import json
import mock
from datetime import datetime, timezone
from django.urls.base import reverse

from matchmaker.models import MatchmakerResult, MatchmakerSubmission
from matchmaker.views.matchmaker_inbox_api import matchmaker_inbox, update_matchmaker_inbox_results
from seqr.views.utils.test_utils import AuthenticationTestCase, AnvilAuthenticationTestCase

NOT_RELEVANT_GUID = 'MR0003552_SHE_1006P_1'
NEW_GUID = 'MR0007228_VCGS_FAM50_156'
RESPONDED_GUID = 'MR0004688_RGP_105_3'

RESULT_FIELDS = {
    'matchmakerResultGuid', 'status', 'source', 'comments', 'createdDate', 'lastModifiedDate', 'matchRemoved',
    'weContacted', 'hostContacted', 'assignedTo', 'assignedToMe', 'submission', 'match', 'geneOverlap', 'hpoOverlap',
}

OVERLAP_RESULT_DATA = {
    'score': {'patient': 'high'},
    'patient': {
        'id': 'P-overlap',
        'label': 'Overlap patient',
        'contact': {
            'institution': 'Test Institute', 'name': 'Dr Test', 'href': 'javascript:alert(1)', 'email': 5,
            'notes': 'Free text which is not returned',
        },
        'genomicFeatures': [{'gene': {'id': 'RP11'}}, {'gene': {'id': 'NOT_A_GENE'}}],
        'features': [
            {'id': 'HP:0001252'}, {'id': 'HP:0001263', 'observed': 'yes'}, {'id': 'HP:0012469', 'observed': 'no'},
            {'label': 'A feature with no id'},
        ],
        'notes': 'Free text which is not returned',
    },
}

EXPECTED_OVERLAP_RESULT = {
    'matchmakerResultGuid': None,
    'status': 'new',
    'source': 'mme',
    'comments': None,
    'createdDate': '2024-01-10T12:00:00Z',
    'lastModifiedDate': None,
    'matchRemoved': False,
    'weContacted': False,
    'hostContacted': False,
    'assignedTo': None,
    'assignedToMe': False,
    'submission': {
        'submissionGuid': 'MS000001_na19675',
        'individualGuid': 'I000001_na19675',
        'individualDisplayName': 'NA19675_1',
        'familyGuid': 'F000001_1',
        'familyDisplayName': '1',
        'projectGuid': 'R0001_1kg',
        'projectName': '1kg project nåme with uniçøde',
        'genes': [{'geneId': 'ENSG00000135953', 'geneSymbol': 'RP11'}],
        'phenotypes': [
            {'id': 'HP:0001252', 'label': 'Muscular hypotonia', 'observed': 'yes'},
            {'id': 'HP:0001263', 'label': 'Global developmental delay', 'observed': 'no'},
            {'id': 'HP:0012469', 'label': 'Infantile spasms', 'observed': 'yes'},
        ],
    },
    'match': {
        'patientId': 'P-overlap',
        'label': 'Overlap patient',
        'institution': 'Test Institute',
        'contactName': 'Dr Test',
        'contactHref': 'javascript:alert(1)',
        'contactEmail': None,
        'genes': [
            {'geneId': 'ENSG00000135953', 'geneSymbol': 'RP11'}, {'geneId': None, 'geneSymbol': 'NOT_A_GENE'},
        ],
        'phenotypes': [
            {'id': 'HP:0001252', 'label': 'Muscular hypotonia', 'observed': 'yes'},
            {'id': 'HP:0001263', 'label': 'Global developmental delay', 'observed': 'yes'},
            {'id': 'HP:0012469', 'label': 'Infantile spasms', 'observed': 'no'},
        ],
        'score': None,
    },
    'geneOverlap': ['ENSG00000135953'],
    'hpoOverlap': ['HP:0001252'],
}

ALL_STATUS_COUNTS = {'new': 0, 'reviewing': 0, 'relevant': 0, 'not_relevant': 0, 'responded': 0}


class MatchmakerInboxTestMixin(object):
    fixtures = ['users', '1kg_project', 'reference_data']

    def _create_result(self, submission_id, result_data, created_date, **kwargs):
        result = MatchmakerResult.objects.create(submission_id=submission_id, result_data=result_data, **kwargs)
        MatchmakerResult.objects.filter(pk=result.pk).update(
            created_date=datetime.strptime(created_date, '%Y-%m-%d %H').replace(tzinfo=timezone.utc))
        return result.guid

    def _create_results(self):
        self.overlap_guid = self._create_result(1, OVERLAP_RESULT_DATA, '2024-01-10 12')
        self.removed_guid = self._create_result(5, {'patient': {'id': 'P-removed', 'contact': {
            'institution': 'test institute', 'href': 'mailto:removed@test.org',
        }, 'features': [{'id': 'HP:0001252'}]}}, '2024-02-01 00', match_removed=True, we_contacted=True)
        self.non_analyst_guid = self._create_result(4, {'score': {'patient': 0.75}, 'patient': {
            'id': 'P-non-analyst', 'contact': 'not a contact',
            'genomicFeatures': [{'gene': {'id': 'ENSG00000135953'}}, {'gene': {'id': 'ENSG00000223972'}}],
        }}, '2024-03-05 23', assigned_to=self.manager_user, source='variantmatcher', host_contacted=True)
        self.demo_guid = self._create_result(2, {'patient': {'id': 'P-demo', 'contact': {}}}, '2024-04-01 00')

    def _get_results(self, url, expected_guids=None, **params):
        response = self.client.get(url, params)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {
            'results', 'totalResults', 'page', 'perPage', 'statusCounts', 'institutions', 'projects',
        })
        for result in response_json['results']:
            self.assertSetEqual(set(result.keys()), RESULT_FIELDS)
        if expected_guids is not None:
            self.assertListEqual([r['matchmakerResultGuid'] for r in response_json['results']], expected_guids)
            self.assertEqual(response_json['totalResults'], len(expected_guids))
        return response_json

    def _assert_no_access(self, url):
        self.assertDictEqual(self._get_results(url, status='all', includeRemoved='true'), {
            'results': [], 'totalResults': 0, 'page': 1, 'perPage': 50, 'statusCounts': ALL_STATUS_COUNTS,
            'institutions': [], 'projects': [],
        })

    def _post_update(self, body):
        return self.client.post(
            reverse(update_matchmaker_inbox_results), content_type='application/json', data=json.dumps(body))


class MatchmakerInboxAPITest(MatchmakerInboxTestMixin, AuthenticationTestCase):

    def test_matchmaker_inbox_access(self):
        self._create_results()
        url = reverse(matchmaker_inbox)
        self.check_require_login(url)

        # A user with no project access gets no results
        self._assert_no_access(url)

        # Collaborators only get results for their projects. Demo projects never have matchmaker access
        self.login_collaborator()
        response_json = self._get_results(url, expected_guids=[self.overlap_guid, NEW_GUID])
        self.assertDictEqual(response_json['statusCounts'], {**ALL_STATUS_COUNTS, 'new': 2, 'not_relevant': 1, 'responded': 1})
        self.assertListEqual(response_json['institutions'], [
            'Test Institute', 'The Danish Epilepsy Centre, Filadelfia, Institute for Regional Health Services',
            'VU University Medical Center', 'test institute',
        ])
        self.assertListEqual(response_json['projects'], [
            {'projectGuid': 'R0001_1kg', 'name': '1kg project nåme with uniçøde'}])
        self.assertEqual(response_json['page'], 1)
        self.assertEqual(response_json['perPage'], 50)

        self.assertDictEqual(response_json['results'][0], {
            **EXPECTED_OVERLAP_RESULT, 'matchmakerResultGuid': self.overlap_guid, 'lastModifiedDate': mock.ANY,
        })
        self.assertNotIn('Free text', json.dumps(response_json))

        all_project_guids = [self.overlap_guid, RESPONDED_GUID, NEW_GUID, NOT_RELEVANT_GUID]
        response_json = self._get_results(url, expected_guids=all_project_guids, status='all')
        results = {r['matchmakerResultGuid']: r for r in response_json['results']}
        self.assertDictEqual(results[NOT_RELEVANT_GUID]['match'], {
            'patientId': 'P0004515',
            'label': None,
            'institution': None,
            'contactName': 'Baylor UDN Clinical Site',
            'contactHref': 'mailto:UDNCC@hms.harvard.edu,matchmaker@phenomecentral.org',
            'contactEmail': None,
            'genes': [
                {'geneId': 'ENSG00000186092', 'geneSymbol': 'OR4F5'},
                {'geneId': 'ENSG00000233750', 'geneSymbol': 'CICP27'},
                {'geneId': 'ENSG00000223972', 'geneSymbol': 'DDX11L1'},
            ],
            'phenotypes': [
                {'id': 'HP:0012469', 'label': 'Infantile spasms', 'observed': 'yes'},
                {'id': 'HP:0003273', 'label': 'Hip contracture', 'observed': 'no'},
            ],
            'score': 0.5706712016939723,
        })
        self.assertEqual(results[NOT_RELEVANT_GUID]['status'], 'not_relevant')
        self.assertTrue(results[NOT_RELEVANT_GUID]['hostContacted'])
        self.assertListEqual(results[NOT_RELEVANT_GUID]['geneOverlap'], [])
        self.assertListEqual(results[NOT_RELEVANT_GUID]['hpoOverlap'], ['HP:0012469'])
        self.assertEqual(results[RESPONDED_GUID]['status'], 'responded')
        self.assertTrue(results[RESPONDED_GUID]['weContacted'])
        self.assertListEqual(results[RESPONDED_GUID]['match']['genes'], [
            {'geneId': 'ENSG00000272333', 'geneSymbol': 'ENSG00000272333'}])

        # Removed matches are only returned on request, results for deleted submissions are never returned
        self._get_results(
            url, expected_guids=[self.removed_guid, *all_project_guids], status='all', includeRemoved='true')
        MatchmakerSubmission.objects.filter(id=5).update(deleted_date=datetime.now())
        self._get_results(url, expected_guids=all_project_guids, status='all', includeRemoved='true')

        # Managers also have access to the non-analyst project
        self.login_manager()
        response_json = self._get_results(url, expected_guids=[self.non_analyst_guid, self.overlap_guid, NEW_GUID])
        self.assertDictEqual(response_json['statusCounts'], {
            **ALL_STATUS_COUNTS, 'new': 2, 'reviewing': 1, 'not_relevant': 1, 'responded': 1})
        self.assertListEqual(response_json['projects'], [
            {'projectGuid': 'R0001_1kg', 'name': '1kg project nåme with uniçøde'},
            {'projectGuid': 'R0004_non_analyst_project', 'name': 'Non-Analyst Project'},
        ])
        non_analyst_result = response_json['results'][0]
        self.assertDictEqual(non_analyst_result['match'], {
            'patientId': 'P-non-analyst', 'label': None, 'institution': None, 'contactName': None,
            'contactHref': None, 'contactEmail': None, 'phenotypes': [], 'score': 0.75,
            'genes': [
                {'geneId': 'ENSG00000135953', 'geneSymbol': 'RP11'},
                {'geneId': 'ENSG00000223972', 'geneSymbol': 'DDX11L1'},
            ],
        })
        self.assertDictEqual(non_analyst_result['submission'], {
            'submissionGuid': 'MS000018_P0004517',
            'individualGuid': 'I000018_na21234',
            'individualDisplayName': 'NA21234',
            'familyGuid': 'F000014_14',
            'familyDisplayName': 'fam14',
            'projectGuid': 'R0004_non_analyst_project',
            'projectName': 'Non-Analyst Project',
            'genes': [{'geneId': 'ENSG00000135953', 'geneSymbol': 'RP11'}],
            'phenotypes': [],
        })
        self.assertListEqual(non_analyst_result['geneOverlap'], ['ENSG00000135953'])
        self.assertListEqual(non_analyst_result['hpoOverlap'], [])
        self.assertEqual(non_analyst_result['source'], 'variantmatcher')
        self.assertEqual(non_analyst_result['status'], 'reviewing')
        self.assertEqual(non_analyst_result['assignedTo'], 'Test Manager User')
        self.assertTrue(non_analyst_result['assignedToMe'])

        # Analysts have no access to the non-analyst project
        self.login_analyst_user()
        self._get_results(url, expected_guids=[self.overlap_guid, NEW_GUID])

        # Data managers only see results for their own projects
        self.login_data_manager_user()
        self._assert_no_access(url)

    def test_matchmaker_inbox_filters(self):
        self._create_results()
        url = reverse(matchmaker_inbox)
        self.check_require_login(url)
        self.login_manager()

        all_guids = [
            self.non_analyst_guid, self.removed_guid, self.overlap_guid, RESPONDED_GUID, NEW_GUID, NOT_RELEVANT_GUID,
        ]
        get_all = lambda expected_guids, **params: self._get_results(
            url, expected_guids=expected_guids, status='all', includeRemoved='true', **params)
        get_all(all_guids)

        # status
        self._get_results(url, expected_guids=[RESPONDED_GUID, NOT_RELEVANT_GUID], status='responded,not_relevant')
        self._get_results(url, expected_guids=[self.non_analyst_guid], status='reviewing')
        self._get_results(url, expected_guids=[], status='relevant')

        # project
        get_all([self.non_analyst_guid], projectGuid='R0004_non_analyst_project')
        get_all(all_guids[1:], projectGuid='R0001_1kg')
        get_all([], projectGuid='R0003_test')

        # institution
        response_json = get_all([self.removed_guid, self.overlap_guid], institution='TEST institute')
        self.assertDictEqual(response_json['statusCounts'], {**ALL_STATUS_COUNTS, 'new': 1, 'responded': 1})
        self.assertEqual(len(response_json['institutions']), 4)
        get_all([RESPONDED_GUID], institution='VU University Medical Center')

        # source
        get_all([self.non_analyst_guid], source='variantmatcher')
        get_all(all_guids, source='variantmatcher,mme')
        get_all([], source='genematcher')

        # assignee
        get_all([self.non_analyst_guid], assignedToMe='true')
        get_all(all_guids, assignedToMe='false')

        # date range, inclusive of both ends
        get_all([self.non_analyst_guid, self.removed_guid], startDate='2024-02-01')
        get_all([self.removed_guid, self.overlap_guid], startDate='2024-01-10', endDate='2024-02-01')
        get_all([RESPONDED_GUID, NEW_GUID, NOT_RELEVANT_GUID], endDate='2024-01-09')
        get_all([self.non_analyst_guid], startDate='2024-03-05', endDate='2024-03-05')

        # gene, in either our submission or the match, by symbol or id
        submission_gene_guids = [
            self.non_analyst_guid, self.overlap_guid, RESPONDED_GUID, NEW_GUID, NOT_RELEVANT_GUID,
        ]
        get_all(submission_gene_guids, gene='RP11')
        get_all(submission_gene_guids, gene=' rp11 ')
        get_all(submission_gene_guids, gene='ENSG00000135953')
        get_all([NEW_GUID, NOT_RELEVANT_GUID], gene='CICP27')
        get_all([NEW_GUID, NOT_RELEVANT_GUID], gene='ENSG00000233750')
        get_all([self.non_analyst_guid, NOT_RELEVANT_GUID], gene='DDX11L1')
        get_all([RESPONDED_GUID], gene='ENSG00000272333')
        get_all([self.overlap_guid], gene='NOT_A_GENE')
        get_all([], gene='MISSING')

        # combined
        get_all([self.overlap_guid], gene='RP11', institution='test institute')
        self._get_results(url, expected_guids=[NEW_GUID], gene='CICP27')

        # pagination
        response_json = self._get_results(url, status='all', includeRemoved='true', perPage='4')
        self.assertListEqual([r['matchmakerResultGuid'] for r in response_json['results']], all_guids[:4])
        self.assertEqual(response_json['totalResults'], 6)
        self.assertEqual(response_json['perPage'], 4)
        response_json = self._get_results(url, status='all', includeRemoved='true', perPage='4', page='2')
        self.assertListEqual([r['matchmakerResultGuid'] for r in response_json['results']], all_guids[4:])
        self.assertEqual(response_json['totalResults'], 6)
        self.assertEqual(response_json['page'], 2)
        response_json = self._get_results(url, status='all', includeRemoved='true', perPage='4', page='3')
        self.assertListEqual(response_json['results'], [])
        self.assertEqual(response_json['totalResults'], 6)
        self.assertEqual(self._get_results(url, perPage='5000')['perPage'], 200)

        # invalid parameters
        for params, error in [
            ({'status': 'new,closed'}, 'Invalid status: closed'),
            ({'source': 'email'}, 'Invalid source: email'),
            ({'page': '0'}, 'Invalid page: 0'),
            ({'perPage': '-1'}, 'Invalid perPage: -1'),
            ({'page': 'two'}, 'Invalid page: two'),
            ({'startDate': '01/02/2024'}, 'Invalid startDate: 01/02/2024. Dates must be formatted as YYYY-MM-DD'),
            ({'endDate': '2024-13-01'}, 'Invalid endDate: 2024-13-01. Dates must be formatted as YYYY-MM-DD'),
        ]:
            response = self.client.get(url, params)
            self.assertEqual(response.status_code, 400)
            self.assertListEqual(response.json()['errors'], [error])

    def test_update_matchmaker_inbox_results(self):
        self._create_results()
        url = reverse(update_matchmaker_inbox_results)
        self.check_require_login(url)

        for body, error in [
            ({'status': 'relevant'}, 'A list of result guids is required'),
            ({'resultGuids': [], 'status': 'relevant'}, 'A list of result guids is required'),
            ({'resultGuids': NEW_GUID, 'status': 'relevant'}, 'A list of result guids is required'),
            ({'resultGuids': [1], 'status': 'relevant'}, 'A list of result guids is required'),
            ({'resultGuids': [str(i) for i in range(501)], 'status': 'relevant'},
             'No more than 500 results can be updated at once'),
            ({'resultGuids': [NEW_GUID]}, 'A status or assignee is required'),
            ({'resultGuids': [NEW_GUID], 'comments': 'test', 'deemedIrrelevant': True}, 'A status or assignee is required'),
            ({'resultGuids': [NEW_GUID], 'status': 'closed'}, 'Invalid status: closed'),
            ({'resultGuids': [NEW_GUID], 'assignedToMe': 'test_user'}, 'Invalid assignedToMe'),
        ]:
            response = self._post_update(body)
            self.assertEqual(response.status_code, 400)
            self.assertListEqual(response.json()['errors'], [error])

        # No project access
        response = self._post_update({'resultGuids': [NEW_GUID], 'status': 'relevant'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).status, 'new')

        # Permission is checked for the project of every result, and nothing is updated if any check fails
        self.login_collaborator()
        for no_access_guid in [self.non_analyst_guid, self.demo_guid, 'MR_does_not_exist']:
            response = self._post_update({'resultGuids': [NEW_GUID, no_access_guid], 'status': 'relevant'})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['error'], 'Permission Denied')
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).status, 'new')
        self.assertEqual(MatchmakerResult.objects.get(guid=self.non_analyst_guid).status, 'reviewing')

        self.reset_logs()
        response = self._post_update({
            'resultGuids': [NEW_GUID, NOT_RELEVANT_GUID, self.removed_guid], 'status': 'relevant',
            'comments': 'ignored', 'resultData': {}, 'weContacted': True,
        })
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'mmeResultsByGuid': {
            guid: {'status': 'relevant', 'assignedTo': None, 'assignedToMe': False}
            for guid in [NEW_GUID, NOT_RELEVANT_GUID, self.removed_guid]
        }})
        result = MatchmakerResult.objects.get(guid=NEW_GUID)
        self.assertEqual(result.status, 'relevant')
        self.assertTrue(result.flag_for_analysis)
        self.assertFalse(result.we_contacted)
        self.assertEqual(result.comments, '')
        self.assertEqual(result.last_modified_by, self.collaborator_user)
        self.assertIn('patient', result.result_data)
        result = MatchmakerResult.objects.get(guid=NOT_RELEVANT_GUID)
        self.assertEqual(result.status, 'relevant')
        self.assertFalse(result.deemed_irrelevant)
        self.assertTrue(result.flag_for_analysis)
        self.assertTrue(result.host_contacted)
        self.assertEqual(MatchmakerResult.objects.get(guid=RESPONDED_GUID).status, 'responded')
        logs = [json.loads(log) for log in self._log_stream.getvalue().split('\n') if log]
        self.assertCountEqual([log['dbUpdate'] for log in logs if 'dbUpdate' in log], [{
            'dbEntity': 'MatchmakerResult', 'entityId': guid, 'updateType': 'update',
            'updateFields': ['last_modified_by', 'status'],
        } for guid in [NEW_GUID, NOT_RELEVANT_GUID, self.removed_guid]])
        self.assertSetEqual(
            {log['user'] for log in logs if 'dbUpdate' in log}, {'test_user_collaborator@test.com'})

        response = self._post_update({'resultGuids': [NEW_GUID, RESPONDED_GUID], 'assignedToMe': True})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'mmeResultsByGuid': {
            NEW_GUID: {'status': 'relevant', 'assignedTo': 'Test Collaborator User', 'assignedToMe': True},
            RESPONDED_GUID: {'status': 'responded', 'assignedTo': 'Test Collaborator User', 'assignedToMe': True},
        }})
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).assigned_to, self.collaborator_user)
        self.assertEqual(MatchmakerResult.objects.get(guid=RESPONDED_GUID).assigned_to, self.collaborator_user)
        response_json = self._get_results(
            reverse(matchmaker_inbox), expected_guids=[RESPONDED_GUID, NEW_GUID], status='all', assignedToMe='true')
        self.assertEqual(response_json['results'][0]['assignedTo'], 'Test Collaborator User')

        # Analysts can not update the non-analyst project. Another user's update is not attributed when nothing changes
        self.login_analyst_user()
        response = self._post_update({'resultGuids': [self.non_analyst_guid], 'status': 'not_relevant'})
        self.assertEqual(response.status_code, 403)
        response = self._post_update({
            'resultGuids': [NEW_GUID, RESPONDED_GUID], 'status': 'relevant', 'assignedToMe': False})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'mmeResultsByGuid': {
            NEW_GUID: {'status': 'relevant', 'assignedTo': None, 'assignedToMe': False},
            RESPONDED_GUID: {'status': 'relevant', 'assignedTo': None, 'assignedToMe': False},
        }})
        result = MatchmakerResult.objects.get(guid=RESPONDED_GUID)
        self.assertIsNone(result.assigned_to)
        self.assertTrue(result.we_contacted)
        self.assertTrue(result.flag_for_analysis)
        response = self._post_update({'resultGuids': [NEW_GUID], 'status': 'relevant', 'assignedToMe': False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).last_modified_by, self.analyst_user)
        self.login_manager()
        response = self._post_update({'resultGuids': [NEW_GUID], 'status': 'relevant', 'assignedToMe': False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).last_modified_by, self.analyst_user)

        # Managers and data managers can update results in any project they can view
        response = self._post_update({
            'resultGuids': [self.non_analyst_guid, self.overlap_guid], 'status': 'not_relevant', 'assignedToMe': False})
        self.assertEqual(response.status_code, 200)
        result = MatchmakerResult.objects.get(guid=self.non_analyst_guid)
        self.assertEqual(result.status, 'not_relevant')
        self.assertTrue(result.deemed_irrelevant)
        self.assertIsNone(result.assigned_to)
        self.assertTrue(MatchmakerResult.objects.get(guid=self.overlap_guid).deemed_irrelevant)

        self.login_data_manager_user()
        response = self._post_update({'resultGuids': [self.non_analyst_guid, self.demo_guid], 'status': 'responded'})
        self.assertEqual(response.status_code, 403)
        response = self._post_update({'resultGuids': [self.non_analyst_guid, self.overlap_guid], 'status': 'responded'})
        self.assertEqual(response.status_code, 200)
        result = MatchmakerResult.objects.get(guid=self.non_analyst_guid)
        self.assertEqual(result.status, 'responded')
        self.assertTrue(result.we_contacted)
        self.assertFalse(result.deemed_irrelevant)


class AnvilMatchmakerInboxAPITest(MatchmakerInboxTestMixin, AnvilAuthenticationTestCase):
    fixtures = ['users', 'social_auth', '1kg_project', 'reference_data']

    def test_matchmaker_inbox_analysis_group_access(self):
        self._create_results()
        url = reverse(matchmaker_inbox)
        self.check_require_login(url)

        # Access to an analysis group workspace gives access to the results for its families only
        family_guids = [self.overlap_guid, RESPONDED_GUID, NEW_GUID, NOT_RELEVANT_GUID]
        response_json = self._get_results(url, expected_guids=family_guids, status='all', includeRemoved='true')
        self.assertSetEqual({r['submission']['familyGuid'] for r in response_json['results']}, {'F000001_1'})

        response = self._post_update({'resultGuids': [NEW_GUID, self.removed_guid], 'status': 'reviewing'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).status, 'new')
        response = self._post_update({'resultGuids': [NEW_GUID], 'status': 'reviewing'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(MatchmakerResult.objects.get(guid=NEW_GUID).status, 'reviewing')

        self.login_manager()
        self._get_results(
            url, expected_guids=[self.non_analyst_guid, self.removed_guid, *family_guids], status='all',
            includeRemoved='true')
