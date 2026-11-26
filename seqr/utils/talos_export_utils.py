"""
Maps the queries of a workbook to a configuration fragment for Talos (https://github.com/populationgenomics/talos) and
a fidelity report. This module has no database access: gene lists and genes are resolved by the caller.

Every Talos key written here was checked against Talos TALOS_VERSION at commit TALOS_COMMIT: the key is read by the
Talos code, or (GeneratePanelData.manual_overrides only) documented in its example config and startup schema.

Talos categories are code, not configuration, so a seqr search can not be re-run in Talos. The export is lossy and
every search parameter gets a report row with one of three outcomes:
- exported: the value is written to the Talos key with the same meaning
- approximated: a value is written, but Talos applies it with a different scope or it was merged across queries
- dropped: nothing is written

Values that do not filter in seqr (null, empty, 0 for a quality threshold, an allele frequency of 1) get no row.

Merge rules. Talos has one configuration for a whole run, a workbook has many queries. A setting is merged over the
queries that set it, always in the direction that makes Talos keep what any of those queries would keep:
- maximum frequencies and counts: the highest value
- minimum scores and genotype qualities: the lowest value
- PanelApp panels, genes with a mode of inheritance and consequence terms: the union
- excluded genes: the intersection over all queries of the workbook, as Talos removes a forbidden gene everywhere
Queries that do not set a merged parameter are named in the note, as Talos applies the setting to the whole run.
"""
import math
import re
from string import punctuation

TALOS_VERSION = '12.3.2'
TALOS_COMMIT = 'd279709d4c8b601b2280ccf3fe5edb480f7a77f6'
TALOS_VERSION_LABEL = f'{TALOS_VERSION} (commit {TALOS_COMMIT[:10]})'
# GeneratePanelData.panelapp defaults to https://panelapp-aus.org/api/v1/panels
TALOS_PANELAPP_SOURCE = 'AU'

EXPORTED = 'exported'
APPROXIMATED = 'approximated'
DROPPED = 'dropped'

FORCED_PANELS_KEY = 'GeneratePanelData.forced_panels'
FORBIDDEN_GENES_KEY = 'GeneratePanelData.forbidden_genes'
# The Talos code reads PanelApp.manual_overrides, its example config and startup schema name
# GeneratePanelData.manual_overrides: both are written
MANUAL_OVERRIDES_KEYS = ['PanelApp.manual_overrides', 'GeneratePanelData.manual_overrides']
CRITICAL_CSQ_KEY = 'RunHailFiltering.critical_csq'
ADDITIONAL_CSQ_KEY = 'RunHailFiltering.additional_csq'
SPLICE_AI_KEY = 'RunHailFiltering.spliceai'
ALPHAMISSENSE_KEY = 'RunHailFiltering.am_pathogenicity'
DE_NOVO_GQ_KEY = 'RunHailFiltering.de_novo.min_proband_gq'
DE_NOVO_AB_KEY = 'RunHailFiltering.de_novo.min_child_ab'
GNOMAD_AF_KEY = 'ValidateMOI.gnomad_max_af'
GNOMAD_HOM_KEY = 'ValidateMOI.gnomad_max_homozygotes'
GNOMAD_HEMI_KEY = 'ValidateMOI.gnomad_max_hemizygotes'

GLOBAL_MODEL_NOTE = 'Talos applies this in its Global filter model only: variants considered under a dominant mode ' \
    'of inheritance and ClinVar pathogenic variants keep their own Talos thresholds.'
GNOMAD_NOTE = f'Talos has one gnomAD 4.1 combined threshold where seqr has separate genomes and exomes thresholds. ' \
    f'{GLOBAL_MODEL_NOTE}'
GNOMAD_AF_NOTE = f'{GNOMAD_NOTE} RunHailFiltering.af_semi_rare (default 0.01) is not exported and removes more ' \
    f'common variants earlier in the run: raise it by hand if this value is higher.'
DE_NOVO_NOTE = 'Talos applies this only when it calls de novo variants.'
CSQ_NOTE = 'Terms are written in the bcftools csq spelling of the Talos defaults: a Talos deployment annotated ' \
    'with VEP needs the VEP spellings.'

# rule, type, note
THRESHOLDS = {
    GNOMAD_AF_KEY: (max, float, GNOMAD_AF_NOTE),
    GNOMAD_HOM_KEY: (max, int, GNOMAD_NOTE),
    GNOMAD_HEMI_KEY: (max, int, f'seqr has one limit for homozygotes and hemizygotes. {GNOMAD_NOTE}'),
    'ValidateMOI.callset_max_af': (max, float, f'Talos only applies it to variants with a callset allele count '
                                               f'above ValidateMOI.min_callset_ac_to_filter. {GLOBAL_MODEL_NOTE}'),
    'ValidateMOI.gnomad_sv_max_af': (max, float, GLOBAL_MODEL_NOTE),
    'ValidateMOI.callset_sv_max_af': (max, float, GLOBAL_MODEL_NOTE),
    SPLICE_AI_KEY: (min, float, 'Talos does not filter by SpliceAI: it labels variants at or above this delta score '
                                'for prioritisation, and only where the Talos callset has SpliceAI annotations.'),
    ALPHAMISSENSE_KEY: (min, float, 'Talos does not filter by AlphaMissense: it labels missense variants at or above '
                                    'this score for prioritisation.'),
    DE_NOVO_GQ_KEY: (min, int, DE_NOVO_NOTE),
    DE_NOVO_AB_KEY: (min, float, f'Converted from a percentage to a fraction. {DE_NOVO_NOTE}'),
}

FREQUENCY_KEYS = {
    'gnomad_genomes': {'af': [GNOMAD_AF_KEY], 'hh': [GNOMAD_HOM_KEY, GNOMAD_HEMI_KEY]},
    'gnomad_exomes': {'af': [GNOMAD_AF_KEY], 'hh': [GNOMAD_HOM_KEY, GNOMAD_HEMI_KEY]},
    'callset': {'af': ['ValidateMOI.callset_max_af']},
    'gnomad_svs': {'af': ['ValidateMOI.gnomad_sv_max_af']},
    'sv_callset': {'af': ['ValidateMOI.callset_sv_max_af']},
}

IN_SILICO_KEYS = {'splice_ai': SPLICE_AI_KEY, 'alphamissense': ALPHAMISSENSE_KEY}

# seqr (VEP) term to the term of the Talos defaults (CRITICAL_CSQ_DEFAULT and ADDITIONAL_CSQ_DEFAULT)
CONSEQUENCE_TERMS = {
    'frameshift_variant': (CRITICAL_CSQ_KEY, 'frameshift'),
    'splice_acceptor_variant': (CRITICAL_CSQ_KEY, 'splice_acceptor'),
    'splice_donor_variant': (CRITICAL_CSQ_KEY, 'splice_donor'),
    'start_lost': (CRITICAL_CSQ_KEY, 'start_lost'),
    'stop_gained': (CRITICAL_CSQ_KEY, 'stop_gained'),
    'stop_lost': (CRITICAL_CSQ_KEY, 'stop_lost'),
    'transcript_ablation': (CRITICAL_CSQ_KEY, 'transcript_ablation'),
    'missense_variant': (ADDITIONAL_CSQ_KEY, 'missense'),
    'inframe_deletion': (ADDITIONAL_CSQ_KEY, 'inframe_deletion'),
    'inframe_insertion': (ADDITIONAL_CSQ_KEY, 'inframe_insertion'),
}
CONSEQUENCE_NOTES = {
    CRITICAL_CSQ_KEY: f'These terms define the High Impact category of Talos. {CSQ_NOTE}',
    ADDITIONAL_CSQ_KEY: f'Talos only uses these terms, with the critical terms, to limit its de novo candidates. '
                        f'{CSQ_NOTE}',
}

# Most lenient first, as in Talos
TALOS_MOIS = ['Mono_And_Biallelic', 'Monoallelic', 'Hemi_Mono_In_Female', 'Hemi_Bi_In_Female', 'Biallelic',
              'Mitochondrial']

DE_NOVO = 'de_novo'

SECONDARY_NOTE = 'Talos has no separate consequence filter for the second variant of a compound heterozygous pair.'
DROPPED_NOTES = {
    'inheritance.mode': 'Talos does not take an inheritance mode: it tests every variant against the mode of '
                        'inheritance PanelApp gives for its gene.',
    'inheritance.filter': 'Talos has no custom genotype or affected status filters.',
    'inheritance.annotationSecondary': SECONDARY_NOTE,
    'pathogenicity.clinvar': 'Talos always prioritises ClinVar pathogenic and likely pathogenic variants in its own '
                             'categories: the selected classifications can not be configured.',
    'pathogenicity.hgmd': 'Talos does not use HGMD.',
    'pathogenicity.clinvarMinStars': 'Talos has no configurable ClinVar star threshold.',
    'exclude.clinvar': 'Talos can not exclude variants by ClinVar classification.',
    'exclude.previousSearch': 'Excluding the results of a previous search has no meaning in Talos.',
    'locus.rawVariantItems': 'Talos can not be limited to a list of variants.',
    'locus.selectedMOIs': 'Talos uses the PanelApp mode of inheritance of every gene and can not select genes by it.',
    'in_silico.requireScore': 'Talos has no setting to require a predictor score.',
    'qualityFilter.vcf_filter': 'Talos has no configurable VCF filter requirement.',
    'qualityFilter.affected_only': 'Talos has no setting to limit quality filters to affected individuals.',
    'qualityFilter.min_qs': 'Talos has no configurable structural variant quality filters.',
    'qualityFilter.min_gq_sv': 'Talos has no configurable structural variant quality filters.',
    'qualityFilter.min_hl': 'The mitochondrial heteroplasmy threshold of Talos is not exported.',
}
NOT_DE_NOVO_NOTE = 'Talos has configurable genotype quality thresholds for de novo calling only, and this is not a ' \
    'de novo query.'
NO_MOI_NOTE = 'Not exported as manual overrides: seqr has no PanelApp mode of inheritance for these genes, and a ' \
    'Talos manual override without one replaces the mode of inheritance of the gene with Mono_And_Biallelic for the ' \
    'whole run. Add them to the Talos configuration by hand with a mode of inheritance.'

INTERVAL_REGEX = re.compile(r'\w+:\d+-\d+(%\d+)?$|\w+<TAB>\d+<TAB>\d+$')


def _is_empty(value):
    if isinstance(value, dict):
        return all(_is_empty(val) for val in value.values())
    return value is None or value is False or value == '' or value == []


def _parse_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def _is_unfiltered(field, value):
    # seqr does not filter on an allele frequency of 1
    number = _parse_number(value)
    return _is_empty(value) or (field == 'af' and number is not None and number >= 1)


def _format_number(value, number_type):
    if number_type is float:
        return float(value)
    return int(value) if float(value).is_integer() else None


def parse_locus_items(raw_items):
    """Splits a seqr gene/interval text the way a seqr search does."""
    parsed = {'geneIds': [], 'symbols': [], 'intervals': []}
    if not isinstance(raw_items, str):
        return parsed
    for item in dict.fromkeys(raw_items.replace(',', ' ').replace('\t', '<TAB>').split()):
        if INTERVAL_REGEX.match(item):
            parsed['intervals'].append(item.replace('<TAB>', ' '))
        elif item.upper().startswith('ENSG'):
            parsed['geneIds'].append(item.replace('<TAB>', ''))
        else:
            parsed['symbols'].append(item.replace('<TAB>', ''))
    return parsed


def get_talos_moi(panel_app_moi, chrom=None):
    """The Talos mode of inheritance for a PanelApp one, following get_simple_moi of Talos. None if it has none."""
    words = (panel_app_moi or '').lower().translate(str.maketrans('', '', punctuation)).split()
    first = words[0] if words else None
    if words == ['mitochondrial']:
        return 'Mitochondrial'
    if first == 'biallelic':
        return 'Biallelic'
    if first == 'both':
        return 'Mono_And_Biallelic'
    if first == 'monoallelic':
        return 'Hemi_Mono_In_Female' if chrom == 'X' else 'Monoallelic'
    if first == 'xlinked':
        return 'Hemi_Bi_In_Female' if 'biallelic' in words else 'Hemi_Mono_In_Female'
    return None


def _merge_mois(mois):
    if {'Biallelic', 'Monoallelic'} <= mois:
        return 'Mono_And_Biallelic'
    return sorted(mois, key=TALOS_MOIS.index)[0]


class _QueryMapper:

    def __init__(self, export, query):
        self.export = export
        self.name = query.get('name')
        self.identifiers = {
            'query': self.name, 'queryGuid': query.get('guid'), 'worksheet': query.get('worksheet'),
        }
        self.rows = []
        self.excluded_gene_ids = set()
        self.is_de_novo = False

    def row(self, parameter, value, outcome, note, talos_key=None):
        row = {**self.identifiers, 'parameter': parameter, 'value': value, 'outcome': outcome, 'note': note}
        if talos_key:
            row['talosKey'] = talos_key
        self.rows.append(row)
        return row

    def drop(self, parameter, value, note=None):
        self.row(parameter, value, DROPPED, note or DROPPED_NOTES[parameter])

    def drop_unknown(self, parameter, value):
        self.drop(parameter, value, f'Unknown search parameter "{parameter}": seqr does not know how to export it.')

    def threshold(self, parameter, value, talos_key, convert=None):
        number_type = THRESHOLDS[talos_key][1]
        number = _parse_number(value)
        if number is not None and convert:
            number = convert(number)
        number = None if number is None else _format_number(number, number_type)
        if number is None:
            type_name = 'number' if number_type is float else 'whole number'
            self.drop(parameter, value, f'Not exported: the value is not a {type_name}.')
            return
        row = self.row(parameter, value, APPROXIMATED, '', talos_key=talos_key)
        self.export.thresholds.setdefault(talos_key, []).append((self, row, number))

    def map_search(self, search):
        if not isinstance(search, dict):
            self.drop('search', search, 'Not exported: the search of this query is not a JSON object.')
            return
        inheritance = search.get('inheritance')
        self.is_de_novo = isinstance(inheritance, dict) and inheritance.get('mode') == DE_NOVO
        # Stored searches do not keep the order of their keys
        keys = [key for key in SEARCH_HANDLERS if key in search] + [key for key in search if key not in SEARCH_HANDLERS]
        for key in keys:
            value = search[key]
            handler = SEARCH_HANDLERS.get(key)
            if handler is None:
                self.drop_unknown(key, value)
            elif _is_empty(value):
                continue
            elif not isinstance(value, dict):
                self.drop(key, value, f'Not exported: "{key}" does not have the format of a seqr search.')
            else:
                handler(self, value)

    def map_dropped_fields(self, section, values):
        for field, value in values.items():
            if _is_empty(value):
                continue
            parameter = f'{section}.{field}'
            if parameter in DROPPED_NOTES:
                self.drop(parameter, value)
            else:
                self.drop_unknown(parameter, value)

    def map_inheritance(self, inheritance):
        self.map_dropped_fields('inheritance', inheritance)

    def map_pathogenicity(self, pathogenicity):
        self.map_dropped_fields('pathogenicity', pathogenicity)

    def map_annotations_secondary(self, annotations):
        self.drop('annotations_secondary', annotations, SECONDARY_NOTE)

    def map_frequencies(self, freqs):
        for population, population_filter in freqs.items():
            parameter = f'freqs.{population}'
            if isinstance(population_filter, dict):
                population_filter = {
                    field: value for field, value in population_filter.items() if not _is_unfiltered(field, value)
                }
            if _is_empty(population_filter):
                continue
            if population not in FREQUENCY_KEYS:
                self.drop(parameter, population_filter, 'Talos has no frequency filter for this population.')
            elif not isinstance(population_filter, dict):
                self.drop(parameter, population_filter, 'Not exported: not a seqr frequency filter.')
            else:
                self._map_population(parameter, population_filter, FREQUENCY_KEYS[population])

    def _map_population(self, parameter, population_filter, talos_keys):
        for field, value in population_filter.items():
            field_parameter = f'{parameter}.{field}'
            if field in talos_keys:
                for talos_key in talos_keys[field]:
                    self.threshold(field_parameter, value, talos_key)
            elif field in {'af', 'ac', 'hh'}:
                self.drop(field_parameter, value, 'Talos has no such limit in its Global filter model.')
            else:
                self.drop_unknown(field_parameter, value)

    def map_annotations(self, annotations):
        for group, terms in annotations.items():
            parameter = f'annotations.{group}'
            if _is_empty(terms):
                continue
            if group == 'splice_ai':
                self.threshold(parameter, terms, SPLICE_AI_KEY)
            elif not isinstance(terms, list):
                self.drop(parameter, terms, 'Not exported: not a list of consequence terms.')
            else:
                self._map_consequences(parameter, terms)

    def _map_consequences(self, parameter, terms):
        unmapped = []
        mapped = {}
        for term in terms:
            talos_key, talos_term = CONSEQUENCE_TERMS.get(term, (None, None)) if isinstance(term, str) else (None, None)
            if talos_key:
                mapped.setdefault(talos_key, {})[term] = talos_term
            else:
                unmapped.append(term)
        for talos_key, talos_terms in mapped.items():
            row = self.row(parameter, list(talos_terms.keys()), APPROXIMATED, '', talos_key=talos_key)
            self.export.consequences.setdefault(talos_key, []).append((self, row, set(talos_terms.values())))
        if unmapped:
            self.drop(
                parameter, unmapped,
                'No counterpart among the consequence terms Talos is configured with (critical_csq and '
                'additional_csq). Talos structural variant and other categories are code and can not be configured.',
            )

    def map_in_silico(self, in_silico):
        for score, value in in_silico.items():
            parameter = f'in_silico.{score}'
            if _is_empty(value):
                continue
            if score in IN_SILICO_KEYS:
                self.threshold(parameter, value, IN_SILICO_KEYS[score])
            elif parameter in DROPPED_NOTES:
                self.drop(parameter, value)
            else:
                self.drop(parameter, value, 'Talos has no configurable threshold for this predictor.')

    def map_quality(self, quality):
        de_novo_keys = {
            'min_gq': (DE_NOVO_GQ_KEY, None),
            'min_ab': (DE_NOVO_AB_KEY, lambda value: value / 100),
        }
        for field, value in quality.items():
            parameter = f'qualityFilter.{field}'
            if _is_empty(value) or value == 0:
                continue
            if field in de_novo_keys and self.is_de_novo:
                talos_key, convert = de_novo_keys[field]
                self.threshold(parameter, value, talos_key, convert=convert)
            elif field in de_novo_keys:
                self.drop(parameter, value, NOT_DE_NOVO_NOTE)
            elif parameter in DROPPED_NOTES:
                self.drop(parameter, value)
            else:
                self.drop_unknown(parameter, value)

    def _resolve_genes(self, parameter, raw_items):
        parsed = parse_locus_items(raw_items)
        if parsed['intervals']:
            self.drop(parameter, parsed['intervals'], 'Talos works on genes and has no interval filter.')
        gene_ids = list(parsed['geneIds'])
        unknown = []
        for symbol in parsed['symbols']:
            gene_id = self.export.gene_ids_by_symbol.get(symbol)
            if gene_id:
                gene_ids.append(gene_id)
            else:
                unknown.append(symbol)
        if unknown:
            self.drop(parameter, unknown, 'Not exported: seqr has no Ensembl gene id for these gene symbols.')
        return list(dict.fromkeys(gene_ids))

    def _gene_label(self, gene_id):
        return (self.export.genes_by_id.get(gene_id) or {}).get('symbol') or gene_id

    def map_exclude(self, exclude):
        for field, value in exclude.items():
            if field == 'rawItems':
                self.excluded_gene_ids.update(self._resolve_genes('exclude.rawItems', value))
            else:
                self.map_dropped_fields('exclude', {field: value})

    def map_locus(self, locus):
        self.map_dropped_fields('locus', {
            field: value for field, value in locus.items()
            if field not in {'locusListGuid', 'rawItems', 'panelAppItems'}
        })

        locus_list_guid = locus.get('locusListGuid')
        locus_list = self.export.locus_lists.get(locus_list_guid) or {}
        panel_app_id = locus_list.get('panelAppId')
        source = locus_list.get('paSource')
        panel_items = locus.get('panelAppItems')
        if source == TALOS_PANELAPP_SOURCE:
            self.row(
                'locus.locusListGuid', f'{locus_list.get("name")} (PanelApp {source} panel {panel_app_id})', EXPORTED,
                'Talos applies the current version of this panel to every participant of the run, whatever their '
                'phenotype, and takes the mode of inheritance of every gene from PanelApp.', talos_key=FORCED_PANELS_KEY,
            )
            self.export.forced_panels.add(panel_app_id)
            if not _is_empty(panel_items):
                self.drop(
                    'locus.panelAppItems', panel_items,
                    'The genes selected within the panel are not exported: Talos uses the genes of the panel at its '
                    'own GeneratePanelData.confidence_level (default: green genes only).',
                )
            return
        if source:
            self.drop(
                'locus.locusListGuid', f'{locus_list.get("name")} (PanelApp {source} panel {panel_app_id})',
                f'Talos reads PanelApp {TALOS_PANELAPP_SOURCE} (GeneratePanelData.panelapp), so this panel can not be '
                f'exported as a panel. Its genes are exported one by one where seqr has their mode of inheritance.',
            )

        raw_items = locus.get('rawItems')
        if _is_empty(raw_items) and isinstance(panel_items, dict):
            raw_items = ' '.join(items for items in panel_items.values() if isinstance(items, str))
        if _is_empty(raw_items):
            if locus_list_guid and not source:
                self.drop(
                    'locus.locusListGuid', locus_list.get('name') or locus_list_guid,
                    'Not exported: the query refers to a gene list but did not save its genes.',
                )
            return
        self._map_genes(self._resolve_genes('locus.rawItems', raw_items), locus_list.get('geneMois') or {})

    def _map_genes(self, gene_ids, panel_app_mois):
        with_moi = {}
        for gene_id in gene_ids:
            chrom = (self.export.genes_by_id.get(gene_id) or {}).get('chrom')
            moi = get_talos_moi(panel_app_mois.get(gene_id), chrom)
            if moi:
                with_moi[gene_id] = moi
        without_moi = [gene_id for gene_id in gene_ids if gene_id not in with_moi]
        if with_moi:
            self.row(
                'locus.rawItems', [f'{self._gene_label(gene_id)} ({moi})' for gene_id, moi in with_moi.items()],
                APPROXIMATED,
                'Exported gene by gene with the PanelApp mode of inheritance seqr has for it, simplified to the '
                'Talos modes. Talos applies these genes to every participant of the run and this mode of inheritance '
                'replaces the one Talos would get from PanelApp Australia. Written to both keys: the Talos code '
                'reads PanelApp.manual_overrides, its documentation names GeneratePanelData.manual_overrides.',
                talos_key=', '.join(MANUAL_OVERRIDES_KEYS),
            )
            for gene_id, moi in with_moi.items():
                self.export.override_mois.setdefault(gene_id, set()).add(moi)
        if without_moi:
            self.drop('locus.rawItems', [self._gene_label(gene_id) for gene_id in without_moi], NO_MOI_NOTE)


SEARCH_HANDLERS = {
    'inheritance': _QueryMapper.map_inheritance,
    'freqs': _QueryMapper.map_frequencies,
    'annotations': _QueryMapper.map_annotations,
    'annotations_secondary': _QueryMapper.map_annotations_secondary,
    'pathogenicity': _QueryMapper.map_pathogenicity,
    'in_silico': _QueryMapper.map_in_silico,
    'qualityFilter': _QueryMapper.map_quality,
    'locus': _QueryMapper.map_locus,
    'exclude': _QueryMapper.map_exclude,
}


class _Export:

    def __init__(self, locus_lists, gene_ids_by_symbol, genes_by_id):
        self.locus_lists = locus_lists or {}
        self.gene_ids_by_symbol = gene_ids_by_symbol or {}
        self.genes_by_id = genes_by_id or {}
        self.mappers = []
        self.thresholds = {}
        self.consequences = {}
        self.forced_panels = set()
        self.override_mois = {}
        self.config = {}

    def _set(self, talos_key, value):
        *tables, key = talos_key.split('.')
        config = self.config
        for table in tables:
            config = config.setdefault(table, {})
        config[key] = value

    def _other_queries_note(self, candidates):
        names = [mapper.name for mapper in self.mappers if all(mapper is not candidate[0] for candidate in candidates)]
        if not names:
            return ''
        quoted = ', '.join(f'"{name}"' for name in names)
        return f' Talos also applies it to the variants of the queries that do not set it: {quoted}.'

    def _merge_thresholds(self):
        for talos_key, candidates in self.thresholds.items():
            rule, _, note = THRESHOLDS[talos_key]
            merged = rule(number for _, _, number in candidates)
            self._set(talos_key, merged)
            direction = 'highest' if rule is max else 'lowest'
            for _, row, number in candidates:
                merge_note = '' if number == merged else \
                    f' Merged: Talos gets {merged}, the {direction} value of the workbook, not {number}.'
                row['note'] = f'{note}{merge_note}{self._other_queries_note(candidates)}'

    def _merge_consequences(self):
        for talos_key, candidates in self.consequences.items():
            merged = sorted(set().union(*(terms for _, _, terms in candidates)))
            self._set(talos_key, merged)
            for _, row, terms in candidates:
                merge_note = '' if sorted(terms) == merged else \
                    f' Merged: Talos gets the terms of all queries ({", ".join(merged)}).'
                row['note'] = f'{CONSEQUENCE_NOTES[talos_key]}{merge_note}{self._other_queries_note(candidates)}'

    def _merge_excluded_genes(self):
        forbidden = set.intersection(*(mapper.excluded_gene_ids for mapper in self.mappers)) if self.mappers else set()
        if forbidden:
            self._set(FORBIDDEN_GENES_KEY, sorted(forbidden))
        for mapper in self.mappers:
            exported = sorted(mapper.excluded_gene_ids & forbidden)
            dropped = sorted(mapper.excluded_gene_ids - forbidden)
            if exported:
                mapper.row(
                    'exclude.rawItems', [mapper._gene_label(gene_id) for gene_id in exported], EXPORTED,
                    'Talos removes these genes from every panel of the run.', talos_key=FORBIDDEN_GENES_KEY,
                )
            if dropped:
                mapper.drop(
                    'exclude.rawItems', [mapper._gene_label(gene_id) for gene_id in dropped],
                    'Not exported: Talos removes a forbidden gene for the whole run, and not every query of this '
                    'workbook excludes these genes.',
                )

    def _set_genes(self):
        if self.forced_panels:
            self._set(FORCED_PANELS_KEY, sorted(self.forced_panels))
        overrides = []
        for gene_id in sorted(self.override_mois):
            override = {'ensg': gene_id, 'moi': _merge_mois(self.override_mois[gene_id])}
            symbol = (self.genes_by_id.get(gene_id) or {}).get('symbol')
            if symbol:
                override['symbol'] = symbol
            overrides.append(override)
        if overrides:
            for talos_key in MANUAL_OVERRIDES_KEYS:
                self._set(talos_key, [dict(override) for override in overrides])

    def build(self, queries):
        for query in queries:
            mapper = _QueryMapper(self, query)
            self.mappers.append(mapper)
            mapper.map_search(query.get('search'))
        self._set_genes()
        self._merge_excluded_genes()
        self._merge_thresholds()
        self._merge_consequences()
        return {
            'config': self.config,
            'report': [row for mapper in self.mappers for row in mapper.rows],
            'talosVersion': TALOS_VERSION_LABEL,
        }


def build_talos_export(queries, locus_lists=None, gene_ids_by_symbol=None, genes_by_id=None):
    """
    queries: [{guid, name, worksheet, search}], search in the seqr saved search format
    locus_lists: {locusListGuid: {name, paSource, panelAppId, geneMois: {gene id: PanelApp mode of inheritance}}}
    gene_ids_by_symbol: {gene symbol: Ensembl gene id}
    genes_by_id: {Ensembl gene id: {symbol, chrom}}

    Returns {config: nested dict for dumps_toml, report: [{query, queryGuid, worksheet, parameter, value, outcome,
    talosKey?, note}], talosVersion}
    """
    return _Export(locus_lists, gene_ids_by_symbol, genes_by_id).build(queries)


BARE_KEY_REGEX = re.compile(r'[A-Za-z0-9_-]+$')
TOML_ESCAPES = {'\\': '\\\\', '"': '\\"', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r'}


def _toml_string(value):
    escaped = []
    for char in value:
        code = ord(char)
        if char in TOML_ESCAPES:
            escaped.append(TOML_ESCAPES[char])
        elif code < 0x20 or code == 0x7f:
            escaped.append(f'\\u{code:04x}')
        elif 0xd800 <= code <= 0xdfff:
            escaped.append('\\ufffd')
        else:
            escaped.append(char)
    return f'"{"".join(escaped)}"'


def _toml_key(key):
    if not isinstance(key, str):
        raise TypeError(f'TOML keys must be strings: {key!r}')
    return key if BARE_KEY_REGEX.match(key) else _toml_string(key)


def _is_table_array(value):
    return isinstance(value, list) and bool(value) and all(isinstance(item, dict) for item in value)


def _toml_value(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return 'nan'
        if math.isinf(value):
            return 'inf' if value > 0 else '-inf'
        return repr(value)
    if isinstance(value, str):
        return _toml_string(value)
    if isinstance(value, list):
        return f'[{", ".join(_toml_value(item) for item in value)}]'
    if isinstance(value, dict):
        return f'{{{", ".join(f"{_toml_key(key)} = {_toml_value(val)}" for key, val in value.items())}}}'
    raise TypeError(f'Unsupported TOML value: {value!r}')


def _toml_table(table, path, lines):
    for key, value in table.items():
        if not (isinstance(value, dict) or _is_table_array(value)):
            lines.append(f'{_toml_key(key)} = {_toml_value(value)}')
    for key, value in table.items():
        name = '.'.join([*path, _toml_key(key)])
        if isinstance(value, dict):
            lines += ['', f'[{name}]']
            _toml_table(value, [*path, _toml_key(key)], lines)
        elif _is_table_array(value):
            for item in value:
                lines += ['', f'[[{name}]]']
                _toml_table(item, [*path, _toml_key(key)], lines)


def dumps_toml(config):
    """A minimal TOML writer for nested dicts of strings, numbers, booleans, lists and tables."""
    if not isinstance(config, dict):
        raise TypeError('The TOML document must be a table')
    lines = []
    _toml_table(config, [], lines)
    return '\n'.join(lines).strip('\n') + '\n'


def _comment_text(text):
    return ''.join(' ' if ord(char) < 0x20 or ord(char) == 0x7f or 0xd800 <= ord(char) <= 0xdfff else char for char in text)


def render_talos_toml(config, workbook_name=''):
    header = [
        f'Talos configuration fragment exported from the seqr workbook "{_comment_text(workbook_name)}"',
        f'Written for Talos {TALOS_VERSION}, commit {TALOS_COMMIT}',
        'This is a starting configuration and NOT an equivalent of the seqr queries: see the fidelity report in seqr.',
        'Talos reads one complete TOML file: merge these keys into your Talos configuration by hand.',
    ]
    if not config:
        header.append('No parameter of this workbook could be exported.')
    return '\n'.join(f'# {line}' for line in header) + '\n\n' + (dumps_toml(config) if config else '')
