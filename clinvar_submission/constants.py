MODE_DISABLED = 'disabled'
MODE_DRY_RUN = 'dry_run'
MODE_TEST = 'test'
MODE_LIVE = 'live'
MODES = {MODE_DISABLED, MODE_DRY_RUN, MODE_TEST, MODE_LIVE}
SENDING_MODES = {MODE_TEST, MODE_LIVE}

PRODUCTION_URL = 'https://submit.ncbi.nlm.nih.gov/api/v1/submissions/'
TEST_URL = 'https://submit.ncbi.nlm.nih.gov/apitest/v1/submissions/'
SUMMARY_FILE_URL_PREFIX = 'https://submit.ncbi.nlm.nih.gov/'
API_KEY_HEADER = 'SP-API-KEY'
REQUEST_TIMEOUT_SECONDS = 30

# Values below are the enumerations of the ClinVar submission API schema (germlineSubmission records)
GERMLINE_CLASSIFICATIONS = [
    'Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'VUS-high', 'VUS-mid', 'VUS-low', 'Likely benign',
    'Benign', 'Pathogenic, low penetrance', 'Uncertain risk allele', 'Likely pathogenic, low penetrance',
    'Established risk allele', 'Likely risk allele', 'affects', 'association', 'drug response', 'confers sensitivity',
    'protective', 'other', 'not provided',
]

# seqr ACMG calculator vocabulary -> ClinVar term. Anything absent here is refused, never guessed.
ACMG_TO_CLINVAR_CLASSIFICATION = {
    'Pathogenic': 'Pathogenic',
    'Likely Pathogenic': 'Likely pathogenic',
    'Uncertain': 'Uncertain significance',
    'Likely Benign': 'Likely benign',
    'Benign': 'Benign',
}

MODES_OF_INHERITANCE = [
    'Autosomal dominant inheritance', 'Autosomal recessive inheritance', 'Mitochondrial inheritance',
    'Genetic anticipation', 'Sporadic', 'Sex-limited autosomal dominant', 'X-linked recessive inheritance',
    'X-linked dominant inheritance', 'Y-linked inheritance', 'Other', 'X-linked inheritance', 'Codominant',
    'Semidominant inheritance', 'Autosomal unknown', 'Autosomal dominant inheritance with maternal imprinting',
    'Autosomal dominant inheritance with paternal imprinting', 'Multifactorial inheritance', 'Unknown mechanism',
    'Oligogenic inheritance',
]

COLLECTION_METHODS = [
    'curation', 'literature only', 'reference population', 'provider interpretation', 'phenotyping only',
    'case-control', 'clinical testing', 'in vitro', 'in vivo', 'research', 'not provided',
]
DEFAULT_COLLECTION_METHOD = 'research'

AFFECTED_STATUSES = ['yes', 'no', 'unknown', 'not provided', 'not applicable']

ALLELE_ORIGINS = [
    'germline', 'somatic', 'de novo', 'unknown', 'inherited', 'maternal', 'paternal', 'biparental', 'not applicable',
]
DEFAULT_ALLELE_ORIGIN = 'germline'

ASSEMBLY_BY_GENOME_VERSION = {'37': 'GRCh37', '38': 'GRCh38'}
COORDINATE_CHROMOSOMES = [str(i) for i in range(1, 23)] + ['X', 'Y']
MAX_ALLELE_LENGTH = 50

CONDITION_DBS = ['MONDO', 'OMIM']
CITATION_DB = 'PubMed'
ASSERTION_CRITERIA_DBS = ['PubMed', 'DOI', 'pmc']
RELEASE_STATUS = 'public'
RECORD_STATUS_NOVEL = 'novel'
RECORD_STATUS_UPDATE = 'update'

EDITABLE_FIELDS = ['condition_id', 'mode_of_inheritance', 'collection_method', 'affected_status', 'allele_origin', 'citations']
