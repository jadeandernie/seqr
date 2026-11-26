from reference_data.models import ReactomePathway
from reference_data.management.tests.test_utils import ReferenceDataCommandTestCase


class UpdateReactomeTest(ReferenceDataCommandTestCase):
    URL = 'https://reactome.org/download/current/Ensembl2Reactome.txt'
    DATA = [
        '2RSSE.1b.1\tR-CEL-8980692\thttps://reactome.org/PathwayBrowser/#/R-CEL-8980692\tRHOA GTPase cycle\tIEA\tCaenorhabditis elegans\n',
        'ENSG00000223972\tR-HSA-162699\thttps://reactome.org/PathwayBrowser/#/R-HSA-162699\tSynthesis of dolichyl-phosphate mannose\tTAS\tHomo sapiens\n',
        'ENSG00000223972\tR-HSA-162699\thttps://reactome.org/PathwayBrowser/#/R-HSA-162699\tSynthesis of dolichyl-phosphate mannose\tIEA\tHomo sapiens\n',
        'ENSG00000223972\tR-HSA-4717374\thttps://reactome.org/PathwayBrowser/#/R-HSA-4717374\tDefective DPM1 causes DPM1-CDG\tTAS\tHomo sapiens\n',
        'ENSG00000186092\tR-HSA-162699\thttps://reactome.org/PathwayBrowser/#/R-HSA-162699\tSynthesis of dolichyl-phosphate mannose\tTAS\tHomo sapiens\n',
        'ENSG00000999999\tR-HSA-162699\thttps://reactome.org/PathwayBrowser/#/R-HSA-162699\tSynthesis of dolichyl-phosphate mannose\tTAS\tHomo sapiens\n',
        'ENSP00000300145\tR-HSA-162699\thttps://reactome.org/PathwayBrowser/#/R-HSA-162699\tSynthesis of dolichyl-phosphate mannose\tTAS\tHomo sapiens\n',
        'ENSMUSG00000000001\tR-MMU-170670\thttps://reactome.org/PathwayBrowser/#/R-MMU-170670\tAdenylate cyclase inhibitory pathway\tIEA\tMus musculus\n',
    ]

    def setUp(self):
        super().setUp()
        self.mock_reactome_version_patcher.stop()

    def test_update_reactome_command(self):
        # The file has no header row, covers every species, repeats a gene/pathway pair per evidence code,
        # and lists human protein ids as well as gene ids
        self._test_update_command(
            'ReactomePathway', 'Thu, 20 Mar 2025 20:52:24 GMT', existing_records=11, created_records=3, skipped_records=1,
        )

        self.assertListEqual(
            list(ReactomePathway.objects.order_by('gene__gene_id', 'pathway_id').values_list(
                'gene__gene_id', 'pathway_id', 'name',
            )), [
                ('ENSG00000186092', 'R-HSA-162699', 'Synthesis of dolichyl-phosphate mannose'),
                ('ENSG00000223972', 'R-HSA-162699', 'Synthesis of dolichyl-phosphate mannose'),
                ('ENSG00000223972', 'R-HSA-4717374', 'Defective DPM1 causes DPM1-CDG'),
            ])
