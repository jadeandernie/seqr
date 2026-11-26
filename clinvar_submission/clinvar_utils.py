import re

from django.conf import settings

from clinvar_submission.constants import MODES, MODE_DISABLED, SENDING_MODES, GERMLINE_CLASSIFICATIONS, ACMG_TO_CLINVAR_CLASSIFICATION, \
    MODES_OF_INHERITANCE, COLLECTION_METHODS, AFFECTED_STATUSES, ALLELE_ORIGINS, ASSEMBLY_BY_GENOME_VERSION, \
    COORDINATE_CHROMOSOMES, MAX_ALLELE_LENGTH, CONDITION_DBS, CITATION_DB, ASSERTION_CRITERIA_DBS, RELEASE_STATUS, \
    RECORD_STATUS_NOVEL, RECORD_STATUS_UPDATE, DEFAULT_COLLECTION_METHOD, DEFAULT_ALLELE_ORIGIN
from seqr.models import Individual
from seqr.utils.xpos_utils import get_chrom_pos

SCV_REGEX = re.compile(r'^SCV\d{9}$')
REFSEQ_HGVS_REGEX = re.compile(r'^N[MR]_\d+\.\d+:[cn]\.\S+$')
MONDO_REGEX = re.compile(r'^(MONDO:)?(\d{7})$')
MONDO_ID_REGEX = re.compile(r'^MONDO:\d{7}$')
OMIM_REGEX = re.compile(r'^\d{6}$')
PUBMED_REGEX = re.compile(r'^\d{1,9}$')
ALLELE_REGEX = re.compile(r'^[ACGT]+$')

SV_ERROR = 'Structural variants cannot be submitted to ClinVar from seqr: only SNVs and indels are supported'
MITO_ERROR = 'Mitochondrial variants cannot be submitted to ClinVar from seqr: only nuclear SNVs and indels are supported'


def get_clinvar_mode():
    mode = getattr(settings, 'CLINVAR_SUBMISSION_MODE', MODE_DISABLED)
    return mode if mode in MODES else MODE_DISABLED


def get_api_key():
    return getattr(settings, 'CLINVAR_API_KEY', None) or None


def get_config_error():
    mode = get_clinvar_mode()
    if mode == MODE_DISABLED:
        return 'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")'
    if mode in SENDING_MODES and not get_api_key():
        return f'CLINVAR_SUBMISSION_MODE is "{mode}" but CLINVAR_API_KEY is not configured: refusing to operate'
    return None


def get_assertion_criteria():
    db, _, citation_id = (getattr(settings, 'CLINVAR_ASSERTION_CRITERIA', None) or '').partition(':')
    if not citation_id:
        return None
    return {'db': db, 'id': citation_id}


def _get_condition_options(family):
    options = []
    for mondo_id in [family.post_discovery_mondo_id, family.mondo_id]:
        match = MONDO_REGEX.match(mondo_id or '')
        if match:
            options.append(f'MONDO:{match.group(2)}')
    options += [f'OMIM:{omim}' for omim in family.post_discovery_omim_numbers or []]
    return list(dict.fromkeys(options))


def _get_zygosity(num_alt, chrom, sex):
    if chrom == 'X' and sex in Individual.MALE_SEXES:
        return 'hemizygous'
    return 'homozygous' if num_alt > 1 else 'heterozygous'


def _format_condition(condition_id):
    db, condition_number = condition_id.split(':')
    return {'db': db, 'id': condition_id if db == 'MONDO' else condition_number}


def get_variant_context(saved_variant):
    family = saved_variant.family
    chrom, pos = get_chrom_pos(saved_variant.xpos)
    num_alts = {
        guid: genotype.get('numAlt') or 0 for guid, genotype in (saved_variant.genotypes or {}).items()
    }
    observation = {'affectedCarriers': 0, 'unaffectedCarriers': 0, 'zygosity': {}}
    individuals = Individual.objects.filter(family=family, guid__in=[guid for guid, n in num_alts.items() if n > 0])
    for individual in individuals.order_by('guid'):
        if individual.affected == Individual.AFFECTED_STATUS_AFFECTED:
            observation['affectedCarriers'] += 1
            zygosity = _get_zygosity(num_alts[individual.guid], chrom, individual.sex)
            observation['zygosity'][zygosity] = observation['zygosity'].get(zygosity, 0) + 1
        elif individual.affected == Individual.AFFECTED_STATUS_UNAFFECTED:
            observation['unaffectedCarriers'] += 1

    return {
        'datasetType': saved_variant.dataset_type,
        'svType': saved_variant.sv_type,
        'chrom': chrom,
        'pos': pos,
        'ref': saved_variant.ref,
        'alt': saved_variant.alt,
        'genomeVersion': family.project.genome_version,
        'hgvsc': (saved_variant.main_transcript or {}).get('hgvsc'),
        'acmgClassification': (saved_variant.acmg_classification or {}).get('classify'),
        'conditionOptions': _get_condition_options(family),
        'pubmedIds': list(family.pubmed_ids or []),
        'observation': observation,
    }


def get_default_fields(context):
    observation = context['observation']
    if observation['affectedCarriers']:
        affected_status = 'yes'
    elif observation['unaffectedCarriers']:
        affected_status = 'no'
    else:
        affected_status = 'unknown'
    return {
        'condition_id': context['conditionOptions'][0] if context['conditionOptions'] else None,
        'mode_of_inheritance': None,
        'collection_method': DEFAULT_COLLECTION_METHOD,
        'affected_status': affected_status,
        'allele_origin': DEFAULT_ALLELE_ORIGIN,
        'citations': context['pubmedIds'],
    }


def map_classification(acmg_classification):
    if not acmg_classification or acmg_classification == 'Unknown':
        return None, 'The variant has no ACMG classification in seqr: classify it before drafting a ClinVar submission'
    classification = ACMG_TO_CLINVAR_CLASSIFICATION.get(acmg_classification)
    if not classification:
        return None, f'The seqr ACMG classification "{acmg_classification}" has no ClinVar equivalent'
    return classification, None


def _build_variant(context, errors):
    dataset_type = context['datasetType'] or ''
    if dataset_type.startswith('SV') or context['svType'] or not (context['ref'] and context['alt']):
        errors.append(SV_ERROR)
        return None
    if dataset_type == 'MITO' or context['chrom'] not in COORDINATE_CHROMOSOMES:
        errors.append(MITO_ERROR)
        return None

    hgvsc = context['hgvsc'] or ''
    if REFSEQ_HGVS_REGEX.match(hgvsc):
        return {'hgvs': hgvsc}

    assembly = ASSEMBLY_BY_GENOME_VERSION.get(context['genomeVersion'])
    if not assembly:
        errors.append(f'Unsupported genome build "{context["genomeVersion"]}"')
        return None
    ref, alt = context['ref'], context['alt']
    if not (ALLELE_REGEX.match(ref) and ALLELE_REGEX.match(alt)):
        errors.append('The reference and alternate alleles must only contain A, C, G and T')
        return None
    if max(len(ref), len(alt)) > MAX_ALLELE_LENGTH:
        errors.append(
            f'ClinVar accepts alleles of up to {MAX_ALLELE_LENGTH} nt as chromosome coordinates and this variant has no RefSeq HGVS')
        return None
    return {'chromosomeCoordinates': {
        'assembly': assembly,
        'chromosome': context['chrom'],
        'start': context['pos'],
        'stop': context['pos'] + len(ref) - 1,
        'referenceAllele': ref,
        'alternateAllele': alt,
    }}


ENUM_FIELDS = {
    'mode_of_inheritance': ('Mode of inheritance', MODES_OF_INHERITANCE),
    'collection_method': ('Collection method', COLLECTION_METHODS),
    'affected_status': ('Affected status', AFFECTED_STATUSES),
    'allele_origin': ('Allele origin', ALLELE_ORIGINS),
}
REQUIRED_FIELDS = ['collection_method', 'affected_status', 'allele_origin']


def validate_fields(context, fields):
    """Errors for values that were provided but are not acceptable. Missing values are reported when building."""
    errors = []
    condition_id = fields.get('condition_id')
    if condition_id not in (None, '') and condition_id not in context['conditionOptions']:
        errors.append(f'Condition "{condition_id}" is not one of the family\'s MONDO or OMIM ids')
    for key, (label, allowed) in ENUM_FIELDS.items():
        if fields.get(key) not in (None, '') and fields[key] not in allowed:
            errors.append(f'{label} "{fields[key]}" is not a value accepted by ClinVar')
    citations = fields.get('citations') or []
    invalid_citations = [str(c) for c in citations if not PUBMED_REGEX.match(str(c))] if isinstance(citations, list) \
        else [str(citations)]
    if invalid_citations:
        errors.append(f'Invalid PubMed id(s): {", ".join(invalid_citations)}')
    return errors


def build_submission_content(context, fields, local_key, scv_accession=None, assertion_criteria=None,
                             require_assertion_criteria=False):
    errors = validate_fields(context, fields)
    classification, classification_error = map_classification(context['acmgClassification'])
    if classification_error:
        errors.append(classification_error)
    variant = _build_variant(context, errors)
    if not fields.get('condition_id'):
        errors.append('A condition is required: set a MONDO id or post-discovery OMIM number on the family')
    errors += [f'{ENUM_FIELDS[key][0]} is required' for key in REQUIRED_FIELDS if not fields.get(key)]
    citations = fields.get('citations') or []

    observation = {
        'affectedStatus': fields.get('affected_status'),
        'alleleOrigin': fields.get('allele_origin'),
        'collectionMethod': fields.get('collection_method'),
    }
    if fields.get('affected_status') == 'yes':
        affected_carriers = context['observation']['affectedCarriers']
        if not affected_carriers:
            errors.append('No affected individual in the family carries this variant')
        observation['numberOfIndividuals'] = affected_carriers

    if scv_accession and not SCV_REGEX.match(scv_accession):
        errors.append(f'Invalid ClinVar accession "{scv_accession}"')
    if require_assertion_criteria and not assertion_criteria:
        errors.append('CLINVAR_ASSERTION_CRITERIA is not configured: ClinVar requires an assertion criteria citation')

    if errors:
        return None, errors

    germline_classification = {'germlineClassificationDescription': classification}
    if fields.get('mode_of_inheritance'):
        germline_classification['modeOfInheritance'] = fields['mode_of_inheritance']
    if citations:
        germline_classification['citation'] = [{'db': CITATION_DB, 'id': str(c)} for c in citations]

    record = {
        'recordStatus': RECORD_STATUS_UPDATE if scv_accession else RECORD_STATUS_NOVEL,
        'localKey': local_key,
        'germlineClassification': germline_classification,
        'conditionSet': {'condition': [_format_condition(fields['condition_id'])]},
        'observedIn': [observation],
        'variantSet': {'variant': [variant]},
    }
    if scv_accession:
        record['clinvarAccession'] = scv_accession

    content = {'clinvarSubmissionReleaseStatus': RELEASE_STATUS, 'germlineSubmission': [record]}
    if assertion_criteria:
        content['assertionCriteria'] = assertion_criteria

    errors = validate_submission_content(content)
    return (None, errors) if errors else (content, [])


def build_deletion_content(scv_accession):
    content = {'clinvarDeletion': {'accessionSet': [{'accession': scv_accession}]}}
    errors = validate_submission_content(content)
    if errors:
        raise ValueError('; '.join(errors))
    return content


class _Validator:

    def __init__(self):
        self.errors = []

    def keys(self, obj, path, required, optional=()):
        if not isinstance(obj, dict):
            self.errors.append(f'{path}: expected an object')
            return False
        unexpected = sorted(set(obj) - set(required) - set(optional))
        missing = sorted(set(required) - set(obj))
        if unexpected:
            self.errors.append(f'{path}: unexpected field(s) {", ".join(unexpected)}')
        if missing:
            self.errors.append(f'{path}: missing field(s) {", ".join(missing)}')
        return not missing

    def single(self, obj, key, path):
        value = obj[key]
        if isinstance(value, list) and len(value) == 1:
            return value[0]
        self.errors.append(f'{path}.{key}: expected a list with exactly one item')
        return None

    def enum(self, obj, key, path, allowed):
        if key in obj and obj[key] not in allowed:
            self.errors.append(f'{path}.{key}: "{obj[key]}" is not an allowed value')

    def regex(self, obj, key, path, regex):
        if key in obj and not (isinstance(obj[key], str) and regex.match(obj[key])):
            self.errors.append(f'{path}.{key}: "{obj[key]}" is not valid')

    def positive_int(self, obj, key, path):
        if key in obj and not (isinstance(obj[key], int) and not isinstance(obj[key], bool) and obj[key] > 0):
            self.errors.append(f'{path}.{key}: expected a positive integer')


def _validate_variant(validator, variant, path):
    if not validator.keys(variant, path, [], ['hgvs', 'chromosomeCoordinates']):
        return
    if len(variant) != 1:
        validator.errors.append(f'{path}: exactly one of hgvs or chromosomeCoordinates is required')
        return
    validator.regex(variant, 'hgvs', path, REFSEQ_HGVS_REGEX)
    if 'chromosomeCoordinates' in variant:
        coordinates = variant['chromosomeCoordinates']
        coordinates_path = f'{path}.chromosomeCoordinates'
        if validator.keys(coordinates, coordinates_path, [
            'assembly', 'chromosome', 'start', 'stop', 'referenceAllele', 'alternateAllele',
        ]):
            validator.enum(coordinates, 'assembly', coordinates_path, ASSEMBLY_BY_GENOME_VERSION.values())
            validator.enum(coordinates, 'chromosome', coordinates_path, COORDINATE_CHROMOSOMES)
            validator.positive_int(coordinates, 'start', coordinates_path)
            validator.positive_int(coordinates, 'stop', coordinates_path)
            validator.regex(coordinates, 'referenceAllele', coordinates_path, ALLELE_REGEX)
            validator.regex(coordinates, 'alternateAllele', coordinates_path, ALLELE_REGEX)


def _validate_condition(validator, condition, path):
    if validator.keys(condition, path, ['db', 'id']):
        validator.enum(condition, 'db', path, CONDITION_DBS)
        validator.regex(condition, 'id', path, OMIM_REGEX if condition['db'] == 'OMIM' else MONDO_ID_REGEX)


def _validate_germline_record(validator, record, path):
    if not validator.keys(record, path, [
        'recordStatus', 'localKey', 'germlineClassification', 'conditionSet', 'observedIn', 'variantSet',
    ], ['clinvarAccession']):
        return
    validator.enum(record, 'recordStatus', path, [RECORD_STATUS_NOVEL, RECORD_STATUS_UPDATE])
    validator.regex(record, 'clinvarAccession', path, SCV_REGEX)
    if (record['recordStatus'] == RECORD_STATUS_UPDATE) != ('clinvarAccession' in record):
        validator.errors.append(f'{path}: clinvarAccession is required for an update and not allowed for a novel record')

    classification = record['germlineClassification']
    classification_path = f'{path}.germlineClassification'
    if validator.keys(
        classification, classification_path, ['germlineClassificationDescription'], ['modeOfInheritance', 'citation'],
    ):
        validator.enum(classification, 'germlineClassificationDescription', classification_path, GERMLINE_CLASSIFICATIONS)
        validator.enum(classification, 'modeOfInheritance', classification_path, MODES_OF_INHERITANCE)
        for i, citation in enumerate(classification.get('citation', [])):
            citation_path = f'{classification_path}.citation[{i}]'
            if validator.keys(citation, citation_path, ['db', 'id']):
                validator.enum(citation, 'db', citation_path, [CITATION_DB])
                validator.regex(citation, 'id', citation_path, PUBMED_REGEX)

    if validator.keys(record['conditionSet'], f'{path}.conditionSet', ['condition']):
        condition = validator.single(record['conditionSet'], 'condition', f'{path}.conditionSet')
        if condition is not None:
            _validate_condition(validator, condition, f'{path}.conditionSet.condition[0]')

    observation = validator.single(record, 'observedIn', path)
    observation_path = f'{path}.observedIn[0]'
    if observation is not None and validator.keys(
        observation, observation_path, ['affectedStatus', 'alleleOrigin', 'collectionMethod'], ['numberOfIndividuals'],
    ):
        validator.enum(observation, 'affectedStatus', observation_path, AFFECTED_STATUSES)
        validator.enum(observation, 'alleleOrigin', observation_path, ALLELE_ORIGINS)
        validator.enum(observation, 'collectionMethod', observation_path, COLLECTION_METHODS)
        validator.positive_int(observation, 'numberOfIndividuals', observation_path)

    if validator.keys(record['variantSet'], f'{path}.variantSet', ['variant']):
        variant = validator.single(record['variantSet'], 'variant', f'{path}.variantSet')
        if variant is not None:
            _validate_variant(validator, variant, f'{path}.variantSet.variant[0]')


def validate_submission_content(content):
    """Strict check of the record seqr emits: only the fields seqr writes, only values the ClinVar schema allows."""
    validator = _Validator()
    if not validator.keys(content, 'content', [], [
        'clinvarSubmissionReleaseStatus', 'assertionCriteria', 'germlineSubmission', 'clinvarDeletion',
    ]):
        return validator.errors
    if ('germlineSubmission' in content) == ('clinvarDeletion' in content):
        validator.errors.append('content: exactly one of germlineSubmission or clinvarDeletion is required')
        return validator.errors

    validator.enum(content, 'clinvarSubmissionReleaseStatus', 'content', [RELEASE_STATUS])
    if 'assertionCriteria' in content:
        criteria = content['assertionCriteria']
        if validator.keys(criteria, 'content.assertionCriteria', ['db', 'id']):
            validator.enum(criteria, 'db', 'content.assertionCriteria', ASSERTION_CRITERIA_DBS)
            validator.regex(criteria, 'id', 'content.assertionCriteria', re.compile(r'^[^;\s]+$'))

    if 'germlineSubmission' in content:
        record = validator.single(content, 'germlineSubmission', 'content')
        if record is not None:
            _validate_germline_record(validator, record, 'content.germlineSubmission[0]')
    else:
        deletion = content['clinvarDeletion']
        if validator.keys(deletion, 'content.clinvarDeletion', ['accessionSet']):
            accession = validator.single(deletion, 'accessionSet', 'content.clinvarDeletion')
            accession_path = 'content.clinvarDeletion.accessionSet[0]'
            if accession is not None and validator.keys(accession, accession_path, ['accession']):
                validator.regex(accession, 'accession', accession_path, SCV_REGEX)
    return validator.errors
