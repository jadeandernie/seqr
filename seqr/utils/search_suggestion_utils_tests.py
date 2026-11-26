from unittest import TestCase

from seqr.utils.search_suggestion_utils import suggest_inheritance_modes

DE_NOVO = 'de_novo'
RECESSIVE = 'recessive'
X_LINKED = 'x_linked_recessive'
PEDIGREE = ['pedigree']
RECORDED = ['expected_inheritance']


def _indiv(individual_id, affected='N', sex='F', mother=None, father=None, has_data=True, expected_inheritance=None):
    return {
        'individual_id': individual_id, 'affected': affected, 'sex': sex, 'mother': mother, 'father': father,
        'has_data': has_data, 'expected_inheritance': expected_inheritance,
    }


def _trio(proband_sex='F', **proband_kwargs):
    return [
        _indiv('child', affected='A', sex=proband_sex, mother='mom', father='dad', **proband_kwargs),
        _indiv('mom', sex='F'),
        _indiv('dad', sex='M'),
    ]


class SearchSuggestionUtilsTest(TestCase):

    def _assert_modes(self, individuals, expected_modes, expected_sources=None):
        suggestions, notes = suggest_inheritance_modes(individuals)
        self.assertListEqual([s['mode'] for s in suggestions], expected_modes)
        for suggestion in suggestions:
            self.assertSetEqual(set(suggestion.keys()), {'mode', 'sources', 'why'})
            self.assertTrue(suggestion['why'])
        if expected_sources is not None:
            self.assertListEqual([s['sources'] for s in suggestions], expected_sources)
        return {s['mode']: s['why'] for s in suggestions}, notes

    def test_trio_unaffected_parents(self):
        whys, notes = self._assert_modes(_trio(), [DE_NOVO, RECESSIVE], [PEDIGREE, PEDIGREE])
        self.assertEqual(
            whys[DE_NOVO],
            'child is affected and both parents (mom, dad) are unaffected and have loaded data, so de novo variants '
            'can be identified.',
        )
        self.assertEqual(
            whys[RECESSIVE],
            'child is affected and both parents (mom, dad) are unaffected and could each be carriers.',
        )
        self.assertListEqual(notes, [])

    def test_trio_affected_male_x_linked(self):
        whys, notes = self._assert_modes(_trio(proband_sex='M'), [DE_NOVO, RECESSIVE, X_LINKED])
        self.assertEqual(
            whys[X_LINKED],
            'child is an affected male and the unaffected mother mom may be a carrier. This is a narrower subset of '
            'the Recessive search.',
        )
        self.assertListEqual(notes, [])

        # Male sex chromosome aneuploidies are treated as male
        self._assert_modes(_trio(proband_sex='XXY'), [DE_NOVO, RECESSIVE, X_LINKED])
        # Female aneuploidies are not
        self._assert_modes(_trio(proband_sex='X0'), [DE_NOVO, RECESSIVE])

    def test_unknown_sex(self):
        _, notes = self._assert_modes(_trio(proband_sex='U'), [DE_NOVO, RECESSIVE])
        self.assertListEqual(notes, ['Sex is not recorded for child, so X-linked inheritance was not assessed.'])

    def test_affected_parent(self):
        individuals = _trio(proband_sex='M')
        individuals[2]['affected'] = 'A'
        whys, notes = self._assert_modes(individuals, [DE_NOVO], [PEDIGREE])
        self.assertEqual(
            whys[DE_NOVO], 'child and their father dad are both affected, consistent with dominant inheritance.',
        )
        self.assertListEqual(notes, [])

        # An affected mother does not produce an X-linked recessive suggestion
        individuals = _trio(proband_sex='M')
        individuals[1]['affected'] = 'A'
        whys, _ = self._assert_modes(individuals, [DE_NOVO])
        self.assertIn('child and their mother mom are both affected', whys[DE_NOVO])

    def test_affected_parent_without_data(self):
        individuals = _trio()
        individuals[1].update({'affected': 'A', 'has_data': False})
        whys, _ = self._assert_modes(individuals, [DE_NOVO])
        self.assertEqual(
            whys[DE_NOVO],
            'child and their mother mom are both affected, consistent with dominant inheritance (mom has no loaded '
            'data).',
        )

        # With no other loaded relative a dominant search is not supported
        individuals[2]['has_data'] = False
        _, notes = self._assert_modes(individuals, [])
        self.assertListEqual(notes, [
            'Only one individual with a known affected status has loaded data (child), so no inheritance mode was '
            'inferred from the pedigree. The mother mom is recorded as affected, which suggests dominant '
            'inheritance, but a dominant search needs data for at least one more relative.',
        ])

    def test_duo(self):
        individuals = [_indiv('child', affected='A', mother='mom'), _indiv('mom')]
        whys, notes = self._assert_modes(individuals, [RECESSIVE, DE_NOVO], [PEDIGREE, PEDIGREE])
        self.assertEqual(
            whys[RECESSIVE],
            'child is the only affected individual with data. Unaffected relatives with data (mom) are used to '
            'exclude variants that do not fit recessive inheritance.',
        )
        self.assertEqual(
            whys[DE_NOVO],
            'Variants in child that are absent from the unaffected relatives with data (mom). Data is not loaded '
            'for two unaffected parents, so a de novo origin cannot be confirmed.',
        )
        self.assertListEqual(notes, [])

        # Affected male with an unaffected mother
        individuals[0]['sex'] = 'M'
        self._assert_modes(individuals, [RECESSIVE, X_LINKED, DE_NOVO])

        # Affected male with only the father loaded has no carrier mother on record
        individuals = [_indiv('child', affected='A', sex='M', father='dad'), _indiv('dad', sex='M')]
        self._assert_modes(individuals, [RECESSIVE, DE_NOVO])

    def test_trio_missing_parent_data(self):
        individuals = _trio(proband_sex='M')
        individuals[1]['has_data'] = False
        whys, notes = self._assert_modes(individuals, [RECESSIVE, X_LINKED, DE_NOVO])
        self.assertIn('Unaffected relatives with data (dad)', whys[RECESSIVE])
        self.assertIn('the unaffected mother mom may be a carrier (mom has no loaded data)', whys[X_LINKED])
        self.assertListEqual(notes, [])

    def test_trio_parent_unknown_affected(self):
        individuals = _trio()
        individuals[2]['affected'] = 'U'
        _, notes = self._assert_modes(individuals, [RECESSIVE, DE_NOVO])
        self.assertListEqual(notes, [
            'Affected status is unknown for dad, so inheritance filters ignore their genotypes.',
        ])

    def test_singleton(self):
        _, notes = self._assert_modes([_indiv('child', affected='A', sex='M')], [])
        self.assertListEqual(notes, [
            'Only one individual with a known affected status has loaded data (child), so no inheritance mode was '
            'inferred from the pedigree.',
        ])

        # Relatives without data or with unknown affected status do not make the family searchable as a trio
        individuals = _trio()
        individuals[1]['has_data'] = False
        individuals[2]['affected'] = 'U'
        _, notes = self._assert_modes(individuals, [])
        self.assertEqual(len(notes), 2)
        self.assertIn('Affected status is unknown for dad', notes[0])
        self.assertIn('Only one individual with a known affected status has loaded data (child)', notes[1])

    def test_multiplex_affected_siblings(self):
        individuals = _trio(proband_sex='M') + [_indiv('sib', affected='A', sex='F', mother='mom', father='dad')]
        whys, notes = self._assert_modes(individuals, [RECESSIVE, DE_NOVO], [PEDIGREE, PEDIGREE])
        self.assertEqual(
            whys[RECESSIVE],
            'child, sib are affected and none of their parents is recorded as affected, consistent with recessive '
            'inheritance.',
        )
        self.assertEqual(
            whys[DE_NOVO],
            'Lower priority: variants carried by all 2 affected individuals and absent from the unaffected relatives '
            'with data (mom, dad), as with parental mosaicism.',
        )
        self.assertListEqual(notes, [])

        # All affected siblings male
        individuals[3]['sex'] = 'M'
        whys, _ = self._assert_modes(individuals, [RECESSIVE, X_LINKED, DE_NOVO])
        self.assertIn('All affected individuals with data (child, sib) are male', whys[X_LINKED])

        # Affected siblings with no parents loaded
        siblings = [_indiv('sib1', affected='A', sex='M'), _indiv('sib2', affected='A', sex='M')]
        whys, _ = self._assert_modes(siblings, [RECESSIVE, DE_NOVO])
        self.assertEqual(whys[DE_NOVO], 'Lower priority: variants carried by all 2 affected individuals.')

    def test_multiplex_multiple_generations(self):
        individuals = _trio() + [
            _indiv('grandma', affected='A', has_data=False),
            _indiv('uncle', affected='N', sex='M', mother='grandma'),
        ]
        individuals[1].update({'affected': 'A', 'mother': 'grandma'})
        whys, _ = self._assert_modes(individuals, [DE_NOVO])
        self.assertIn('child and their mother mom are both affected', whys[DE_NOVO])

    def test_no_affected_or_no_data(self):
        individuals = _trio()
        individuals[0]['affected'] = 'N'
        self.assertTupleEqual(suggest_inheritance_modes(individuals), (
            [], ['No individual is recorded as affected, so inheritance searches cannot be run.'],
        ))

        individuals = _trio()
        individuals[0]['has_data'] = False
        self.assertTupleEqual(suggest_inheritance_modes(individuals), (
            [], ['The affected individuals (child) have no loaded data, so inheritance searches cannot be run.'],
        ))

        individuals = [_indiv('child', affected='U'), _indiv('mom', affected='U')]
        self.assertTupleEqual(suggest_inheritance_modes(individuals), ([], [
            'Affected status is unknown for child, mom, so inheritance filters ignore their genotypes.',
            'No individual is recorded as affected, so inheritance searches cannot be run.',
        ]))

        for individual in individuals:
            individual['has_data'] = False
        self.assertTupleEqual(
            suggest_inheritance_modes(individuals), ([], ['No individual in this family has loaded data.']),
        )
        self.assertTupleEqual(suggest_inheritance_modes([]), ([], ['No individual in this family has loaded data.']))

    def test_parent_not_in_family(self):
        individuals = [_indiv('child', affected='A', mother='unlisted_mom', father='dad'), _indiv('dad', sex='M')]
        self._assert_modes(individuals, [RECESSIVE, DE_NOVO])

    def test_expected_inheritance(self):
        # Recorded modes come first and are merged with the pedigree inference
        whys, notes = self._assert_modes(
            _trio(expected_inheritance=['R']), [RECESSIVE, DE_NOVO], [RECORDED + PEDIGREE, PEDIGREE],
        )
        self.assertEqual(
            whys[RECESSIVE],
            '"Autosomal recessive inheritance" is recorded as the expected inheritance for child. '
            'child is affected and both parents (mom, dad) are unaffected and could each be carriers.',
        )
        self.assertListEqual(notes, [])

        whys, _ = self._assert_modes(
            _trio(expected_inheritance=['Z', 'D']), [X_LINKED, DE_NOVO, RECESSIVE],
            [RECORDED, RECORDED + PEDIGREE, PEDIGREE],
        )
        self.assertEqual(
            whys[X_LINKED], '"X-linked recessive inheritance" is recorded as the expected inheritance for child.',
        )

        for code in ['S', 'D', 'L', 'A', 'C', 'W']:
            self._assert_modes(
                _trio(expected_inheritance=[code]), [DE_NOVO, RECESSIVE], [RECORDED + PEDIGREE, PEDIGREE],
            )
        self._assert_modes(_trio(expected_inheritance=['X']), [X_LINKED, DE_NOVO, RECESSIVE])

    def test_expected_inheritance_repeated_source(self):
        individuals = _trio(expected_inheritance=['D', 'S'])
        self._assert_modes(individuals, [DE_NOVO, RECESSIVE], [RECORDED + PEDIGREE, PEDIGREE])

    def test_expected_inheritance_unmapped(self):
        _, notes = self._assert_modes(_trio(expected_inheritance=['M', 'F', 'Q']), [DE_NOVO, RECESSIVE])
        self.assertListEqual(notes, [
            '"Mitochondrial inheritance" is recorded as the expected inheritance for child, which has no matching '
            'search inheritance mode.',
            '"Multifactorial inheritance" is recorded as the expected inheritance for child, which has no matching '
            'search inheritance mode.',
            '"Q" is recorded as the expected inheritance for child, which has no matching search inheritance mode.',
        ])

    def test_expected_inheritance_singleton(self):
        # Recessive searches are meaningful for a singleton, dominant searches are not
        whys, notes = self._assert_modes(
            [_indiv('child', affected='A', expected_inheritance=['R', 'D'])], [RECESSIVE], [RECORDED],
        )
        self.assertEqual(
            whys[RECESSIVE], '"Autosomal recessive inheritance" is recorded as the expected inheritance for child.',
        )
        self.assertListEqual(notes, [
            '"Autosomal dominant inheritance" is recorded as the expected inheritance for child, but a dominant '
            'search needs data for at least one more relative with a known affected status.',
            'Only one individual with a known affected status has loaded data (child), so no inheritance mode was '
            'inferred from the pedigree.',
        ])

    def test_expected_inheritance_ignored_for_unaffected(self):
        individuals = _trio()
        individuals[1]['expected_inheritance'] = ['Z']
        self._assert_modes(individuals, [DE_NOVO, RECESSIVE], [PEDIGREE, PEDIGREE])
