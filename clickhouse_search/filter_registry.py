"""
Registry of the search filters the ClickHouse query builders support, derived from the same model attributes the
query builders in managers.py read: PREDICTIONS/RANGE_PREDICTIONS/PREDICTION_FIELDS (in silico),
POPULATIONS/POPULATION_FIELDS/gt_stats (frequency) and CALL_FIELDS x QUALITY_FILTERS (call quality).

The "dynamic" search key is validated against this registry and translated into the legacy in_silico/freqs/qualityFilter
search keys, so there is a single query building path.
"""
import json
import math

from django.db.models import DecimalField, FloatField, IntegerField

from clickhouse_search.managers import InvalidSearchException
from clickhouse_search.models.search_models import ENTRY_CLASS_MAP, VARIANTS_CLASS_MAP
from seqr.utils.constants import DATASET_TYPE_SV_CALLS

DYNAMIC_SEARCH_KEY = 'dynamic'

IN_SILICO_GROUP = 'in_silico'
FREQUENCY_GROUP = 'frequency'
QUALITY_GROUP = 'quality'
LEGACY_SEARCH_KEYS = {
    IN_SILICO_GROUP: 'in_silico',
    FREQUENCY_GROUP: 'freqs',
    QUALITY_GROUP: 'qualityFilter',
}

KIND_MIN = 'min'
KIND_MAX = 'max'
KIND_ENUM = 'enum'
KIND_BOOL = 'bool'

SCOPE_VARIANT = 'variant'
SCOPE_CALL = 'call'

ALPHAMISSENSE_FILTER = 'alphamissense'
ALPHAMISSENSE_TRANSCRIPT_FIELD = 'alphamissensePathogenicity'
VCF_FILTER = 'vcf_filter'
VCF_FILTER_VALUE = 'pass'


def _ui_range(label, min_value=0, max_value=None):
    # Matches the bounds and step of the hard-coded in silico inputs in the search form
    return {'label': label, 'min': min_value, 'max': max_value or 1, 'step': 1 if max_value else 0.05}


# Labels and bounds for fields whose model attribute names are not presentable. Seeded from the UI search constants
IN_SILICO_OVERLAY = {
    'cadd': _ui_range('CADD', min_value=1, max_value=99),
    'revel': _ui_range('REVEL'),
    'alphagenome': _ui_range('AlphaGenome', max_value=99),
    ALPHAMISSENSE_FILTER: _ui_range('AlphaMissense'),
    'mpc': _ui_range('MPC', max_value=5),
    'splice_ai': _ui_range('SpliceAI'),
    'absplice': _ui_range('AbSplice'),
    'promoter_ai': _ui_range('PromoterAI'),
    'pext': _ui_range('PEXT'),
    'vest': _ui_range('VEST'),
    'mut_pred': _ui_range('MutPred'),
    'primate_ai': _ui_range('PrimateAI'),
    'eigen': _ui_range('Eigen', max_value=99),
    'strvctvre': _ui_range('Strvctvre'),
    'polyphen': _ui_range('PolyPhen'),
    'sift': _ui_range('SIFT'),
    'mut_taster': {'label': 'MutTaster', 'options': [
        {'value': 'D', 'text': 'disease causing'},
        {'value': 'A', 'text': 'disease causing automatic'},
        {'value': 'N', 'text': 'polymorphism'},
        {'value': 'P', 'text': 'polymorphism automatic'},
    ]},
    'fathmm': _ui_range('FATHMM'),
    'apogee': _ui_range('Apogee'),
    'hmtvar': _ui_range('HmtVar'),
    'mlc': _ui_range('MLC'),
    'gnomad_noncoding': {
        'label': 'gnomAD Constraint',
        'help': 'Minimum gnomAD non-coding constraint z-score of the genomic region containing the variant',
        'step': 0.1,
    },
}

POPULATION_LABELS = {
    'gnomad_genomes': 'gnomAD genomes',
    'gnomad_exomes': 'gnomAD exomes',
    'topmed': 'TOPMed',
    'callset': 'seqr',
    'gnomad_mito': 'gnomAD homoplasmic',
    'gnomad_mito_heteroplasmy': 'gnomAD heteroplasmic',
    'helix': 'Helix homoplasmic',
    'helix_heteroplasmy': 'Helix heteroplasmic',
    'gnomad_svs': 'gnomAD genome SVs',
    'sv_callset': 'seqr SV',
}

FREQUENCY_SUBFIELDS = {
    'af': {'label': 'AF', 'help': 'Maximum allele frequency', 'min': 0, 'max': 1, 'step': 0.0001, 'integer': False},
    'ac': {'label': 'AC', 'help': 'Maximum allele count', 'min': 0, 'max': None, 'step': 1, 'integer': True},
    'hh': {
        'label': 'H/H', 'help': 'Maximum homozygous/hemizygous count', 'min': 0, 'max': None, 'step': 1, 'integer': True,
    },
}

QUALITY_OVERLAY = {
    'min_gq': {'label': 'Genotype Quality', 'max': 100, 'step': 5},
    'min_ab': {'label': 'Allele Balance', 'max': 50, 'step': 5},
    'min_hl': {'label': 'Heteroplasmy level', 'max': 50, 'step': 5},
    'min_mitoCn': {'label': 'Mitochondrial Copy Number'},
    'min_qs': {'label': 'WES SV Quality Score', 'max': 1000, 'step': 10},
    'min_gq_sv': {'label': 'WGS SV Genotype Quality', 'max': 100, 'step': 5},
    VCF_FILTER: {'label': 'Pass Variants Only'},
}


def _title(name):
    return ' '.join(word.capitalize() for word in name.split('_'))


def _is_integer(model_field):
    return isinstance(model_field, IntegerField)


def _is_numeric(model_field):
    return isinstance(model_field, (IntegerField, DecimalField, FloatField))


def _in_silico_fields(entry_model, variants_model):
    score_fields = {}
    for source, field_map in getattr(entry_model, 'PREDICTIONS', {}).items():
        for name, model_field in getattr(entry_model, source).rel.related_model.base_fields():
            if name not in field_map:
                score_fields[source if name == 'score' else name] = model_field
    for name, range_dict in getattr(entry_model, 'RANGE_PREDICTIONS', {}).items():
        score_fields[name] = dict(range_dict.base_fields())['score']
    score_fields.update(dict(getattr(variants_model, 'PREDICTION_FIELDS', [])))
    transcript_fields = dict(getattr(variants_model, 'SORTED_TRANSCRIPT_CONSQUENCES_FIELDS', []))
    if hasattr(entry_model, 'PREDICTIONS') and ALPHAMISSENSE_TRANSCRIPT_FIELD in transcript_fields:
        score_fields[ALPHAMISSENSE_FILTER] = transcript_fields[ALPHAMISSENSE_TRANSCRIPT_FIELD]

    fields = []
    for key, model_field in score_fields.items():
        overlay = IN_SILICO_OVERLAY.get(key, {})
        field = {
            'key': key,
            'group': IN_SILICO_GROUP,
            'scope': SCOPE_VARIANT,
            'label': overlay.get('label') or _title(key),
            'help': overlay.get('help'),
            'legacyPath': [LEGACY_SEARCH_KEYS[IN_SILICO_GROUP], key],
        }
        if overlay.get('options'):
            fields.append({**field, 'kind': KIND_ENUM, 'options': overlay['options']})
        elif _is_numeric(model_field):
            fields.append({
                **field, 'kind': KIND_MIN, 'integer': _is_integer(model_field),
                'min': overlay.get('min'), 'max': overlay.get('max'), 'step': overlay.get('step', 0.05),
            })
        # Fields that are neither numeric nor have declared options are not filterable: free text is never accepted
    return fields


def _add_subfields(population_subfields, population, subfields):
    population_subfields[population] = population_subfields.get(population, []) + [
        subfield for subfield in subfields if subfield not in population_subfields.get(population, [])
    ]


def _frequency_fields(entry_model, variants_model):
    population_subfields = {}
    for population in getattr(entry_model, 'POPULATIONS', []):
        dict_fields = dict(getattr(entry_model, population).rel.related_model.base_fields())
        _add_subfields(population_subfields, population, [subfield for subfield, is_supported in [
            ('af', 'af' in dict_fields or 'filter_af' in dict_fields),
            ('ac', 'ac' in dict_fields),
            ('hh', 'hom' in dict_fields or 'hemi' in dict_fields),
        ] if is_supported])

    for population, population_field in getattr(variants_model, 'POPULATION_FIELDS', []):
        tuple_fields = dict(population_field.base_fields)
        _add_subfields(population_subfields, population, [subfield for subfield, is_supported in [
            ('af', 'af' in tuple_fields),
            ('ac', 'ac' in tuple_fields or ('het' in tuple_fields and 'hom' in tuple_fields)),
        ] if is_supported])

    entries = entry_model.objects.all()
    gt_stats_dict = entries.gt_stats_dict
    if gt_stats_dict is not None:
        stats_fields = [name for name, _ in gt_stats_dict.base_fields() if not name.endswith('affected')]
        _add_subfields(population_subfields, entries.callset_filter_field, [subfield for subfield, prefix in [
            ('ac', gt_stats_dict.SEQR_POPULATIONS[0][1]), ('hh', 'hom'),
        ] if any(name.startswith(prefix) for name in stats_fields)])

    return [
        {
            'key': f'{population}_{subfield}',
            'group': FREQUENCY_GROUP,
            'kind': KIND_MAX,
            'scope': SCOPE_VARIANT,
            **FREQUENCY_SUBFIELDS[subfield],
            'label': f'{POPULATION_LABELS.get(population) or _title(population)} {FREQUENCY_SUBFIELDS[subfield]["label"]}',
            'legacyPath': [LEGACY_SEARCH_KEYS[FREQUENCY_GROUP], population, subfield],
        }
        for population, subfields in population_subfields.items() for subfield in subfields
    ]


def _quality_fields(entry_model, variants_model):
    call_fields = dict(entry_model.CALL_FIELDS)
    fields = []
    for call_field, config in entry_model.objects.all().QUALITY_FILTERS.items():
        if call_field not in call_fields:
            continue
        key = config.get('filter_key', f'min_{call_field}')
        overlay = QUALITY_OVERLAY.get(key, {})
        is_percent = config.get('scale', 1) == 100
        fields.append({
            'key': key,
            'group': QUALITY_GROUP,
            'kind': KIND_MIN,
            'scope': SCOPE_CALL,
            'label': overlay.get('label') or f'Minimum {call_field.upper()}',
            'help': 'Percentage (0-100)' if is_percent else None,
            'integer': _is_integer(call_fields[call_field]),
            'min': 0,
            'max': overlay.get('max') or (100 if is_percent else None),
            'step': overlay.get('step', 1),
            'legacyPath': [LEGACY_SEARCH_KEYS[QUALITY_GROUP], key],
        })
    if any(model_field.name == 'filters' for model_field in entry_model._meta.fields):
        fields.append({
            'key': VCF_FILTER,
            'group': QUALITY_GROUP,
            'kind': KIND_BOOL,
            'scope': SCOPE_VARIANT,
            'label': QUALITY_OVERLAY[VCF_FILTER]['label'],
            'help': 'Only return variants that passed the variant quality filters applied when the data was processed',
            'legacyPath': [LEGACY_SEARCH_KEYS[QUALITY_GROUP], VCF_FILTER],
        })
    return fields


def _ui_dataset_type(dataset_type):
    return DATASET_TYPE_SV_CALLS if dataset_type.startswith(DATASET_TYPE_SV_CALLS) else dataset_type


def get_filter_schema(genome_version):
    """The filterable fields for a genome version, each listing the dataset types that support it"""
    schema = {}
    for dataset_type, entry_model in ENTRY_CLASS_MAP[genome_version].items():
        variants_model = VARIANTS_CLASS_MAP[genome_version][dataset_type]
        for get_fields in [_in_silico_fields, _frequency_fields, _quality_fields]:
            for field in get_fields(entry_model, variants_model):
                schema_field = schema.setdefault((field['group'], field['key']), {**field, 'datasetTypes': []})
                ui_dataset_type = _ui_dataset_type(dataset_type)
                if ui_dataset_type not in schema_field['datasetTypes']:
                    schema_field['datasetTypes'].append(ui_dataset_type)
    return sorted(schema.values(), key=lambda field: list(LEGACY_SEARCH_KEYS).index(field['group']))


def get_filter_schemas():
    return {genome_version: get_filter_schema(genome_version) for genome_version in ENTRY_CLASS_MAP}


def get_filter_registry():
    """All filterable fields in any genome version, as {group: {key: field}}"""
    registry = {group: {} for group in LEGACY_SEARCH_KEYS}
    for schema in get_filter_schemas().values():
        for field in schema:
            registry[field['group']].setdefault(field['key'], field)
    return registry


def _quote(value):
    return json.dumps(value)


def _parse_number(field, value):
    name = f'{field["label"]} ({field["key"]})'
    if isinstance(value, str):
        try:
            value = int(value)
        except ValueError:
            try:
                value = float(value)
            except ValueError:
                value = None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InvalidSearchException(f'Invalid value for {name}: expected a number')
    if field['integer']:
        if value != int(value):
            raise InvalidSearchException(f'Invalid value for {name}: expected a whole number')
        value = int(value)
    if field['min'] is not None and value < field['min']:
        raise InvalidSearchException(f'Invalid value for {name}: must be at least {field["min"]}')
    if field['max'] is not None and value > field['max']:
        raise InvalidSearchException(f'Invalid value for {name}: must be at most {field["max"]}')
    return value


def _parse_value(field, value):
    name = f'{field["label"]} ({field["key"]})'
    if field['kind'] == KIND_BOOL:
        if not isinstance(value, bool):
            raise InvalidSearchException(f'Invalid value for {name}: expected true or false')
        return value
    if field['kind'] == KIND_ENUM:
        options = [option['value'] for option in field['options']]
        if not isinstance(value, str) or value not in options:
            raise InvalidSearchException(f'Invalid value for {name}: expected one of {", ".join(options)}')
        return value
    return _parse_number(field, value)


def parse_dynamic_filters(dynamic):
    """
    Strictly validate a dynamic filter {group: {key: value}} against the registry.
    Returns [(field, value)] with every value coerced to the type the registry declares, raises on anything else.
    """
    if dynamic is None:
        return []
    if not isinstance(dynamic, dict):
        raise InvalidSearchException('Invalid dynamic filters: expected filters grouped by type')

    registry = get_filter_registry()
    parsed = []
    for group, group_filters in dynamic.items():
        if group not in registry:
            raise InvalidSearchException(
                f'Unknown dynamic filter group {_quote(group)}. Available groups: {", ".join(registry)}')
        if not isinstance(group_filters, dict):
            raise InvalidSearchException(f'Invalid dynamic {group} filters: expected values keyed by filter')
        for key, value in group_filters.items():
            field = registry[group].get(key)
            if not field:
                raise InvalidSearchException(f'Unknown dynamic {group} filter {_quote(key)}')
            if value is not None:
                parsed.append((field, _parse_value(field, value)))
    return parsed




def apply_dynamic_filters(search):
    """
    Translate the dynamic filters of a search into the legacy in_silico/freqs/qualityFilter structures.
    Returns a new search without the dynamic key; the search passed in is not modified.
    """
    parsed = parse_dynamic_filters(search.get(DYNAMIC_SEARCH_KEY))
    search = {key: value for key, value in search.items() if key != DYNAMIC_SEARCH_KEY}
    for field, value in parsed:
        if field['kind'] == KIND_BOOL:
            if not value:
                continue
            value = VCF_FILTER_VALUE
        *parent_path, leaf = field['legacyPath']
        parent = search
        for path_key in parent_path:
            parent[path_key] = dict(parent.get(path_key) or {})
            parent = parent[path_key]
        if parent.get(leaf) not in (None, '', value):
            raise InvalidSearchException(
                f'{field["label"]} ({field["key"]}) is set to different values by the dynamic and '
                f'{".".join(field["legacyPath"])} filters')
        parent[leaf] = value
    return search


def validate_dynamic_filters(search):
    apply_dynamic_filters(search or {})
