from django.test import SimpleTestCase, TestCase
import mock

from clickhouse_search.gene_evidence import parse_gene_evidence, combine_gene_evidence, get_family_evidence_gene_ids
from clickhouse_search.managers import InvalidSearchException
from seqr.models import Family, RnaSample, RnaSeqOutlier, RnaSeqSpliceOutlier

EXPRESSION = {'rna_expression_outlier': True}
SPLICE = {'rna_splice_outlier': True}
EXPRESSION_ONLY_GENE = 'ENSG00000135953'
SHARED_GENE = 'ENSG00000268903'
NEW_GENE = 'ENSG00000097046'
SPLICE_OUTLIER_FIELDS = {
    'p_value': 0.0001, 'chrom': '1', 'start': 100, 'end': 200, 'strand': '+', 'type': 'psi5', 'counts': 10,
    'mean_counts': 1.5, 'total_counts': 20, 'mean_total_counts': 2.5,
}


class GeneEvidenceParseTest(SimpleTestCase):

    def test_parse_gene_evidence(self):
        for empty_evidence in [None, {}, {'match': 'all'}, {'rna_expression_outlier': False, 'rna_splice_outlier': False}]:
            self.assertIsNone(parse_gene_evidence(empty_evidence))

        self.assertEqual(parse_gene_evidence(EXPRESSION), (['rna_expression_outlier'], 'any'))
        self.assertEqual(parse_gene_evidence({**SPLICE, 'match': None}), (['rna_splice_outlier'], 'any'))
        self.assertEqual(
            parse_gene_evidence({**SPLICE, **EXPRESSION, 'match': 'all'}),
            (['rna_expression_outlier', 'rna_splice_outlier'], 'all'),
        )
        self.assertEqual(
            parse_gene_evidence({'rna_expression_outlier': False, **SPLICE, 'match': 'any'}), (['rna_splice_outlier'], 'any'),
        )

        for invalid_evidence, error in [
            (['rna_expression_outlier'], 'Invalid gene evidence filter'),
            ({**EXPRESSION, 'proteomics_outlier': True, 'methylation': True}, 'Invalid gene evidence filter: methylation, proteomics_outlier'),
            ({'rna_expression_outlier': 'yes', 'rna_splice_outlier': 1}, 'Invalid gene evidence filter value for rna_expression_outlier, rna_splice_outlier'),
            ({**EXPRESSION, 'match': 'some'}, 'Invalid gene evidence match "some"'),
        ]:
            with self.assertRaises(InvalidSearchException) as cm:
                parse_gene_evidence(invalid_evidence)
            self.assertEqual(str(cm.exception), error)

    def test_combine_gene_evidence(self):
        gene_sets = [{'A', 'B'}, {'B', 'C'}]
        self.assertSetEqual(combine_gene_evidence(gene_sets, 'any'), {'A', 'B', 'C'})
        self.assertSetEqual(combine_gene_evidence(gene_sets, 'all'), {'B'})
        self.assertSetEqual(combine_gene_evidence([{'A'}, set()], 'all'), set())
        self.assertSetEqual(combine_gene_evidence([{'A'}], 'all'), {'A'})


class FamilyGeneEvidenceTest(TestCase):
    databases = {'default'}
    fixtures = ['users', '1kg_project']

    def _get_gene_ids(self, family_guids, gene_evidence):
        return get_family_evidence_gene_ids(Family.objects.filter(guid__in=family_guids), gene_evidence)

    def _assert_evidence_error(self, family_guids, gene_evidence, error):
        with self.assertRaises(InvalidSearchException) as cm:
            self._get_gene_ids(family_guids, gene_evidence)
        self.assertEqual(str(cm.exception), error)

    def test_no_gene_evidence(self):
        self.assertIsNone(self._get_gene_ids(['F000001_1'], None))
        self.assertIsNone(self._get_gene_ids(['F000002_2'], {'match': 'all', 'rna_splice_outlier': False}))
        self._assert_evidence_error(['F000001_1'], {'tpm': True}, 'Invalid gene evidence filter: tpm')

    def test_evidence_types(self):
        self.assertDictEqual(self._get_gene_ids(['F000001_1'], EXPRESSION), {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}})
        self.assertDictEqual(self._get_gene_ids(['F000001_1'], SPLICE), {'F000001_1': {SHARED_GENE}})
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], {**EXPRESSION, **SPLICE}), {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}},
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], {**EXPRESSION, **SPLICE, 'match': 'any'}),
            {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}},
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], {**EXPRESSION, **SPLICE, 'match': 'all'}), {'F000001_1': {SHARED_GENE}},
        )

    def test_significance_thresholds(self):
        RnaSeqOutlier.objects.create(sample_id=172, gene_id=NEW_GENE, p_value=0.001, p_adjust=0.05, z_score=3)
        expected = {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}}
        self.assertDictEqual(self._get_gene_ids(['F000001_1'], EXPRESSION), expected)
        RnaSeqOutlier.objects.filter(gene_id=NEW_GENE).update(p_adjust=0.049)
        expected['F000001_1'].add(NEW_GENE)
        self.assertDictEqual(self._get_gene_ids(['F000001_1'], EXPRESSION), expected)

        outlier = RnaSeqSpliceOutlier.objects.create(
            sample_id=151, gene_id=NEW_GENE, p_adjust=0.3, delta_intron_jaccard_index=0.5, **SPLICE_OUTLIER_FIELDS,
        )
        for p_adjust, delta_intron_jaccard_index, is_significant in [
            (0.3, 0.5, False), (0.29, 0.1, False), (0.29, -0.1, False), (0.29, 0.11, True), (0.29, -0.11, True),
        ]:
            outlier.p_adjust = p_adjust
            outlier.delta_intron_jaccard_index = delta_intron_jaccard_index
            outlier.save()
            self.assertDictEqual(
                self._get_gene_ids(['F000001_1'], SPLICE),
                {'F000001_1': {SHARED_GENE, NEW_GENE} if is_significant else {SHARED_GENE}},
            )

    def test_tissues_and_samples(self):
        # Fibroblast and muscle samples for the same individual both contribute evidence
        RnaSeqSpliceOutlier.objects.create(
            sample_id=152, gene_id=NEW_GENE, p_adjust=0.01, delta_intron_jaccard_index=0.5, **SPLICE_OUTLIER_FIELDS,
        )
        RnaSeqSpliceOutlier.objects.create(
            sample_id=151, gene_id=EXPRESSION_ONLY_GENE, p_adjust=0.01, delta_intron_jaccard_index=0.5, **SPLICE_OUTLIER_FIELDS,
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], SPLICE), {'F000001_1': {SHARED_GENE, NEW_GENE, EXPRESSION_ONLY_GENE}},
        )

        RnaSample.objects.filter(id=152).update(is_active=False)
        self.assertDictEqual(self._get_gene_ids(['F000001_1'], SPLICE), {'F000001_1': {SHARED_GENE, EXPRESSION_ONLY_GENE}})

        # Evidence is combined across the individuals in a family
        sample = RnaSample.objects.create(
            individual_id=2, data_type='E', tissue_type='WB', sequencing_type='T', data_source='blood.tsv', is_active=True,
        )
        RnaSeqOutlier.objects.create(sample=sample, gene_id=NEW_GENE, p_value=0.001, p_adjust=0.01, z_score=-5)
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], EXPRESSION), {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE, NEW_GENE}},
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1'], {**EXPRESSION, **SPLICE, 'match': 'all'}),
            {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}},
        )

    def test_multiple_families(self):
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1', 'F000014_14'], SPLICE), {'F000001_1': {SHARED_GENE}, 'F000014_14': {SHARED_GENE}},
        )

        # A family with loaded data and no significant outliers has no evidence genes
        RnaSample.objects.create(
            individual_id=19, data_type='E', tissue_type='M', sequencing_type='T', data_source='muscle.tsv', is_active=True,
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1', 'F000014_14'], EXPRESSION),
            {'F000001_1': {EXPRESSION_ONLY_GENE, SHARED_GENE}, 'F000014_14': set()},
        )
        self.assertDictEqual(
            self._get_gene_ids(['F000001_1', 'F000014_14'], {**EXPRESSION, **SPLICE, 'match': 'all'}),
            {'F000001_1': {SHARED_GENE}, 'F000014_14': set()},
        )

        with mock.patch('clickhouse_search.gene_evidence.MAX_GENE_EVIDENCE_FAMILIES', 1):
            self._assert_evidence_error(
                ['F000001_1', 'F000014_14'], SPLICE, 'Gene evidence filters are only supported when searching 1 or fewer families',
            )
            self.assertDictEqual(self._get_gene_ids(['F000014_14'], SPLICE), {'F000014_14': {SHARED_GENE}})

    def test_missing_data(self):
        self._assert_evidence_error(['F000014_14'], EXPRESSION, 'No RNA expression outlier data loaded for family fam14')
        # Family 4 only has TPM data
        self._assert_evidence_error(['F000004_4'], SPLICE, 'No RNA splice outlier data loaded for family 4')
        self._assert_evidence_error(
            ['F000001_1', 'F000002_2', 'F000003_3'], {**EXPRESSION, **SPLICE},
            'No RNA expression outlier data loaded for families 2, 3',
        )
        self._assert_evidence_error(
            ['F000001_1', 'F000014_14'], {**SPLICE, **EXPRESSION, 'match': 'any'},
            'No RNA expression outlier data loaded for family fam14',
        )

        RnaSample.objects.filter(data_type='E').update(is_active=False)
        self._assert_evidence_error(['F000001_1'], EXPRESSION, 'No RNA expression outlier data loaded for family 1')
