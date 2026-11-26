SEX_MALE = 'M'
SEX_FEMALE = 'F'
SEX_UNKNOWN = 'U'
FEMALE_ANEUPLOIDIES = ['XXX', 'X0']
MALE_ANEUPLOIDIES = ['XXY', 'XYY']
FEMALE_SEXES = [SEX_FEMALE, *FEMALE_ANEUPLOIDIES]
MALE_SEXES = [SEX_MALE, *MALE_ANEUPLOIDIES]

AFFECTED_STATUS_AFFECTED = 'A'
AFFECTED_STATUS_UNAFFECTED = 'N'
AFFECTED_STATUS_UNKNOWN = 'U'

SAMPLE_TYPE_WES = 'WES'
SAMPLE_TYPE_WGS = 'WGS'
DATASET_TYPE_VARIANT_CALLS = 'SNV_INDEL'
DATASET_TYPE_SV_CALLS = 'SV'
DATASET_TYPE_MITO_CALLS = 'MITO'

GENOME_VERSION_GRCh37 = '37'
GENOME_VERSION_GRCh38 = '38'

HPO_QUALIFIERS = {
    'age_of_onset': {
        'Adult onset': 'HP:0003581',
        'Childhood onset': 'HP:0011463',
        'Congenital onset': 'HP:0003577',
        'Embryonal onset': 'HP:0011460',
        'Fetal onset': 'HP:0011461',
        'Infantile onset': 'HP:0003593',
        'Juvenile onset': 'HP:0003621',
        'Late onset': 'HP:0003584',
        'Middle age onset': 'HP:0003596',
        'Neonatal onset': 'HP:0003623',
        'Young adult onset': 'HP:0011462',
    },
    'pace_of_progression': {
        'Nonprogressive': 'HP:0003680',
        'Slow progression': 'HP:0003677',
        'Progressive': 'HP:0003676',
        'Rapidly progressive': 'HP:0003678',
        'Variable progression rate': 'HP:0003682',
    },
    'severity': {
        'Borderline': 'HP:0012827',
        'Mild': 'HP:0012825',
        'Moderate': 'HP:0012826',
        'Severe': 'HP:0012828',
        'Profound': 'HP:0012829',
    },
    'temporal_pattern': {
        'Insidious onset': 'HP:0003587',
        'Chronic': 'HP:0011010',
        'Subacute': 'HP:0011011',
        'Acute': 'HP:0011009',
    },
    'spatial_pattern': {
        'Generalized': 'HP:0012837',
        'Localized': 'HP:0012838',
        'Distal': 'HP:0012839',
        'Proximal': 'HP:0012840',
    },
}
