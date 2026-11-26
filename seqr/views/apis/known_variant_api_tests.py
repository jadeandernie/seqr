import json
import mock
from datetime import date

from django.urls.base import reverse

from seqr.models import Family, KnownVariantCheck, KnownVariantMatch, SavedVariant
from seqr.utils.known_variant_utils_tests import KnownVariantTestMixin, GRCH37_VARIANT_ID, GRCH37_VARIANT_ID_2, \
    GRCH38_VARIANT_ID, MITO_VARIANT_ID, PROJECT_GUID, OTHER_PROJECT_GUID, NON_ANALYST_PROJECT_GUID
from seqr.views.apis.known_variant_api import known_variant_checks, create_known_variant_check, \
    update_known_variant_check, delete_known_variant_check, project_known_variant_matches, \
    family_known_variant_matches, update_known_variant_match
from seqr.views.utils.test_utils import AuthenticationTestCase

SAVED_VARIANT_GUID = 'SV0000001_2103343353_r0390_100'
SV_SAVED_VARIANT_GUID = 'SV0000007_prefix_19107_DEL_r00'

CHECK_FIELDS = {
    'checkGuid', 'genomeVersion', 'datasetType', 'variantId', 'geneIds', 'geneNames', 'verdict', 'pubmedId',
    'clinvarAccession', 'isGlobal', 'isActive', 'createdDate', 'createdBy', 'sourceProjectGuid', 'sourceProjectName',
    'canEdit', 'numMatches', 'numNewMatches',
}
MATCH_FIELDS = {
    'matchGuid', 'familyGuid', 'projectGuid', 'status', 'firstSeen', 'reviewedBy', 'savedVariantGuid',
    'genomeVersion', 'datasetType', 'variantId', 'geneIds', 'geneNames', 'verdict', 'pubmedId', 'clinvarAccession',
    'createdBy', 'sourceProjectName',
}


class KnownVariantAPITest(KnownVariantTestMixin, AuthenticationTestCase):
    fixtures = ['users', '1kg_project', 'reference_data']

    def setUp(self):
        super().setUp()
        self.set_up_clickhouse_mocks()

    def _post(self, url, body):
        return self.client.post(url, content_type='application/json', data=json.dumps(body))

    def _get_checks(self):
        response = self.client.get(reverse(known_variant_checks))
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(set(response.json().keys()), {'knownVariantChecksByGuid'})
        return response.json()['knownVariantChecksByGuid']

    def _create_non_analyst_saved_variant(self):
        return SavedVariant.objects.create(
            family=Family.objects.get(guid='F000014_14'), xpos=1009310123, ref='T', alt='C',
            variant_id=GRCH38_VARIANT_ID, dataset_type='SNV_INDEL', gene_ids=['ENSG00000135953'],
        )

    def test_create_known_variant_check(self):
        url = reverse(create_known_variant_check)
        body = {
            'savedVariantGuid': SAVED_VARIANT_GUID, 'verdict': 'S', 'pubmedId': ' 12345678 ',
            'clinvarAccession': 'VCV000012345.2',
        }
        self.check_collaborator_login(url, request_data=body)

        response = self._post(url, body)
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(set(response.json().keys()), {'knownVariantChecksByGuid', 'matchingDeferred'})
        self.assertFalse(response.json()['matchingDeferred'])
        checks = response.json()['knownVariantChecksByGuid']
        self.assertEqual(len(checks), 1)
        check_guid = next(iter(checks))
        self.assertDictEqual(checks[check_guid], {
            'checkGuid': check_guid,
            'genomeVersion': '37',
            'datasetType': 'SNV_INDEL',
            'variantId': GRCH37_VARIANT_ID,
            'geneIds': ['ENSG00000135953'],
            'geneNames': ['RP11'],
            'verdict': 'S',
            'pubmedId': '12345678',
            'clinvarAccession': 'VCV000012345.2',
            'isGlobal': False,
            'isActive': True,
            'createdDate': mock.ANY,
            'createdBy': 'Test Collaborator User',
            'sourceProjectGuid': PROJECT_GUID,
            'sourceProjectName': '1kg project nåme with uniçøde',
            'canEdit': True,
            'numMatches': 2,
            'numNewMatches': 2,
        })
        check = KnownVariantCheck.objects.get(guid=check_guid)
        self.assertEqual(check.created_by, self.collaborator_user)
        self.assertEqual(check.source_saved_variant.guid, SAVED_VARIANT_GUID)
        self.assertEqual(check.source_project.guid, PROJECT_GUID)

        # The new check is matched against the families the creator can view
        self.assertSetEqual(self.match_families(), {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
        })
        self.mock_family_keys.assert_called_once_with(
            '37', 'SNV_INDEL', [PROJECT_GUID, OTHER_PROJECT_GUID],
            sorted(Family.objects.filter(project__genome_version='37').values_list('guid', flat=True)), [10],
        )

        response = self._post(url, body)
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], ['You have already recorded this variant as a known variant'])

        # Validation
        response = self._post(url, {'savedVariantGuid': 'SV0000002_1248367227_r0390_100'})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], ['Verdict is required'])

        response = self._post(url, {
            'savedVariantGuid': 'SV0000002_1248367227_r0390_100', 'verdict': 'Pathogenic', 'pubmedId': 'PMID:123',
            'clinvarAccession': 'https://evil.example.com',
        })
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'Invalid verdict', 'PubMed ID must be a number, for example 12345678',
            'ClinVar accession must be a VCV, RCV or SCV accession, for example VCV000012345',
        ])

        response = self._post(url, {'savedVariantGuid': SV_SAVED_VARIANT_GUID, 'verdict': 'C'})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants',
        ])

        response = self._post(url, {'savedVariantGuid': 'SV_invalid', 'verdict': 'C'})
        self.assertEqual(response.status_code, 404)

        # Only analysts can share checks with all projects, or record a variant which is not saved
        response = self._post(url, {
            'savedVariantGuid': 'SV0000002_1248367227_r0390_100', 'verdict': 'C', 'isGlobal': True,
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'Permission Denied')
        new_variant_body = {
            'genomeVersion': '38', 'datasetType': 'MITO', 'variantId': MITO_VARIANT_ID, 'verdict': 'B',
            'geneIds': ['ENSG00000223972', 'ENSG00000000001'], 'isGlobal': True,
        }
        response = self._post(url, new_variant_body)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'Permission Denied')
        self.assertEqual(KnownVariantCheck.objects.count(), 1)

        # Users can not record variants from projects they can not view
        non_analyst_saved_variant = self._create_non_analyst_saved_variant()
        response = self._post(url, {'savedVariantGuid': non_analyst_saved_variant.guid, 'verdict': 'C'})
        self.assertEqual(response.status_code, 403)
        self.login_analyst_user()
        response = self._post(url, {'savedVariantGuid': non_analyst_saved_variant.guid, 'verdict': 'C'})
        self.assertEqual(response.status_code, 403)

        response = self._post(url, new_variant_body)
        self.assertEqual(response.status_code, 200)
        checks = response.json()['knownVariantChecksByGuid']
        self.assertEqual(len(checks), 1)
        self.assertDictEqual(next(iter(checks.values())), {
            'checkGuid': mock.ANY,
            'genomeVersion': '38',
            'datasetType': 'MITO',
            'variantId': MITO_VARIANT_ID,
            'geneIds': ['ENSG00000223972', 'ENSG00000000001'],
            'geneNames': ['DDX11L1', 'ENSG00000000001'],
            'verdict': 'B',
            'pubmedId': None,
            'clinvarAccession': None,
            'isGlobal': True,
            'isActive': True,
            'createdDate': mock.ANY,
            'createdBy': 'Test User',
            'sourceProjectGuid': None,
            'sourceProjectName': None,
            'canEdit': True,
            'numMatches': 0,
            'numNewMatches': 0,
        })
        # Global checks are matched in projects the creator can not view by the load hook, not on creation
        self.assertEqual(KnownVariantMatch.objects.count(), 2)

        for invalid_body, error in [
            ({'variantId': 'chrM-4429-G-A'}, 'Invalid variant ID, expected the format chrom-pos-ref-alt, for example 1-248367227-TC-T'),
            ({'variantId': None}, 'Invalid variant ID, expected the format chrom-pos-ref-alt, for example 1-248367227-TC-T'),
            ({'variantId': '1-248367227-TC-T'}, 'Invalid variant ID, expected the format chrom-pos-ref-alt, for example 1-248367227-TC-T'),
            ({'datasetType': 'SV_WGS', 'variantId': 'phase2_DEL_chr14_4640'}, 'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants'),
            ({'genomeVersion': '37'}, 'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants'),
            ({'genomeVersion': '39'}, 'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants'),
            ({'genomeVersion': None, 'datasetType': ['SNV_INDEL']}, 'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants'),
            ({'variantId': 'M-11597-A-G', 'geneIds': ['MFSD9']}, 'Genes must be a list of up to 20 Ensembl gene IDs'),
            ({'variantId': 'M-11597-A-G', 'geneIds': 'ENSG00000223972'}, 'Genes must be a list of up to 20 Ensembl gene IDs'),
            ({'variantId': 'M-11597-A-G', 'geneIds': [f'ENSG{i:011d}' for i in range(21)]}, 'Genes must be a list of up to 20 Ensembl gene IDs'),
            ({'variantId': 'M-11597-A-G', 'isGlobal': 'yes'}, 'Invalid value for isGlobal'),
        ]:
            response = self._post(url, {**new_variant_body, **invalid_body})
            self.assertEqual(response.status_code, 400)
            self.assertListEqual(response.json()['errors'], [error])
        self.assertEqual(KnownVariantCheck.objects.count(), 2)

        # Fields which are not explicitly allowed are ignored
        response = self._post(url, {
            'genomeVersion': '38', 'datasetType': 'SNV_INDEL', 'variantId': GRCH38_VARIANT_ID, 'verdict': 'C',
            'isActive': False, 'guid': 'KVC_custom', 'createdBy': self.collaborator_user.id, 'note': 'free text',
            'sourceProjectGuid': NON_ANALYST_PROJECT_GUID,
        })
        self.assertEqual(response.status_code, 200)
        check_json = next(iter(response.json()['knownVariantChecksByGuid'].values()))
        self.assertTrue(check_json['isActive'])
        self.assertFalse(check_json['isGlobal'])
        self.assertIsNone(check_json['sourceProjectGuid'])
        self.assertEqual(check_json['createdBy'], 'Test User')
        self.assertRegex(check_json['checkGuid'], r'^KVC\d{7}_1_9310123_t_c$')
        # The analyst can not view the project with the only family carrying the variant
        self.assertEqual(check_json['numMatches'], 0)
        self.assertEqual(KnownVariantMatch.objects.count(), 2)

    @mock.patch('seqr.views.apis.known_variant_api.MAX_CREATE_MATCH_FAMILIES', 12)
    def test_create_known_variant_check_deferred_matching(self):
        url = reverse(create_known_variant_check)
        self.login_collaborator()

        # Matching is left to the load hook and backfill command if the creator can view too many families
        response = self._post(url, {'savedVariantGuid': SAVED_VARIANT_GUID, 'verdict': 'C'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['matchingDeferred'])
        self.mock_key_lookup.assert_not_called()
        self.assertEqual(KnownVariantCheck.objects.count(), 1)
        self.assertEqual(KnownVariantMatch.objects.count(), 0)

        # The check is still created if matching fails
        self.mock_key_lookup.side_effect = Exception('ClickHouse is unavailable')
        self.login_manager()
        with mock.patch('seqr.views.apis.known_variant_api.MAX_CREATE_MATCH_FAMILIES', 13), \
                mock.patch('seqr.views.apis.known_variant_api.logger') as mock_logger:
            response = self._post(url, {'savedVariantGuid': SAVED_VARIANT_GUID, 'verdict': 'C'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['matchingDeferred'])
        check_guid = next(iter(response.json()['knownVariantChecksByGuid']))
        self.assertEqual(KnownVariantCheck.objects.count(), 2)
        self.assertEqual(KnownVariantMatch.objects.count(), 0)
        mock_logger.error.assert_called_once_with(
            f'Error matching new known variant check {check_guid}: ClickHouse is unavailable', self.manager_user,
        )

    def _create_visibility_checks(self):
        collaborator_check = self.create_check(
            self.collaborator_user, source_saved_variant=SavedVariant.objects.get(guid=SAVED_VARIANT_GUID),
            gene_ids=['ENSG00000135953'],
        )
        manager_check = self.create_check(
            self.manager_user, variant_id=GRCH38_VARIANT_ID, genome_version='38',
            source_project_guid=NON_ANALYST_PROJECT_GUID, pubmed_id='234', verdict='R',
        )
        analyst_check = self.create_check(
            self.analyst_user, variant_id=GRCH37_VARIANT_ID_2, source_project_guid=None, verdict='B',
        )
        return collaborator_check, manager_check, analyst_check

    def test_known_variant_checks(self):
        url = reverse(known_variant_checks)
        self.check_require_login(url)
        self.assertDictEqual(self._get_checks(), {})

        collaborator_check, manager_check, analyst_check = self._create_visibility_checks()
        KnownVariantMatch.objects.create(known_variant_check=collaborator_check, family_id=1, status='D')
        KnownVariantMatch.objects.create(known_variant_check=collaborator_check, family_id=11)
        KnownVariantMatch.objects.create(known_variant_check=manager_check, family_id=14)
        KnownVariantMatch.objects.create(known_variant_check=analyst_check, family_id=2)

        # A user without access to any project sees no checks
        self.assertDictEqual(self._get_checks(), {})

        # The creator sees their own check
        self.login_collaborator()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid})
        self.assertSetEqual(set(checks[collaborator_check.guid].keys()), CHECK_FIELDS)
        self.assertDictEqual(checks[collaborator_check.guid], {
            'checkGuid': collaborator_check.guid,
            'genomeVersion': '37',
            'datasetType': 'SNV_INDEL',
            'variantId': GRCH37_VARIANT_ID,
            'geneIds': ['ENSG00000135953'],
            'geneNames': ['RP11'],
            'verdict': 'C',
            'pubmedId': None,
            'clinvarAccession': None,
            'isGlobal': False,
            'isActive': True,
            'createdDate': mock.ANY,
            'createdBy': 'Test Collaborator User',
            'sourceProjectGuid': PROJECT_GUID,
            'sourceProjectName': '1kg project nåme with uniçøde',
            'canEdit': True,
            'numMatches': 2,
            'numNewMatches': 1,
        })

        # Other members of the source project see the check, but can not edit it
        self.login_manager()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid, manager_check.guid})
        self.assertFalse(checks[collaborator_check.guid]['canEdit'])
        self.assertEqual(checks[collaborator_check.guid]['createdBy'], 'Test Collaborator User')
        self.assertTrue(checks[manager_check.guid]['canEdit'])
        self.assertEqual(checks[manager_check.guid]['numMatches'], 1)

        # Analysts can edit the checks they can see, which excludes checks from projects they can not view
        self.login_analyst_user()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid, analyst_check.guid})
        self.assertTrue(checks[collaborator_check.guid]['canEdit'])
        self.assertIsNone(checks[analyst_check.guid]['sourceProjectGuid'])

        self.login_data_manager_user()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid, manager_check.guid})
        self.assertFalse(checks[manager_check.guid]['canEdit'])

        # Global checks are visible to everyone, without the creator, source project or matches in other projects
        KnownVariantCheck.objects.update(is_global=True)
        self.login_base_user()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid, manager_check.guid, analyst_check.guid})
        for check in checks.values():
            self.assertDictEqual(
                {field: check[field] for field in [
                    'createdBy', 'sourceProjectGuid', 'sourceProjectName', 'canEdit', 'numMatches', 'numNewMatches',
                    'isGlobal',
                ]},
                {'createdBy': None, 'sourceProjectGuid': None, 'sourceProjectName': None, 'canEdit': False,
                 'numMatches': 0, 'numNewMatches': 0, 'isGlobal': True},
            )
        self.assertEqual(checks[manager_check.guid]['pubmedId'], '234')

        self.login_collaborator()
        checks = self._get_checks()
        self.assertEqual(len(checks), 3)
        self.assertIsNone(checks[manager_check.guid]['createdBy'])
        self.assertIsNone(checks[manager_check.guid]['sourceProjectName'])
        self.assertEqual(checks[manager_check.guid]['numMatches'], 0)
        self.assertIsNone(checks[analyst_check.guid]['createdBy'])
        self.assertEqual(checks[analyst_check.guid]['numMatches'], 1)
        KnownVariantCheck.objects.update(is_global=False)

        # When access to the source project is revoked, other members no longer see the check
        self.login_manager()
        self.manager_user.groups.clear()
        self.assertSetEqual(set(self._get_checks().keys()), {manager_check.guid})
        # The creator still sees their own check, but not its matches
        self.collaborator_user.groups.clear()
        self.login_collaborator()
        checks = self._get_checks()
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid})
        self.assertEqual(checks[collaborator_check.guid]['numMatches'], 0)
        self.assertEqual(checks[collaborator_check.guid]['sourceProjectGuid'], PROJECT_GUID)

    def test_update_known_variant_check(self):
        collaborator_check, manager_check, analyst_check = self._create_visibility_checks()
        url = reverse(update_known_variant_check, args=[collaborator_check.guid])
        body = {'verdict': 'R', 'pubmedId': '987', 'clinvarAccession': 'RCV000012345', 'isActive': False}
        self.check_require_login(url)

        # Users who can not see the check can not tell that it exists
        response = self._post(url, body)
        self.assertEqual(response.status_code, 404)

        # Other members of the source project can not edit the check
        self.login_manager()
        response = self._post(url, body)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'Permission Denied')
        self.login_data_manager_user()
        self.assertEqual(self._post(url, body).status_code, 403)
        collaborator_check.refresh_from_db()
        self.assertEqual(collaborator_check.verdict, 'C')

        self.login_collaborator()
        response = self._post(url, body)
        self.assertEqual(response.status_code, 200)
        checks = response.json()['knownVariantChecksByGuid']
        self.assertSetEqual(set(checks.keys()), {collaborator_check.guid})
        self.assertSetEqual(set(checks[collaborator_check.guid].keys()), CHECK_FIELDS)
        self.assertDictEqual(
            {field: checks[collaborator_check.guid][field] for field in ['verdict', 'pubmedId', 'clinvarAccession', 'isActive', 'isGlobal']},
            {'verdict': 'R', 'pubmedId': '987', 'clinvarAccession': 'RCV000012345', 'isActive': False, 'isGlobal': False},
        )
        collaborator_check.refresh_from_db()
        self.assertEqual(collaborator_check.verdict, 'R')
        self.assertFalse(collaborator_check.is_active)

        # References can be cleared, and the variant and creator can not be changed
        response = self._post(url, {
            'pubmedId': '', 'clinvarAccession': None, 'isActive': True, 'variantId': GRCH37_VARIANT_ID_2,
            'genomeVersion': '38', 'geneIds': ['ENSG00000223972'], 'createdBy': self.manager_user.id,
            'sourceProjectGuid': NON_ANALYST_PROJECT_GUID, 'guid': 'KVC_custom',
        })
        self.assertEqual(response.status_code, 200)
        collaborator_check.refresh_from_db()
        self.assertIsNone(collaborator_check.pubmed_id)
        self.assertIsNone(collaborator_check.clinvar_accession)
        self.assertTrue(collaborator_check.is_active)
        self.assertEqual(collaborator_check.variant_id, GRCH37_VARIANT_ID)
        self.assertEqual(collaborator_check.genome_version, '37')
        self.assertListEqual(collaborator_check.gene_ids, ['ENSG00000135953'])
        self.assertEqual(collaborator_check.created_by, self.collaborator_user)
        self.assertEqual(collaborator_check.source_project.guid, PROJECT_GUID)
        self.assertEqual(response.json()['knownVariantChecksByGuid'][collaborator_check.guid]['checkGuid'], collaborator_check.guid)

        response = self._post(url, {'verdict': 'X', 'pubmedId': '12a', 'clinvarAccession': 'VCV1', 'isActive': 'no'})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'Invalid verdict', 'PubMed ID must be a number, for example 12345678',
            'ClinVar accession must be a VCV, RCV or SCV accession, for example VCV000012345',
            'Invalid value for isActive',
        ])

        # Only analysts can share a check with all projects
        response = self._post(url, {'isGlobal': True})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'Permission Denied')
        collaborator_check.refresh_from_db()
        self.assertFalse(collaborator_check.is_global)

        self.login_analyst_user()
        response = self._post(url, {'isGlobal': True, 'verdict': 'S'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['knownVariantChecksByGuid'][collaborator_check.guid]['isGlobal'])
        collaborator_check.refresh_from_db()
        self.assertTrue(collaborator_check.is_global)
        self.assertEqual(collaborator_check.verdict, 'S')
        self.assertEqual(collaborator_check.created_by, self.collaborator_user)

        # Analysts can not edit checks from projects they can not view
        manager_url = reverse(update_known_variant_check, args=[manager_check.guid])
        self.assertEqual(self._post(manager_url, {'isGlobal': True}).status_code, 404)
        manager_check.refresh_from_db()
        self.assertFalse(manager_check.is_global)

        # A creator who loses access to the source project can still edit their own check
        self.collaborator_user.groups.clear()
        self.login_collaborator()
        self.assertEqual(self._post(url, {'verdict': 'B'}).status_code, 200)
        self.assertEqual(self._post(manager_url, {'verdict': 'B'}).status_code, 404)
        self.assertEqual(
            self._post(reverse(update_known_variant_check, args=[analyst_check.guid]), {'verdict': 'C'}).status_code, 404,
        )

    def test_delete_known_variant_check(self):
        collaborator_check, manager_check, analyst_check = self._create_visibility_checks()
        KnownVariantMatch.objects.create(known_variant_check=collaborator_check, family_id=1)
        KnownVariantMatch.objects.create(known_variant_check=manager_check, family_id=14)
        url = reverse(delete_known_variant_check, args=[collaborator_check.guid])
        self.check_require_login(url)

        self.assertEqual(self._post(url, {}).status_code, 404)
        self.login_manager()
        self.assertEqual(self._post(url, {}).status_code, 403)
        self.login_analyst_user()
        self.assertEqual(self._post(reverse(delete_known_variant_check, args=[manager_check.guid]), {}).status_code, 404)
        self.assertEqual(KnownVariantCheck.objects.count(), 3)
        self.assertEqual(KnownVariantMatch.objects.count(), 2)

        self.login_collaborator()
        response = self._post(url, {})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'knownVariantChecksByGuid': {collaborator_check.guid: None}})
        self.assertFalse(KnownVariantCheck.objects.filter(guid=collaborator_check.guid).exists())
        self.assertSetEqual(self.match_families(), {(GRCH38_VARIANT_ID, 'F000014_14')})
        self.assertEqual(self._post(url, {}).status_code, 404)

        # Analysts can delete checks they can see
        KnownVariantCheck.objects.filter(id=manager_check.id).update(is_global=True)
        self.login_analyst_user()
        response = self._post(reverse(delete_known_variant_check, args=[manager_check.guid]), {})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(KnownVariantCheck.objects.values_list('guid', flat=True)), [analyst_check.guid])
        self.assertEqual(KnownVariantMatch.objects.count(), 0)

    def _create_matches(self):
        collaborator_check, manager_check, analyst_check = self._create_visibility_checks()
        non_analyst_check = self.create_check(
            self.manager_user, source_project_guid=NON_ANALYST_PROJECT_GUID, clinvar_accession='SCV000012345',
            verdict='S', is_global=True,
        )
        return {
            'collaborator': KnownVariantMatch.objects.create(known_variant_check=collaborator_check, family_id=1),
            'analyst': KnownVariantMatch.objects.create(known_variant_check=analyst_check, family_id=2),
            'global': KnownVariantMatch.objects.create(known_variant_check=non_analyst_check, family_id=1),
            'other_project': KnownVariantMatch.objects.create(known_variant_check=collaborator_check, family_id=11),
            'non_analyst_project': KnownVariantMatch.objects.create(known_variant_check=manager_check, family_id=14),
        }

    def test_project_known_variant_matches(self):
        matches = self._create_matches()
        url = reverse(project_known_variant_matches, args=[PROJECT_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(set(response.json().keys()), {'knownVariantMatchesByGuid'})
        response_matches = response.json()['knownVariantMatchesByGuid']
        self.assertSetEqual(
            set(response_matches.keys()), {matches[key].guid for key in ['collaborator', 'analyst', 'global']},
        )
        self.assertDictEqual(response_matches[matches['collaborator'].guid], {
            'matchGuid': matches['collaborator'].guid,
            'familyGuid': 'F000001_1',
            'projectGuid': PROJECT_GUID,
            'status': 'N',
            'firstSeen': date.today().isoformat(),
            'reviewedBy': None,
            'savedVariantGuid': SAVED_VARIANT_GUID,
            'genomeVersion': '37',
            'datasetType': 'SNV_INDEL',
            'variantId': GRCH37_VARIANT_ID,
            'geneIds': ['ENSG00000135953'],
            'geneNames': ['RP11'],
            'verdict': 'C',
            'pubmedId': None,
            'clinvarAccession': None,
            'createdBy': 'Test Collaborator User',
            'sourceProjectName': '1kg project nåme with uniçøde',
        })
        # Who recorded a check is only shown to users who can view its source project
        self.assertSetEqual(set(response_matches[matches['global'].guid].keys()), MATCH_FIELDS)
        self.assertDictEqual(
            {field: response_matches[matches['global'].guid][field] for field in [
                'createdBy', 'sourceProjectName', 'verdict', 'clinvarAccession', 'savedVariantGuid', 'familyGuid',
            ]},
            {'createdBy': None, 'sourceProjectName': None, 'verdict': 'S', 'clinvarAccession': 'SCV000012345',
             'savedVariantGuid': SAVED_VARIANT_GUID, 'familyGuid': 'F000001_1'},
        )
        self.assertDictEqual(
            {field: response_matches[matches['analyst'].guid][field] for field in [
                'createdBy', 'sourceProjectName', 'verdict', 'savedVariantGuid', 'familyGuid',
            ]},
            {'createdBy': None, 'sourceProjectName': None, 'verdict': 'B',
             'savedVariantGuid': 'SV0000002_1248367227_r0390_100', 'familyGuid': 'F000002_2'},
        )

        self.login_manager()
        response_matches = self.client.get(url).json()['knownVariantMatchesByGuid']
        self.assertEqual(response_matches[matches['global'].guid]['createdBy'], 'Test Manager User')
        self.assertEqual(response_matches[matches['global'].guid]['sourceProjectName'], 'Non-Analyst Project')

        # Matches for inactive checks are hidden
        KnownVariantCheck.objects.filter(created_by=self.collaborator_user).update(is_active=False)
        response = self.client.get(url)
        self.assertSetEqual(
            set(response.json()['knownVariantMatchesByGuid'].keys()),
            {matches[key].guid for key in ['analyst', 'global']},
        )

        response = self.client.get(reverse(project_known_variant_matches, args=[NON_ANALYST_PROJECT_GUID]))
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(
            set(response.json()['knownVariantMatchesByGuid'].keys()), {matches['non_analyst_project'].guid},
        )
        self.login_analyst_user()
        response = self.client.get(reverse(project_known_variant_matches, args=[NON_ANALYST_PROJECT_GUID]))
        self.assertEqual(response.status_code, 403)
        response = self.client.get(reverse(project_known_variant_matches, args=['R0002_empty']))
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'knownVariantMatchesByGuid': {}})

    def test_family_known_variant_matches(self):
        matches = self._create_matches()
        url = reverse(family_known_variant_matches, args=['F000001_1'])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        response_matches = response.json()['knownVariantMatchesByGuid']
        self.assertSetEqual(
            set(response_matches.keys()), {matches[key].guid for key in ['collaborator', 'global']},
        )
        for match in response_matches.values():
            self.assertSetEqual(set(match.keys()), MATCH_FIELDS)
            self.assertEqual(match['familyGuid'], 'F000001_1')

        response = self.client.get(reverse(family_known_variant_matches, args=['F000014_14']))
        self.assertEqual(response.status_code, 403)
        response = self.client.get(reverse(family_known_variant_matches, args=['F000099_99']))
        self.assertEqual(response.status_code, 404)

        self.login_manager()
        response = self.client.get(reverse(family_known_variant_matches, args=['F000014_14']))
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json()['knownVariantMatchesByGuid'][matches['non_analyst_project'].guid], {
            'matchGuid': matches['non_analyst_project'].guid,
            'familyGuid': 'F000014_14',
            'projectGuid': NON_ANALYST_PROJECT_GUID,
            'status': 'N',
            'firstSeen': date.today().isoformat(),
            'reviewedBy': None,
            'savedVariantGuid': None,
            'genomeVersion': '38',
            'datasetType': 'SNV_INDEL',
            'variantId': GRCH38_VARIANT_ID,
            'geneIds': [],
            'geneNames': [],
            'verdict': 'R',
            'pubmedId': '234',
            'clinvarAccession': None,
            'createdBy': 'Test Manager User',
            'sourceProjectName': 'Non-Analyst Project',
        })

    def test_update_known_variant_match(self):
        matches = self._create_matches()
        match = matches['collaborator']
        url = reverse(update_known_variant_match, args=[match.guid])
        self.check_collaborator_login(url, request_data={'status': 'R'})

        response = self._post(url, {'status': 'R'})
        self.assertEqual(response.status_code, 200)
        response_matches = response.json()['knownVariantMatchesByGuid']
        self.assertSetEqual(set(response_matches.keys()), {match.guid})
        self.assertSetEqual(set(response_matches[match.guid].keys()), MATCH_FIELDS)
        self.assertEqual(response_matches[match.guid]['status'], 'R')
        self.assertEqual(response_matches[match.guid]['reviewedBy'], 'Test Collaborator User')
        match.refresh_from_db()
        self.assertEqual(match.status, 'R')
        self.assertEqual(match.reviewed_by, self.collaborator_user)

        self.login_manager()
        response = self._post(url, {'status': 'D', 'familyGuid': 'F000002_2', 'firstSeen': '2020-01-01'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['knownVariantMatchesByGuid'][match.guid]['reviewedBy'], 'Test Manager User')
        match.refresh_from_db()
        self.assertEqual(match.status, 'D')
        self.assertEqual(match.family.guid, 'F000001_1')
        self.assertEqual(match.first_seen, date.today())

        response = self._post(url, {'status': 'N'})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['knownVariantMatchesByGuid'][match.guid]['reviewedBy'])
        match.refresh_from_db()
        self.assertEqual(match.status, 'N')
        self.assertIsNone(match.reviewed_by)

        for invalid_body in [{'status': 'X'}, {}]:
            response = self._post(url, invalid_body)
            self.assertEqual(response.status_code, 400)
            self.assertListEqual(response.json()['errors'], ['Invalid status'])

        self.assertEqual(self._post(reverse(update_known_variant_match, args=['KVM_invalid']), {'status': 'R'}).status_code, 404)

        # Matches can only be reviewed by users who can view the family
        self.login_analyst_user()
        non_analyst_url = reverse(update_known_variant_match, args=[matches['non_analyst_project'].guid])
        self.assertEqual(self._post(non_analyst_url, {'status': 'D'}).status_code, 403)
        matches['non_analyst_project'].refresh_from_db()
        self.assertEqual(matches['non_analyst_project'].status, 'N')
