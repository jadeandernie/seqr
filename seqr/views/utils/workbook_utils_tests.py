from django.test import SimpleTestCase

from seqr.views.utils.workbook_utils import get_key_variant_ids, get_result_keys, to_key_set

SNV = {'variantId': '1-100-A-T', 'key': 5, 'familyGuids': ['F000002_2', 'F000001_1']}
OTHER_SNV = {'variantId': '1-90-C-G', 'key': 6, 'familyGuids': ['F000001_1']}
MITO = {'variantId': 'M-100-A-T', 'key': 5, 'familyGuids': ['F000001_1'], 'mitomapPathogenic': False}
SV = {'variantId': 'DEL:chr1:100-200', 'key': 5, 'familyGuids': ['F000001_1'], 'endChrom': '1'}
GCNV = {'variantId': 'suffix_19107_DEL', 'key': 5, 'familyGuids': ['F000001_1']}


class WorkbookUtilsTest(SimpleTestCase):

    def test_get_result_keys(self):
        self.assertListEqual(get_result_keys([]), [])

        keys = get_result_keys([SNV, [SNV, OTHER_SNV], MITO, SV, GCNV, [SV, OTHER_SNV], [MITO, GCNV]])
        self.assertListEqual(keys, [
            ('F000001_1', 'MITO', 'M-100-A-T'),
            ('F000001_1', 'MITO', 'M-100-A-T', 'SV_WES', 'suffix_19107_DEL'),
            ('F000001_1', 'SNV_INDEL', '1-100-A-T'),
            ('F000001_1', 'SNV_INDEL', '1-100-A-T', 'SNV_INDEL', '1-90-C-G'),
            ('F000001_1', 'SNV_INDEL', '1-90-C-G', 'SV_WGS', 'DEL:chr1:100-200'),
            ('F000001_1', 'SV_WES', 'suffix_19107_DEL'),
            ('F000001_1', 'SV_WGS', 'DEL:chr1:100-200'),
            ('F000002_2', 'SNV_INDEL', '1-100-A-T'),
        ])
        self.assertListEqual([list(get_key_variant_ids(key)) for key in keys[:3]], [
            ['M-100-A-T'], ['M-100-A-T', 'suffix_19107_DEL'], ['1-100-A-T'],
        ])

        # The keys do not depend on the order of the results, of a pair or of the families, on the ClickHouse keys
        # or on annotations, and a result that is returned twice has one key
        reloaded_snv = {**SNV, 'key': 77, 'familyGuids': ['F000001_1', 'F000002_2'], 'transcripts': {'ENSG00000177000': []}}
        reloaded_results = [
            [GCNV, {**MITO, 'key': 78, 'mitomapPathogenic': True}], [{**OTHER_SNV, 'key': 79}, SV], GCNV, SV, MITO,
            [OTHER_SNV, reloaded_snv], reloaded_snv, reloaded_snv,
        ]
        self.assertListEqual(get_result_keys(reloaded_results), keys)

        # The same variant is a different result in another family, pair or dataset type
        self.assertListEqual(get_result_keys([{**SNV, 'familyGuids': ['F000003_3']}]), [
            ('F000003_3', 'SNV_INDEL', '1-100-A-T'),
        ])
        self.assertListEqual(get_result_keys([[SNV, MITO]]), [
            ('F000001_1', 'MITO', 'M-100-A-T', 'SNV_INDEL', '1-100-A-T'),
        ])
        self.assertListEqual(get_result_keys([{**SV, 'endChrom': None}, {'variantId': SV['variantId'], 'familyGuids': ['F000001_1']}]), [
            ('F000001_1', 'SV_WES', 'DEL:chr1:100-200'), ('F000001_1', 'SV_WGS', 'DEL:chr1:100-200'),
        ])

        # A result without families, which a workbook search never has, has no key
        self.assertListEqual(get_result_keys([{'variantId': '1-100-A-T'}, {'variantId': '1-100-A-T', 'familyGuids': None}]), [])

    def test_to_key_set(self):
        self.assertSetEqual(
            to_key_set([['F000001_1', 'MITO', 'M-100-A-T'], ('F000001_1', 'MITO', 'M-100-A-T')]),
            {('F000001_1', 'MITO', 'M-100-A-T')},
        )
