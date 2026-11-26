from django.db.models import Count

from seqr.models import Family, Individual, LocusList, PhenotypePrioritization
from seqr.utils.gene_utils import get_gene_ids_for_gene_symbols, get_genes
from seqr.utils.search_suggestion_utils import suggest_inheritance_modes
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.permissions_utils import check_family_view_permission, login_and_policies_required

MAX_CANDIDATE_GENES = 25
MAX_PRIORITIZED_GENES = 10
MAX_PRIORITIZED_RANK = 10
MAX_GENE_WHYS = 3
MAX_GENE_LISTS = 50

INHERITANCE_TYPE = 'inheritance'
GENE_TYPE = 'gene'
GENE_LIST_TYPE = 'gene_list'

CANDIDATE_GENES_SOURCE = 'candidate_genes'
PHENOTYPE_PRIORITIZATION_SOURCE = 'phenotype_prioritization'
PROJECT_GENE_LIST_SOURCE = 'project_gene_list'


def _suggestion(suggestion_type, value, label, sources, why, **kwargs):
    return {
        'id': f'{suggestion_type}:{value}', 'type': suggestion_type, 'value': value, 'label': label,
        'sources': sources, 'why': why, **kwargs,
    }


def _individual_name(individual):
    return individual.display_name or individual.individual_id


def _inheritance_suggestions(individuals, loaded_individual_ids):
    names = {i.id: _individual_name(i) for i in individuals}
    suggestions, notes = suggest_inheritance_modes([{
        'individual_id': names[i.id],
        'sex': i.sex,
        'affected': i.affected,
        'mother': names.get(i.mother_id),
        'father': names.get(i.father_id),
        'has_data': i.id in loaded_individual_ids,
        'expected_inheritance': i.expected_inheritance,
    } for i in individuals])
    return [
        _suggestion(INHERITANCE_TYPE, s['mode'], s['mode'], s['sources'], s['why']) for s in suggestions
    ], notes


def _candidate_gene_whys(affected_individuals, genome_version, notes):
    individuals_by_symbol = {}
    for individual in affected_individuals:
        for gene in individual.candidate_genes or []:
            symbol = (gene.get('gene') or '').strip()
            if symbol:
                individuals_by_symbol.setdefault(symbol, []).append(_individual_name(individual))
    if not individuals_by_symbol:
        notes.append('No candidate genes are recorded for affected individuals.')
        return {}

    symbols = list(individuals_by_symbol.keys())
    if len(symbols) > MAX_CANDIDATE_GENES:
        notes.append(
            f'{len(symbols)} candidate genes are recorded, only the first {MAX_CANDIDATE_GENES} are suggested.'
        )
        symbols = symbols[:MAX_CANDIDATE_GENES]

    symbol_gene_ids = get_gene_ids_for_gene_symbols(
        {symbol for s in symbols for symbol in [s, s.upper()]}, genome_version=genome_version,
    )
    gene_individuals = {}
    unmatched = []
    for symbol in symbols:
        gene_ids = symbol_gene_ids.get(symbol) or symbol_gene_ids.get(symbol.upper())
        if gene_ids:
            names = gene_individuals.setdefault(gene_ids[0], [])
            names += [name for name in individuals_by_symbol[symbol] if name not in names]
        else:
            unmatched.append(symbol)
    if unmatched:
        notes.append(
            f'Recorded candidate genes that do not match a current gene symbol were skipped: {", ".join(unmatched)}.'
        )
    return {
        gene_id: [f'Recorded as a candidate gene for {", ".join(names)}.'] for gene_id, names in gene_individuals.items()
    }


def _prioritized_gene_whys(family, notes):
    prioritizations = PhenotypePrioritization.objects.filter(
        individual__family=family, rank__lte=MAX_PRIORITIZED_RANK,
    ).order_by('rank', 'tool', 'gene_id', 'disease_id').values(
        'gene_id', 'tool', 'rank', 'disease_name', 'individual__display_name', 'individual__individual_id',
    )
    gene_whys = {}
    for row in prioritizations:
        if row['gene_id'] not in gene_whys and len(gene_whys) >= MAX_PRIORITIZED_GENES:
            continue
        whys = gene_whys.setdefault(row['gene_id'], [])
        if len(whys) < MAX_GENE_WHYS:
            individual = row['individual__display_name'] or row['individual__individual_id']
            whys.append(f'Ranked {row["rank"]} by {row["tool"]} for {individual} ({row["disease_name"]}).')
    if not gene_whys:
        notes.append('No phenotype prioritization results are loaded for this family.')
    return gene_whys


def _gene_suggestions(family, affected_individuals, notes):
    genome_version = family.project.genome_version
    source_gene_whys = [
        (CANDIDATE_GENES_SOURCE, _candidate_gene_whys(affected_individuals, genome_version, notes)),
        (PHENOTYPE_PRIORITIZATION_SOURCE, _prioritized_gene_whys(family, notes)),
    ]
    gene_ids = {gene_id for _, gene_whys in source_gene_whys for gene_id in gene_whys}
    if not gene_ids:
        return []

    genes_by_id = get_genes(gene_ids, genome_version=genome_version)
    suggestions = {}
    unmatched = []
    for source, gene_whys in source_gene_whys:
        for gene_id, whys in gene_whys.items():
            if gene_id not in genes_by_id:
                unmatched.append(gene_id)
                continue
            symbol = genes_by_id[gene_id]['geneSymbol']
            suggestion = suggestions.setdefault(gene_id, _suggestion(GENE_TYPE, symbol, symbol, [], '', geneId=gene_id))
            suggestion['sources'].append(source)
            suggestion['why'] = ' '.join([suggestion['why'], *whys]).strip()
    if unmatched:
        notes.append(
            f'Prioritized genes not found in the current gene reference were skipped: {", ".join(sorted(unmatched))}.'
        )
    return list(suggestions.values())


def _gene_list_suggestions(project, notes):
    locus_lists = list(LocusList.objects.filter(projects=project).annotate(
        num_entries=Count('locuslistgene', distinct=True) + Count('locuslistinterval', distinct=True),
    ).order_by('name', 'guid')[:MAX_GENE_LISTS + 1])
    if not locus_lists:
        notes.append('No gene lists are attached to this project.')
    if len(locus_lists) > MAX_GENE_LISTS:
        notes.append(f'Only the first {MAX_GENE_LISTS} project gene lists are shown.')
    return [
        _suggestion(
            GENE_LIST_TYPE, locus_list.guid, locus_list.name, [PROJECT_GENE_LIST_SOURCE],
            f'Gene list with {locus_list.num_entries} entries attached to project {project.name}.',
            numEntries=locus_list.num_entries,
        ) for locus_list in locus_lists[:MAX_GENE_LISTS]
    ]


@login_and_policies_required
def family_search_suggestions(request, family_guid):
    family = Family.objects.select_related('project').get(guid=family_guid)
    check_family_view_permission(family, request.user)

    individuals = list(family.individual_set.order_by('id'))
    loaded_individual_ids = set(
        Individual.objects.filter(family=family, active_datasets__isnull=False).values_list('id', flat=True)
    )
    affected_individuals = [i for i in individuals if i.affected == Individual.AFFECTED_STATUS_AFFECTED]

    suggestions, notes = _inheritance_suggestions(individuals, loaded_individual_ids)
    suggestions += _gene_suggestions(family, affected_individuals, notes)
    suggestions += _gene_list_suggestions(family.project, notes)

    num_hpo_terms = sum(len(i.features or []) for i in affected_individuals)
    if num_hpo_terms:
        notes.append(
            f'{num_hpo_terms} HPO terms are recorded for affected individuals, but seqr has no HPO-to-gene or '
            'HPO-to-panel mapping, so they produce no suggestions.'
        )

    return create_json_response({'familyGuid': family_guid, 'suggestions': suggestions, 'notes': notes})
