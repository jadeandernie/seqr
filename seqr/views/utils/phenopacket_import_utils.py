from collections import defaultdict
from django.core.exceptions import PermissionDenied

from reference_data.models import HumanPhenotypeOntology
from seqr.models import Individual
from seqr.utils.gene_utils import get_genes, get_gene_ids_for_gene_symbols
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.utils.individual_utils import add_or_update_individuals_and_families
from seqr.views.utils.orm_to_json_utils import _get_json_for_individuals
from seqr.views.utils.permissions_utils import check_project_pm_permission, external_anvil_project_can_edit

MERGE = 'merge'
REPLACE = 'replace'

FEATURES_FIELD = 'features'
ABSENT_FEATURES_FIELD = 'absentFeatures'
FEATURE_KEYS = [FEATURES_FIELD, ABSENT_FEATURES_FIELD]
MONDO_FIELD = 'mondoId'
PARENT_FIELDS = {
    'maternalId': ('maternal_id', 'mother', Individual.MALE_SEXES),
    'paternalId': ('paternal_id', 'father', Individual.FEMALE_SEXES),
}
PEDIGREE_FIELDS = ['sex', 'affected', *PARENT_FIELDS]
LIST_ITEM_KEYS = {
    'disorders': lambda disorder: disorder,
    'candidateGenes': lambda gene: (gene.get('gene') or '').upper(),
}
# Preview/selection field -> (label, key in the parsed Phenopacket record)
IMPORT_FIELDS = {
    FEATURES_FIELD: ('HPO terms', None),
    'disorders': ('Disorders (OMIM)', 'disorders'),
    'candidateGenes': ('Candidate genes', 'candidate_genes'),
    'birthYear': ('Birth year', 'birth_year'),
    'onsetAge': ('Age of onset', 'onset_age'),
    'consanguinity': ('Consanguinity', 'consanguinity'),
    'sex': ('Sex', 'sex'),
    'affected': ('Affected status', 'affected'),
    'maternalId': ('Mother', None),
    'paternalId': ('Father', None),
    MONDO_FIELD: ('Family MONDO ID', 'mondo_id'),
}
LIST_FIELDS = {FEATURES_FIELD, *LIST_ITEM_KEYS}
DISPLAY_LOOKUPS = {
    'sex': Individual.SEX_LOOKUP,
    'affected': Individual.AFFECTED_STATUS_LOOKUP,
    'onsetAge': Individual.ONSET_AGE_LOOKUP,
    'consanguinity': {True: 'Yes', False: 'No'},
}
ENSEMBL_ID_PREFIX = 'ensembl:'


def can_edit_pedigree(project, user):
    try:
        check_project_pm_permission(project, user, override_permission_func=external_anvil_project_can_edit)
    except PermissionDenied:
        return False
    return True


def _project_individuals(project, **filters):
    return Individual.objects.filter(family__project=project, **filters).select_related('family', 'mother', 'father')


def _current_values(individual):
    return {
        FEATURES_FIELD: {
            FEATURES_FIELD: individual.features or [], ABSENT_FEATURES_FIELD: individual.absent_features or [],
        },
        'disorders': individual.disorders or [],
        'candidateGenes': individual.candidate_genes or [],
        'birthYear': individual.birth_year or None,
        'onsetAge': individual.onset_age or None,
        'consanguinity': individual.consanguinity,
        'sex': None if individual.sex == Individual.SEX_UNKNOWN else individual.sex,
        'affected': None if individual.affected == Individual.AFFECTED_STATUS_UNKNOWN else individual.affected,
        'maternalId': individual.mother.individual_id if individual.mother else None,
        'paternalId': individual.father.individual_id if individual.father else None,
        MONDO_FIELD: individual.family.mondo_id or None,
    }


def _feature_conflicts(current, proposed):
    return [
        feature['id'] for key, other_key in [FEATURE_KEYS, FEATURE_KEYS[::-1]] for feature in proposed[key]
        if feature['id'] in {current_feature['id'] for current_feature in current[other_key]}
    ]


def _resolve(field, current, proposed, mode):
    """Returns the value the field would have after applying the proposed value with the given mode."""
    if mode == REPLACE:
        return proposed
    if field == FEATURES_FIELD:
        current_ids = {feature['id'] for key in FEATURE_KEYS for feature in current[key]}
        return {
            key: current[key] + [feature for feature in proposed[key] if feature['id'] not in current_ids]
            for key in FEATURE_KEYS
        }
    if field in LIST_ITEM_KEYS:
        item_key = LIST_ITEM_KEYS[field]
        current_keys = {item_key(item) for item in current}
        return current + [item for item in proposed if item_key(item) not in current_keys]
    return proposed if current is None else current


def _feature_display(feature, hpo_names, prefix=''):
    qualifiers = ', '.join(qualifier['label'] for qualifier in feature.get('qualifiers') or [])
    return f'{prefix}{hpo_names.get(feature["id"], "Unknown term")} ({feature["id"]}){f" [{qualifiers}]" if qualifiers else ""}'


def _display(field, value, hpo_names):
    if field == FEATURES_FIELD:
        return [_feature_display(feature, hpo_names) for feature in value[FEATURES_FIELD]] + [
            _feature_display(feature, hpo_names, prefix='Absent: ') for feature in value[ABSENT_FEATURES_FIELD]
        ]
    if field == 'disorders':
        return [f'OMIM:{disorder}' for disorder in value]
    if field == 'candidateGenes':
        return [gene.get('gene') or '' for gene in value]
    if value is None:
        return None
    return str(DISPLAY_LOOKUPS.get(field, {}).get(value, value))


def _get_change(field, current, proposed, hpo_names):
    merged = _resolve(field, current, proposed, MERGE)
    can_merge = merged != current
    can_replace = proposed != merged
    if not (can_merge or can_replace):
        return None
    is_list = field in LIST_FIELDS
    change = {
        'field': field,
        'label': IMPORT_FIELDS[field][0],
        'isList': is_list,
        'current': _display(field, current, hpo_names),
        'proposed': _display(field, proposed, hpo_names),
        'canMerge': can_merge,
        'canReplace': can_replace,
        'conflict': can_replace and not is_list,
    }
    if is_list:
        merged_display = _display(field, merged, hpo_names)
        change.update({
            'added': [item for item in merged_display if item not in change['current']],
            'removed': [item for item in change['current'] if item not in change['proposed']],
        })
    if field == FEATURES_FIELD:
        conflicts = _feature_conflicts(current, proposed)
        change.update({
            'conflict': bool(conflicts),
            'conflicts': [f'{hpo_names[hpo_id]} ({hpo_id})' for hpo_id in conflicts],
        })
    return change


def _ensembl_ids(gene):
    return [
        gene_id[len(ENSEMBL_ID_PREFIX):] for gene_id in gene['ids'] if gene_id.lower().startswith(ENSEMBL_ID_PREFIX)
    ]


def _resolve_genes(records):
    """Returns a function giving the seqr gene symbol for a parsed gene reference, or None if seqr does not know it."""
    gene_refs = [gene for record in records for gene in record.get('candidate_genes', [])]
    ensembl_ids = {gene_id for gene in gene_refs for gene_id in _ensembl_ids(gene)}
    symbols_by_ensembl_id = {
        gene_id: gene['geneSymbol'] for gene_id, gene in get_genes(ensembl_ids).items()
    } if ensembl_ids else {}
    known_symbols = get_gene_ids_for_gene_symbols({gene['symbol'] for gene in gene_refs if gene['symbol']})

    def resolve(gene):
        ensembl_symbol = next(
            (symbols_by_ensembl_id[gene_id] for gene_id in _ensembl_ids(gene) if gene_id in symbols_by_ensembl_id), None)
        return ensembl_symbol or (gene['symbol'] if gene['symbol'] in known_symbols else None)
    return resolve


def _get_proposed_values(record, individual, parents_by_id, hpo_names, resolve_gene, pedigree_allowed, warnings):
    proposed = {
        field: record[record_key] for field, (_, record_key) in IMPORT_FIELDS.items() if record_key in record
    }

    features = {key: record.get(record_key, []) for key, record_key in zip(FEATURE_KEYS, ['features', 'absent_features'])}
    unknown_hpo_terms = sorted({feature['id'] for terms in features.values() for feature in terms} - set(hpo_names))
    features = {
        key: [feature for feature in terms if feature['id'] in hpo_names] for key, terms in features.items()
    }
    if any(features.values()):
        proposed[FEATURES_FIELD] = features

    if 'candidateGenes' in proposed:
        symbols = [(resolve_gene(gene), gene) for gene in proposed.pop('candidateGenes')]
        unresolved = [gene['symbol'] or gene['ids'][0] for symbol, gene in symbols if not symbol]
        if unresolved:
            warnings.append(
                f'Gene(s) not found in seqr\'s gene reference data and not proposed: {", ".join(unresolved)}')
        genes = list(dict.fromkeys(symbol for symbol, _ in symbols if symbol))
        if genes:
            proposed['candidateGenes'] = [{'gene': symbol} for symbol in genes]

    for field, (record_key, label, invalid_sexes) in PARENT_FIELDS.items():
        if record_key not in record:
            continue
        parent = parents_by_id.get(record[record_key])
        if not parent or parent.family_id != individual.family_id or parent == individual:
            warnings.append(f'The pedigree {label} is not another individual in the same seqr family and is not proposed')
        elif parent.sex in invalid_sexes:
            warnings.append(f'The pedigree {label} has an incompatible sex in seqr and is not proposed')
        else:
            proposed[field] = parent.individual_id

    if not pedigree_allowed:
        current = _current_values(individual)
        blocked = [IMPORT_FIELDS[field][0] for field in PEDIGREE_FIELDS if field in proposed and proposed.pop(field) != current[field]]
        if blocked:
            warnings.append(
                f'{", ".join(blocked)} differ from seqr but changing them requires project manager permission; not proposed')

    return proposed, unknown_hpo_terms


def get_phenopacket_import_preview(parsed, project, user):
    """
    Returns (records to stash for the save step keyed by individual guid, preview json for the uploader).
    Subjects are matched to existing individuals on individual id; unmatched subjects are reported, never created.
    """
    records = parsed['individuals']
    individuals_by_id = {i.individual_id: i for i in _project_individuals(
        project, individual_id__in=[record['individual_id'] for record in records])}
    parent_ids = {record[key] for record in records for key in ['maternal_id', 'paternal_id'] if key in record}
    parents_by_id = {i.individual_id: i for i in _project_individuals(project, individual_id__in=parent_ids)}
    matched_records = [record for record in records if record['individual_id'] in individuals_by_id]

    hpo_ids = {
        feature['id'] for record in matched_records for key in ['features', 'absent_features']
        for feature in record.get(key, [])
    }
    for individual in individuals_by_id.values():
        hpo_ids.update(feature['id'] for key in ['features', 'absent_features'] for feature in getattr(individual, key) or [])
    hpo_names = dict(HumanPhenotypeOntology.objects.filter(hpo_id__in=hpo_ids).values_list('hpo_id', 'name'))
    resolve_gene = _resolve_genes(matched_records)
    pedigree_allowed = can_edit_pedigree(project, user)

    warnings = list(parsed['warnings'])
    proposed_by_id = {}
    preview_by_id = {}
    for record in matched_records:
        individual = individuals_by_id[record['individual_id']]
        individual_warnings = list(record['warnings'])
        proposed, unknown_hpo_terms = _get_proposed_values(
            record, individual, parents_by_id, hpo_names, resolve_gene, pedigree_allowed, individual_warnings)
        proposed_by_id[individual.individual_id] = proposed
        preview_by_id[individual.individual_id] = {
            'individualGuid': individual.guid,
            'individualId': individual.individual_id,
            'familyId': individual.family.family_id,
            'unknownHpoTerms': unknown_hpo_terms,
            'warnings': individual_warnings,
        }

    family_mondo_ids = defaultdict(dict)
    for individual_id, proposed in proposed_by_id.items():
        if MONDO_FIELD in proposed:
            family_mondo_ids[individuals_by_id[individual_id].family][individual_id] = proposed.pop(MONDO_FIELD)
    for family, mondo_ids in sorted(family_mondo_ids.items(), key=lambda item: item[0].family_id):
        if len(set(mondo_ids.values())) == 1:
            individual_id, mondo_id = next(iter(mondo_ids.items()))
            proposed_by_id[individual_id][MONDO_FIELD] = mondo_id
        else:
            warnings.append(
                f'Family {family.family_id}: the uploaded subjects have different MONDO diagnoses; the family MONDO ID is not proposed')

    stash = {}
    preview_individuals = []
    unchanged = []
    for individual_id, proposed in proposed_by_id.items():
        individual = individuals_by_id[individual_id]
        current = _current_values(individual)
        changes = [
            _get_change(field, current[field], proposed[field], hpo_names) for field in IMPORT_FIELDS if field in proposed
        ]
        changes = [change for change in changes if change]
        preview = preview_by_id[individual_id]
        if changes:
            stash[individual.guid] = {change['field']: proposed[change['field']] for change in changes}
        elif not (preview['unknownHpoTerms'] or preview['warnings']):
            unchanged.append(individual_id)
            continue
        preview_individuals.append({**preview, 'changes': changes})

    return stash, {
        'individuals': preview_individuals,
        'unmatchedSubjects': [
            record['individual_id'] for record in records if record['individual_id'] not in individuals_by_id],
        'unchangedIndividuals': unchanged,
        'warnings': warnings,
        'ignoredFields': parsed['ignored_fields'],
    }


def apply_phenopacket_import(project, stash, selections, user):
    """Applies only the selected fields ({individual guid: {field: 'merge' | 'replace'}}) of a stashed upload."""
    if not isinstance(selections, dict) or not selections:
        raise ErrorsWarningsException(['No changes were selected'])
    individuals_by_guid = {i.guid: i for i in _project_individuals(project, guid__in=selections.keys())}
    errors = []
    for guid, fields in selections.items():
        if guid not in stash or guid not in individuals_by_guid:
            errors.append(f'{guid} is not an individual in this upload')
        elif not isinstance(fields, dict) or not fields:
            errors.append(f'{guid}: no fields were selected')
        else:
            errors += [f'{guid}: {field} is not a proposed change' for field in fields if field not in stash[guid]]
            errors += [
                f'{guid}: {field} must be "{MERGE}" or "{REPLACE}"' for field, mode in fields.items()
                if mode not in {MERGE, REPLACE}
            ]
    if errors:
        raise ErrorsWarningsException(errors)
    if any(field in PEDIGREE_FIELDS for fields in selections.values() for field in fields):
        check_project_pm_permission(project, user, override_permission_func=external_anvil_project_can_edit)

    records = []
    for guid, fields in selections.items():
        individual = individuals_by_guid[guid]
        current = _current_values(individual)
        record = {}
        for field, mode in fields.items():
            value = _resolve(field, current[field], stash[guid][field], mode)
            if value == current[field]:
                continue
            if field == FEATURES_FIELD:
                record.update({key: terms or None for key, terms in value.items()})
            else:
                record[field] = value
        if record:
            records.append({'individualGuid': guid, 'familyId': individual.family.family_id, **record})

    response = add_or_update_individuals_and_families(project, records, user, allow_features_update=True)
    response['individualsByGuid'] = {
        individual['individualGuid']: individual for individual in _get_json_for_individuals(
            Individual.objects.filter(guid__in=response['individualsByGuid'].keys()), user=user,
            add_hpo_details=True, project_guid=project.guid,
        )}
    return response
