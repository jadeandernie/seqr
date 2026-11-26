from unittest import TestCase

from seqr.views.utils.completeness_utils import COMPLETENESS_FIELDS, get_individual_completeness, \
    get_family_completeness

COMPLETE_INDIVIDUAL = {
    'affected': 'A',
    'features': [{'id': 'HP:0001631'}],
    'absentFeatures': [{'id': 'HP:0001636'}],
    'onsetAge': 'C',
    'sex': 'F',
    'maternalGuid': 'I000003_na19679',
    'paternalGuid': 'I000002_na19678',
    'birthYear': 2010,
    'consanguinity': False,
    'maternalEthnicity': ['Finnish'],
    'paternalEthnicity': None,
    'expectedInheritance': ['R'],
    'disorders': ['616126'],
    'notes': 'free text is never scored',
}
COMPLETE_FAMILY = {'codedPhenotype': 'myopathy', 'mondoId': 'MONDO:0044970', 'description': 'never scored'}

EXPECTED_FIELDS = [
    ('features', 30, 'individual'),
    ('absentFeatures', 10, 'individual'),
    ('onsetAge', 10, 'individual'),
    ('sex', 8, 'individual'),
    ('parents', 8, 'individual'),
    ('birthYear', 6, 'individual'),
    ('consanguinity', 6, 'individual'),
    ('ancestry', 5, 'individual'),
    ('expectedInheritance', 5, 'individual'),
    ('disorders', 4, 'individual'),
    ('codedPhenotype', 4, 'family'),
    ('mondoId', 4, 'family'),
]
EXPECTED_WEIGHTS = {field: weight for field, weight, _ in EXPECTED_FIELDS}

# The values that make each scored field missing, and the individual or family field that holds it
MISSING_VALUES = {
    'features': ('individual', 'features', [None, []]),
    'absentFeatures': ('individual', 'absentFeatures', [None, []]),
    'onsetAge': ('individual', 'onsetAge', [None, '']),
    'sex': ('individual', 'sex', [None, '', 'U']),
    'birthYear': ('individual', 'birthYear', [None]),
    'consanguinity': ('individual', 'consanguinity', [None]),
    'ancestry': ('individual', 'maternalEthnicity', [None, []]),
    'expectedInheritance': ('individual', 'expectedInheritance', [None, []]),
    'disorders': ('individual', 'disorders', [None, []]),
    'codedPhenotype': ('family', 'codedPhenotype', [None, '']),
    'mondoId': ('family', 'mondoId', [None, '']),
}


def _fields(items):
    return [item['field'] for item in items]


class CompletenessUtilsTest(TestCase):

    def test_field_vocabulary(self):
        self.assertListEqual(
            [(config['field'], config['weight'], config['level']) for config in COMPLETENESS_FIELDS], EXPECTED_FIELDS,
        )
        self.assertEqual(sum(config['weight'] for config in COMPLETENESS_FIELDS), 100)
        self.assertEqual(max(COMPLETENESS_FIELDS, key=lambda config: config['weight'])['field'], 'features')
        labels = [config['label'] for config in COMPLETENESS_FIELDS]
        self.assertEqual(len(set(labels)), len(labels))
        self.assertTrue(all(labels))

    def test_complete_individual(self):
        completeness = get_individual_completeness(COMPLETE_INDIVIDUAL, COMPLETE_FAMILY)
        self.assertDictEqual(completeness, {'score': 100, 'missing': [], 'present': mock_items(EXPECTED_FIELDS)})

    def test_empty_individual(self):
        expected_missing = [field for field in EXPECTED_FIELDS if field[0] != 'parents']
        for individual, family in [
            ({'affected': 'A'}, None),
            ({'affected': 'A'}, {}),
            ({'affected': 'A', 'sex': 'U', 'features': [], 'maternalEthnicity': [], 'notes': 'HP:0001631'},
             {'codedPhenotype': '', 'mondoId': None, 'description': 'myopathy'}),
        ]:
            completeness = get_individual_completeness(individual, family)
            self.assertDictEqual(completeness, {'score': 0, 'missing': mock_items(expected_missing), 'present': []})

    def test_not_affected_individuals_are_not_scored(self):
        for affected in ['N', 'U', None, '']:
            self.assertIsNone(get_individual_completeness({**COMPLETE_INDIVIDUAL, 'affected': affected}, COMPLETE_FAMILY))
        self.assertIsNone(get_individual_completeness({}, COMPLETE_FAMILY))

    def test_each_missing_field(self):
        for field, (level, key, missing_values) in MISSING_VALUES.items():
            for value in missing_values:
                with self.subTest(field=field, value=value):
                    individual = dict(COMPLETE_INDIVIDUAL)
                    family = dict(COMPLETE_FAMILY)
                    (individual if level == 'individual' else family)[key] = value
                    completeness = get_individual_completeness(individual, family)
                    self.assertListEqual(_fields(completeness['missing']), [field])
                    self.assertEqual(completeness['missing'][0]['level'], level)
                    self.assertEqual(completeness['score'], 100 - EXPECTED_WEIGHTS[field])
                    self.assertListEqual(
                        _fields(completeness['present']), [f for f, _, _ in EXPECTED_FIELDS if f != field])

            with self.subTest(field=field, value='absent key'):
                individual = dict(COMPLETE_INDIVIDUAL)
                family = dict(COMPLETE_FAMILY)
                del (individual if level == 'individual' else family)[key]
                self.assertListEqual(_fields(get_individual_completeness(individual, family)['missing']), [field])

    def test_each_present_field(self):
        for field, (level, key, _) in MISSING_VALUES.items():
            with self.subTest(field=field):
                individual = {'affected': 'A'}
                family = {}
                (individual if level == 'individual' else family)[key] = (
                    COMPLETE_INDIVIDUAL if level == 'individual' else COMPLETE_FAMILY)[key]
                completeness = get_individual_completeness(individual, family)
                self.assertListEqual(_fields(completeness['present']), [field])
                # No parents are recorded, so the 8 points for parents are not applicable
                self.assertEqual(completeness['score'], int(100 * EXPECTED_WEIGHTS[field] / 92 + 0.5))

    def test_explicit_negative_answers_are_recorded(self):
        completeness = get_individual_completeness({**COMPLETE_INDIVIDUAL, 'consanguinity': False}, COMPLETE_FAMILY)
        self.assertEqual(completeness['score'], 100)
        completeness = get_individual_completeness({**COMPLETE_INDIVIDUAL, 'consanguinity': True}, COMPLETE_FAMILY)
        self.assertEqual(completeness['score'], 100)

    def test_ancestry_from_either_parent(self):
        for maternal, paternal, expected_missing in [
            (['Finnish'], None, []),
            (None, ['Finnish'], []),
            ([], ['Finnish', 'Irish'], []),
            ([], [], ['ancestry']),
            (None, None, ['ancestry']),
        ]:
            individual = {**COMPLETE_INDIVIDUAL, 'maternalEthnicity': maternal, 'paternalEthnicity': paternal}
            completeness = get_individual_completeness(individual, COMPLETE_FAMILY)
            self.assertListEqual(_fields(completeness['missing']), expected_missing)

    def test_sex_aneuploidies_are_recorded(self):
        for sex in ['M', 'F', 'XXY', 'X0']:
            completeness = get_individual_completeness({**COMPLETE_INDIVIDUAL, 'sex': sex}, COMPLETE_FAMILY)
            self.assertListEqual(completeness['missing'], [])

    def test_parents(self):
        # Founders, who have no parents in the pedigree, are not penalized: the field is left out of the score
        founder = {**COMPLETE_INDIVIDUAL, 'maternalGuid': None, 'paternalGuid': None}
        completeness = get_individual_completeness(founder, COMPLETE_FAMILY)
        self.assertEqual(completeness['score'], 100)
        self.assertListEqual(completeness['missing'], [])
        self.assertNotIn('parents', _fields(completeness['present']))
        self.assertEqual(sum(item['weight'] for item in completeness['present']), 92)

        del founder['maternalGuid']
        del founder['paternalGuid']
        self.assertEqual(get_individual_completeness(founder, COMPLETE_FAMILY), completeness)

        founder_no_features = {**founder, 'features': None}
        completeness = get_individual_completeness(founder_no_features, COMPLETE_FAMILY)
        self.assertEqual(completeness['score'], 67)
        self.assertListEqual(_fields(completeness['missing']), ['features'])

        # A half-recorded pedigree is incomplete
        for parents in [{'maternalGuid': None}, {'paternalGuid': None}, {'paternalGuid': ''}]:
            completeness = get_individual_completeness({**COMPLETE_INDIVIDUAL, **parents}, COMPLETE_FAMILY)
            self.assertEqual(completeness['score'], 92)
            self.assertListEqual(completeness['missing'], mock_items([('parents', 8, 'individual')]))

    def test_inputs_are_not_modified(self):
        individual = {'affected': 'A', 'features': [{'id': 'HP:0001631'}]}
        family = {'mondoId': 'MONDO:0044970'}
        completeness = get_individual_completeness(individual, family)
        self.assertDictEqual(individual, {'affected': 'A', 'features': [{'id': 'HP:0001631'}]})
        self.assertDictEqual(family, {'mondoId': 'MONDO:0044970'})

        completeness['present'][0]['weight'] = 0
        self.assertEqual(COMPLETENESS_FIELDS[0]['weight'], 30)

    def test_family_completeness(self):
        self.assertIsNone(get_family_completeness([]))
        self.assertIsNone(get_family_completeness([None, None]))

        complete = get_individual_completeness(COMPLETE_INDIVIDUAL, COMPLETE_FAMILY)
        no_features = get_individual_completeness({**COMPLETE_INDIVIDUAL, 'features': []}, COMPLETE_FAMILY)
        no_onset = get_individual_completeness({**COMPLETE_INDIVIDUAL, 'onsetAge': None}, {})
        self.assertEqual((complete['score'], no_features['score'], no_onset['score']), (100, 70, 82))

        self.assertDictEqual(
            get_family_completeness([complete]), {'score': 100, 'numIndividuals': 1, 'numNoFeatures': 0})
        self.assertDictEqual(
            get_family_completeness([None, no_features, None]), {'score': 70, 'numIndividuals': 1, 'numNoFeatures': 1})
        self.assertDictEqual(
            get_family_completeness([complete, no_features, None, no_onset, no_features]),
            {'score': 81, 'numIndividuals': 4, 'numNoFeatures': 2},
        )

    def test_scores_round_half_up(self):
        scores = [{'score': score, 'missing': []} for score in (70, 71)]
        self.assertEqual(get_family_completeness(scores)['score'], 71)
        scores = [{'score': score, 'missing': []} for score in (71, 72)]
        self.assertEqual(get_family_completeness(scores)['score'], 72)


def mock_items(fields):
    labels = {config['field']: config['label'] for config in COMPLETENESS_FIELDS}
    return [{'field': field, 'label': labels[field], 'weight': weight, 'level': level} for field, weight, level in fields]
