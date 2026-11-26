import gzip
import json

from django.urls.base import reverse

from reference_data.models import DataVersions, HumanPhenotypeOntology
from seqr.views.apis.hpo_vocabulary_api import hpo_vocabulary
from seqr.views.utils.test_utils import AuthenticationTestCase

NAME_ONLY_TERMS = [
    ['HP:0001252', 'Muscular hypotonia', 'HP:0011458', []],
    ['HP:0001263', 'Global developmental delay', '', []],
    ['HP:0001508', 'Failure to thrive', 'HP:0008800', []],
    ['HP:0001631', 'Defect in the atrial septum', 'HP:0008800', []],
    ['HP:0001636', 'Tetralogy of Fallot', 'HP:0008800', []],
    ['HP:0001674', 'Complete atrioventricular canal defect', 'HP:0008800', []],
    ['HP:0002011', 'Morphological abnormality of the central nervous system', 'HP:0008800', []],
    ['HP:0002017', 'Nausea and vomiting', 'HP:0011458', []],
    ['HP:0003273', 'Hip contracture', 'HP:0008800', []],
    ['HP:0011675', 'Arrhythmia', 'HP:0008800', []],
    ['HP:0012469', 'Infantile spasms', '', []],
]


class HpoVocabularyAPITest(AuthenticationTestCase):
    fixtures = ['users', 'reference_data']

    def test_hpo_vocabulary(self):
        url = reverse(hpo_vocabulary)
        self.check_require_login(url)

        # Works on names alone before the reference data is reloaded with synonyms
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/json')
        response_json = response.json()
        self.assertDictEqual(response_json, {'version': '2025-03-03', 'terms': NAME_ONLY_TERMS})
        # Terms outside "Phenotypic abnormality" have no category and are not offered as features
        self.assertTrue(HumanPhenotypeOntology.objects.filter(hpo_id='HP:0000006', category_id='').exists())
        self.assertNotIn('HP:0000006', [term[0] for term in response_json['terms']])

        HumanPhenotypeOntology.objects.filter(hpo_id='HP:0001252').update(synonyms=['Hypotonia', 'Low muscle tone'])
        HumanPhenotypeOntology.objects.create(
            hpo_id='HP:0000057', name='obsolete Clitoromegaly', synonyms=['Large clitoris'])
        HumanPhenotypeOntology.objects.create(
            hpo_id='HP:0003674', name='Onset', parent_id='HP:0012823', synonyms=['Age of onset'])
        DataVersions.objects.filter(data_model_name='HumanPhenotypeOntology').delete()

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'version': None, 'terms': [
            ['HP:0001252', 'Muscular hypotonia', 'HP:0011458', ['Hypotonia', 'Low muscle tone']],
        ] + NAME_ONLY_TERMS[1:]})

    def test_hpo_vocabulary_caching(self):
        url = reverse(hpo_vocabulary)
        self.check_require_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, max-age=3600')
        self.assertFalse(response.has_header('Pragma'))
        self.assertFalse(response.has_header('Expires'))
        self.assertFalse(response.has_header('Content-Encoding'))
        etag = response['ETag']
        self.assertRegex(etag, r'^"[0-9a-f]{32}"$')

        response = self.client.get(url, HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(response.status_code, 304)
        self.assertEqual(response.content, b'')
        self.assertEqual(response['ETag'], etag)
        self.assertEqual(response['Cache-Control'], 'private, max-age=3600')
        self.assertFalse(response.has_header('Pragma'))

        response = self.client.get(url, HTTP_ACCEPT_ENCODING='gzip, deflate')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Encoding'], 'gzip')
        self.assertIn('Accept-Encoding', response['Vary'])
        self.assertEqual(response['ETag'], f'W/{etag}')
        self.assertEqual(response['Cache-Control'], 'private, max-age=3600')
        self.assertDictEqual(
            json.loads(gzip.decompress(response.content)), {'version': '2025-03-03', 'terms': NAME_ONLY_TERMS})

        response = self.client.get(url, HTTP_IF_NONE_MATCH=f'W/{etag}', HTTP_ACCEPT_ENCODING='gzip')
        self.assertEqual(response.status_code, 304)

        # The cached copy is invalidated when the vocabulary changes
        HumanPhenotypeOntology.objects.filter(hpo_id='HP:0001252').update(synonyms=['Hypotonia'])
        response = self.client.get(url, HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response['ETag'], etag)
        self.assertIn(['HP:0001252', 'Muscular hypotonia', 'HP:0011458', ['Hypotonia']], response.json()['terms'])

        # Other responses are still never cached
        self.client.logout()
        response = self.client.get(url)
        self.assertEqual(response.status_code, 302)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(response['Pragma'], 'no-cache')
