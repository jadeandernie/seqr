from django.urls.base import reverse
import mock

from seqr.models import Family, Individual, LocusList, PhenotypePrioritization
from seqr.views.apis.search_suggestions_api import family_search_suggestions
from seqr.views.utils.test_utils import AuthenticationTestCase

FAMILY_GUID = 'F000001_1'
TRIO_FAMILY_GUID = 'F000002_2'
NO_DATA_FAMILY_GUID = 'F000003_3'
NO_ACCESS_FAMILY_GUID = 'F000014_14'

RECORDED_RECESSIVE_WHY = '"Autosomal recessive inheritance" is recorded as the expected inheritance for NA19675_1.'
INHERITANCE_SUGGESTIONS = [
    {
        'id': 'inheritance:recessive', 'type': 'inheritance', 'value': 'recessive', 'label': 'recessive',
        'sources': ['expected_inheritance', 'pedigree'],
        'why': f'{RECORDED_RECESSIVE_WHY} NA19675_1 is the only affected individual with data. Unaffected relatives '
               'with data (NA19678) are used to exclude variants that do not fit recessive inheritance.',
    },
    {
        'id': 'inheritance:x_linked_recessive', 'type': 'inheritance', 'value': 'x_linked_recessive',
        'label': 'x_linked_recessive', 'sources': ['pedigree'],
        'why': 'NA19675_1 is an affected male and the unaffected mother NA19679 may be a carrier (NA19679 has no '
               'loaded data). This is a narrower subset of the Recessive search.',
    },
    {
        'id': 'inheritance:de_novo', 'type': 'inheritance', 'value': 'de_novo', 'label': 'de_novo',
        'sources': ['pedigree'],
        'why': 'Variants in NA19675_1 that are absent from the unaffected relatives with data (NA19678). Data is not '
               'loaded for two unaffected parents, so a de novo origin cannot be confirmed.',
    },
]
PRIORITIZED_GENE_SUGGESTION = {
    'id': 'gene:AL627309.7', 'type': 'gene', 'value': 'AL627309.7', 'label': 'AL627309.7',
    'geneId': 'ENSG00000268903', 'sources': ['phenotype_prioritization'],
    'why': 'Ranked 1 by exomiser for NA19675_1 (Khan-Khan-Katsanis syndrome). Ranked 1 by lirical for NA19678 '
           '(Cystinosis, nephropathic). Ranked 2 by exomiser for NA19675_1 (Cystinosis, nephropathic).',
}
GENE_LIST_SUGGESTIONS = [
    {
        'id': 'gene_list:LL00049_pid_genes_autosomal_do', 'type': 'gene_list',
        'value': 'LL00049_pid_genes_autosomal_do', 'label': 'PID genes - Autosomal dominant',
        'sources': ['project_gene_list'], 'numEntries': mock.ANY,
        'why': mock.ANY,
    },
    {
        'id': 'gene_list:LL00005_retina_proteome', 'type': 'gene_list', 'value': 'LL00005_retina_proteome',
        'label': 'Retina proteome', 'sources': ['project_gene_list'], 'numEntries': mock.ANY, 'why': mock.ANY,
    },
]
UNMATCHED_CANDIDATES_NOTE = \
    'Recorded candidate genes that do not match a current gene symbol were skipped: EHBP1L1, ACY3.'
HPO_NOTE = '3 HPO terms are recorded for affected individuals, but seqr has no HPO-to-gene or HPO-to-panel ' \
           'mapping, so they produce no suggestions.'


class SearchSuggestionsAPITest(AuthenticationTestCase):
    fixtures = ['users', '1kg_project', 'reference_data']
    maxDiff = None

    def _get_suggestions(self, family_guid=FAMILY_GUID):
        response = self.client.get(reverse(family_search_suggestions, args=[family_guid]))
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {'familyGuid', 'suggestions', 'notes'})
        self.assertEqual(response_json['familyGuid'], family_guid)
        return response_json['suggestions'], response_json['notes']

    def test_family_search_suggestions(self):
        url = reverse(family_search_suggestions, args=[FAMILY_GUID])
        self.check_collaborator_login(url)

        suggestions, notes = self._get_suggestions()
        self.assertListEqual(
            suggestions, INHERITANCE_SUGGESTIONS + [PRIORITIZED_GENE_SUGGESTION] + GENE_LIST_SUGGESTIONS,
        )
        for suggestion in suggestions[-2:]:
            self.assertEqual(
                suggestion['why'],
                f'Gene list with {suggestion["numEntries"]} entries attached to project 1kg project nåme with '
                'uniçøde.',
            )
            self.assertEqual(
                suggestion['numEntries'],
                LocusList.objects.get(guid=suggestion['value']).locuslistgene_set.count() +
                LocusList.objects.get(guid=suggestion['value']).locuslistinterval_set.count(),
            )
        self.assertListEqual(notes, [UNMATCHED_CANDIDATES_NOTE, HPO_NOTE])

    def test_permissions(self):
        self.login_collaborator()
        response = self.client.get(reverse(family_search_suggestions, args=[NO_ACCESS_FAMILY_GUID]))
        self.assertEqual(response.status_code, 403)

        response = self.client.get(reverse(family_search_suggestions, args=['F_invalid']))
        self.assertEqual(response.status_code, 404)

    def test_candidate_genes(self):
        self.login_collaborator()
        proband = Individual.objects.get(guid='I000001_na19675')
        father = Individual.objects.get(guid='I000002_na19678')
        mother = Individual.objects.get(guid='I000003_na19679')
        proband.candidate_genes = [
            {'gene': ' mthfr ', 'comments': 'confidential free text'}, {'gene': 'OR4F5'}, {'gene': ''}, {},
            {'gene': 'AL627309.7'}, {'gene': 'NOT_A_GENE'}, {'gene': 'MTHFR'},
            # Gene with no coordinates on the genome build of the project
            {'gene': 'DDX11L1'},
        ]
        proband.save()
        # Candidate genes for unaffected individuals are ignored
        father.candidate_genes = [{'gene': 'CDC7'}]
        father.save()
        mother.affected = 'A'
        mother.candidate_genes = [{'gene': 'MTHFR'}, {'gene': 'WASH7P'}]
        mother.save()

        suggestions, notes = self._get_suggestions()
        gene_suggestions = [s for s in suggestions if s['type'] == 'gene']
        self.assertListEqual(gene_suggestions, [
            {
                'id': 'gene:MTHFR', 'type': 'gene', 'value': 'MTHFR', 'label': 'MTHFR', 'geneId': 'ENSG00000177000',
                'sources': ['candidate_genes'], 'why': 'Recorded as a candidate gene for NA19675_1, NA19679.',
            },
            {
                'id': 'gene:OR4F5', 'type': 'gene', 'value': 'OR4F5', 'label': 'OR4F5', 'geneId': 'ENSG00000186092',
                'sources': ['candidate_genes'], 'why': 'Recorded as a candidate gene for NA19675_1.',
            },
            {
                **PRIORITIZED_GENE_SUGGESTION,
                'sources': ['candidate_genes', 'phenotype_prioritization'],
                'why': f'Recorded as a candidate gene for NA19675_1. {PRIORITIZED_GENE_SUGGESTION["why"]}',
            },
            {
                'id': 'gene:WASH7P', 'type': 'gene', 'value': 'WASH7P', 'label': 'WASH7P',
                'geneId': 'ENSG00000227232', 'sources': ['candidate_genes'],
                'why': 'Recorded as a candidate gene for NA19679.',
            },
        ])
        self.assertNotIn('confidential', str(suggestions))
        self.assertIn(
            'Recorded candidate genes that do not match a current gene symbol were skipped: NOT_A_GENE, DDX11L1.',
            notes,
        )

    @mock.patch('seqr.views.apis.search_suggestions_api.MAX_CANDIDATE_GENES', 2)
    def test_candidate_genes_bounded(self):
        self.login_collaborator()
        Individual.objects.filter(guid='I000001_na19675').update(
            candidate_genes=[{'gene': 'MTHFR'}, {'gene': 'OR4F5'}, {'gene': 'WASH7P'}],
        )
        PhenotypePrioritization.objects.all().delete()

        suggestions, notes = self._get_suggestions()
        self.assertListEqual([s['value'] for s in suggestions if s['type'] == 'gene'], ['MTHFR', 'OR4F5'])
        self.assertListEqual(notes, [
            '3 candidate genes are recorded, only the first 2 are suggested.',
            'No phenotype prioritization results are loaded for this family.',
            HPO_NOTE,
        ])

    @mock.patch('seqr.views.apis.search_suggestions_api.MAX_GENE_WHYS', 2)
    @mock.patch('seqr.views.apis.search_suggestions_api.MAX_PRIORITIZED_GENES', 2)
    def test_prioritized_genes_bounded(self):
        self.login_collaborator()
        proband = Individual.objects.get(guid='I000001_na19675')
        PhenotypePrioritization.objects.bulk_create([
            PhenotypePrioritization(
                guid=f'PP_test_{i}', individual=proband, gene_id=gene_id, tool='lirical', rank=rank,
                disease_id=f'OMIM:{i}', disease_name=f'Disease {i}', scores={},
            ) for i, (gene_id, rank) in enumerate([
                ('ENSG00000177000', 3), ('ENSG00000186092', 4), ('ENSG00000097046', 10), ('ENSG00000227232', 11),
            ])
        ])

        suggestions, notes = self._get_suggestions()
        self.assertListEqual([s for s in suggestions if s['type'] == 'gene'], [
            {
                **PRIORITIZED_GENE_SUGGESTION,
                'why': 'Ranked 1 by exomiser for NA19675_1 (Khan-Khan-Katsanis syndrome). Ranked 1 by lirical for '
                       'NA19678 (Cystinosis, nephropathic).',
            },
            {
                'id': 'gene:MTHFR', 'type': 'gene', 'value': 'MTHFR', 'label': 'MTHFR', 'geneId': 'ENSG00000177000',
                'sources': ['phenotype_prioritization'], 'why': 'Ranked 3 by lirical for NA19675_1 (Disease 0).',
            },
        ])
        self.assertListEqual(notes, [UNMATCHED_CANDIDATES_NOTE, HPO_NOTE])

    def test_prioritized_gene_not_in_reference(self):
        self.login_collaborator()
        PhenotypePrioritization.objects.filter(gene_id='ENSG00000268903', tool='lirical').update(
            gene_id='ENSG00000000001',
        )
        suggestions, notes = self._get_suggestions()
        self.assertListEqual([s['geneId'] for s in suggestions if s['type'] == 'gene'], ['ENSG00000268903'])
        self.assertIn(
            'Prioritized genes not found in the current gene reference were skipped: ENSG00000000001.', notes,
        )

    @mock.patch('seqr.views.apis.search_suggestions_api.MAX_GENE_LISTS', 1)
    def test_gene_lists_bounded(self):
        self.login_collaborator()
        suggestions, notes = self._get_suggestions()
        self.assertListEqual(
            [s['label'] for s in suggestions if s['type'] == 'gene_list'], ['PID genes - Autosomal dominant'],
        )
        self.assertIn('Only the first 1 project gene lists are shown.', notes)

    def test_trio(self):
        self.login_collaborator()
        Individual.objects.filter(guid='I000004_hg00731').update(
            mother=Individual.objects.get(guid='I000006_hg00733'),
            father=Individual.objects.get(guid='I000005_hg00732'),
        )
        suggestions, _ = self._get_suggestions(TRIO_FAMILY_GUID)
        self.assertListEqual([s for s in suggestions if s['type'] == 'inheritance'], [
            {
                'id': 'inheritance:de_novo', 'type': 'inheritance', 'value': 'de_novo', 'label': 'de_novo',
                'sources': ['pedigree'],
                'why': 'HG00731_a is affected and both parents (HG00733, HG00732) are unaffected and have loaded '
                       'data, so de novo variants can be identified.',
            },
            {
                'id': 'inheritance:recessive', 'type': 'inheritance', 'value': 'recessive', 'label': 'recessive',
                'sources': ['pedigree'],
                'why': 'HG00731_a is affected and both parents (HG00733, HG00732) are unaffected and could each be '
                       'carriers.',
            },
        ])

    def test_family_without_data(self):
        self.login_collaborator()
        Family.objects.get(guid=NO_DATA_FAMILY_GUID).project.locuslist_set.clear()
        suggestions, notes = self._get_suggestions(NO_DATA_FAMILY_GUID)
        self.assertListEqual(suggestions, [])
        self.assertListEqual(notes, [
            'Only one individual with a known affected status has loaded data (NA20870), so no inheritance mode was '
            'inferred from the pedigree.',
            'No candidate genes are recorded for affected individuals.',
            'No phenotype prioritization results are loaded for this family.',
            'No gene lists are attached to this project.',
        ])
