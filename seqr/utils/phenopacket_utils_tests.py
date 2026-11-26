import json
import os
import unittest

from seqr.utils.constants import HPO_QUALIFIERS
from seqr.utils.phenopacket_utils import load_phenopacket_json, parse_phenopackets, combine_parsed_phenopackets, \
    PhenopacketError, ONSET_AGE_BY_HPO_ID, ONSET_AGE_LABELS

RESOURCE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_resources', 'phenopackets')

NO_FIELD = 'is present but is not imported: seqr has no field for it'


def _load_resource(name):
    with open(os.path.join(RESOURCE_DIR, name), 'rb') as f:
        return load_phenopacket_json(f.read())


def _packet(**fields):
    return {'subject': {'id': 'IND_1'}, **fields}


def _parse_one(**fields):
    result = parse_phenopackets(_packet(**fields))
    return result['individuals'][0]


class PhenopacketUtilsTest(unittest.TestCase):
    maxDiff = None

    def _assert_errors(self, data, expected_errors):
        with self.assertRaises(PhenopacketError) as cm:
            parse_phenopackets(data)
        self.assertListEqual(cm.exception.errors, expected_errors)
        self.assertEqual(str(cm.exception), '; '.join(expected_errors))

    def test_phenopacket_example(self):
        self.assertDictEqual(parse_phenopackets(_load_resource('synthetic_phenopacket.json')), {
            'individuals': [{
                'individual_id': 'NA20870',
                'sex': 'M',
                'birth_year': 2012,
                'features': [
                    {'id': 'HP:0001252', 'qualifiers': [
                        {'type': 'severity', 'label': 'Mild'},
                        {'type': 'pace_of_progression', 'label': 'Nonprogressive'},
                        {'type': 'age_of_onset', 'label': 'Infantile onset'},
                    ]},
                    {'id': 'HP:0004322'},
                ],
                'absent_features': [{'id': 'HP:0001263'}],
                'disorders': ['236250'],
                'mondo_id': 'MONDO:0009353',
                'onset_age': 'I',
                'candidate_genes': [{'symbol': 'MTHFR', 'ids': ['HGNC:7436']}],
                'warnings': [
                    f'measurements {NO_FIELD}',
                    f'subject.timeAtLastEncounter {NO_FIELD}',
                    f'subject.vitalStatus {NO_FIELD}',
                    'interpretations[0].progressStatus is present but is not imported: solve status is set by analysts in seqr',
                    'interpretations[0].diagnosis.disease is present but is not imported: diagnoses are read from the diseases field',
                ],
            }],
            'warnings': [],
            'ignored_fields': [
                'files',
                'id',
                'interpretations[].diagnosis.genomicInterpretations[].gene.description',
                'interpretations[].diagnosis.genomicInterpretations[].subjectOrBiosampleId',
                'interpretations[].id',
                'interpretations[].summary',
                'metaData.createdBy',
                'metaData.externalReferences',
                'metaData.submittedBy',
                'phenotypicFeatures[].description',
                'phenotypicFeatures[].evidence',
                'subject.alternateIds',
                'subject.dateOfBirth (only the year is kept)',
            ],
        })

    def test_family_example(self):
        self.assertDictEqual(parse_phenopackets(_load_resource('synthetic_family.json')), {
            'individuals': [{
                'individual_id': 'NA19675_1',
                'sex': 'XXY',
                'affected': 'A',
                'birth_year': 2001,
                'consanguinity': False,
                'maternal_id': 'NA19679',
                'paternal_id': 'NA19678',
                'features': [
                    {'id': 'HP:0001631'},
                    {'id': 'HP:0012469', 'qualifiers': [{'type': 'age_of_onset', 'label': 'Infantile onset'}]},
                ],
                'absent_features': [{'id': 'HP:0002011'}],
                'disorders': ['615593', '236250'],
                'onset_age': 'C',
                'candidate_genes': [{'symbol': 'CDC7', 'ids': ['HGNC:1745']}, {'symbol': 'ACY3', 'ids': ['HGNC:17012']}],
                'warnings': [
                    'proband.interpretations[0].diagnosis.genomicInterpretations[0].variantInterpretation: variant '
                    'details are not imported, only the gene',
                    'proband.interpretations[0].diagnosis.genomicInterpretations[2]: an interpretation with status '
                    'REJECTED is not imported (only CANDIDATE, CONTRIBUTORY and CAUSATIVE genes are)',
                ],
            }, {
                'individual_id': 'NA19678', 'sex': 'M', 'affected': 'N', 'warnings': [],
            }, {
                'individual_id': 'NA19679', 'sex': 'F', 'affected': 'A', 'features': [{'id': 'HP:0011675'}], 'warnings': [],
            }],
            'warnings': [],
            'ignored_fields': [
                'id',
                'metaData.createdBy',
                'pedigree.persons[].familyId',
                'proband.id',
                'proband.interpretations[].diagnosis.genomicInterpretations[].subjectOrBiosampleId',
                'proband.interpretations[].id',
                'proband.subject.dateOfBirth (only the year is kept)',
                'relatives[].id',
            ],
        })

    def test_cohort_example(self):
        self.assertDictEqual(parse_phenopackets(_load_resource('synthetic_cohort.json')), {
            'individuals': [{
                'individual_id': 'HG00731',
                'sex': 'F',
                'birth_year': 1988,
                'features': [{'id': 'HP:0002017'}, {'id': 'HP:0001508'}],
                'mondo_id': 'MONDO:0008788',
                'onset_age': 'Y',
                'warnings': [],
            }, {
                'individual_id': 'SYNTHETIC-UNMATCHED-0001',
                'features': [{'id': 'HP:0001252'}],
                'warnings': ['members[1].subject.sex is OTHER_SEX, which has no seqr equivalent; sex is not imported'],
            }],
            'warnings': [],
            'ignored_fields': [
                'description', 'id', 'members[].id', 'members[].subject.dateOfBirth (only the year is kept)',
                'metaData.createdBy',
            ],
        })

    def test_identifying_content_is_never_copied(self):
        identifying = [
            'Jane Citizen', 'MRN-555-0001', '1999-04-23', 'Dr Alex Clinician', 'registrar@hospital.example',
            'free text about the patient', '/data/jane_citizen.vcf', 'the Citizen family', 'letter to the GP',
            'jane-biosample', 'packet-for-jane', 'gene note about Jane', 'updated by Dr Alex',
        ]
        packet = {
            'id': 'packet-for-jane',
            'subject': {
                'id': 'IND_1', 'alternateIds': ['Jane Citizen', 'MRN-555-0001'], 'dateOfBirth': '1999-04-23T00:00:00Z',
                'sex': 'FEMALE', 'gender': {'id': 'LOINC:LA22878-5', 'label': 'free text about the patient'},
            },
            'phenotypicFeatures': [{
                'description': 'free text about the patient',
                'type': {'id': 'HP:0001252', 'label': 'free text about the patient'},
                'evidence': [{'reference': {'id': 'PMID:1', 'description': 'letter to the GP'}}],
            }, {
                'type': {'id': 'Jane Citizen', 'label': 'Jane Citizen'},
            }],
            'diseases': [
                {'term': {'id': 'OMIM:615593', 'label': 'free text about the patient'}},
                {'term': {'id': 'MRN-555-0001'}},
            ],
            'interpretations': [{
                'id': 'packet-for-jane', 'summary': 'free text about the patient',
                'diagnosis': {'genomicInterpretations': [{
                    'subjectOrBiosampleId': 'jane-biosample', 'interpretationStatus': 'CAUSATIVE',
                    'gene': {'valueId': 'Jane Citizen', 'symbol': 'MTHFR', 'description': 'gene note about Jane'},
                }, {
                    'subjectOrBiosampleId': 'jane-biosample', 'interpretationStatus': 'CANDIDATE',
                    'gene': {'valueId': 'Jane Citizen', 'symbol': 'Jane Citizen'},
                }]},
            }],
            'files': [{'uri': '/data/jane_citizen.vcf', 'individualToFileIdentifiers': {'IND_1': 'Jane Citizen'}}],
            'metaData': {
                'createdBy': 'Dr Alex Clinician', 'submittedBy': 'registrar@hospital.example',
                'updates': [{'timestamp': '2024-01-01T00:00:00Z', 'updatedBy': 'updated by Dr Alex', 'comment': 'letter to the GP'}],
                'externalReferences': [{'id': 'PMID:1', 'description': 'letter to the GP'}],
            },
        }
        family = {
            'id': 'the Citizen family',
            'proband': packet,
            'pedigree': {'persons': [{'familyId': 'the Citizen family', 'individualId': 'IND_1', 'sex': 'FEMALE'}]},
            'files': [{'uri': '/data/jane_citizen.vcf'}],
            'metaData': {'createdBy': 'Dr Alex Clinician'},
        }
        cohort = {'id': 'packet-for-jane', 'description': 'free text about the patient', 'members': [packet]}

        expected_individual = {
            'individual_id': 'IND_1',
            'sex': 'F',
            'birth_year': 1999,
            'features': [{'id': 'HP:0001252'}],
            'disorders': ['615593'],
            'candidate_genes': [{'symbol': 'MTHFR', 'ids': []}],
        }
        for message, prefix in [(packet, ''), (family, 'proband.'), (cohort, 'members[0].'), ([packet], '[0].')]:
            result = parse_phenopackets(message)
            self.assertDictEqual(result['individuals'][0], {**expected_individual, 'warnings': [
                f'{prefix}subject.gender {NO_FIELD}',
                f'{prefix}phenotypicFeatures[1].type: an identifier that is not a CURIE is not an HPO term and is not imported',
                f'{prefix}diseases[1].term: an identifier that is not a CURIE is not an OMIM or MONDO identifier and is not imported',
                f'{prefix}interpretations[0].diagnosis.genomicInterpretations[1].gene: no usable gene symbol or identifier, nothing is imported',
            ]})
            serialized = json.dumps(result)
            for value in identifying:
                self.assertNotIn(value, serialized)

        self.assertListEqual(parse_phenopackets(packet)['ignored_fields'], [
            'files', 'id',
            'interpretations[].diagnosis.genomicInterpretations[].gene.description',
            'interpretations[].diagnosis.genomicInterpretations[].subjectOrBiosampleId',
            'interpretations[].id', 'interpretations[].summary',
            'metaData.createdBy', 'metaData.externalReferences', 'metaData.submittedBy', 'metaData.updates',
            'phenotypicFeatures[].description', 'phenotypicFeatures[].evidence',
            'subject.alternateIds', 'subject.dateOfBirth (only the year is kept)',
        ])
        self.assertTrue({
            'files', 'id', 'metaData.createdBy', 'pedigree.persons[].familyId', 'proband.subject.alternateIds',
        }.issubset(parse_phenopackets(family)['ignored_fields']))
        self.assertTrue({'description', 'id', 'members[].files'}.issubset(parse_phenopackets(cohort)['ignored_fields']))

        # errors name the path and the expected type, never the offending value
        packet['subject']['dateOfBirth'] = 'born 23 April 1999, Jane Citizen'
        packet['subject']['sex'] = 'Jane Citizen'
        packet['phenotypicFeatures'][0]['onset'] = {'age': {'iso8601duration': 'Jane Citizen'}}
        with self.assertRaises(PhenopacketError) as cm:
            parse_phenopackets(packet)
        self.assertListEqual(cm.exception.errors, [
            'subject.dateOfBirth: expected an ISO 8601 timestamp such as 2010-01-01T00:00:00Z',
            'subject.sex: not a value of the Sex enum (FEMALE, MALE, OTHER_SEX, UNKNOWN_SEX)',
            'phenotypicFeatures[0].onset.age.iso8601duration: expected an ISO 8601 duration such as P5Y or P3M',
        ])

    def test_sex(self):
        cases = [
            ({'sex': 'FEMALE'}, 'F', []),
            ({'sex': 'MALE'}, 'M', []),
            ({'sex': 'UNKNOWN_SEX'}, None, []),
            ({}, None, []),
            ({'sex': 'OTHER_SEX'}, None, ['subject.sex is OTHER_SEX, which has no seqr equivalent; sex is not imported']),
            ({'sex': 'MALE', 'karyotypicSex': 'XXY'}, 'XXY', []),
            ({'sex': 'MALE', 'karyotypicSex': 'XYY'}, 'XYY', []),
            ({'sex': 'FEMALE', 'karyotypicSex': 'XXX'}, 'XXX', []),
            ({'karyotypicSex': 'XO'}, 'X0', []),
            ({'karyotypicSex': 'XX'}, 'F', []),
            ({'sex': 'UNKNOWN_SEX', 'karyotypicSex': 'XY'}, 'M', []),
            ({'sex': 'FEMALE', 'karyotypicSex': 'XY'}, 'F', []),
            ({'sex': 'OTHER_SEX', 'karyotypicSex': 'XY'}, None, [
                'subject.sex is OTHER_SEX, which has no seqr equivalent; sex is not imported']),
            ({'sex': 'MALE', 'karyotypicSex': 'UNKNOWN_KARYOTYPE'}, 'M', []),
            ({'sex': 'MALE', 'karyotypicSex': 'XXYY'}, 'M', [
                'subject.karyotypicSex is XXYY, which has no seqr equivalent, and is not imported']),
            ({'karyotypicSex': 'OTHER_KARYOTYPE'}, None, [
                'subject.karyotypicSex is OTHER_KARYOTYPE, which has no seqr equivalent, and is not imported']),
        ]
        for subject, expected_sex, expected_warnings in cases:
            with self.subTest(subject):
                individual = _parse_one(subject={'id': 'IND_1', **subject})
                self.assertEqual(individual.get('sex'), expected_sex)
                self.assertEqual('sex' in individual, bool(expected_sex))
                self.assertListEqual(individual['warnings'], expected_warnings)

        self._assert_errors(_packet(subject={'id': 'IND_1', 'sex': 'female', 'karyotypicSex': 3}), [
            'subject.sex: not a value of the Sex enum (FEMALE, MALE, OTHER_SEX, UNKNOWN_SEX)',
            'subject.karyotypicSex: expected string, found number',
        ])

    def test_subject(self):
        individual = _parse_one(subject={
            'id': 'IND_1', 'dateOfBirth': '2010-12-31', 'taxonomy': {'id': 'NCBITaxon:9606'},
            'vitalStatus': {'status': 'DECEASED', 'timeOfDeath': {'timestamp': '2020-01-01T00:00:00Z'}},
            'timeAtLastEncounter': {'age': {'iso8601duration': 'P9Y'}},
        })
        self.assertDictEqual(individual, {'individual_id': 'IND_1', 'birth_year': 2010, 'warnings': [
            f'subject.timeAtLastEncounter {NO_FIELD}', f'subject.vitalStatus {NO_FIELD}',
        ]})

        # an age alone is never turned into a birth year
        self.assertDictEqual(
            _parse_one(subject={'id': 'IND_1', 'timeAtLastEncounter': {'age': {'iso8601duration': 'P9Y'}}}),
            {'individual_id': 'IND_1', 'warnings': [f'subject.timeAtLastEncounter {NO_FIELD}']},
        )

        for date_of_birth in ['1899-12-31T23:59:59Z', '2030-01-01T00:00:00Z']:
            self.assertDictEqual(_parse_one(subject={'id': 'IND_1', 'dateOfBirth': date_of_birth}), {
                'individual_id': 'IND_1',
                'warnings': ['subject.dateOfBirth is outside the years seqr accepts (1900-2029) and is not imported'],
            })

        self.assertListEqual(_parse_one(subject={'id': 'IND_1', 'taxonomy': {'id': 'NCBITaxon:10090'}})['warnings'], [
            'subject.taxonomy is not human (NCBITaxon:9606); check that this subject belongs in seqr',
        ])

        self._assert_errors({'subject': {'dateOfBirth': 2010, 'taxonomy': 'human'}}, [
            'subject.taxonomy: expected object, found string',
            'subject.dateOfBirth: expected string, found number',
            'subject.id: required string is missing',
        ])
        self._assert_errors({'subject': {'id': ' ', 'dateOfBirth': '2010', 'taxonomy': {}}}, [
            'subject.taxonomy.id: required string is missing',
            'subject.dateOfBirth: expected an ISO 8601 timestamp such as 2010-01-01T00:00:00Z',
            'subject.id: required string is empty',
        ])
        self._assert_errors({'subject': None, 'phenotypicFeatures': {}}, [
            'subject: required object is missing',
            'phenotypicFeatures: expected array, found object',
        ])

    def test_phenotypic_features(self):
        individual = _parse_one(phenotypicFeatures=[
            {'type': {'id': 'HP:0001252'}, 'excluded': False},
            {'type': {'id': 'HP:0001263'}, 'excluded': True},
            {'type': {'id': 'HP:0001252'}, 'severity': {'id': 'HP:0012828'}},
            {'type': {'id': 'HP:0001263'}, 'excluded': True, 'resolution': {'age': {'iso8601duration': 'P2Y'}}},
            {'type': {'id': 'HP:0011675'}, 'excluded': True},
            {'type': {'id': 'HP:0011675'}},
            {'type': {'id': 'SNOMED:123'}},
            {'type': {'id': 'HP:12'}, 'excluded': True},
            {
                'type': {'id': 'HP:0002017'},
                'severity': {'id': 'HP:0012826'},
                'modifiers': [
                    {'id': 'HP:0012828'}, {'id': 'HP:0003676'}, {'id': 'HP:0011010'}, {'id': 'HP:0012839'},
                    {'id': 'HP:0012832'}, {'id': 'not a curie'}, {'id': 'HP:0003682'},
                ],
                'onset': {'ontologyClass': {'id': 'HP:0003621'}},
            },
        ])
        self.assertDictEqual(individual, {
            'individual_id': 'IND_1',
            'features': [
                {'id': 'HP:0001252'},
                {'id': 'HP:0011675'},
                {'id': 'HP:0002017', 'qualifiers': [
                    {'type': 'severity', 'label': 'Moderate'},
                    {'type': 'pace_of_progression', 'label': 'Progressive'},
                    {'type': 'temporal_pattern', 'label': 'Chronic'},
                    {'type': 'spatial_pattern', 'label': 'Distal'},
                    {'type': 'age_of_onset', 'label': 'Juvenile onset'},
                ]},
            ],
            'absent_features': [{'id': 'HP:0001263'}],
            'warnings': [
                f'phenotypicFeatures[3].resolution {NO_FIELD}',
                'phenotypicFeatures[6].type: SNOMED:123 is not an HPO term and is not imported',
                'phenotypicFeatures[7].type: HP:12 is not an HPO term and is not imported',
                'phenotypicFeatures[8].modifiers[0]: seqr keeps one severity qualifier per term; this additional one is not imported',
                'phenotypicFeatures[8].modifiers[4]: HP:0012832 is not one of the modifiers seqr supports and is not imported',
                'phenotypicFeatures[8].modifiers[5]: an identifier that is not a CURIE is not one of the modifiers seqr supports and is not imported',
                'phenotypicFeatures[8].modifiers[6]: seqr keeps one pace_of_progression qualifier per term; this additional one is not imported',
                'phenotypicFeatures: HP:0011675 recorded as both observed and excluded; imported as observed',
            ],
        })

        self.assertDictEqual(
            _parse_one(phenotypicFeatures=[{'type': {'id': 'HP:0001263'}, 'excluded': True}]),
            {'individual_id': 'IND_1', 'absent_features': [{'id': 'HP:0001263'}], 'warnings': []},
        )
        self.assertDictEqual(_parse_one(phenotypicFeatures=[]), {'individual_id': 'IND_1', 'warnings': []})

        self._assert_errors(_packet(phenotypicFeatures=[
            'HP:0001252',
            {},
            {'type': 'HP:0001252'},
            {'type': {'id': 7}, 'excluded': 'true'},
            {'type': {'id': ''}, 'modifiers': {'id': 'HP:0012828'}},
            {'type': {'id': 'HP:0001252'}, 'modifiers': [None, {'label': 'Severe'}], 'severity': [], 'onset': 'P1Y'},
        ]), [
            'phenotypicFeatures[0]: expected object, found string',
            'phenotypicFeatures[1].type: required object is missing',
            'phenotypicFeatures[2].type: expected object, found string',
            'phenotypicFeatures[3].excluded: expected boolean, found string',
            'phenotypicFeatures[3].type.id: expected string, found number',
            'phenotypicFeatures[4].type.id: required string is empty',
            'phenotypicFeatures[4].modifiers: expected array, found object',
            'phenotypicFeatures[5].severity: expected object, found array',
            'phenotypicFeatures[5].modifiers[0]: expected object, found null',
            'phenotypicFeatures[5].modifiers[1].id: required string is missing',
            'phenotypicFeatures[5].onset: expected object, found string',
        ])

    def test_onset_hpo_terms(self):
        # every seqr onset category is reachable from its own HPO term, and labels match seqr's qualifier labels
        self.assertDictEqual(
            {hpo_id: code for hpo_id, code in ONSET_AGE_BY_HPO_ID.items() if hpo_id in HPO_QUALIFIERS['age_of_onset'].values()},
            {
                'HP:0003577': 'G', 'HP:0011460': 'E', 'HP:0011461': 'F', 'HP:0003623': 'N', 'HP:0003593': 'I',
                'HP:0011463': 'C', 'HP:0003621': 'J', 'HP:0003581': 'A', 'HP:0011462': 'Y', 'HP:0003596': 'M',
                'HP:0003584': 'L',
            },
        )
        self.assertDictEqual(ONSET_AGE_LABELS, {
            'G': 'Congenital onset', 'E': 'Embryonal onset', 'F': 'Fetal onset', 'N': 'Neonatal onset',
            'I': 'Infantile onset', 'C': 'Childhood onset', 'J': 'Juvenile onset', 'A': 'Adult onset',
            'Y': 'Young adult onset', 'M': 'Middle age onset', 'L': 'Late onset',
        })
        for hpo_id, code in ONSET_AGE_BY_HPO_ID.items():
            with self.subTest(hpo_id):
                individual = _parse_one(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': {'ontologyClass': {'id': hpo_id}}}])
                self.assertDictEqual(
                    individual, {'individual_id': 'IND_1', 'disorders': ['615593'], 'onset_age': code, 'warnings': []})
        for hpo_id in ['HP:0034199', 'HP:0034198', 'HP:0034197']:
            self.assertEqual(ONSET_AGE_BY_HPO_ID[hpo_id], 'F')
        for hpo_id in ['HP:0025708', 'HP:0025709', 'HP:0025710']:
            self.assertEqual(ONSET_AGE_BY_HPO_ID[hpo_id], 'Y')

        # broader or unrelated terms are left unset rather than guessed
        for hpo_id in ['HP:0030674', 'HP:0410280', 'HP:4000040', 'HP:0001252']:
            individual = _parse_one(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': {'ontologyClass': {'id': hpo_id}}}])
            self.assertDictEqual(individual, {'individual_id': 'IND_1', 'disorders': ['615593'], 'warnings': [
                f'diseases[0].onset.ontologyClass: {hpo_id} has no matching seqr onset category and is not imported',
            ]})

    def test_onset_ages(self):
        cases = [
            ('P0D', 'G'), ('P0Y', 'G'), ('PT0S', 'G'),
            ('P1D', 'N'), ('P3W', 'N'), ('P27D', 'N'), ('PT12H', 'N'),
            ('P28D', 'I'), ('P4W', 'I'), ('P6M', 'I'), ('P11M', 'I'), ('P0Y11M30D', 'I'),
            ('P1Y', 'C'), ('P12M', 'C'), ('P4Y11M', 'C'), ('P2.5Y', 'C'),
            ('P5Y', 'J'), ('P15Y11M', 'J'),
            ('P16Y', 'Y'), ('P25Y3M2D', 'Y'), ('P39Y', 'Y'),
            ('P40Y', 'M'), ('P59Y11M', 'M'),
            ('P60Y', 'L'), ('P95Y', 'L'),
        ]
        for duration, expected in cases:
            with self.subTest(duration):
                individual = _parse_one(diseases=[
                    {'term': {'id': 'OMIM:615593'}, 'onset': {'age': {'iso8601duration': duration}}}])
                self.assertEqual(individual['onset_age'], expected)
                self.assertListEqual(individual['warnings'], [])

        range_cases = [
            ('P1Y', 'P4Y', 'C', []),
            ('P45Y', 'P49Y', 'M', []),
            ('P3Y', 'P7Y', None, ['diseases[0].onset.ageRange spans more than one seqr onset category and is not imported']),
        ]
        for start, end, expected, expected_warnings in range_cases:
            individual = _parse_one(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': {
                'ageRange': {'start': {'iso8601duration': start}, 'end': {'iso8601duration': end}}}}])
            self.assertEqual(individual.get('onset_age'), expected)
            self.assertListEqual(individual['warnings'], expected_warnings)

        for weeks, expected in [(0, 'E'), (9, 'E'), (10, 'F'), (38, 'F')]:
            individual = _parse_one(diseases=[
                {'term': {'id': 'OMIM:615593'}, 'onset': {'gestationalAge': {'weeks': weeks, 'days': 3}}}])
            self.assertEqual(individual['onset_age'], expected)

        for onset, key in [
            ({'timestamp': '2015-03-01T00:00:00Z'}, 'timestamp'),
            ({'interval': {'start': '2015-03-01T00:00:00Z', 'end': '2015-04-01T00:00:00Z'}}, 'interval'),
        ]:
            individual = _parse_one(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': onset}])
            self.assertDictEqual(individual, {'individual_id': 'IND_1', 'disorders': ['615593'], 'warnings': [
                f'diseases[0].onset.{key} is present but is not imported: a calendar date cannot be converted to an onset category',
            ]})
        self.assertDictEqual(
            _parse_one(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': {}}]),
            {'individual_id': 'IND_1', 'disorders': ['615593'], 'warnings': []},
        )

        def _onsets(*onsets):
            return _packet(diseases=[{'term': {'id': 'OMIM:615593'}, 'onset': onset} for onset in onsets])
        self._assert_errors(_onsets(
            {'age': {'iso8601duration': '5 years'}},
            {'age': {'iso8601duration': 'P'}},
            {'age': {'iso8601duration': 5}},
            {'age': {}},
            {'age': 'P5Y'},
            {'ageRange': {'start': {'iso8601duration': 'P1Y'}}},
            {'ageRange': {'start': {'iso8601duration': 'P1Y'}, 'end': {'iso8601duration': 'soon'}}},
            {'gestationalAge': {'weeks': '12'}},
            {'gestationalAge': {'weeks': True}},
            {'gestationalAge': {}},
            {'ontologyClass': {'label': 'Infantile onset'}},
        ), [
            'diseases[0].onset.age.iso8601duration: expected an ISO 8601 duration such as P5Y or P3M',
            'diseases[1].onset.age.iso8601duration: expected an ISO 8601 duration such as P5Y or P3M',
            'diseases[2].onset.age.iso8601duration: expected string, found number',
            'diseases[3].onset.age.iso8601duration: required string is missing',
            'diseases[4].onset.age: expected object, found string',
            'diseases[5].onset.ageRange.end: required object is missing',
            'diseases[6].onset.ageRange.end.iso8601duration: expected an ISO 8601 duration such as P5Y or P3M',
            'diseases[7].onset.gestationalAge.weeks: expected number, found string',
            'diseases[8].onset.gestationalAge.weeks: expected number, found boolean',
            'diseases[9].onset.gestationalAge.weeks: required number is missing',
            'diseases[10].onset.ontologyClass.id: required string is missing',
        ])

    def test_diseases(self):
        individual = _parse_one(diseases=[
            {'term': {'id': 'OMIM:615593'}, 'onset': {'age': {'iso8601duration': 'P2Y'}}},
            {'term': {'id': 'MIM:236250'}, 'onset': {'ontologyClass': {'id': 'HP:0011463'}}},
            {'term': {'id': 'OMIM:615593'}},
            {'term': {'id': 'MONDO:0008788'}, 'excluded': False, 'laterality': {'id': 'HP:0012834'}},
            {'term': {'id': 'MONDO:0008788'}},
            {'term': {'id': 'MONDO:0044976'}, 'excluded': True, 'onset': {'age': {'iso8601duration': 'P70Y'}}},
            {'term': {'id': 'Orphanet:395'}, 'primarySite': {'id': 'UBERON:0000955'}, 'resolution': {'age': {'iso8601duration': 'P9Y'}}},
            {'term': {'id': 'OMIM:PS123456'}, 'diseaseStage': [{'id': 'NCIT:C28051'}], 'clinicalTnmFinding': [{'id': 'NCIT:C48724'}]},
        ])
        self.assertDictEqual(individual, {
            'individual_id': 'IND_1',
            'disorders': ['615593', '236250'],
            'mondo_id': 'MONDO:0008788',
            'onset_age': 'C',
            'warnings': [
                f'diseases[3].laterality {NO_FIELD}',
                'diseases[5]: excluded diagnosis MONDO:0044976 is not imported: seqr has no field for excluded diagnoses',
                f'diseases[6].resolution {NO_FIELD}',
                f'diseases[6].primarySite {NO_FIELD}',
                'diseases[6].term: Orphanet:395 is not an OMIM or MONDO identifier and is not imported',
                f'diseases[7].diseaseStage {NO_FIELD}',
                f'diseases[7].clinicalTnmFinding {NO_FIELD}',
                'diseases[7].term: OMIM:PS123456 is not an OMIM or MONDO identifier and is not imported',
            ],
        })

        # ambiguous MONDO diagnoses and onsets are left unset
        individual = _parse_one(diseases=[
            {'term': {'id': 'MONDO:0008788'}, 'onset': {'age': {'iso8601duration': 'P2Y'}}},
            {'term': {'id': 'MONDO:0044976'}, 'onset': {'age': {'iso8601duration': 'P20Y'}}},
        ])
        self.assertDictEqual(individual, {'individual_id': 'IND_1', 'warnings': [
            'diseases: 2 MONDO diagnoses are present; the family MONDO ID is only imported when there is exactly one',
            'diseases: the diseases have different onset categories; age of onset is not imported',
        ]})

        self._assert_errors(_packet(diseases=[{}, {'term': {}}, {'term': {'id': 'OMIM:615593'}, 'excluded': 0, 'onset': []}, 3]), [
            'diseases[3]: expected object, found number',
            'diseases[0].term: required object is missing',
            'diseases[1].term.id: required string is missing',
            'diseases[2].excluded: expected boolean, found number',
            'diseases[2].onset: expected object, found array',
        ])

    def test_interpretations(self):
        def _interpretation(*genomic_interpretations, **fields):
            return {'diagnosis': {'genomicInterpretations': list(genomic_interpretations)}, **fields}

        individual = _parse_one(interpretations=[
            _interpretation(
                {'interpretationStatus': 'CANDIDATE', 'gene': {'valueId': 'HGNC:7436', 'symbol': 'MTHFR'}},
                {'interpretationStatus': 'CONTRIBUTORY', 'gene': {
                    'valueId': 'HGNC:1745', 'symbol': 'CDC7', 'alternateIds': ['ensembl:ENSG00000097046', 'not a curie'],
                    'alternateSymbols': ['HSK1'], 'xrefs': ['OMIM:603311'],
                }},
                {'interpretationStatus': 'CAUSATIVE', 'variantInterpretation': {
                    'acmgPathogenicityClassification': 'PATHOGENIC',
                    'variationDescriptor': {
                        'id': 'var-1', 'geneContext': {'valueId': 'ensembl:ENSG00000186092'},
                        'expressions': [{'syntax': 'hgvs.c', 'value': 'NM_001.1:c.1A>G'}],
                    },
                }},
                {'interpretationStatus': 'CAUSATIVE', 'gene': {'valueId': 'HGNC:7436', 'symbol': 'MTHFR'}},
                {'interpretationStatus': 'REJECTED', 'gene': {'valueId': 'HGNC:1', 'symbol': 'A1BG'}},
                {'interpretationStatus': 'UNKNOWN_STATUS', 'gene': {'valueId': 'HGNC:1', 'symbol': 'A1BG'}},
                {'gene': {'valueId': 'HGNC:1', 'symbol': 'A1BG'}},
                {'interpretationStatus': 'CAUSATIVE', 'variantInterpretation': {'variationDescriptor': {'id': 'var-2'}}},
                {'interpretationStatus': 'CAUSATIVE', 'variantInterpretation': {}},
                {'interpretationStatus': 'CANDIDATE'},
                {'interpretationStatus': 'CANDIDATE', 'gene': {'symbol': 'not a symbol!'}},
                progressStatus='IN_PROGRESS',
            ),
            {'id': 'no diagnosis'},
            {'diagnosis': {'disease': {'id': 'OMIM:615593'}}},
        ])
        genomic_path = 'interpretations[0].diagnosis.genomicInterpretations'
        not_imported = 'is not imported (only CANDIDATE, CONTRIBUTORY and CAUSATIVE genes are)'
        self.assertDictEqual(individual, {
            'individual_id': 'IND_1',
            'candidate_genes': [
                {'symbol': 'MTHFR', 'ids': ['HGNC:7436']},
                {'symbol': 'CDC7', 'ids': ['HGNC:1745', 'ensembl:ENSG00000097046']},
                {'symbol': None, 'ids': ['ensembl:ENSG00000186092']},
            ],
            'warnings': [
                'interpretations[0].progressStatus is present but is not imported: solve status is set by analysts in seqr',
                f'{genomic_path}[2].variantInterpretation: variant details are not imported, only the gene',
                f'{genomic_path}[4]: an interpretation with status REJECTED {not_imported}',
                f'{genomic_path}[5]: an interpretation with status UNKNOWN_STATUS {not_imported}',
                f'{genomic_path}[6]: an interpretation with status UNKNOWN_STATUS {not_imported}',
                f'{genomic_path}[7].variantInterpretation: variant details are not imported, only the gene',
                f'{genomic_path}[7]: no gene is given, nothing is imported',
                f'{genomic_path}[8].variantInterpretation: variant details are not imported, only the gene',
                f'{genomic_path}[8]: no gene is given, nothing is imported',
                f'{genomic_path}[9]: no gene is given, nothing is imported',
                f'{genomic_path}[10].gene: no usable gene symbol or identifier, nothing is imported',
                'interpretations[2].diagnosis.disease is present but is not imported: diagnoses are read from the diseases field',
            ],
        })

        self._assert_errors(_packet(interpretations=[
            _interpretation(
                {'interpretationStatus': 'causative', 'gene': {'symbol': 'MTHFR'}},
                {'interpretationStatus': 'CAUSATIVE', 'gene': 'MTHFR'},
                {'interpretationStatus': 'CAUSATIVE', 'gene': {'symbol': ['MTHFR'], 'valueId': 7436}},
                {'interpretationStatus': 'CAUSATIVE', 'gene': {'symbol': 'MTHFR', 'alternateIds': ['HGNC:7436', 7436]}},
                {'interpretationStatus': 'CAUSATIVE', 'variantInterpretation': {'variationDescriptor': {'geneContext': []}}},
                {'interpretationStatus': 'CAUSATIVE', 'variantInterpretation': {'variationDescriptor': 'var'}},
                progressStatus='DONE',
            ),
            {'diagnosis': []},
            {'diagnosis': {'genomicInterpretations': {}}},
        ]), [
            'interpretations[0].progressStatus: not a value of the ProgressStatus enum (COMPLETED, IN_PROGRESS, SOLVED, UNKNOWN_PROGRESS, UNSOLVED)',
            'interpretations[0].diagnosis.genomicInterpretations[0].interpretationStatus: not a value of the '
            'InterpretationStatus enum (CANDIDATE, CAUSATIVE, CONTRIBUTORY, REJECTED, UNKNOWN_STATUS)',
            'interpretations[0].diagnosis.genomicInterpretations[1].gene: expected object, found string',
            'interpretations[0].diagnosis.genomicInterpretations[2].gene.symbol: expected string, found array',
            'interpretations[0].diagnosis.genomicInterpretations[2].gene.valueId: expected string, found number',
            'interpretations[0].diagnosis.genomicInterpretations[3].gene.alternateIds: expected an array of strings',
            'interpretations[0].diagnosis.genomicInterpretations[4].variantInterpretation.variationDescriptor.geneContext: expected object, found array',
            'interpretations[0].diagnosis.genomicInterpretations[5].variantInterpretation.variationDescriptor: expected object, found string',
            'interpretations[1].diagnosis: expected object, found array',
            'interpretations[2].diagnosis.genomicInterpretations: expected array, found object',
        ])

    def test_unmapped_clinical_fields_warn(self):
        individual = _parse_one(
            measurements=[{'assay': {'id': 'LOINC:1'}}], biosamples=[{'id': 'b1'}], medicalActions=[{'treatment': {}}],
            subject={'id': 'IND_1', 'gender': {'id': 'LOINC:LA22878-5'}},
        )
        self.assertDictEqual(individual, {'individual_id': 'IND_1', 'warnings': [
            f'measurements {NO_FIELD}', f'biosamples {NO_FIELD}', f'medicalActions {NO_FIELD}', f'subject.gender {NO_FIELD}',
        ]})
        # empty values are not reported, unknown extra fields are tolerated
        self.assertDictEqual(
            _parse_one(measurements=[], biosamples=None, files=[], id='', someFutureField={'a': 1}, metaData={}),
            {'individual_id': 'IND_1', 'warnings': []},
        )

    def test_meta_data(self):
        version_warning = 'metaData.phenopacketSchemaVersion is not a 2.x version: this importer reads Phenopackets v2, ' \
                          'fields from other versions may be missed'
        result = parse_phenopackets([
            _packet(metaData={'phenopacketSchemaVersion': '1.0.0'}),
            _packet(subject={'id': 'IND_2'}, metaData={'phenopacketSchemaVersion': '1.0.0'}),
            _packet(subject={'id': 'IND_3'}, metaData={'phenopacketSchemaVersion': '2.0.2', 'created': '2024-01-01T00:00:00Z'}),
        ])
        self.assertDictEqual(result, {
            'individuals': [{'individual_id': f'IND_{i}', 'warnings': []} for i in [1, 2, 3]],
            'warnings': [version_warning],
            'ignored_fields': [],
        })
        self._assert_errors(_packet(metaData={'phenopacketSchemaVersion': 2}), [
            'metaData.phenopacketSchemaVersion: expected string, found number',
        ])
        self._assert_errors(_packet(metaData='v2'), ['metaData: expected object, found string'])

    def test_family(self):
        family = {
            'proband': {'subject': {'id': 'CHILD', 'sex': 'FEMALE', 'karyotypicSex': 'XXX'}},
            'relatives': [
                {'subject': {'id': 'MUM', 'sex': 'MALE'}},
                {'subject': {'id': 'SIB'}, 'phenotypicFeatures': [{'type': {'id': 'HP:0001252'}}]},
            ],
            'consanguinousParents': True,
            'pedigree': {'persons': [
                {'individualId': 'CHILD', 'maternalId': 'MUM', 'paternalId': 'DAD', 'sex': 'FEMALE', 'affectedStatus': 'AFFECTED'},
                {'individualId': 'MUM', 'maternalId': '0', 'paternalId': '', 'sex': 'FEMALE', 'affectedStatus': 'UNAFFECTED'},
                {'individualId': 'DAD', 'sex': 'MALE', 'affectedStatus': 'MISSING'},
                {'individualId': 'SIB', 'maternalId': 'MUM', 'sex': 'UNKNOWN_SEX'},
                {'individualId': 'AUNT', 'sex': 'OTHER_SEX'},
            ]},
        }
        self.assertDictEqual(parse_phenopackets(family), {
            'individuals': [
                {'individual_id': 'CHILD', 'sex': 'XXX', 'affected': 'A', 'consanguinity': True, 'maternal_id': 'MUM',
                 'paternal_id': 'DAD', 'warnings': []},
                {'individual_id': 'MUM', 'sex': 'M', 'affected': 'N', 'warnings': [
                    'pedigree.persons[1].sex disagrees with the sex of the subject in the Phenopacket; the Phenopacket value is used',
                ]},
                {'individual_id': 'SIB', 'features': [{'id': 'HP:0001252'}], 'maternal_id': 'MUM', 'warnings': []},
                {'individual_id': 'DAD', 'sex': 'M', 'warnings': []},
                {'individual_id': 'AUNT', 'warnings': []},
            ],
            'warnings': [],
            'ignored_fields': [],
        })

        # the pedigree and relatives are optional, the proband is not
        self.assertDictEqual(parse_phenopackets({'proband': {'subject': {'id': 'CHILD'}}}), {
            'individuals': [{'individual_id': 'CHILD', 'warnings': []}], 'warnings': [], 'ignored_fields': [],
        })
        self._assert_errors({'pedigree': {'persons': [{'individualId': 'CHILD'}]}}, ['proband: required object is missing'])
        self._assert_errors({
            'id': 'family',
            'proband': {'phenotypicFeatures': [{}]},
            'relatives': [{'subject': {}}, []],
            'consanguinousParents': 'yes',
            'pedigree': {'persons': [
                {'sex': 'M', 'affectedStatus': 2, 'maternalId': 3},
                {'individualId': 'X', 'affectedStatus': 'YES'},
                'CHILD',
            ]},
        }, [
            'proband.subject: required object is missing',
            'proband.phenotypicFeatures[0].type: required object is missing',
            'consanguinousParents: expected boolean, found string',
            'relatives[1]: expected object, found array',
            'relatives[0].subject.id: required string is missing',
            'pedigree.persons[2]: expected object, found string',
            'pedigree.persons[0].individualId: required string is missing',
            'pedigree.persons[0].sex: not a value of the Sex enum (FEMALE, MALE, OTHER_SEX, UNKNOWN_SEX)',
            'pedigree.persons[0].affectedStatus: expected string, found number',
            'pedigree.persons[0].maternalId: expected string, found number',
            'pedigree.persons[1].affectedStatus: not a value of the AffectedStatus enum (AFFECTED, MISSING, UNAFFECTED)',
        ])
        self._assert_errors({'proband': {'subject': {'id': 'CHILD'}}, 'pedigree': []}, ['pedigree: expected object, found array'])

    def test_cohort(self):
        self.assertDictEqual(parse_phenopackets({'members': []}), {'individuals': [], 'warnings': [], 'ignored_fields': []})
        self._assert_errors({'members': [{'subject': {'id': 'IND_1'}}, {}, 'IND_3']}, [
            'members[2]: expected object, found string',
            'members[1].subject: required object is missing',
        ])
        self._assert_errors({'members': {}}, ['members: expected array, found object'])

    def test_message_types_and_arrays(self):
        result = parse_phenopackets([
            _packet(),
            {'proband': {'subject': {'id': 'IND_2'}}},
            {'members': [{'subject': {'id': 'IND_3'}}]},
        ])
        self.assertListEqual([i['individual_id'] for i in result['individuals']], ['IND_1', 'IND_2', 'IND_3'])

        self._assert_errors({'phenotypicFeatures': []}, [
            'document: not a Phenopacket, Family or Cohort message (no subject, proband or members field)'])
        self._assert_errors('IND_1', ['document: expected object, found string'])
        self._assert_errors([_packet(), None, {'resourceType': 'Patient'}, [_packet()]], [
            '[1]: expected object, found null',
            '[2]: not a Phenopacket, Family or Cohort message (no subject, proband or members field)',
            '[3]: expected object, found array',
        ])
        self._assert_errors([{'subject': {}}], ['[0].subject.id: required string is missing'])

    def test_snake_case_field_names(self):
        individual = _parse_one(
            subject={'id': 'IND_1', 'date_of_birth': '2011-01-01T00:00:00Z', 'karyotypic_sex': 'XY', 'alternate_ids': ['x']},
            phenotypic_features=[{'type': {'id': 'HP:0001252'}}],
            interpretations=[{'diagnosis': {'genomic_interpretations': [{
                'interpretation_status': 'CAUSATIVE',
                'variant_interpretation': {'variation_descriptor': {'gene_context': {'value_id': 'HGNC:7436', 'symbol': 'MTHFR'}}},
            }]}}],
            meta_data={'created_by': 'someone'},
        )
        self.assertDictEqual(individual, {
            'individual_id': 'IND_1', 'sex': 'M', 'birth_year': 2011, 'features': [{'id': 'HP:0001252'}],
            'candidate_genes': [{'symbol': 'MTHFR', 'ids': ['HGNC:7436']}],
            'warnings': [
                'interpretations[0].diagnosis.genomicInterpretations[0].variantInterpretation: variant details are not '
                'imported, only the gene',
            ],
        })
        self.assertDictEqual(
            parse_phenopackets({'proband': _packet(), 'consanguinous_parents': False})['individuals'][0],
            {'individual_id': 'IND_1', 'consanguinity': False, 'warnings': []},
        )

    def test_load_phenopacket_json(self):
        self.assertDictEqual(load_phenopacket_json('{"subject": {"id": "IND_1"}}'), _packet())
        self.assertDictEqual(load_phenopacket_json(b'{"subject": {"id": "IND_1"}}'), _packet())
        self.assertListEqual(load_phenopacket_json('[{"subject": {"id": "IND_1"}}]'), [_packet()])
        self.assertListEqual(
            load_phenopacket_json('{"subject": {"id": "IND_1"}}\n\n{"subject": {"id": "IND_2"}}\n'),
            [_packet(), {'subject': {'id': 'IND_2'}}],
        )
        self.assertDictEqual(parse_phenopackets(_load_resource('synthetic_cohort.json'))['individuals'][0], {
            'individual_id': 'HG00731', 'sex': 'F', 'birth_year': 1988, 'mondo_id': 'MONDO:0008788', 'onset_age': 'Y',
            'features': [{'id': 'HP:0002017'}, {'id': 'HP:0001508'}], 'warnings': [],
        })

        for text, expected in [
            ('', 'not valid JSON (Expecting value at line 1 column 1)'),
            ('{"subject": {"id": "Jane Citizen"', "not valid JSON (Expecting ',' delimiter at line 1 column 34)"),
            (
                '{"subject": {"id": "IND_1"}}\n{"subject": {"id": "Jane Citizen"\n',
                'not valid JSON (Extra data at line 2 column 1), and line 2 is not valid JSON-lines',
            ),
            (b'\xff\xfe{}', 'not UTF-8 encoded text'),
        ]:
            with self.assertRaises(PhenopacketError) as cm:
                load_phenopacket_json(text)
            self.assertListEqual(cm.exception.errors, [expected])

    def test_combine_parsed_phenopackets(self):
        version_warning = 'a message-level warning'
        combined = combine_parsed_phenopackets([
            {'individuals': [{'individual_id': 'IND_1', 'sex': 'F', 'warnings': []}], 'warnings': [version_warning],
             'ignored_fields': ['id', 'subject.alternateIds']},
            {'individuals': [
                {'individual_id': 'IND_2', 'warnings': []}, {'individual_id': 'IND_1', 'sex': 'M', 'warnings': []},
            ], 'warnings': [version_warning, 'another warning'], 'ignored_fields': ['files', 'id']},
        ])
        self.assertDictEqual(combined, {
            'individuals': [{'individual_id': 'IND_1', 'sex': 'F', 'warnings': []}, {'individual_id': 'IND_2', 'warnings': []}],
            'warnings': [
                version_warning, 'another warning',
                '1 record(s) repeat a subject that was already read; only the first record for each subject is used',
            ],
            'ignored_fields': ['files', 'id', 'subject.alternateIds'],
        })
        self.assertDictEqual(combine_parsed_phenopackets([]), {'individuals': [], 'warnings': [], 'ignored_fields': []})
