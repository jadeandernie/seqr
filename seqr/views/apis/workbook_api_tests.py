from copy import deepcopy
import json
import mock

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.utils import IntegrityError
from django.test import TestCase
from django.urls.base import reverse

from seqr.models import AnalysisGroup, Family, Project, VariantSearch, VariantSearchResults, Workbook, WorkbookTarget, \
    Worksheet, WorksheetQuery, WorksheetQueryResult
from seqr.views.apis.analysis_group_api import delete_analysis_group_handler
from seqr.views.apis.variant_search_api import delete_saved_search_handler, query_variants_handler
from seqr.views.apis.workbook_api import project_workbooks_handler, create_workbook_handler, workbook_detail_handler, \
    update_workbook_handler, delete_workbook_handler, duplicate_workbook_handler, add_workbook_targets_handler, \
    reorder_workbook_targets_handler, delete_workbook_target_handler, create_worksheet_handler, \
    reorder_worksheets_handler, update_worksheet_handler, delete_worksheet_handler, create_worksheet_query_handler, \
    reorder_worksheet_queries_handler, update_worksheet_query_handler, delete_worksheet_query_handler, \
    update_worksheet_query_result_handler, run_worksheet_query_handler, _get_search_hash
from seqr.views.utils.test_utils import AuthenticationTestCase, AnvilAuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
NO_ACCESS_PROJECT_GUID = 'R0004_non_analyst_project'
WORKBOOK_GUID = 'WB0000001_trio_analysis'
NO_ACCESS_WORKBOOK_GUID = 'WB0000002_non_analyst_workbook'
FAMILY_TARGET_GUID = 'WBT0000001_1'
GROUP_TARGET_GUID = 'WBT0000002_test_group_1'
NO_ACCESS_TARGET_GUID = 'WBT0000003_fam14'
DE_NOVO_WORKSHEET_GUID = 'WS0000001_de_novo'
RECESSIVE_WORKSHEET_GUID = 'WS0000002_recessive'
NO_ACCESS_WORKSHEET_GUID = 'WS0000003_other'
RESTRICTIVE_QUERY_GUID = 'WSQ0000001_de_novo_restrictive'
PERMISSIVE_QUERY_GUID = 'WSQ0000002_de_novo_permissive'
RECESSIVE_QUERY_GUID = 'WSQ0000003_recessive'
NO_ACCESS_QUERY_GUID = 'WSQ0000004_other'
QUERY_RESULT_GUID = 'WQR0000001_1_1'
ANALYSIS_GROUP_GUID = 'AG0000183_test_group'
SAVED_SEARCH_GUID = 'VS0079516_'

MANAGER_NAME = 'Test Manager User'
COLLABORATOR_NAME = 'Test Collaborator User'

RESTRICTIVE_SEARCH = {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.001}}}
PERMISSIVE_SEARCH = {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.01}}}
RECESSIVE_SEARCH = {'inheritance': {'mode': 'recessive'}}

WORKBOOK_JSON = {
    'workbookGuid': WORKBOOK_GUID, 'projectGuid': PROJECT_GUID, 'name': 'Trio analysis',
    'description': 'De novo and recessive review', 'createdDate': '2026-11-20T10:00:00Z', 'createdBy': MANAGER_NAME,
    'lastModifiedDate': '2026-11-20T10:00:00Z', 'canEdit': False,
}
FAMILY_TARGET_JSON = {
    'workbookTargetGuid': FAMILY_TARGET_GUID, 'workbookGuid': WORKBOOK_GUID, 'order': 0, 'familyGuid': 'F000001_1',
    'analysisGroupGuid': None, 'familyGuids': ['F000001_1'],
}
GROUP_TARGET_JSON = {
    'workbookTargetGuid': GROUP_TARGET_GUID, 'workbookGuid': WORKBOOK_GUID, 'order': 1, 'familyGuid': None,
    'analysisGroupGuid': ANALYSIS_GROUP_GUID, 'familyGuids': ['F000001_1', 'F000003_3', 'F000005_5'],
}
DE_NOVO_WORKSHEET_JSON = {
    'worksheetGuid': DE_NOVO_WORKSHEET_GUID, 'workbookGuid': WORKBOOK_GUID, 'name': 'De Novo', 'order': 0,
}
RECESSIVE_WORKSHEET_JSON = {
    'worksheetGuid': RECESSIVE_WORKSHEET_GUID, 'workbookGuid': WORKBOOK_GUID, 'name': 'Recessive', 'order': 1,
}
RESTRICTIVE_QUERY_JSON = {
    'worksheetQueryGuid': RESTRICTIVE_QUERY_GUID, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID, 'name': 'De novo restrictive',
    'order': 0, 'search': RESTRICTIVE_SEARCH, 'createdDate': '2026-11-20T10:03:00Z', 'createdBy': MANAGER_NAME,
}
PERMISSIVE_QUERY_JSON = {
    'worksheetQueryGuid': PERMISSIVE_QUERY_GUID, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID, 'name': 'De novo permissive',
    'order': 1, 'search': PERMISSIVE_SEARCH, 'createdDate': '2026-11-20T10:03:00Z', 'createdBy': MANAGER_NAME,
}
RECESSIVE_QUERY_JSON = {
    'worksheetQueryGuid': RECESSIVE_QUERY_GUID, 'worksheetGuid': RECESSIVE_WORKSHEET_GUID, 'name': 'Recessive',
    'order': 0, 'search': RECESSIVE_SEARCH, 'createdDate': '2026-11-20T10:03:00Z', 'createdBy': MANAGER_NAME,
}
QUERY_RESULT_JSON = {
    'worksheetQueryResultGuid': QUERY_RESULT_GUID, 'worksheetQueryGuid': RESTRICTIVE_QUERY_GUID,
    'workbookTargetGuid': FAMILY_TARGET_GUID, 'status': 'I', 'statusLastModifiedDate': '2026-11-20T10:04:00Z',
    'statusLastModifiedBy': MANAGER_NAME, 'note': 'Reviewing candidates', 'searchHash': None, 'lastRunDate': None,
    'lastRunBy': None, 'numResults': None, 'lastModifiedDate': '2026-11-20T10:04:00Z',
}
WORKBOOK_DETAIL_JSON = {
    'workbooksByGuid': {WORKBOOK_GUID: WORKBOOK_JSON},
    'workbookTargetsByGuid': {FAMILY_TARGET_GUID: FAMILY_TARGET_JSON, GROUP_TARGET_GUID: GROUP_TARGET_JSON},
    'worksheetsByGuid': {
        DE_NOVO_WORKSHEET_GUID: DE_NOVO_WORKSHEET_JSON, RECESSIVE_WORKSHEET_GUID: RECESSIVE_WORKSHEET_JSON,
    },
    'worksheetQueriesByGuid': {
        RESTRICTIVE_QUERY_GUID: RESTRICTIVE_QUERY_JSON, PERMISSIVE_QUERY_GUID: PERMISSIVE_QUERY_JSON,
        RECESSIVE_QUERY_GUID: RECESSIVE_QUERY_JSON,
    },
    'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: QUERY_RESULT_JSON},
}

SEARCH_HASH_REGEX = '^WB[0-9a-f]{48}$'

# Simulates a user whose access to families was removed while still being able to view the project
NO_FAMILY_ACCESS_PATCH = mock.patch(
    'seqr.views.utils.permissions_utils.get_project_analysis_group_guids_user_can_view', lambda *args, **kwargs: ([], []))


@mock.patch('seqr.views.utils.permissions_utils.safe_redis_get_json', lambda *args: None)
class WorkbookAPITest(object):

    def _post(self, url, body=None):
        return self.client.post(url, content_type='application/json', data=json.dumps(body or {}))

    def _check_manager_login(self, url):
        self.client.logout()
        self.check_manager_login(url)

    def _assert_error(self, response, error):
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [error])

    def _assert_no_family_access(self, url, body=None):
        with NO_FAMILY_ACCESS_PATCH:
            response = self._post(url, body)
        self.assertEqual(response.status_code, 403)

    def _assert_workbook_counts(self, workbooks=2, targets=3, worksheets=3, queries=4, query_results=1):
        self.assertEqual(Workbook.objects.count(), workbooks)
        self.assertEqual(WorkbookTarget.objects.count(), targets)
        self.assertEqual(Worksheet.objects.count(), worksheets)
        self.assertEqual(WorksheetQuery.objects.count(), queries)
        self.assertEqual(WorksheetQueryResult.objects.count(), query_results)

    def test_project_workbooks(self):
        url = reverse(project_workbooks_handler, args=[PROJECT_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbooksByGuid': {WORKBOOK_GUID: WORKBOOK_JSON}})

        self.assertEqual(self.client.get(reverse(project_workbooks_handler, args=[NO_ACCESS_PROJECT_GUID])).status_code, 403)
        self.assertEqual(self.client.get(reverse(project_workbooks_handler, args=['R0000_invalid'])).status_code, 404)

        Workbook.objects.create(project=Project.objects.get(guid=PROJECT_GUID), name='A workbook', created_by=self.collaborator_user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        workbooks = response.json()['workbooksByGuid']
        self.assertDictEqual(
            {workbook['name']: workbook['canEdit'] for workbook in workbooks.values()},
            {'A workbook': True, 'Trio analysis': False},
        )

        self.login_manager()
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(
            {workbook['name']: workbook['canEdit'] for workbook in response.json()['workbooksByGuid'].values()},
            {'A workbook': True, 'Trio analysis': True},
        )

        response = self.client.get(reverse(project_workbooks_handler, args=[NO_ACCESS_PROJECT_GUID]))
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(response.json()['workbooksByGuid'].keys()), [NO_ACCESS_WORKBOOK_GUID])

    def test_workbook_detail(self):
        url = reverse(workbook_detail_handler, args=[WORKBOOK_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), WORKBOOK_DETAIL_JSON)

        self.assertEqual(self.client.get(reverse(workbook_detail_handler, args=[NO_ACCESS_WORKBOOK_GUID])).status_code, 403)
        self.assertEqual(self.client.get(reverse(workbook_detail_handler, args=['WB0000000_invalid'])).status_code, 404)

        with NO_FAMILY_ACCESS_PATCH:
            self.assertEqual(self.client.get(url).status_code, 403)

        # Access to an analysis group in the workbook does not grant access to the workbook
        self.login_base_user()
        self.assertEqual(self.client.get(url).status_code, 403)

        self.login_manager()
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            **WORKBOOK_DETAIL_JSON, 'workbooksByGuid': {WORKBOOK_GUID: {**WORKBOOK_JSON, 'canEdit': True}},
        })

        response = self.client.get(reverse(workbook_detail_handler, args=[NO_ACCESS_WORKBOOK_GUID]))
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), set(WORKBOOK_DETAIL_JSON.keys()))
        self.assertListEqual(list(response_json['workbookTargetsByGuid'].keys()), [NO_ACCESS_TARGET_GUID])
        self.assertListEqual(list(response_json['worksheetsByGuid'].keys()), [NO_ACCESS_WORKSHEET_GUID])
        self.assertListEqual(list(response_json['worksheetQueriesByGuid'].keys()), [NO_ACCESS_QUERY_GUID])
        self.assertDictEqual(response_json['worksheetQueryResultsByGuid'], {})

    def test_create_workbook(self):
        url = reverse(create_workbook_handler, args=[PROJECT_GUID])
        self.check_collaborator_login(url)

        self._assert_error(self._post(url), '"Name" is required')
        self._assert_error(self._post(url, {'name': '  '}), '"Name" is required')
        self._assert_error(self._post(url, {'name': 5}), '"Name" is required')
        self._assert_error(
            self._post(url, {'name': 'Trio analysis '}), 'A workbook named "Trio analysis" already exists')
        self._assert_error(self._post(url, {'name': 'New workbook', 'description': 5}), '"description" must be text')
        self._assert_error(
            self._post(url, {
                'name': 'New workbook', 'familyGuids': ['F000011_11', 'F000002_2', 'invalid_family'],
                'analysisGroupGuids': [ANALYSIS_GROUP_GUID, 'invalid_group'],
            }),
            'The following families or analysis groups do not exist in this project: F000011_11, invalid_family, invalid_group',
        )
        self._assert_no_family_access(url, {'name': 'New workbook', 'familyGuids': ['F000002_2']})
        self._assert_workbook_counts()

        response = self._post(url, {'name': ' New workbook '})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), set(WORKBOOK_DETAIL_JSON.keys()))
        self.assertEqual(len(response_json['workbooksByGuid']), 1)
        workbook_guid = next(iter(response_json['workbooksByGuid']))
        self.assertDictEqual(response_json, {
            'workbooksByGuid': {workbook_guid: {
                'workbookGuid': workbook_guid, 'projectGuid': PROJECT_GUID, 'name': 'New workbook', 'description': None,
                'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME, 'lastModifiedDate': mock.ANY, 'canEdit': True,
            }},
            'workbookTargetsByGuid': {}, 'worksheetsByGuid': {}, 'worksheetQueriesByGuid': {},
            'worksheetQueryResultsByGuid': {},
        })
        workbook = Workbook.objects.get(guid=workbook_guid)
        self.assertEqual(workbook.name, 'New workbook')
        self.assertEqual(workbook.project.guid, PROJECT_GUID)
        self.assertEqual(workbook.created_by, self.collaborator_user)

        response = self._post(url, {
            'name': 'Cohort workbook', 'description': 'A cohort', 'familyGuids': ['F000002_2', 'F000003_3', 'F000002_2'],
            'analysisGroupGuids': ['AG0000185_accepted'],
        })
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        workbook_guid = next(iter(response_json['workbooksByGuid']))
        self.assertEqual(response_json['workbooksByGuid'][workbook_guid]['description'], 'A cohort')
        targets = sorted(response_json['workbookTargetsByGuid'].values(), key=lambda target: target['order'])
        self.assertListEqual(targets, [
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'order': 0, 'familyGuid': 'F000002_2',
             'analysisGroupGuid': None, 'familyGuids': ['F000002_2']},
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'order': 1, 'familyGuid': 'F000003_3',
             'analysisGroupGuid': None, 'familyGuids': ['F000003_3']},
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'order': 2, 'familyGuid': None,
             'analysisGroupGuid': 'AG0000185_accepted', 'familyGuids': ['F000003_3']},
        ])
        self.assertSetEqual(
            set(response_json['workbookTargetsByGuid'].keys()),
            set(WorkbookTarget.objects.filter(workbook__guid=workbook_guid).values_list('guid', flat=True)),
        )
        self._assert_workbook_counts(workbooks=4, targets=6)

        self.assertEqual(self._post(reverse(create_workbook_handler, args=[NO_ACCESS_PROJECT_GUID]), {'name': 'A'}).status_code, 403)
        self.assertEqual(self._post(reverse(create_workbook_handler, args=['R0000_invalid']), {'name': 'A'}).status_code, 404)

    def test_update_workbook(self):
        url = reverse(update_workbook_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(url)

        collaborator_workbook = Workbook.objects.create(
            project=Project.objects.get(guid=PROJECT_GUID), name='Collaborator workbook', created_by=self.collaborator_user)
        collaborator_url = reverse(update_workbook_handler, args=[collaborator_workbook.guid])

        self._assert_error(self._post(url, {'name': ''}), '"Name" is required')
        self._assert_error(
            self._post(url, {'name': 'Collaborator workbook'}), 'A workbook named "Collaborator workbook" already exists')
        self._assert_error(self._post(url, {'description': ['invalid']}), '"description" must be text')

        manager_workbook_json = {**WORKBOOK_JSON, 'canEdit': True}
        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbooksByGuid': {WORKBOOK_GUID: manager_workbook_json}})

        response = self._post(url, {'name': 'Trio analysis', 'description': None, 'project': 'ignored', 'guid': 'ignored'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbooksByGuid': {WORKBOOK_GUID: {
            **manager_workbook_json, 'description': None, 'lastModifiedDate': mock.ANY,
        }}})
        self.assertNotEqual(response.json()['workbooksByGuid'][WORKBOOK_GUID]['lastModifiedDate'], '2026-11-20T10:00:00Z')

        response = self._post(url, {'name': ' Updated workbook', 'description': 'Updated description'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbooksByGuid': {WORKBOOK_GUID: {
            **manager_workbook_json, 'name': 'Updated workbook', 'description': 'Updated description',
            'lastModifiedDate': mock.ANY,
        }}})
        workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        self.assertEqual(workbook.name, 'Updated workbook')
        self.assertEqual(workbook.description, 'Updated description')
        self.assertEqual(workbook.project.guid, PROJECT_GUID)

        # Users with edit access to the project can edit workbooks created by other users
        response = self._post(collaborator_url, {'description': 'Edited by a manager'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._post(reverse(update_workbook_handler, args=['WB0000000_invalid'])).status_code, 404)

        # Users with view access to the project can only edit the workbooks they created
        self.login_collaborator()
        response = self._post(collaborator_url, {'name': 'Renamed workbook'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json()['workbooksByGuid'][collaborator_workbook.guid], {
            'workbookGuid': collaborator_workbook.guid, 'projectGuid': PROJECT_GUID, 'name': 'Renamed workbook',
            'description': 'Edited by a manager', 'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME,
            'lastModifiedDate': mock.ANY, 'canEdit': True,
        })
        self.assertEqual(self._post(url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(self._post(reverse(update_workbook_handler, args=[NO_ACCESS_WORKBOOK_GUID])).status_code, 403)
        self.assertEqual(Workbook.objects.get(guid=WORKBOOK_GUID).name, 'Updated workbook')

        # Creators can not edit their workbooks after they lose access to the project
        collaborator_workbook.created_by = self.no_access_user
        collaborator_workbook.save()
        self.login_base_user()
        self.assertEqual(self._post(collaborator_url, {'name': 'Not allowed'}).status_code, 403)

    def test_delete_workbook(self):
        url = reverse(delete_workbook_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(url)

        self.login_collaborator()
        self.assertEqual(self._post(url).status_code, 403)
        self.assertEqual(self._post(reverse(delete_workbook_handler, args=[NO_ACCESS_WORKBOOK_GUID])).status_code, 403)
        self._assert_workbook_counts()

        self.login_manager()
        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbooksByGuid': {WORKBOOK_GUID: None}})
        self._assert_workbook_counts(workbooks=1, targets=1, worksheets=1, queries=1, query_results=0)
        self.assertEqual(Family.objects.filter(guid='F000001_1').count(), 1)
        self.assertEqual(AnalysisGroup.objects.filter(guid=ANALYSIS_GROUP_GUID).count(), 1)

        self.assertEqual(self._post(url).status_code, 404)

    def test_duplicate_workbook(self):
        url = reverse(duplicate_workbook_handler, args=[WORKBOOK_GUID])
        self.check_collaborator_login(url)

        self._assert_error(self._post(url), '"Name" is required')
        self._assert_error(self._post(url, {'name': 'Trio analysis'}), 'A workbook named "Trio analysis" already exists')
        self._assert_error(
            self._post(url, {'name': 'Copied workbook', 'familyGuids': ['F000014_14']}),
            'The following families or analysis groups do not exist in this project: F000014_14',
        )
        self._assert_no_family_access(url, {'name': 'Copied workbook', 'familyGuids': ['F000002_2']})
        self._assert_workbook_counts()

        response = self._post(url, {
            'name': 'Copied workbook', 'familyGuids': ['F000002_2'], 'analysisGroupGuids': ['AG0000185_accepted'],
        })
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), set(WORKBOOK_DETAIL_JSON.keys()))
        workbook_guid = next(iter(response_json['workbooksByGuid']))
        self.assertNotEqual(workbook_guid, WORKBOOK_GUID)
        self.assertDictEqual(response_json['workbooksByGuid'], {workbook_guid: {
            'workbookGuid': workbook_guid, 'projectGuid': PROJECT_GUID, 'name': 'Copied workbook',
            'description': 'De novo and recessive review', 'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME,
            'lastModifiedDate': mock.ANY, 'canEdit': True,
        }})

        # Targets and query results are not copied
        targets = sorted(response_json['workbookTargetsByGuid'].values(), key=lambda target: target['order'])
        self.assertListEqual(targets, [
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'order': 0, 'familyGuid': 'F000002_2',
             'analysisGroupGuid': None, 'familyGuids': ['F000002_2']},
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'order': 1, 'familyGuid': None,
             'analysisGroupGuid': 'AG0000185_accepted', 'familyGuids': ['F000003_3']},
        ])
        self.assertDictEqual(response_json['worksheetQueryResultsByGuid'], {})

        worksheets = sorted(response_json['worksheetsByGuid'].values(), key=lambda worksheet: worksheet['order'])
        self.assertListEqual(worksheets, [
            {'worksheetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'name': 'De Novo', 'order': 0},
            {'worksheetGuid': mock.ANY, 'workbookGuid': workbook_guid, 'name': 'Recessive', 'order': 1},
        ])
        de_novo_guid, recessive_guid = [worksheet['worksheetGuid'] for worksheet in worksheets]
        self.assertFalse({de_novo_guid, recessive_guid} & {DE_NOVO_WORKSHEET_GUID, RECESSIVE_WORKSHEET_GUID})

        self.assertFalse(set(response_json['worksheetQueriesByGuid']) & set(WORKBOOK_DETAIL_JSON['worksheetQueriesByGuid']))
        queries = sorted(
            response_json['worksheetQueriesByGuid'].values(), key=lambda query: (query['worksheetGuid'] != de_novo_guid, query['order']))
        copied_query_json = {'worksheetQueryGuid': mock.ANY, 'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME}
        self.assertListEqual(queries, [
            {**RESTRICTIVE_QUERY_JSON, **copied_query_json, 'worksheetGuid': de_novo_guid},
            {**PERMISSIVE_QUERY_JSON, **copied_query_json, 'worksheetGuid': de_novo_guid},
            {**RECESSIVE_QUERY_JSON, **copied_query_json, 'worksheetGuid': recessive_guid},
        ])
        self._assert_workbook_counts(workbooks=3, targets=5, worksheets=5, queries=7)

        # The copied workbook is independent of the original workbook
        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertDictEqual(response.json(), WORKBOOK_DETAIL_JSON)
        response = self._post(
            reverse(update_worksheet_query_handler, args=[workbook_guid, queries[0]['worksheetQueryGuid']]), {'name': 'Renamed'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(WorksheetQuery.objects.get(guid=RESTRICTIVE_QUERY_GUID).name, 'De novo restrictive')

        response = self._post(url, {'name': 'Empty copy', 'description': None})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        workbook_guid = next(iter(response_json['workbooksByGuid']))
        self.assertIsNone(response_json['workbooksByGuid'][workbook_guid]['description'])
        self.assertDictEqual(response_json['workbookTargetsByGuid'], {})
        self.assertEqual(len(response_json['worksheetsByGuid']), 2)
        self.assertEqual(len(response_json['worksheetQueriesByGuid']), 3)

        self.assertEqual(self._post(reverse(duplicate_workbook_handler, args=[NO_ACCESS_WORKBOOK_GUID]), {'name': 'A'}).status_code, 403)
        self.assertEqual(self._post(reverse(duplicate_workbook_handler, args=['WB0000000_invalid']), {'name': 'A'}).status_code, 404)

    def test_workbook_targets(self):
        add_url = reverse(add_workbook_targets_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(add_url)

        self._assert_error(self._post(add_url), 'Families or analysis groups are required')
        self._assert_error(
            self._post(add_url, {'familyGuids': ['F000014_14'], 'analysisGroupGuids': ['invalid_group']}),
            'The following families or analysis groups do not exist in this project: F000014_14, invalid_group',
        )
        self._assert_error(
            self._post(add_url, {'familyGuids': ['F000002_2', 'F000001_1'], 'analysisGroupGuids': [ANALYSIS_GROUP_GUID]}),
            'The following are already targets of this workbook: 1, Test Group 1',
        )
        self._assert_no_family_access(add_url, {'familyGuids': ['F000002_2']})
        self._assert_workbook_counts()

        response = self._post(add_url, {'familyGuids': ['F000002_2'], 'analysisGroupGuids': ['AG0000185_accepted']})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertListEqual(list(response_json.keys()), ['workbookTargetsByGuid'])
        new_targets = sorted(response_json['workbookTargetsByGuid'].values(), key=lambda target: target['order'])
        self.assertListEqual(new_targets, [
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': WORKBOOK_GUID, 'order': 2, 'familyGuid': 'F000002_2',
             'analysisGroupGuid': None, 'familyGuids': ['F000002_2']},
            {'workbookTargetGuid': mock.ANY, 'workbookGuid': WORKBOOK_GUID, 'order': 3, 'familyGuid': None,
             'analysisGroupGuid': 'AG0000185_accepted', 'familyGuids': ['F000003_3']},
        ])
        family_target_guid, group_target_guid = [target['workbookTargetGuid'] for target in new_targets]
        self.assertEqual(WorkbookTarget.objects.get(guid=family_target_guid).created_by, self.manager_user)
        self._assert_workbook_counts(targets=5)

        reorder_url = reverse(reorder_workbook_targets_handler, args=[WORKBOOK_GUID])
        self._check_manager_login(reorder_url)
        reorder_error = 'The guid of every item is required exactly once'
        self._assert_error(self._post(reorder_url), reorder_error)
        self._assert_error(self._post(reorder_url, {'workbookTargetGuids': [FAMILY_TARGET_GUID, GROUP_TARGET_GUID]}), reorder_error)
        self._assert_error(self._post(reorder_url, {'workbookTargetGuids': [
            FAMILY_TARGET_GUID, GROUP_TARGET_GUID, family_target_guid, family_target_guid,
        ]}), reorder_error)
        self._assert_error(self._post(reorder_url, {'workbookTargetGuids': [
            FAMILY_TARGET_GUID, GROUP_TARGET_GUID, family_target_guid, group_target_guid, NO_ACCESS_TARGET_GUID,
        ]}), reorder_error)
        self._assert_no_family_access(reorder_url, {'workbookTargetGuids': [
            group_target_guid, FAMILY_TARGET_GUID, family_target_guid, GROUP_TARGET_GUID,
        ]})

        response = self._post(reorder_url, {'workbookTargetGuids': [
            group_target_guid, GROUP_TARGET_GUID, family_target_guid, FAMILY_TARGET_GUID,
        ]})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'workbookTargetsByGuid': {
            group_target_guid: {**new_targets[1], 'order': 0},
            GROUP_TARGET_GUID: {**GROUP_TARGET_JSON, 'order': 1},
            family_target_guid: {**new_targets[0], 'order': 2},
            FAMILY_TARGET_GUID: {**FAMILY_TARGET_JSON, 'order': 3},
        }})
        self.assertListEqual(
            list(WorkbookTarget.objects.filter(workbook__guid=WORKBOOK_GUID).order_by('order').values_list('guid', flat=True)),
            [group_target_guid, GROUP_TARGET_GUID, family_target_guid, FAMILY_TARGET_GUID],
        )
        self.assertEqual(WorkbookTarget.objects.get(guid=NO_ACCESS_TARGET_GUID).order, 0)

        delete_url = reverse(delete_workbook_target_handler, args=[WORKBOOK_GUID, FAMILY_TARGET_GUID])
        self._check_manager_login(delete_url)
        self.assertEqual(self._post(reverse(delete_workbook_target_handler, args=[WORKBOOK_GUID, NO_ACCESS_TARGET_GUID])).status_code, 404)
        self._assert_no_family_access(delete_url)
        self._assert_workbook_counts(targets=5)

        response = self._post(delete_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'workbookTargetsByGuid': {FAMILY_TARGET_GUID: None},
            'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: None},
        })
        self._assert_workbook_counts(targets=4, query_results=0)
        self.assertEqual(Family.objects.filter(guid='F000001_1').count(), 1)
        self.assertEqual(self._post(delete_url).status_code, 404)

        response = self._post(reverse(delete_workbook_target_handler, args=[WORKBOOK_GUID, group_target_guid]))
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'workbookTargetsByGuid': {group_target_guid: None}, 'worksheetQueryResultsByGuid': {},
        })

        # Adding targets continues from the last order
        response = self._post(add_url, {'familyGuids': ['F000001_1']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(next(iter(response.json()['workbookTargetsByGuid'].values()))['order'], 3)

        self.login_collaborator()
        self.assertEqual(self._post(add_url, {'familyGuids': ['F000003_3']}).status_code, 403)
        self.assertEqual(self._post(reorder_url, {'workbookTargetGuids': []}).status_code, 403)
        self.assertEqual(self._post(reverse(delete_workbook_target_handler, args=[WORKBOOK_GUID, GROUP_TARGET_GUID])).status_code, 403)
        no_access_urls = [
            reverse(add_workbook_targets_handler, args=[NO_ACCESS_WORKBOOK_GUID]),
            reverse(reorder_workbook_targets_handler, args=[NO_ACCESS_WORKBOOK_GUID]),
            reverse(delete_workbook_target_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_TARGET_GUID]),
        ]
        for no_access_url in no_access_urls:
            self.assertEqual(self._post(no_access_url).status_code, 403)
        self._assert_workbook_counts(targets=4, query_results=0)

    def test_delete_target_families_and_analysis_groups(self):
        self.login_manager()
        project = Project.objects.get(guid=PROJECT_GUID)
        family = Family.objects.create(project=project, family_id='workbook_family')
        analysis_group = AnalysisGroup.objects.create(project=project, name='Workbook group')
        analysis_group.families.set([family])

        response = self._post(reverse(add_workbook_targets_handler, args=[WORKBOOK_GUID]), {
            'familyGuids': [family.guid], 'analysisGroupGuids': [analysis_group.guid],
        })
        self.assertEqual(response.status_code, 200)
        family_target_guid, group_target_guid = sorted(
            response.json()['workbookTargetsByGuid'], key=lambda guid: response.json()['workbookTargetsByGuid'][guid]['order'])
        for target_guid in [family_target_guid, group_target_guid]:
            response = self._post(reverse(
                update_worksheet_query_result_handler, args=[WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, target_guid],
            ), {'status': 'U'})
            self.assertEqual(response.status_code, 200)
        self._assert_workbook_counts(targets=5, query_results=3)

        # Deleting a family removes its target and query results, and removes the family from analysis group targets
        Family.bulk_delete(self.manager_user, guid=family.guid)
        self._assert_workbook_counts(targets=4, query_results=2)
        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertEqual(response.status_code, 200)
        targets = response.json()['workbookTargetsByGuid']
        self.assertSetEqual(set(targets.keys()), {FAMILY_TARGET_GUID, GROUP_TARGET_GUID, group_target_guid})
        self.assertListEqual(targets[group_target_guid]['familyGuids'], [])

        # Deleting an analysis group removes its target and query results
        response = self._post(reverse(delete_analysis_group_handler, args=[PROJECT_GUID, analysis_group.guid]))
        self.assertEqual(response.status_code, 200)
        self._assert_workbook_counts()
        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertDictEqual(response.json(), {
            **WORKBOOK_DETAIL_JSON, 'workbooksByGuid': {WORKBOOK_GUID: {**WORKBOOK_JSON, 'canEdit': True}},
        })

    def test_worksheets(self):
        create_url = reverse(create_worksheet_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(create_url)

        self._assert_error(self._post(create_url), '"Name" is required')
        self._assert_error(self._post(create_url, {'name': 'De Novo'}), 'A worksheet named "De Novo" already exists')

        response = self._post(create_url, {'name': ' Dominant '})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertListEqual(list(response_json.keys()), ['worksheetsByGuid'])
        worksheet_guid = next(iter(response_json['worksheetsByGuid']))
        dominant_worksheet_json = {
            'worksheetGuid': worksheet_guid, 'workbookGuid': WORKBOOK_GUID, 'name': 'Dominant', 'order': 2,
        }
        self.assertDictEqual(response_json['worksheetsByGuid'], {worksheet_guid: dominant_worksheet_json})
        worksheet = Worksheet.objects.get(guid=worksheet_guid)
        self.assertEqual(worksheet.workbook.guid, WORKBOOK_GUID)
        self.assertEqual(worksheet.created_by, self.manager_user)

        # Worksheet names are only unique per workbook
        response = self._post(create_url, {'name': 'Other'})
        self.assertEqual(response.status_code, 200)
        other_worksheet_guid = next(iter(response.json()['worksheetsByGuid']))
        self.assertEqual(response.json()['worksheetsByGuid'][other_worksheet_guid]['order'], 3)

        update_url = reverse(update_worksheet_handler, args=[WORKBOOK_GUID, worksheet_guid])
        self._check_manager_login(update_url)
        self._assert_error(self._post(update_url), '"Name" is required')
        self._assert_error(self._post(update_url, {'name': 'Recessive'}), 'A worksheet named "Recessive" already exists')
        response = self._post(update_url, {'name': 'Dominant'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetsByGuid': {worksheet_guid: dominant_worksheet_json}})
        response = self._post(update_url, {'name': 'Dominant inherited', 'order': 10, 'workbook': 'ignored'})
        self.assertEqual(response.status_code, 200)
        dominant_worksheet_json['name'] = 'Dominant inherited'
        self.assertDictEqual(response.json(), {'worksheetsByGuid': {worksheet_guid: dominant_worksheet_json}})
        self.assertEqual(Worksheet.objects.get(guid=worksheet_guid).name, 'Dominant inherited')
        self.assertEqual(self._post(
            reverse(update_worksheet_handler, args=[WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]), {'name': 'A'},
        ).status_code, 404)

        reorder_url = reverse(reorder_worksheets_handler, args=[WORKBOOK_GUID])
        self._check_manager_login(reorder_url)
        reorder_error = 'The guid of every item is required exactly once'
        self._assert_error(self._post(reorder_url, {'worksheetGuids': 'invalid'}), reorder_error)
        self._assert_error(self._post(reorder_url, {'worksheetGuids': [
            worksheet_guid, NO_ACCESS_WORKSHEET_GUID, RECESSIVE_WORKSHEET_GUID, DE_NOVO_WORKSHEET_GUID,
        ]}), reorder_error)
        response = self._post(reorder_url, {'worksheetGuids': [
            worksheet_guid, RECESSIVE_WORKSHEET_GUID, other_worksheet_guid, DE_NOVO_WORKSHEET_GUID,
        ]})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetsByGuid': {
            worksheet_guid: {**dominant_worksheet_json, 'order': 0},
            RECESSIVE_WORKSHEET_GUID: {**RECESSIVE_WORKSHEET_JSON, 'order': 1},
            other_worksheet_guid: {
                'worksheetGuid': other_worksheet_guid, 'workbookGuid': WORKBOOK_GUID, 'name': 'Other', 'order': 2,
            },
            DE_NOVO_WORKSHEET_GUID: {**DE_NOVO_WORKSHEET_JSON, 'order': 3},
        }})
        self.assertListEqual(
            list(Worksheet.objects.filter(workbook__guid=WORKBOOK_GUID).order_by('order').values_list('guid', flat=True)),
            [worksheet_guid, RECESSIVE_WORKSHEET_GUID, other_worksheet_guid, DE_NOVO_WORKSHEET_GUID],
        )

        delete_url = reverse(delete_worksheet_handler, args=[WORKBOOK_GUID, DE_NOVO_WORKSHEET_GUID])
        self._check_manager_login(delete_url)
        self.assertEqual(self._post(reverse(delete_worksheet_handler, args=[WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID])).status_code, 404)
        self._assert_workbook_counts(worksheets=5)

        response = self._post(delete_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'worksheetsByGuid': {DE_NOVO_WORKSHEET_GUID: None},
            'worksheetQueriesByGuid': {RESTRICTIVE_QUERY_GUID: None, PERMISSIVE_QUERY_GUID: None},
            'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: None},
        })
        self._assert_workbook_counts(worksheets=4, queries=2, query_results=0)
        self.assertEqual(self._post(delete_url).status_code, 404)

        self.login_collaborator()
        self.assertEqual(self._post(create_url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(self._post(update_url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(self._post(reorder_url, {'worksheetGuids': []}).status_code, 403)
        self.assertEqual(self._post(reverse(delete_worksheet_handler, args=[WORKBOOK_GUID, RECESSIVE_WORKSHEET_GUID])).status_code, 403)
        no_access_urls = [
            reverse(create_worksheet_handler, args=[NO_ACCESS_WORKBOOK_GUID]),
            reverse(reorder_worksheets_handler, args=[NO_ACCESS_WORKBOOK_GUID]),
            reverse(update_worksheet_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]),
            reverse(delete_worksheet_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]),
        ]
        for no_access_url in no_access_urls:
            self.assertEqual(self._post(no_access_url, {'name': 'Not allowed'}).status_code, 403)
        self._assert_workbook_counts(worksheets=4, queries=2, query_results=0)

    def test_worksheet_queries(self):
        create_url = reverse(create_worksheet_query_handler, args=[WORKBOOK_GUID, DE_NOVO_WORKSHEET_GUID])
        self.check_manager_login(create_url)

        search = {'inheritance': {'mode': 'x_linked_recessive'}, 'freqs': {'callset': {'ac': 10}}}
        search_error = 'Exactly one of "search" or "savedSearchGuid" is required'
        self._assert_error(self._post(create_url, {'name': 'X-linked'}), search_error)
        self._assert_error(
            self._post(create_url, {'name': 'X-linked', 'search': search, 'savedSearchGuid': SAVED_SEARCH_GUID}), search_error)
        self._assert_error(self._post(create_url, {'name': 'X-linked', 'search': 'invalid'}), '"search" must be a JSON object')
        self._assert_error(
            self._post(create_url, {'name': 'X-linked', 'search': {'inheritance': {'filter': {'genotype': {'I000001_na19675': 'ref_alt'}}}}}),
            'Saved searches cannot include custom genotype filters',
        )
        self._assert_error(self._post(create_url, {'search': search}), '"Name" is required')
        self._assert_error(
            self._post(create_url, {'name': 'X-linked', 'savedSearchGuid': 'VS0000000_invalid'}),
            'Invalid saved search: VS0000000_invalid',
        )
        private_search = VariantSearch.objects.create(name='Private search', search=search, created_by=self.collaborator_user)
        self._assert_error(
            self._post(create_url, {'savedSearchGuid': private_search.guid}), f'Invalid saved search: {private_search.guid}')
        self.assertEqual(self._post(
            reverse(create_worksheet_query_handler, args=[WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]), {'name': 'X-linked', 'search': search},
        ).status_code, 404)
        self._assert_workbook_counts()

        response = self._post(create_url, {'name': ' X-linked ', 'search': search, 'order': 10})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertListEqual(list(response_json.keys()), ['worksheetQueriesByGuid'])
        query_guid = next(iter(response_json['worksheetQueriesByGuid']))
        query_json = {
            'worksheetQueryGuid': query_guid, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID, 'name': 'X-linked', 'order': 2,
            'search': search, 'createdDate': mock.ANY, 'createdBy': MANAGER_NAME,
        }
        self.assertDictEqual(response_json['worksheetQueriesByGuid'], {query_guid: query_json})
        self.assertDictEqual(WorksheetQuery.objects.get(guid=query_guid).search, search)

        # Queries copy saved searches as they are shown to the user, and are independent of the saved search
        saved_search = VariantSearch.objects.get(guid=SAVED_SEARCH_GUID)
        saved_search_json = deepcopy(saved_search.search)
        self.assertListEqual(saved_search_json['pathogenicity']['hgmd'], ['disease_causing'])
        non_analyst_search_json = deepcopy(saved_search_json)
        non_analyst_search_json['pathogenicity'].pop('hgmd')

        response = self._post(create_url, {'savedSearchGuid': SAVED_SEARCH_GUID})
        self.assertEqual(response.status_code, 200)
        saved_search_query_guid = next(iter(response.json()['worksheetQueriesByGuid']))
        self.assertDictEqual(response.json()['worksheetQueriesByGuid'][saved_search_query_guid], {
            'worksheetQueryGuid': saved_search_query_guid, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID,
            'name': 'De Novo/Dominant Restrictive', 'order': 3, 'search': non_analyst_search_json,
            'createdDate': mock.ANY, 'createdBy': MANAGER_NAME,
        })

        self.login_analyst_user()
        response = self._post(create_url, {'savedSearchGuid': SAVED_SEARCH_GUID, 'name': 'With HGMD'})
        self.assertEqual(response.status_code, 200)
        analyst_query_guid = next(iter(response.json()['worksheetQueriesByGuid']))
        self.assertDictEqual(response.json()['worksheetQueriesByGuid'][analyst_query_guid], {
            'worksheetQueryGuid': analyst_query_guid, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID, 'name': 'With HGMD',
            'order': 4, 'search': saved_search_json, 'createdDate': mock.ANY, 'createdBy': 'Test User',
        })

        saved_search.delete()
        self.assertDictEqual(WorksheetQuery.objects.get(guid=saved_search_query_guid).search, non_analyst_search_json)
        self.assertDictEqual(WorksheetQuery.objects.get(guid=analyst_query_guid).search, saved_search_json)
        self._assert_workbook_counts(queries=7)

        self.login_manager()
        update_url = reverse(update_worksheet_query_handler, args=[WORKBOOK_GUID, query_guid])
        self._check_manager_login(update_url)
        self._assert_error(self._post(update_url), '"Name" is required')
        update_search_error = 'The search of an existing query can not be changed, create a new query instead'
        self._assert_error(self._post(update_url, {'name': 'Updated', 'search': RECESSIVE_SEARCH}), update_search_error)
        self._assert_error(self._post(update_url, {'name': 'Updated', 'savedSearchGuid': private_search.guid}), update_search_error)
        response = self._post(update_url, {'name': 'X-linked recessive', 'order': 10, 'worksheet': 'ignored'})
        self.assertEqual(response.status_code, 200)
        query_json['name'] = 'X-linked recessive'
        self.assertDictEqual(response.json(), {'worksheetQueriesByGuid': {query_guid: query_json}})
        query = WorksheetQuery.objects.get(guid=query_guid)
        self.assertEqual(query.name, 'X-linked recessive')
        self.assertDictEqual(query.search, search)
        self.assertEqual(self._post(
            reverse(update_worksheet_query_handler, args=[WORKBOOK_GUID, NO_ACCESS_QUERY_GUID]), {'name': 'A'},
        ).status_code, 404)

        reorder_url = reverse(reorder_worksheet_queries_handler, args=[WORKBOOK_GUID, DE_NOVO_WORKSHEET_GUID])
        self._check_manager_login(reorder_url)
        reorder_error = 'The guid of every item is required exactly once'
        self._assert_error(self._post(reorder_url, {'worksheetQueryGuids': [query_guid]}), reorder_error)
        self._assert_error(self._post(reorder_url, {'worksheetQueryGuids': [
            query_guid, saved_search_query_guid, analyst_query_guid, RESTRICTIVE_QUERY_GUID, RECESSIVE_QUERY_GUID,
        ]}), reorder_error)
        self.assertEqual(self._post(
            reverse(reorder_worksheet_queries_handler, args=[WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]), {'worksheetQueryGuids': []},
        ).status_code, 404)
        reordered_guids = [
            query_guid, PERMISSIVE_QUERY_GUID, saved_search_query_guid, analyst_query_guid, RESTRICTIVE_QUERY_GUID,
        ]
        response = self._post(reorder_url, {'worksheetQueryGuids': reordered_guids})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertListEqual(list(response_json.keys()), ['worksheetQueriesByGuid'])
        self.assertDictEqual(
            {guid: query['order'] for guid, query in response_json['worksheetQueriesByGuid'].items()},
            {guid: i for i, guid in enumerate(reordered_guids)},
        )
        self.assertDictEqual(response_json['worksheetQueriesByGuid'][query_guid], {**query_json, 'order': 0})
        self.assertDictEqual(
            response_json['worksheetQueriesByGuid'][RESTRICTIVE_QUERY_GUID], {**RESTRICTIVE_QUERY_JSON, 'order': 4})
        self.assertListEqual(list(WorksheetQuery.objects.filter(
            worksheet__guid=DE_NOVO_WORKSHEET_GUID).order_by('order').values_list('guid', flat=True)), reordered_guids)
        self.assertEqual(WorksheetQuery.objects.get(guid=RECESSIVE_QUERY_GUID).order, 0)

        delete_url = reverse(delete_worksheet_query_handler, args=[WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID])
        self._check_manager_login(delete_url)
        self.assertEqual(self._post(reverse(delete_worksheet_query_handler, args=[WORKBOOK_GUID, NO_ACCESS_QUERY_GUID])).status_code, 404)
        response = self._post(delete_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'worksheetQueriesByGuid': {RESTRICTIVE_QUERY_GUID: None},
            'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: None},
        })
        self._assert_workbook_counts(queries=6, query_results=0)
        self.assertEqual(self._post(delete_url).status_code, 404)
        response = self._post(reverse(delete_worksheet_query_handler, args=[WORKBOOK_GUID, query_guid]))
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'worksheetQueriesByGuid': {query_guid: None}, 'worksheetQueryResultsByGuid': {},
        })

        self.login_collaborator()
        self.assertEqual(self._post(create_url, {'name': 'Not allowed', 'search': search}).status_code, 403)
        self.assertEqual(self._post(reorder_url, {'worksheetQueryGuids': []}).status_code, 403)
        for handler in [update_worksheet_query_handler, delete_worksheet_query_handler]:
            url = reverse(handler, args=[WORKBOOK_GUID, PERMISSIVE_QUERY_GUID])
            self.assertEqual(self._post(url, {'name': 'Not allowed'}).status_code, 403)
        no_access_urls = [
            reverse(create_worksheet_query_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]),
            reverse(reorder_worksheet_queries_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_WORKSHEET_GUID]),
            reverse(update_worksheet_query_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_QUERY_GUID]),
            reverse(delete_worksheet_query_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_QUERY_GUID]),
        ]
        for no_access_url in no_access_urls:
            self.assertEqual(self._post(no_access_url, {'name': 'Not allowed', 'search': search}).status_code, 403)
        self._assert_workbook_counts(queries=5, query_results=0)

    def test_update_worksheet_query_result(self):
        url = reverse(update_worksheet_query_result_handler, args=[WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID])
        self.check_collaborator_login(url, request_data={'status': 'F'})

        self._assert_error(self._post(url), '"status" or "note" is required')
        self._assert_error(self._post(url, {'numResults': 5, 'lastRunDate': None}), '"status" or "note" is required')
        self._assert_error(self._post(url, {'status': 'Z'}), 'Invalid status: Z')
        self._assert_error(self._post(url, {'status': None}), 'Invalid status: None')
        self._assert_error(self._post(url, {'note': 5}), '"note" must be text')
        self._assert_no_family_access(url, {'status': 'F'})
        self.assertEqual(WorksheetQueryResult.objects.get(guid=QUERY_RESULT_GUID).status, 'I')

        response = self._post(url, {'status': 'F', 'note': 'Candidate variant in a known gene', 'numResults': 5})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: {
            **QUERY_RESULT_JSON, 'status': 'F', 'note': 'Candidate variant in a known gene',
            'statusLastModifiedDate': mock.ANY, 'statusLastModifiedBy': COLLABORATOR_NAME, 'lastModifiedDate': mock.ANY,
        }}})
        status_modified_date = response.json()['worksheetQueryResultsByGuid'][QUERY_RESULT_GUID]['statusLastModifiedDate']
        self.assertNotEqual(status_modified_date, '2026-11-20T10:04:00Z')

        # Changing the note does not change the status audit fields
        response = self._post(url, {'note': None})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: {
            **QUERY_RESULT_JSON, 'status': 'F', 'note': None, 'statusLastModifiedDate': status_modified_date,
            'statusLastModifiedBy': COLLABORATOR_NAME, 'lastModifiedDate': mock.ANY,
        }}})
        self._assert_workbook_counts()

        # Query results are created when they are first updated
        group_url = reverse(
            update_worksheet_query_result_handler, args=[WORKBOOK_GUID, RECESSIVE_QUERY_GUID, GROUP_TARGET_GUID])
        self._assert_error(self._post(group_url, {'status': 'Z'}), 'Invalid status: Z')
        self._assert_no_family_access(group_url, {'note': 'A note'})
        self._assert_workbook_counts()

        response = self._post(group_url, {'note': 'A note'})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertListEqual(list(response_json.keys()), ['worksheetQueryResultsByGuid'])
        query_result_guid = next(iter(response_json['worksheetQueryResultsByGuid']))
        self.assertDictEqual(response_json['worksheetQueryResultsByGuid'], {query_result_guid: {
            'worksheetQueryResultGuid': query_result_guid, 'worksheetQueryGuid': RECESSIVE_QUERY_GUID,
            'workbookTargetGuid': GROUP_TARGET_GUID, 'status': 'N', 'statusLastModifiedDate': None,
            'statusLastModifiedBy': None, 'note': 'A note', 'searchHash': None, 'lastRunDate': None, 'lastRunBy': None,
            'numResults': None, 'lastModifiedDate': mock.ANY,
        }})
        self.assertEqual(WorksheetQueryResult.objects.get(guid=query_result_guid).created_by, self.collaborator_user)
        self._assert_workbook_counts(query_results=2)

        response = self._post(group_url, {'status': 'U'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetQueryResultsByGuid': {query_result_guid: {
            **response_json['worksheetQueryResultsByGuid'][query_result_guid], 'status': 'U',
            'statusLastModifiedDate': mock.ANY, 'statusLastModifiedBy': COLLABORATOR_NAME, 'lastModifiedDate': mock.ANY,
        }}})
        self.assertIsNotNone(response.json()['worksheetQueryResultsByGuid'][query_result_guid]['statusLastModifiedDate'])
        self._assert_workbook_counts(query_results=2)

        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertSetEqual(set(response.json()['worksheetQueryResultsByGuid'].keys()), {QUERY_RESULT_GUID, query_result_guid})

        invalid_args = [
            [WORKBOOK_GUID, NO_ACCESS_QUERY_GUID, FAMILY_TARGET_GUID],
            [WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, NO_ACCESS_TARGET_GUID],
            ['WB0000000_invalid', RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID],
        ]
        for args in invalid_args:
            response = self._post(reverse(update_worksheet_query_result_handler, args=args), {'status': 'F'})
            self.assertEqual(response.status_code, 404)
        response = self._post(reverse(
            update_worksheet_query_result_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_QUERY_GUID, NO_ACCESS_TARGET_GUID],
        ), {'status': 'F'})
        self.assertEqual(response.status_code, 403)
        self._assert_workbook_counts(query_results=2)

    def test_run_worksheet_query(self):
        url = reverse(run_worksheet_query_handler, args=[WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID])
        self.check_collaborator_login(url)

        self._assert_no_family_access(url)
        self.assertEqual(VariantSearchResults.objects.filter(search_hash__startswith='WB').count(), 0)

        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {'searchHash', 'worksheetQueryResultsByGuid'})
        search_hash = response_json['searchHash']
        self.assertRegex(search_hash, SEARCH_HASH_REGEX)
        self.assertEqual(search_hash, _get_search_hash(RESTRICTIVE_SEARCH, ['F000001_1']))
        ran_query_result_json = {
            **QUERY_RESULT_JSON, 'searchHash': search_hash, 'lastRunDate': mock.ANY, 'lastRunBy': COLLABORATOR_NAME,
            'lastModifiedDate': mock.ANY,
        }
        self.assertDictEqual(response_json['worksheetQueryResultsByGuid'], {QUERY_RESULT_GUID: ran_query_result_json})
        last_run_date = response_json['worksheetQueryResultsByGuid'][QUERY_RESULT_GUID]['lastRunDate']
        self.assertIsNotNone(last_run_date)

        results_model = VariantSearchResults.objects.get(search_hash=search_hash)
        self.assertDictEqual(results_model.variant_search.search, RESTRICTIVE_SEARCH)
        self.assertIsNone(results_model.variant_search.name)
        self.assertListEqual(list(results_model.families.values_list('guid', flat=True)), ['F000001_1'])
        self.assertEqual(WorksheetQueryResult.objects.get(guid=QUERY_RESULT_GUID).results, results_model)

        # The results are loaded through the search API, which sets the number of results
        search_url = reverse(query_variants_handler, args=[search_hash])
        with mock.patch('seqr.views.apis.variant_search_api._get_variants_with_cache') as mock_get_variants, \
                mock.patch('seqr.views.apis.variant_search_api._process_variants') as mock_process_variants:
            mock_get_variants.return_value = [{}, {}, {}]
            mock_process_variants.return_value = {}
            response = self.client.get(search_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'search': {
            'search': RESTRICTIVE_SEARCH, 'projectFamilies': [{'projectGuid': PROJECT_GUID, 'familyGuids': ['F000001_1']}],
            'totalResults': 3,
        }})
        self.assertEqual(WorksheetQueryResult.objects.get(guid=QUERY_RESULT_GUID).num_results, 3)

        # Running a query again uses the same results for all users, and the hash does not depend on the order of keys
        self.login_manager()
        query = WorksheetQuery.objects.get(guid=RESTRICTIVE_QUERY_GUID)
        query.search = {'freqs': {'gnomad_genomes': {'af': 0.001}}, 'inheritance': {'mode': 'de_novo'}}
        query.save()
        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'searchHash': search_hash, 'worksheetQueryResultsByGuid': {QUERY_RESULT_GUID: {
            **ran_query_result_json, 'lastRunBy': MANAGER_NAME, 'numResults': 3,
        }}})
        self.assertNotEqual(response.json()['worksheetQueryResultsByGuid'][QUERY_RESULT_GUID]['lastRunDate'], last_run_date)
        self.assertEqual(VariantSearchResults.objects.filter(search_hash__startswith='WB').count(), 1)
        self._assert_workbook_counts()

        # Analysis group targets search the current families of the group, and create query results when first run
        group_url = reverse(run_worksheet_query_handler, args=[WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, GROUP_TARGET_GUID])
        self._assert_no_family_access(group_url)
        self._assert_workbook_counts()

        response = self._post(group_url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        group_search_hash = response_json['searchHash']
        self.assertRegex(group_search_hash, SEARCH_HASH_REGEX)
        self.assertNotEqual(group_search_hash, search_hash)
        query_result_guid = next(iter(response_json['worksheetQueryResultsByGuid']))
        group_query_result_json = {
            'worksheetQueryResultGuid': query_result_guid, 'worksheetQueryGuid': RESTRICTIVE_QUERY_GUID,
            'workbookTargetGuid': GROUP_TARGET_GUID, 'status': 'N', 'statusLastModifiedDate': None,
            'statusLastModifiedBy': None, 'note': None, 'searchHash': group_search_hash, 'lastRunDate': mock.ANY,
            'lastRunBy': MANAGER_NAME, 'numResults': None, 'lastModifiedDate': mock.ANY,
        }
        self.assertDictEqual(response_json['worksheetQueryResultsByGuid'], {query_result_guid: group_query_result_json})
        self.assertIsNotNone(response_json['worksheetQueryResultsByGuid'][query_result_guid]['lastRunDate'])
        self._assert_workbook_counts(query_results=2)
        results_model = VariantSearchResults.objects.get(search_hash=group_search_hash)
        self.assertSetEqual(
            set(results_model.families.values_list('guid', flat=True)), {'F000001_1', 'F000003_3', 'F000005_5'})

        WorksheetQueryResult.objects.filter(guid=query_result_guid).update(num_results=7)
        analysis_group = AnalysisGroup.objects.get(guid=ANALYSIS_GROUP_GUID)
        analysis_group.families.remove(Family.objects.get(guid='F000005_5'))
        response = self._post(group_url)
        self.assertEqual(response.status_code, 200)
        updated_group_search_hash = response.json()['searchHash']
        self.assertNotIn(updated_group_search_hash, {search_hash, group_search_hash})
        self.assertDictEqual(response.json()['worksheetQueryResultsByGuid'], {query_result_guid: {
            **group_query_result_json, 'searchHash': updated_group_search_hash,
        }})
        results_model = VariantSearchResults.objects.get(search_hash=updated_group_search_hash)
        self.assertSetEqual(set(results_model.families.values_list('guid', flat=True)), {'F000001_1', 'F000003_3'})
        self.assertEqual(VariantSearchResults.objects.filter(search_hash__startswith='WB').count(), 3)
        self._assert_workbook_counts(query_results=2)

        analysis_group.families.clear()
        self._assert_error(self._post(group_url), 'Test Group 1 has no families to search')

        # Different queries for the same target have different results
        permissive_url = reverse(run_worksheet_query_handler, args=[WORKBOOK_GUID, PERMISSIVE_QUERY_GUID, FAMILY_TARGET_GUID])
        response = self._post(permissive_url)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(response.json()['searchHash'], {search_hash, group_search_hash, updated_group_search_hash})
        self.assertRegex(response.json()['searchHash'], SEARCH_HASH_REGEX)
        self._assert_workbook_counts(query_results=3)

        invalid_args = [
            [WORKBOOK_GUID, NO_ACCESS_QUERY_GUID, FAMILY_TARGET_GUID],
            [WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, NO_ACCESS_TARGET_GUID],
            ['WB0000000_invalid', RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID],
        ]
        for args in invalid_args:
            self.assertEqual(self._post(reverse(run_worksheet_query_handler, args=args)).status_code, 404)
        self.login_collaborator()
        response = self._post(reverse(
            run_worksheet_query_handler, args=[NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_QUERY_GUID, NO_ACCESS_TARGET_GUID]))
        self.assertEqual(response.status_code, 403)
        self._assert_workbook_counts(query_results=3)

    def test_run_worksheet_query_search_models(self):
        url = reverse(run_worksheet_query_handler, args=[WORKBOOK_GUID, RECESSIVE_QUERY_GUID, FAMILY_TARGET_GUID])
        self.login_manager()

        # Existing results with the same hash for a different search or families are never used
        search_hash = _get_search_hash(RECESSIVE_SEARCH, ['F000001_1'])
        variant_search = VariantSearch.objects.create(search={'inheritance': {'mode': 'de_novo'}}, created_by=self.manager_user)
        results_model = VariantSearchResults.objects.create(search_hash=search_hash, variant_search=variant_search)
        results_model.families.set(Family.objects.filter(guid='F000001_1'))
        error = f'The search results for {search_hash} do not match this query and target'
        self._assert_error(self._post(url), error)

        variant_search.search = RECESSIVE_SEARCH
        variant_search.save()
        results_model.families.set(Family.objects.filter(guid__in=['F000001_1', 'F000002_2']))
        self._assert_error(self._post(url), error)
        self._assert_workbook_counts()

        # Results are shared with saved searches for the same search
        results_model.delete()
        variant_search.name = 'My recessive search'
        variant_search.save()
        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertEqual(response_json['searchHash'], search_hash)
        query_result_guid = next(iter(response_json['worksheetQueryResultsByGuid']))
        self.assertEqual(response_json['worksheetQueryResultsByGuid'][query_result_guid]['searchHash'], search_hash)
        last_run_date = response_json['worksheetQueryResultsByGuid'][query_result_guid]['lastRunDate']
        self.assertEqual(VariantSearchResults.objects.get(search_hash=search_hash).variant_search, variant_search)
        WorksheetQueryResult.objects.filter(guid=query_result_guid).update(num_results=4)

        # Deleting the saved search removes the results but not the query or the history of the query result
        response = self._post(reverse(delete_saved_search_handler, args=[variant_search.guid]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(VariantSearchResults.objects.filter(search_hash=search_hash).count(), 0)
        self.assertDictEqual(WorksheetQuery.objects.get(guid=RECESSIVE_QUERY_GUID).search, RECESSIVE_SEARCH)
        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertEqual(response.status_code, 200)
        query_result_json = response.json()['worksheetQueryResultsByGuid'][query_result_guid]
        self.assertDictEqual(query_result_json, {
            'worksheetQueryResultGuid': query_result_guid, 'worksheetQueryGuid': RECESSIVE_QUERY_GUID,
            'workbookTargetGuid': FAMILY_TARGET_GUID, 'status': 'N', 'statusLastModifiedDate': None,
            'statusLastModifiedBy': None, 'note': None, 'searchHash': None, 'lastRunDate': last_run_date,
            'lastRunBy': MANAGER_NAME, 'numResults': 4, 'lastModifiedDate': mock.ANY,
        })

        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['searchHash'], search_hash)
        self.assertDictEqual(response.json()['worksheetQueryResultsByGuid'], {query_result_guid: {
            **query_result_json, 'searchHash': search_hash, 'lastRunDate': mock.ANY, 'numResults': None,
            'lastModifiedDate': mock.ANY,
        }})
        results_model = VariantSearchResults.objects.get(search_hash=search_hash)
        self.assertIsNone(results_model.variant_search.name)
        self.assertDictEqual(results_model.variant_search.search, RECESSIVE_SEARCH)
        self._assert_workbook_counts(query_results=2)


class LocalWorkbookAPITest(AuthenticationTestCase, WorkbookAPITest):
    fixtures = ['users', 'social_auth', '1kg_project', 'variant_searches', 'workbooks']


class AnvilWorkbookAPITest(AnvilAuthenticationTestCase, WorkbookAPITest):
    fixtures = ['users', 'social_auth', '1kg_project', 'variant_searches', 'workbooks']


class WorkbookModelTest(TestCase):
    fixtures = ['users', '1kg_project', 'workbooks']

    def _assert_integrity_error(self, func):
        with self.assertRaises(IntegrityError), transaction.atomic():
            func()

    def test_workbook_target_constraints(self):
        workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        family = Family.objects.get(guid='F000002_2')
        analysis_group = AnalysisGroup.objects.get(guid='AG0000185_accepted')

        target = WorkbookTarget.objects.create(workbook=workbook, family=family)
        self.assertEqual(target.guid, f'WBT{target.id:07d}_2')
        self.assertEqual(target.order, 0)
        group_target = WorkbookTarget.objects.create(workbook=workbook, analysis_group=analysis_group)
        self.assertEqual(group_target.guid, f'WBT{group_target.id:07d}_accepted')

        one_target_error = 'A workbook target must be exactly one of a family or an analysis group'
        with self.assertRaisesMessage(ValidationError, one_target_error):
            WorkbookTarget.objects.create(workbook=workbook)
        with self.assertRaisesMessage(ValidationError, one_target_error):
            WorkbookTarget.objects.create(workbook=workbook, family=family, analysis_group=analysis_group)

        project_error = 'A workbook target must belong to the project of its workbook'
        with self.assertRaisesMessage(ValidationError, project_error):
            WorkbookTarget.objects.create(workbook=workbook, family=Family.objects.get(guid='F000011_11'))
        other_project_group = AnalysisGroup.objects.create(project=Project.objects.get(guid='R0003_test'), name='Other')
        with self.assertRaisesMessage(ValidationError, project_error):
            WorkbookTarget.objects.create(workbook=workbook, analysis_group=other_project_group)
        target.family = Family.objects.get(guid='F000011_11')
        with self.assertRaisesMessage(ValidationError, project_error):
            target.save()

        # The database enforces exactly one of a family or an analysis group when model validation is bypassed
        targets = WorkbookTarget.objects.filter(guid=FAMILY_TARGET_GUID)
        self._assert_integrity_error(lambda: targets.update(analysis_group=analysis_group))
        self._assert_integrity_error(lambda: targets.update(family=None))

        self._assert_integrity_error(lambda: WorkbookTarget.objects.create(workbook=workbook, family=family))
        self._assert_integrity_error(lambda: WorkbookTarget.objects.create(workbook=workbook, analysis_group=analysis_group))
        self.assertEqual(WorkbookTarget.objects.filter(workbook=workbook).count(), 4)

        # The same family or analysis group can be a target of multiple workbooks
        other_workbook = Workbook.objects.create(project=workbook.project, name='Other workbook')
        self.assertEqual(other_workbook.guid, f'WB{other_workbook.id:07d}_other_workbook')
        WorkbookTarget.objects.create(workbook=other_workbook, family=family)
        WorkbookTarget.objects.create(workbook=other_workbook, analysis_group=analysis_group)

    def test_unique_constraints(self):
        workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        self._assert_integrity_error(lambda: Workbook.objects.create(project=workbook.project, name='Trio analysis'))
        Workbook.objects.create(project=Project.objects.get(guid='R0003_test'), name='Trio analysis')

        self._assert_integrity_error(lambda: Worksheet.objects.create(workbook=workbook, name='De Novo'))
        worksheet = Worksheet.objects.create(workbook=workbook, name='Other')
        self.assertEqual(worksheet.guid, f'WS{worksheet.id:07d}_other')
        self.assertEqual(worksheet.order, 0)

        # Query names are not unique
        query = WorksheetQuery.objects.create(worksheet=worksheet, name='Recessive', search={})
        duplicate_query = WorksheetQuery.objects.create(worksheet=worksheet, name='Recessive', search={})
        self.assertEqual(query.guid, f'WSQ{query.id:07d}_recessive')
        self.assertEqual(duplicate_query.guid, f'WSQ{duplicate_query.id:07d}_recessive')

        target = WorkbookTarget.objects.get(guid=FAMILY_TARGET_GUID)
        query_result = WorksheetQueryResult.objects.create(query=query, target=target)
        self.assertEqual(query_result.guid, f'WQR{query_result.id:07d}_{query.id}_{target.id}')
        self.assertEqual(query_result.status, 'N')
        self._assert_integrity_error(lambda: WorksheetQueryResult.objects.create(query=query, target=target))
        self._assert_integrity_error(lambda: WorksheetQueryResult.objects.create(
            query=WorksheetQuery.objects.get(guid=RESTRICTIVE_QUERY_GUID), target=target))

        with self.assertRaisesMessage(
            ValidationError, 'A worksheet query result must have a query and a target from the same workbook',
        ):
            WorksheetQueryResult.objects.create(query=query, target=WorkbookTarget.objects.get(guid=NO_ACCESS_TARGET_GUID))

    def test_cascade_deletes(self):
        results_model = VariantSearchResults.objects.create(
            search_hash='abc', variant_search=VariantSearch.objects.create(search={}))
        WorksheetQueryResult.objects.filter(guid=QUERY_RESULT_GUID).update(results=results_model)

        results_model.delete()
        self.assertIsNone(WorksheetQueryResult.objects.get(guid=QUERY_RESULT_GUID).results)

        Worksheet.objects.get(guid=DE_NOVO_WORKSHEET_GUID).delete()
        self.assertEqual(WorksheetQuery.objects.count(), 2)
        self.assertEqual(WorksheetQueryResult.objects.count(), 0)

        project = Project.objects.create(name='Workbook project', created_by=User.objects.get(username='test_user_manager'))
        workbook = Workbook.objects.create(project=project, name='Project workbook')
        Worksheet.objects.create(workbook=workbook, name='De Novo')
        self.assertEqual(Workbook.objects.count(), 3)
        self.assertEqual(Worksheet.objects.count(), 3)
        project.delete()
        self.assertEqual(Workbook.objects.count(), 2)
        self.assertEqual(Worksheet.objects.count(), 2)

        Workbook.objects.get(guid=WORKBOOK_GUID).delete()
        self.assertListEqual(list(Workbook.objects.values_list('guid', flat=True)), [NO_ACCESS_WORKBOOK_GUID])
        self.assertListEqual(list(WorkbookTarget.objects.values_list('guid', flat=True)), [NO_ACCESS_TARGET_GUID])
        self.assertListEqual(list(Worksheet.objects.values_list('guid', flat=True)), [NO_ACCESS_WORKSHEET_GUID])
        self.assertListEqual(list(WorksheetQuery.objects.values_list('guid', flat=True)), [NO_ACCESS_QUERY_GUID])
