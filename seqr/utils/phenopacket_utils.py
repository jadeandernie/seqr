"""
Parses GA4GH Phenopackets v2 (ISO 4454) JSON into seqr-shaped individual records.

Supported messages: Phenopacket, Family, Cohort, a JSON array of these, or JSON-lines.
This module is pure: it has no database access and never copies identifying or free-text content
(names, alternate ids, full dates, descriptions, files, authorship) into its output, warnings or errors.
"""
import json
import re

from seqr.utils.constants import SEX_MALE, SEX_FEMALE, FEMALE_SEXES, MALE_SEXES, AFFECTED_STATUS_AFFECTED, \
    AFFECTED_STATUS_UNAFFECTED, HPO_QUALIFIERS

ONSET_QUALIFIER = 'age_of_onset'

ONSET_AGE_BY_HPO_ID = {
    'HP:0003577': 'G',  # Congenital onset
    'HP:0011460': 'E',  # Embryonal onset
    'HP:0011461': 'F',  # Fetal onset
    'HP:0003623': 'N',  # Neonatal onset
    'HP:0003593': 'I',  # Infantile onset
    'HP:0011463': 'C',  # Childhood onset
    'HP:0003621': 'J',  # Juvenile onset
    'HP:0003581': 'A',  # Adult onset
    'HP:0011462': 'Y',  # Young adult onset
    'HP:0003596': 'M',  # Middle age onset
    'HP:0003584': 'L',  # Late onset
    # narrower HPO onset terms, mapped to the seqr category that contains them
    'HP:0034199': 'F',  # Late first trimester onset
    'HP:0034198': 'F',  # Second trimester onset
    'HP:0034197': 'F',  # Third trimester onset
    'HP:0025708': 'Y',  # Early young adult onset
    'HP:0025709': 'Y',  # Intermediate young adult onset
    'HP:0025710': 'Y',  # Late young adult onset
}
_ONSET_LABEL_BY_HPO_ID = {hpo_id: label for label, hpo_id in HPO_QUALIFIERS[ONSET_QUALIFIER].items()}
ONSET_AGE_LABELS = {
    code: _ONSET_LABEL_BY_HPO_ID[hpo_id] for hpo_id, code in ONSET_AGE_BY_HPO_ID.items()
    if hpo_id in _ONSET_LABEL_BY_HPO_ID
}
QUALIFIER_BY_HPO_ID = {
    hpo_id: (qualifier_type, label) for qualifier_type, terms in HPO_QUALIFIERS.items()
    if qualifier_type != ONSET_QUALIFIER for label, hpo_id in terms.items()
}

# Upper age bounds in days for each postnatal seqr onset category, following the HPO definitions
_DAYS_PER_YEAR = 365.25
_ONSET_AGE_UPPER_BOUNDS = [
    (28, 'N'), (_DAYS_PER_YEAR, 'I'), (5 * _DAYS_PER_YEAR, 'C'), (16 * _DAYS_PER_YEAR, 'J'),
    (40 * _DAYS_PER_YEAR, 'Y'), (60 * _DAYS_PER_YEAR, 'M'),
]
_EMBRYONAL_MAX_GESTATIONAL_WEEKS = 10

SEX_ENUM = {'UNKNOWN_SEX', 'FEMALE', 'MALE', 'OTHER_SEX'}
SEX_LOOKUP = {'FEMALE': SEX_FEMALE, 'MALE': SEX_MALE}
KARYOTYPIC_SEX_ENUM = {
    'UNKNOWN_KARYOTYPE', 'XX', 'XY', 'XO', 'XXY', 'XXX', 'XXYY', 'XXXY', 'XXXX', 'XYY', 'OTHER_KARYOTYPE',
}
ANEUPLOIDY_LOOKUP = {'XXY': 'XXY', 'XYY': 'XYY', 'XXX': 'XXX', 'XO': 'X0'}
KARYOTYPE_SEX_LOOKUP = {'XX': SEX_FEMALE, 'XY': SEX_MALE}
AFFECTED_STATUS_ENUM = {'MISSING', 'UNAFFECTED', 'AFFECTED'}
AFFECTED_LOOKUP = {'AFFECTED': AFFECTED_STATUS_AFFECTED, 'UNAFFECTED': AFFECTED_STATUS_UNAFFECTED}
PROGRESS_STATUS_ENUM = {'UNKNOWN_PROGRESS', 'IN_PROGRESS', 'COMPLETED', 'SOLVED', 'UNSOLVED'}
INTERPRETATION_STATUS_ENUM = {'UNKNOWN_STATUS', 'REJECTED', 'CANDIDATE', 'CONTRIBUTORY', 'CAUSATIVE'}
IMPORTED_INTERPRETATION_STATUSES = {'CANDIDATE', 'CONTRIBUTORY', 'CAUSATIVE'}

MIN_BIRTH_YEAR = 1900
MAX_BIRTH_YEAR = 2029

_HPO_ID_RE = re.compile(r'^HP:\d{7}$')
_OMIM_ID_RE = re.compile(r'^(?:OMIM|MIM):(\d{6})$')
_MONDO_ID_RE = re.compile(r'^MONDO:\d{7}$')
_CURIE_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_.]{0,19}:[A-Za-z0-9_.-]{1,30}$')
_GENE_SYMBOL_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$')
_TIMESTAMP_RE = re.compile(r'^(\d{4})-\d{2}-\d{2}(?:[Tt ].*)?$')
_DURATION_RE = re.compile(
    r'^P(?=\d|T\d)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(T[0-9HMS.]+)?$')
_DURATION_UNIT_DAYS = [_DAYS_PER_YEAR, _DAYS_PER_YEAR / 12, 7, 1]
_INDEX_RE = re.compile(r'\[\d+\]')
_SNAKE_RE = re.compile(r'_([a-z0-9])')

_TYPE_NAMES = {
    dict: 'object', list: 'array', str: 'string', bool: 'boolean', int: 'number', float: 'number', type(None): 'null',
}
_NO_SEQR_FIELD = 'seqr has no field for it'
_MISSING_PARENT_IDS = {'', '0'}


class PhenopacketError(ValueError):
    def __init__(self, errors):
        super().__init__('; '.join(errors))
        self.errors = errors


class _Context:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.ignored = set()


def load_phenopacket_json(text):
    """Returns the parsed content of a JSON document or of JSON-lines (one message per line)."""
    try:
        text = text.decode('utf-8') if isinstance(text, bytes) else text
    except UnicodeDecodeError:
        raise PhenopacketError(['not UTF-8 encoded text'])
    try:
        return json.loads(text)
    except ValueError as e:
        error_message = f'not valid JSON ({e.msg} at line {e.lineno} column {e.colno})'
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) < 2:
        raise PhenopacketError([error_message])
    messages = []
    for i, line in enumerate(lines):
        try:
            messages.append(json.loads(line))
        except ValueError:
            raise PhenopacketError([f'{error_message}, and line {i + 1} is not valid JSON-lines'])
    return messages


def parse_phenopackets(data):
    """
    Returns {'individuals': [...], 'warnings': [...], 'ignored_fields': [...]} for parsed JSON content.

    Each individual is a dict with 'individual_id', 'warnings' and whichever of these could be derived:
    sex, affected, birth_year, onset_age, consanguinity, features, absent_features, disorders, mondo_id,
    candidate_genes (unresolved {'symbol', 'ids'} references), maternal_id, paternal_id.
    Raises PhenopacketError naming the path of every structural problem.
    """
    ctx = _Context()
    data = _camel_keys(data)
    individuals = []
    if isinstance(data, list):
        for i, message in enumerate(data):
            individuals += _parse_message(message, f'[{i}]', ctx)
    else:
        individuals += _parse_message(data, '', ctx)
    if ctx.errors:
        raise PhenopacketError(ctx.errors)
    return {'individuals': individuals, 'warnings': ctx.warnings, 'ignored_fields': sorted(ctx.ignored)}


def combine_parsed_phenopackets(results):
    """Combines parse results, keeping only the first record for a subject that appears more than once."""
    individuals = {}
    warnings = []
    ignored = set()
    num_repeated = 0
    for result in results:
        warnings += [warning for warning in result['warnings'] if warning not in warnings]
        ignored.update(result['ignored_fields'])
        for individual in result['individuals']:
            if individual['individual_id'] in individuals:
                num_repeated += 1
            else:
                individuals[individual['individual_id']] = individual
    if num_repeated:
        warnings.append(
            f'{num_repeated} record(s) repeat a subject that was already read; only the first record for each subject is used')
    return {'individuals': list(individuals.values()), 'warnings': warnings, 'ignored_fields': sorted(ignored)}


def _camel_keys(value):
    # protobuf JSON parsers accept the original snake_case field names as well as lowerCamelCase
    if isinstance(value, dict):
        return {_SNAKE_RE.sub(lambda m: m.group(1).upper(), key): _camel_keys(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_camel_keys(val) for val in value]
    return value


def _join(path, key):
    return f'{path}.{key}' if path else key


def _display_id(term_id):
    return term_id if _CURIE_RE.match(term_id) else 'an identifier that is not a CURIE'


def _get(obj, key, expected, path, ctx, required=False):
    value = obj.get(key)
    if value is None:
        if required:
            ctx.errors.append(f'{_join(path, key)}: required {_TYPE_NAMES[expected]} is missing')
        return None
    if not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
        ctx.errors.append(f'{_join(path, key)}: expected {_TYPE_NAMES[expected]}, found {_TYPE_NAMES[type(value)]}')
        return None
    return value


def _get_id(obj, key, path, ctx):
    value = _get(obj, key, str, path, ctx, required=True)
    if value is not None and not value.strip():
        ctx.errors.append(f'{_join(path, key)}: required string is empty')
        return None
    return value


def _get_term_id(obj, key, path, ctx, required=False):
    term = _get(obj, key, dict, path, ctx, required=required)
    return None if term is None else _get_id(term, 'id', _join(path, key), ctx)


def _get_objects(obj, key, path, ctx):
    items = _get(obj, key, list, path, ctx) or []
    objects = []
    for i, item in enumerate(items):
        item_path = f'{_join(path, key)}[{i}]'
        if isinstance(item, dict):
            objects.append((item, item_path))
        else:
            ctx.errors.append(f'{item_path}: expected object, found {_TYPE_NAMES[type(item)]}')
    return objects


def _get_enum(obj, key, enum_name, allowed, path, ctx):
    value = _get(obj, key, str, path, ctx)
    if value is not None and value not in allowed:
        ctx.errors.append(f'{_join(path, key)}: not a value of the {enum_name} enum ({", ".join(sorted(allowed))})')
        return None
    return value


def _is_present(value):
    return value is not None and value != '' and value != [] and value != {}


def _note_ignored(obj, keys, path, ctx):
    for key in keys:
        if _is_present(obj.get(key)):
            ctx.ignored.add(_INDEX_RE.sub('[]', _join(path, key)))


def _warn_unmapped(obj, keys, path, warnings, reason=_NO_SEQR_FIELD):
    for key in keys:
        if _is_present(obj.get(key)):
            warnings.append(f'{_join(path, key)} is present but is not imported: {reason}')


def _parse_message(message, path, ctx):
    if not isinstance(message, dict):
        ctx.errors.append(f'{path or "document"}: expected object, found {_TYPE_NAMES[type(message)]}')
        return []
    if any(key in message for key in ['proband', 'relatives', 'pedigree']):
        return _parse_family(message, path, ctx)
    if 'members' in message:
        return _parse_cohort(message, path, ctx)
    if 'subject' in message:
        record = _parse_phenopacket(message, path, ctx)
        return [record] if record else []
    ctx.errors.append(
        f'{path or "document"}: not a Phenopacket, Family or Cohort message (no subject, proband or members field)')
    return []


def _parse_meta_data(message, path, ctx):
    meta_data = _get(message, 'metaData', dict, path, ctx)
    if meta_data is None:
        return
    meta_path = _join(path, 'metaData')
    _note_ignored(meta_data, ['createdBy', 'submittedBy', 'updates', 'externalReferences'], meta_path, ctx)
    version = _get(meta_data, 'phenopacketSchemaVersion', str, meta_path, ctx)
    if version and not version.startswith('2'):
        warning = 'metaData.phenopacketSchemaVersion is not a 2.x version: this importer reads Phenopackets v2, ' \
                  'fields from other versions may be missed'
        if warning not in ctx.warnings:
            ctx.warnings.append(warning)


def _parse_cohort(cohort, path, ctx):
    _note_ignored(cohort, ['id', 'description', 'files'], path, ctx)
    _parse_meta_data(cohort, path, ctx)
    records = [
        _parse_phenopacket(member, member_path, ctx) for member, member_path in _get_objects(cohort, 'members', path, ctx)
    ]
    return [record for record in records if record]


def _parse_family(family, path, ctx):
    _note_ignored(family, ['id', 'files'], path, ctx)
    _parse_meta_data(family, path, ctx)
    records = []
    proband = _get(family, 'proband', dict, path, ctx, required=True)
    proband_record = None if proband is None else _parse_phenopacket(proband, _join(path, 'proband'), ctx)
    consanguinity = _get(family, 'consanguinousParents', bool, path, ctx)
    if proband_record:
        if consanguinity is not None:
            proband_record['consanguinity'] = consanguinity
        records.append(proband_record)
    for relative, relative_path in _get_objects(family, 'relatives', path, ctx):
        record = _parse_phenopacket(relative, relative_path, ctx)
        if record:
            records.append(record)
    pedigree = _get(family, 'pedigree', dict, path, ctx)
    if pedigree is not None:
        _apply_pedigree(pedigree, _join(path, 'pedigree'), ctx, records)
    return records


def _apply_pedigree(pedigree, path, ctx, records):
    records_by_id = {record['individual_id']: record for record in records}
    for person, person_path in _get_objects(pedigree, 'persons', path, ctx):
        _note_ignored(person, ['familyId'], person_path, ctx)
        individual_id = _get_id(person, 'individualId', person_path, ctx)
        sex = SEX_LOOKUP.get(_get_enum(person, 'sex', 'Sex', SEX_ENUM, person_path, ctx))
        affected = AFFECTED_LOOKUP.get(
            _get_enum(person, 'affectedStatus', 'AffectedStatus', AFFECTED_STATUS_ENUM, person_path, ctx))
        parent_ids = {
            field: _get(person, key, str, person_path, ctx)
            for field, key in [('maternal_id', 'maternalId'), ('paternal_id', 'paternalId')]
        }
        if individual_id is None:
            continue
        record = records_by_id.get(individual_id)
        if not record:
            record = {'individual_id': individual_id, 'warnings': []}
            records_by_id[individual_id] = record
            records.append(record)
        if sex and 'sex' not in record:
            record['sex'] = sex
        elif sex and record['sex'] not in (FEMALE_SEXES if sex == SEX_FEMALE else MALE_SEXES):
            record['warnings'].append(
                f'{person_path}.sex disagrees with the sex of the subject in the Phenopacket; the Phenopacket value is used')
        if affected:
            record['affected'] = affected
        record.update({
            field: parent_id for field, parent_id in parent_ids.items()
            if parent_id is not None and parent_id.strip() not in _MISSING_PARENT_IDS
        })


def _parse_phenopacket(packet, path, ctx):
    warnings = []
    record = {'warnings': warnings}
    _note_ignored(packet, ['id', 'files'], path, ctx)
    _parse_meta_data(packet, path, ctx)
    _warn_unmapped(packet, ['measurements', 'biosamples', 'medicalActions'], path, warnings)

    subject = _get(packet, 'subject', dict, path, ctx, required=True)
    individual_id = None if subject is None else _parse_subject(subject, _join(path, 'subject'), ctx, warnings, record)
    _parse_features(packet, path, ctx, warnings, record)
    _parse_diseases(packet, path, ctx, warnings, record)
    _parse_interpretations(packet, path, ctx, warnings, record)
    if individual_id is None:
        return None
    record['individual_id'] = individual_id
    return record


def _parse_subject(subject, path, ctx, warnings, record):
    _note_ignored(subject, ['alternateIds'], path, ctx)
    _warn_unmapped(subject, ['timeAtLastEncounter', 'vitalStatus', 'gender'], path, warnings)

    taxonomy_id = _get_term_id(subject, 'taxonomy', path, ctx)
    if taxonomy_id and taxonomy_id != 'NCBITaxon:9606':
        warnings.append(f'{path}.taxonomy is not human (NCBITaxon:9606); check that this subject belongs in seqr')

    date_of_birth = _get(subject, 'dateOfBirth', str, path, ctx)
    if date_of_birth is not None:
        ctx.ignored.add(_INDEX_RE.sub('[]', f'{path}.dateOfBirth (only the year is kept)'))
        match = _TIMESTAMP_RE.match(date_of_birth)
        if not match:
            ctx.errors.append(f'{path}.dateOfBirth: expected an ISO 8601 timestamp such as 2010-01-01T00:00:00Z')
        elif MIN_BIRTH_YEAR <= int(match.group(1)) <= MAX_BIRTH_YEAR:
            record['birth_year'] = int(match.group(1))
        else:
            warnings.append(
                f'{path}.dateOfBirth is outside the years seqr accepts ({MIN_BIRTH_YEAR}-{MAX_BIRTH_YEAR}) and is not imported')

    sex = _get_enum(subject, 'sex', 'Sex', SEX_ENUM, path, ctx)
    karyotype = _get_enum(subject, 'karyotypicSex', 'KaryotypicSex', KARYOTYPIC_SEX_ENUM, path, ctx)
    seqr_sex = SEX_LOOKUP.get(sex)
    if sex == 'OTHER_SEX':
        warnings.append(f'{path}.sex is OTHER_SEX, which has no seqr equivalent; sex is not imported')
    if karyotype in ANEUPLOIDY_LOOKUP:
        seqr_sex = ANEUPLOIDY_LOOKUP[karyotype]
    elif karyotype in KARYOTYPE_SEX_LOOKUP:
        if sex in {None, 'UNKNOWN_SEX'}:
            seqr_sex = KARYOTYPE_SEX_LOOKUP[karyotype]
    elif karyotype not in {None, 'UNKNOWN_KARYOTYPE'}:
        warnings.append(f'{path}.karyotypicSex is {karyotype}, which has no seqr equivalent, and is not imported')
    if seqr_sex:
        record['sex'] = seqr_sex

    return _get_id(subject, 'id', path, ctx)


def _parse_features(packet, path, ctx, warnings, record):
    features = {}
    absent_features = {}
    for feature, feature_path in _get_objects(packet, 'phenotypicFeatures', path, ctx):
        parsed, excluded = _parse_feature(feature, feature_path, ctx, warnings)
        if parsed:
            (absent_features if excluded else features).setdefault(parsed['id'], parsed)
    contradictory = sorted(set(features) & set(absent_features))
    for hpo_id in contradictory:
        absent_features.pop(hpo_id)
    if contradictory:
        warnings.append(
            f'{_join(path, "phenotypicFeatures")}: {", ".join(contradictory)} recorded as both observed and excluded; '
            'imported as observed')
    if features:
        record['features'] = list(features.values())
    if absent_features:
        record['absent_features'] = list(absent_features.values())


def _parse_feature(feature, path, ctx, warnings):
    _note_ignored(feature, ['description', 'evidence'], path, ctx)
    _warn_unmapped(feature, ['resolution'], path, warnings)
    excluded = _get(feature, 'excluded', bool, path, ctx) or False
    term_id = _get_term_id(feature, 'type', path, ctx, required=True)

    qualifiers = {}
    modifier_ids = [(_get_term_id(feature, 'severity', path, ctx), f'{path}.severity')] + [
        (_get_id(modifier, 'id', modifier_path, ctx), modifier_path)
        for modifier, modifier_path in _get_objects(feature, 'modifiers', path, ctx)
    ]
    for modifier_id, modifier_path in modifier_ids:
        if modifier_id is None:
            continue
        qualifier_type, label = QUALIFIER_BY_HPO_ID.get(modifier_id, (None, None))
        if not qualifier_type:
            warnings.append(
                f'{modifier_path}: {_display_id(modifier_id)} is not one of the modifiers seqr supports and is not imported')
        elif qualifier_type in qualifiers:
            warnings.append(
                f'{modifier_path}: seqr keeps one {qualifier_type} qualifier per term; this additional one is not imported')
        else:
            qualifiers[qualifier_type] = label

    onset = _get(feature, 'onset', dict, path, ctx)
    onset_code = None if onset is None else _onset_category(onset, f'{path}.onset', ctx, warnings)
    if onset_code:
        qualifiers[ONSET_QUALIFIER] = ONSET_AGE_LABELS[onset_code]

    if term_id is None:
        return None, excluded
    if not _HPO_ID_RE.match(term_id):
        warnings.append(f'{path}.type: {_display_id(term_id)} is not an HPO term and is not imported')
        return None, excluded
    parsed = {'id': term_id}
    if qualifiers:
        parsed['qualifiers'] = [{'type': qualifier_type, 'label': label} for qualifier_type, label in qualifiers.items()]
    return parsed, excluded


def _onset_category(element, path, ctx, warnings):
    """Returns the seqr onset_age code nearest to a TimeElement, or None (with a warning) when there is none."""
    onset_term = _get(element, 'ontologyClass', dict, path, ctx)
    age = _get(element, 'age', dict, path, ctx)
    age_range = _get(element, 'ageRange', dict, path, ctx)
    gestational_age = _get(element, 'gestationalAge', dict, path, ctx)

    if onset_term is not None:
        term_id = _get_id(onset_term, 'id', f'{path}.ontologyClass', ctx)
        code = ONSET_AGE_BY_HPO_ID.get(term_id)
        if term_id and not code:
            warnings.append(
                f'{path}.ontologyClass: {_display_id(term_id)} has no matching seqr onset category and is not imported')
        return code
    if age is not None:
        return _age_category(age, f'{path}.age', ctx)
    if age_range is not None:
        bounds = [
            (_get(age_range, key, dict, f'{path}.ageRange', ctx, required=True), f'{path}.ageRange.{key}')
            for key in ['start', 'end']
        ]
        codes = {_age_category(bound, bound_path, ctx) for bound, bound_path in bounds if bound is not None}
        if len(codes) > 1:
            warnings.append(f'{path}.ageRange spans more than one seqr onset category and is not imported')
        return codes.pop() if len(codes) == 1 else None
    if gestational_age is not None:
        weeks = _get(gestational_age, 'weeks', int, f'{path}.gestationalAge', ctx, required=True)
        if weeks is None:
            return None
        return 'E' if weeks < _EMBRYONAL_MAX_GESTATIONAL_WEEKS else 'F'
    _warn_unmapped(
        element, ['timestamp', 'interval'], path, warnings,
        reason='a calendar date cannot be converted to an onset category',
    )
    return None


def _age_category(age, path, ctx):
    duration = _get(age, 'iso8601duration', str, path, ctx, required=True)
    if duration is None:
        return None
    match = _DURATION_RE.match(duration)
    if not match:
        ctx.errors.append(f'{path}.iso8601duration: expected an ISO 8601 duration such as P5Y or P3M')
        return None
    *date_parts, time_part = match.groups()
    days = sum(float(value) * unit_days for value, unit_days in zip(date_parts, _DURATION_UNIT_DAYS) if value)
    if days == 0:
        return 'N' if time_part and re.search('[1-9]', time_part) else 'G'
    return next((code for upper_bound, code in _ONSET_AGE_UPPER_BOUNDS if days < upper_bound), 'L')


def _parse_diseases(packet, path, ctx, warnings, record):
    disorders = []
    mondo_ids = []
    onset_codes = set()
    for disease, disease_path in _get_objects(packet, 'diseases', path, ctx):
        _warn_unmapped(
            disease, ['resolution', 'diseaseStage', 'clinicalTnmFinding', 'primarySite', 'laterality'], disease_path, warnings)
        term_id = _get_term_id(disease, 'term', disease_path, ctx, required=True)
        excluded = _get(disease, 'excluded', bool, disease_path, ctx)
        onset = _get(disease, 'onset', dict, disease_path, ctx)
        if term_id is None:
            continue
        if excluded:
            warnings.append(
                f'{disease_path}: excluded diagnosis {_display_id(term_id)} is not imported: seqr has no field for '
                'excluded diagnoses')
            continue

        omim_match = _OMIM_ID_RE.match(term_id)
        if omim_match:
            if omim_match.group(1) not in disorders:
                disorders.append(omim_match.group(1))
        elif _MONDO_ID_RE.match(term_id):
            if term_id not in mondo_ids:
                mondo_ids.append(term_id)
        else:
            warnings.append(
                f'{disease_path}.term: {_display_id(term_id)} is not an OMIM or MONDO identifier and is not imported')

        onset_code = None if onset is None else _onset_category(onset, f'{disease_path}.onset', ctx, warnings)
        if onset_code:
            onset_codes.add(onset_code)

    if disorders:
        record['disorders'] = disorders
    if len(mondo_ids) == 1:
        record['mondo_id'] = mondo_ids[0]
    elif mondo_ids:
        warnings.append(
            f'{_join(path, "diseases")}: {len(mondo_ids)} MONDO diagnoses are present; the family MONDO ID is only '
            'imported when there is exactly one')
    if len(onset_codes) == 1:
        record['onset_age'] = onset_codes.pop()
    elif onset_codes:
        warnings.append(
            f'{_join(path, "diseases")}: the diseases have different onset categories; age of onset is not imported')


def _parse_interpretations(packet, path, ctx, warnings, record):
    genes = []
    for interpretation, interpretation_path in _get_objects(packet, 'interpretations', path, ctx):
        _note_ignored(interpretation, ['id', 'summary'], interpretation_path, ctx)
        _get_enum(interpretation, 'progressStatus', 'ProgressStatus', PROGRESS_STATUS_ENUM, interpretation_path, ctx)
        _warn_unmapped(
            interpretation, ['progressStatus'], interpretation_path, warnings,
            reason='solve status is set by analysts in seqr',
        )
        diagnosis = _get(interpretation, 'diagnosis', dict, interpretation_path, ctx)
        if diagnosis is None:
            continue
        diagnosis_path = f'{interpretation_path}.diagnosis'
        _warn_unmapped(
            diagnosis, ['disease'], diagnosis_path, warnings, reason='diagnoses are read from the diseases field',
        )
        for genomic, genomic_path in _get_objects(diagnosis, 'genomicInterpretations', diagnosis_path, ctx):
            gene = _parse_genomic_interpretation(genomic, genomic_path, ctx, warnings)
            if gene and gene not in genes:
                genes.append(gene)
    if genes:
        record['candidate_genes'] = genes


def _parse_genomic_interpretation(genomic, path, ctx, warnings):
    _note_ignored(genomic, ['subjectOrBiosampleId'], path, ctx)
    status = _get_enum(
        genomic, 'interpretationStatus', 'InterpretationStatus', INTERPRETATION_STATUS_ENUM, path, ctx,
    ) or 'UNKNOWN_STATUS'
    gene = _get(genomic, 'gene', dict, path, ctx)
    gene_path = f'{path}.gene'
    variant = _get(genomic, 'variantInterpretation', dict, path, ctx)
    if variant is not None:
        descriptor = _get(variant, 'variationDescriptor', dict, f'{path}.variantInterpretation', ctx) or {}
        gene_path = f'{path}.variantInterpretation.variationDescriptor.geneContext'
        gene = _get(descriptor, 'geneContext', dict, f'{path}.variantInterpretation.variationDescriptor', ctx)
    if status not in IMPORTED_INTERPRETATION_STATUSES:
        warnings.append(
            f'{path}: an interpretation with status {status} is not imported (only CANDIDATE, CONTRIBUTORY and '
            'CAUSATIVE genes are)')
        return None
    if variant is not None:
        warnings.append(f'{path}.variantInterpretation: variant details are not imported, only the gene')
    if gene is None:
        warnings.append(f'{path}: no gene is given, nothing is imported')
        return None

    _note_ignored(gene, ['description'], gene_path, ctx)
    symbol = _get(gene, 'symbol', str, gene_path, ctx)
    value_id = _get(gene, 'valueId', str, gene_path, ctx)
    alternate_ids = _get(gene, 'alternateIds', list, gene_path, ctx) or []
    if any(not isinstance(alternate_id, str) for alternate_id in alternate_ids):
        ctx.errors.append(f'{gene_path}.alternateIds: expected an array of strings')
        return None
    parsed = {
        'symbol': symbol if symbol and _GENE_SYMBOL_RE.match(symbol) else None,
        'ids': [gene_id for gene_id in [value_id, *alternate_ids] if gene_id and _CURIE_RE.match(gene_id)],
    }
    if not parsed['symbol'] and not parsed['ids']:
        warnings.append(f'{gene_path}: no usable gene symbol or identifier, nothing is imported')
        return None
    return parsed
