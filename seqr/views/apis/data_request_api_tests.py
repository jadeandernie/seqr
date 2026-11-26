import json
import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls.base import reverse
from notifications.models import Notification

from seqr.models import DataRequest, Family, Individual, Project
from seqr.views.apis.data_request_api import project_data_requests, create_data_request, update_data_request_status
from seqr.views.apis.family_api import update_family_fields_handler, edit_families_handler
from seqr.views.apis.individual_api import update_individual_handler, update_individual_hpo_terms, \
    save_individuals_metadata_table_handler
from seqr.views.apis.project_api import project_notifications
from seqr.views.utils.test_utils import AuthenticationTestCase, AnvilAuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
OTHER_PROJECT_GUID = 'R0003_test'

FAMILY_GUID = 'F000002_2'
INDIVIDUAL_GUID = 'I000004_hg00731'
INDIVIDUAL_NAME = 'HG00731_a'
NO_DATA_FAMILY_GUID = 'F000003_3'
NO_DATA_INDIVIDUAL_GUID = 'I000007_na20870'
MISSING_MONDO_FAMILY_GUID = 'F000001_1'
MISSING_MONDO_INDIVIDUAL_GUID = 'I000001_na19675'
UNAFFECTED_INDIVIDUAL_GUID = 'I000005_hg00732'
OTHER_PROJECT_INDIVIDUAL_GUID = 'I000015_na20885'

COLLABORATOR_NAME = 'Test Collaborator User'
MANAGER_NAME = 'Test Manager User'

ONSET_ITEM = {'field': 'onsetAge', 'label': 'Age of onset', 'recorded': False}
BIRTH_ITEM = {'field': 'birthYear', 'label': 'Year of birth', 'recorded': False}
ANCESTRY_ITEM = {'field': 'ancestry', 'label': 'Maternal or paternal ancestry', 'recorded': False}

DATA_REQUEST_JSON = {
    'dataRequestGuid': mock.ANY,
    'individualGuid': INDIVIDUAL_GUID,
    'familyGuid': FAMILY_GUID,
    'projectGuid': PROJECT_GUID,
    'individualName': INDIVIDUAL_NAME,
    'items': [ONSET_ITEM, BIRTH_ITEM],
    'reason': None,
    'status': 'O',
    'createdDate': mock.ANY,
    'createdBy': COLLABORATOR_NAME,
    'assignedTo': None,
    'assignedToUsername': None,
    'resolvedBy': None,
    'resolvedDate': None,
    'canCancel': True,
    'canResolve': False,
}

DATA_REQUEST_VERB_PREFIX = 'Data request'


class DataRequestAPITest(object):

    def _create_request(self, individual_guid=INDIVIDUAL_GUID, fields=None, created_by=None, **kwargs):
        return DataRequest.objects.create(
            individual=Individual.objects.get(guid=individual_guid),
            requested_fields=fields or ['onsetAge', 'birthYear'],
            created_by=created_by or self.collaborator_user, **kwargs)

    def _post(self, url, body):
        return self.client.post(url, content_type='application/json', data=json.dumps(body))

    def _assert_error(self, response, error, status=400):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.json()['error'], error)

    def _notifications(self):
        return [
            (n.actor, n.recipient, n.verb)
            for n in Notification.objects.filter(verb__startswith=DATA_REQUEST_VERB_PREFIX).order_by('id')
        ]

    def test_project_data_requests(self):
        url = reverse(project_data_requests, args=[PROJECT_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {}})

        open_request = self._create_request()
        assigned_request = self._create_request(
            NO_DATA_INDIVIDUAL_GUID, fields=['features', 'mondoId'], created_by=self.manager_user,
            assigned_to=self.collaborator_user, reason='M')
        declined_request = self._create_request(
            MISSING_MONDO_INDIVIDUAL_GUID, fields=['mondoId', 'features'], status='D', resolved_by=self.manager_user)
        other_project_request = self._create_request(OTHER_PROJECT_INDIVIDUAL_GUID, fields=['onsetAge'])

        # Only open requests for the project are returned by default
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        assigned_request_json = {
            **DATA_REQUEST_JSON,
            'individualGuid': NO_DATA_INDIVIDUAL_GUID,
            'familyGuid': NO_DATA_FAMILY_GUID,
            'individualName': 'NA20870',
            'items': [
                {'field': 'features', 'label': 'Observed features (HPO terms)', 'recorded': False},
                {'field': 'mondoId', 'label': 'Family MONDO disease ID', 'recorded': False},
            ],
            'reason': 'M',
            'createdBy': MANAGER_NAME,
            'assignedTo': COLLABORATOR_NAME,
            'assignedToUsername': 'test_user_collaborator',
            'canCancel': False,
            'canResolve': True,
        }
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {
            open_request.guid: DATA_REQUEST_JSON,
            assigned_request.guid: assigned_request_json,
        }})
        self.assertTrue(open_request.guid.startswith('DR'))

        response = self.client.get(f'{url}?status=D')
        self.assertEqual(response.status_code, 200)
        declined_request_json = {
            **DATA_REQUEST_JSON,
            'individualGuid': MISSING_MONDO_INDIVIDUAL_GUID,
            'familyGuid': MISSING_MONDO_FAMILY_GUID,
            'individualName': 'NA19675_1',
            'items': [
                {'field': 'mondoId', 'label': 'Family MONDO disease ID', 'recorded': False},
                {'field': 'features', 'label': 'Observed features (HPO terms)', 'recorded': True},
            ],
            'status': 'D',
            'resolvedBy': MANAGER_NAME,
            'canCancel': False,
        }
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {declined_request.guid: declined_request_json}})

        response = self.client.get(f'{url}?status=all')
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(
            set(response.json()['dataRequestsByGuid']), {open_request.guid, assigned_request.guid, declined_request.guid})

        # Requests can be looked up by guid, but never from another project
        response = self.client.get(
            f'{url}?status=all&dataRequestGuids={declined_request.guid},{other_project_request.guid},{open_request.guid}')
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(set(response.json()['dataRequestsByGuid']), {open_request.guid, declined_request.guid})

        response = self.client.get(f'{url}?dataRequestGuids={declined_request.guid},{open_request.guid}')
        self.assertSetEqual(set(response.json()['dataRequestsByGuid']), {open_request.guid})

        self._assert_error(self.client.get(f'{url}?status=X'), 'Invalid status: X')

        # Project editors can resolve any open request but can only cancel their own
        self.login_manager()
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {
            open_request.guid: {**DATA_REQUEST_JSON, 'canCancel': False, 'canResolve': True},
            assigned_request.guid: {**assigned_request_json, 'canCancel': True},
        }})

        response = self.client.get(reverse(project_data_requests, args=[OTHER_PROJECT_GUID]))
        self.assertEqual(response.status_code, 200)
        self.assertSetEqual(set(response.json()['dataRequestsByGuid']), {other_project_request.guid})

    @mock.patch('seqr.views.utils.data_request_utils.BASE_URL', 'https://seqr.test/')
    @mock.patch('seqr.views.utils.data_request_utils.send_html_email')
    def test_create_data_request(self, mock_send_email):
        url = reverse(create_data_request, args=[PROJECT_GUID])
        body = {'individualGuid': INDIVIDUAL_GUID, 'requestedFields': ['onsetAge', 'birthYear', 'onsetAge']}
        self.check_collaborator_login(url, request_data=body)

        # Free text or any other unexpected content is rejected
        self._assert_error(
            self._post(url, {**body, 'message': 'Patient is a 4 year old boy', 'status': 'F'}),
            'Unsupported fields: message, status')

        # Individuals are only found through their own project
        for individual_guid in [OTHER_PROJECT_INDIVIDUAL_GUID, 'I_missing', None]:
            response = self._post(url, {**body, 'individualGuid': individual_guid})
            self.assertEqual(response.status_code, 404)
        response = self._post(reverse(create_data_request, args=[OTHER_PROJECT_GUID]), body)
        self.assertEqual(response.status_code, 404)

        for requested_fields in [None, [], 'onsetAge']:
            self._assert_error(
                self._post(url, {**body, 'requestedFields': requested_fields}),
                'At least one clinical data field is required')
        self._assert_error(
            self._post(url, {**body, 'requestedFields': ['onsetAge', 'notes', {'free': 'text'}]}),
            "Invalid clinical data fields: notes, {'free': 'text'}")
        self._assert_error(
            self._post(url, {**body, 'requestedFields': ['features', 'onsetAge', 'parents']}),
            'Clinical data is already recorded or is not applicable for: features, parents')
        self._assert_error(
            self._post(url, {**body, 'individualGuid': UNAFFECTED_INDIVIDUAL_GUID}),
            'Clinical data can only be requested for affected individuals')
        for reason in ['Z', 'Needed for analysis', ['A']]:
            self._assert_error(self._post(url, {**body, 'reason': reason}), f'Invalid reason: {reason}')
        for assigned_to in ['test_user_no_access', 'not_a_user', ['test_user_manager']]:
            self._assert_error(
                self._post(url, {**body, 'assignedTo': assigned_to}),
                'Data requests can only be assigned to collaborators of the project')
        self.assertEqual(DataRequest.objects.count(), 0)
        self.assertListEqual(self._notifications(), [])

        self.reset_logs()
        response = self._post(url, {**body, 'reason': 'I', 'assignedTo': 'test_user_manager'})
        self.assertEqual(response.status_code, 200)
        data_request = DataRequest.objects.get()
        expected_json = {
            **DATA_REQUEST_JSON, 'reason': 'I', 'assignedTo': MANAGER_NAME, 'assignedToUsername': 'test_user_manager',
        }
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {data_request.guid: expected_json}})
        self.assertEqual(data_request.individual.guid, INDIVIDUAL_GUID)
        self.assertListEqual(data_request.requested_fields, ['onsetAge', 'birthYear'])
        self.assertEqual(data_request.status, 'O')
        self.assertEqual(data_request.created_by, self.collaborator_user)
        self.assertEqual(data_request.assigned_to, self.manager_user)
        self.assert_json_logs(self.collaborator_user, [(f'create DataRequest {data_request.guid}', {'dbUpdate': {
            'dbEntity': 'DataRequest', 'entityId': data_request.guid, 'updateType': 'create',
            'updateFields': ['assigned_to', 'individual', 'reason', 'requested_fields'],
        }})])

        # The project is notified in the app, and only the assignee is emailed
        project = Project.objects.get(guid=PROJECT_GUID)
        self.assertListEqual(self._notifications(), [
            (project, self.manager_user, 'Data request created for individual HG00731_a: 2 items'),
        ])
        mock_send_email.assert_called_once_with(
            email_body='Dear seqr user,\n\nA request for clinical data for individual HG00731_a has been assigned to '
                       'you in seqr. <a href=https://seqr.test/project/R0001_1kg/family_page/F000002_2>View the '
                       'request in seqr</a> to see what has been requested.\n\nAll the best,\nThe seqr team',
            to=['test_user_manager@test.com'], subject='Clinical data requested in seqr',
        )

        # Requesting more data for an individual with an open request adds to that request
        mock_send_email.reset_mock()
        response = self._post(url, {'individualGuid': INDIVIDUAL_GUID, 'requestedFields': ['ancestry', 'birthYear']})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {
            data_request.guid: {**expected_json, 'items': [ONSET_ITEM, BIRTH_ITEM, ANCESTRY_ITEM]},
        }})
        data_request = DataRequest.objects.get()
        self.assertListEqual(data_request.requested_fields, ['onsetAge', 'birthYear', 'ancestry'])
        self.assertEqual(data_request.reason, 'I')
        self.assertEqual(data_request.assigned_to, self.manager_user)
        self.assertEqual(self._notifications()[1:], [
            (project, self.manager_user, 'Data request updated for individual HG00731_a: 3 items'),
        ])
        mock_send_email.assert_not_called()

        # Repeating a request changes nothing and notifies nobody
        response = self._post(url, {**body, 'reason': 'I', 'assignedTo': 'test_user_manager'})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(response.json()['dataRequestsByGuid']), [data_request.guid])
        self.assertEqual(DataRequest.objects.count(), 1)
        self.assertEqual(len(self._notifications()), 2)

        # A different user can add to the request and reassign it, the new assignee is emailed
        self.login_manager()
        mock_send_email.side_effect = Exception('Email server is down')
        response = self._post(url, {
            'individualGuid': INDIVIDUAL_GUID, 'requestedFields': ['onsetAge'], 'assignedTo': 'test_user_collaborator',
        })
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {data_request.guid: {
            **expected_json, 'items': [ONSET_ITEM, BIRTH_ITEM, ANCESTRY_ITEM], 'assignedTo': COLLABORATOR_NAME,
            'assignedToUsername': 'test_user_collaborator', 'canCancel': False, 'canResolve': True,
        }}})
        self.assertEqual(DataRequest.objects.get().created_by, self.collaborator_user)
        self.assertEqual(self._notifications()[2:], [
            (project, self.collaborator_user, 'Data request updated for individual HG00731_a: 3 items'),
        ])
        mock_send_email.assert_called_once()
        self.assertListEqual(mock_send_email.call_args.kwargs['to'], ['test_user_collaborator@test.com'])
        self.assertIn(
            f'Error sending data request email for {data_request.guid}: Email server is down',
            self._log_stream.getvalue())

        # A resolved request does not block a new request, and no email is sent without an assignee
        mock_send_email.reset_mock(side_effect=True)
        DataRequest.objects.update(status='C')
        self.reset_logs()
        response = self._post(url, {'individualGuid': INDIVIDUAL_GUID, 'requestedFields': ['disorders']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(DataRequest.objects.count(), 2)
        new_request = DataRequest.objects.get(status='O')
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {new_request.guid: {
            **DATA_REQUEST_JSON, 'createdBy': MANAGER_NAME, 'canResolve': True,
            'items': [{'field': 'disorders', 'label': 'Known disorders (OMIM)', 'recorded': False}],
        }}})
        # Subscribers other than the requester are notified, and the project always receives the notification
        self.assertEqual(self._notifications()[3:], [
            (project, self.manager_user, 'Data request created for individual HG00731_a: 1 item'),
        ])
        mock_send_email.assert_not_called()

        # Requests are not assigned to and do not email the requester
        DataRequest.objects.update(status='C')
        project.subscribers.user_set.add(self.collaborator_user)
        response = self._post(url, {
            'individualGuid': INDIVIDUAL_GUID, 'requestedFields': ['disorders'], 'assignedTo': 'test_user_manager',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._notifications()[4:], [
            (project, self.collaborator_user, 'Data request created for individual HG00731_a: 1 item'),
        ])
        mock_send_email.assert_not_called()

        # The notifications are shown with the other notifications of the project and only of that project
        self.login_collaborator()
        response = self.client.get(reverse(project_notifications, args=[PROJECT_GUID, 'unread']))
        self.assertEqual(response.status_code, 200)
        verbs = [notification['verb'] for notification in response.json()['unreadNotifications']]
        self.assertListEqual([verb for verb in verbs if verb.startswith(DATA_REQUEST_VERB_PREFIX)], [
            'Data request created for individual HG00731_a: 1 item',
            'Data request updated for individual HG00731_a: 3 items',
        ])
        response = self.client.get(reverse(project_notifications, args=[OTHER_PROJECT_GUID, 'unread']))
        self.assertEqual(response.status_code, 200)
        verbs = [notification['verb'] for notification in response.json()['unreadNotifications']]
        self.assertListEqual([verb for verb in verbs if verb.startswith(DATA_REQUEST_VERB_PREFIX)], [])

    def test_update_data_request_status(self):
        data_request = self._create_request()
        url = reverse(update_data_request_status, args=[PROJECT_GUID, data_request.guid])
        self.check_collaborator_login(url, request_data={'status': 'C'})

        # Requests are only found through their own project
        other_project_request = self._create_request(OTHER_PROJECT_INDIVIDUAL_GUID, fields=['onsetAge'])
        for args in [
            [PROJECT_GUID, other_project_request.guid], [OTHER_PROJECT_GUID, data_request.guid], [PROJECT_GUID, 'DR_x'],
        ]:
            response = self._post(reverse(update_data_request_status, args=args), {'status': 'C'})
            self.assertEqual(response.status_code, 404)

        self._assert_error(
            self._post(url, {'status': 'C', 'note': 'free text', 'requestedFields': []}),
            'Unsupported fields: note, requestedFields')
        for status in ['O', 'X', None, ['C']]:
            self._assert_error(self._post(url, {'status': status}), f'Invalid status: {status}')

        # A collaborator who is not the assignee can not decline or fulfil a request
        for status in ['D', 'F']:
            self._assert_error(self._post(url, {'status': status}), 'Permission Denied', status=403)
        self.assertEqual(DataRequest.objects.get(guid=data_request.guid).status, 'O')

        # The creator can cancel the request
        self.reset_logs()
        response = self._post(url, {'status': 'C'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {data_request.guid: {
            **DATA_REQUEST_JSON, 'status': 'C', 'resolvedBy': COLLABORATOR_NAME, 'resolvedDate': mock.ANY,
            'canCancel': False,
        }}})
        data_request = DataRequest.objects.get(guid=data_request.guid)
        self.assertEqual(data_request.status, 'C')
        self.assertEqual(data_request.resolved_by, self.collaborator_user)
        self.assertIsNotNone(data_request.resolved_date)
        self.assertEqual(data_request.status_last_modified_by, self.collaborator_user)
        self.assertIsNotNone(data_request.status_last_modified_date)
        self.assert_json_logs(self.collaborator_user, [(f'update DataRequest {data_request.guid}', {'dbUpdate': {
            'dbEntity': 'DataRequest', 'entityId': data_request.guid, 'updateType': 'update',
            'updateFields': [
                'resolved_by', 'resolved_date', 'status', 'status_last_modified_by', 'status_last_modified_date'],
        }})])
        self.assertListEqual(self._notifications(), [])

        self._assert_error(self._post(url, {'status': 'C'}), 'Only open data requests can be updated')

        # Managers can decline or fulfil requests but can not cancel the requests of other users
        data_request = self._create_request()
        url = reverse(update_data_request_status, args=[PROJECT_GUID, data_request.guid])
        self.login_manager()
        self._assert_error(self._post(url, {'status': 'C'}), 'Permission Denied', status=403)
        response = self._post(url, {'status': 'D'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'dataRequestsByGuid': {data_request.guid: {
            **DATA_REQUEST_JSON, 'status': 'D', 'resolvedBy': MANAGER_NAME, 'resolvedDate': mock.ANY,
            'canCancel': False,
        }}})
        project = Project.objects.get(guid=PROJECT_GUID)
        self.assertListEqual(self._notifications(), [
            (project, self.collaborator_user, 'Data request for individual HG00731_a declined'),
        ])
        self._assert_error(self._post(url, {'status': 'F'}), 'Only open data requests can be updated')

        # The assignee can fulfil a request without edit permission, and can not cancel it
        data_request = self._create_request(created_by=self.manager_user, assigned_to=self.collaborator_user)
        url = reverse(update_data_request_status, args=[PROJECT_GUID, data_request.guid])
        self.login_collaborator()
        self._assert_error(self._post(url, {'status': 'C'}), 'Permission Denied', status=403)
        response = self._post(url, {'status': 'F'})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()['dataRequestsByGuid'][data_request.guid]
        self.assertEqual(response_json['status'], 'F')
        self.assertEqual(response_json['resolvedBy'], COLLABORATOR_NAME)
        self.assertListEqual(self._notifications()[1:], [
            (project, self.manager_user, 'Data request for individual HG00731_a fulfilled'),
        ])

        # An assignee who no longer has access to the project can not update the request
        data_request = self._create_request(created_by=self.manager_user, assigned_to=self.no_access_user)
        url = reverse(update_data_request_status, args=[PROJECT_GUID, data_request.guid])
        self.login_base_user()
        self._assert_error(self._post(url, {'status': 'F'}), 'Permission Denied', status=403)

        # Users are not notified about their own requests
        self.login_manager()
        response = self._post(url, {'status': 'F'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self._notifications()), 2)

    def _assert_data_request_queries(self, captured_queries, expected_tables):
        # The only queries that read data requests are the queries that already loaded the edited models
        data_request_queries = [q['sql'] for q in captured_queries if 'seqr_datarequest' in q['sql']]
        self.assertListEqual(
            [sql.split('"')[1] for sql in data_request_queries], expected_tables, msg=data_request_queries)
        for sql in data_request_queries:
            self.assertTrue(sql.startswith('SELECT'), msg=sql)

    def _post_edit(self, url, body, expected_tables=None, **kwargs):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(url, content_type='application/json', data=json.dumps(body), **kwargs)
        self.assertEqual(response.status_code, 200)
        if expected_tables is not None:
            self._assert_data_request_queries(queries.captured_queries, expected_tables)
        return response.json()

    def _assert_fulfilled(self, data_request, user):
        data_request = DataRequest.objects.get(guid=data_request.guid)
        self.assertEqual(data_request.status, 'F')
        self.assertEqual(data_request.resolved_by, user)
        self.assertIsNotNone(data_request.resolved_date)
        self.assertEqual(data_request.status_last_modified_by, user)

    def _assert_open(self, data_request):
        data_request = DataRequest.objects.get(guid=data_request.guid)
        self.assertEqual(data_request.status, 'O')
        self.assertIsNone(data_request.resolved_by)
        self.assertIsNone(data_request.resolved_date)

    def test_fulfil_on_individual_update(self):
        url = reverse(update_individual_handler, args=[INDIVIDUAL_GUID])
        self.check_collaborator_login(url, request_data={})
        self.login_manager()

        # Edits to individuals with no open request do not run any additional query
        other_individual_request = self._create_request(NO_DATA_INDIVIDUAL_GUID)
        self._create_request(status='D')
        self._post_edit(url, {'consanguinity': False}, expected_tables=['seqr_individual'])

        data_request = self._create_request()
        list_url = reverse(project_data_requests, args=[PROJECT_GUID])

        # Partially satisfied requests stay open and show which items remain
        self._post_edit(url, {'onsetAge': 'J'})
        self._assert_open(data_request)
        response = self.client.get(list_url)
        self.assertListEqual(response.json()['dataRequestsByGuid'][data_request.guid]['items'], [
            {**ONSET_ITEM, 'recorded': True}, BIRTH_ITEM,
        ])
        self.assertListEqual(self._notifications(), [])

        # Edits that do not record the remaining data leave the request open
        self._post_edit(url, {'notes': 'A note', 'maternalEthnicity': ['Asian']})
        self._assert_open(data_request)

        self._post_edit(url, {'birthYear': 2000})
        self._assert_fulfilled(data_request, self.manager_user)
        self._assert_open(other_individual_request)
        self.assertListEqual(self._notifications(), [(
            Project.objects.get(guid=PROJECT_GUID), self.collaborator_user,
            'Data request for individual HG00731_a fulfilled',
        )])
        response = self.client.get(f'{list_url}?status=F')
        self.assertDictEqual(response.json()['dataRequestsByGuid'][data_request.guid], {
            **DATA_REQUEST_JSON, 'status': 'F', 'resolvedBy': MANAGER_NAME, 'resolvedDate': mock.ANY,
            'canCancel': False, 'items': [{**ONSET_ITEM, 'recorded': True}, {**BIRTH_ITEM, 'recorded': True}],
        })

        # Requests are not evaluated for individuals who are no longer affected
        unaffected_request = self._create_request(UNAFFECTED_INDIVIDUAL_GUID, fields=['features'])
        self._post_edit(reverse(update_individual_handler, args=[UNAFFECTED_INDIVIDUAL_GUID]), {'birthYear': 1970})
        self._assert_open(unaffected_request)
        response = self.client.get(list_url)
        self.assertListEqual(response.json()['dataRequestsByGuid'][unaffected_request.guid]['items'], [
            {'field': 'features', 'label': 'Observed features (HPO terms)', 'recorded': False},
        ])

    @mock.patch('seqr.views.apis.individual_api.IndividualMetadataDict')
    def test_fulfil_on_hpo_terms_update(self, mock_metadata_dict):
        url = reverse(update_individual_hpo_terms, args=[NO_DATA_INDIVIDUAL_GUID])
        self.check_manager_login(url)

        hpo_terms = {'features': [{'id': 'HP:0002011'}]}
        self._create_request(status='C')
        self._post_edit(url, hpo_terms, expected_tables=['seqr_individual'])
        mock_metadata_dict.reload.assert_called_once()

        Individual.objects.filter(guid=NO_DATA_INDIVIDUAL_GUID).update(features=None)
        data_request = self._create_request(NO_DATA_INDIVIDUAL_GUID, fields=['features', 'absentFeatures'])
        self._post_edit(url, hpo_terms)
        self._assert_open(data_request)

        response_json = self._post_edit(url, {**hpo_terms, 'absentFeatures': [{'id': 'HP:0011675'}]})
        self.assertNotIn('openDataRequestId', response_json[NO_DATA_INDIVIDUAL_GUID])
        self._assert_fulfilled(data_request, self.manager_user)
        self.assertListEqual(self._notifications(), [(
            Project.objects.get(guid=PROJECT_GUID), self.collaborator_user,
            'Data request for individual NA20870 fulfilled',
        )])

    def test_fulfil_on_family_update(self):
        url = reverse(update_family_fields_handler, args=[NO_DATA_FAMILY_GUID])
        self.check_require_login(url)
        self.login_collaborator()

        # Families with no open request are loaded with the same query as before, and nothing else is read
        self._create_request()
        self._create_request(NO_DATA_INDIVIDUAL_GUID, fields=['codedPhenotype'], status='C')
        self._post_edit(url, {'codedPhenotype': 'myopathy', 'description': 'Updated'}, expected_tables=['seqr_family'])
        Family.objects.filter(guid=NO_DATA_FAMILY_GUID).update(coded_phenotype=None)

        data_request = self._create_request(
            NO_DATA_INDIVIDUAL_GUID, fields=['codedPhenotype', 'mondoId'], created_by=self.manager_user)

        # Fields that are not scored do not trigger a check of the open request
        self._post_edit(url, {'description': 'Updated again'}, expected_tables=['seqr_family'])

        # The annotation that flags an open request can not be overwritten by the request body
        response_json = self._post_edit(
            url, {'codedPhenotype': 'myopathy', 'hasOpenDataRequest': False, 'has_open_data_request': False})
        self.assertNotIn('hasOpenDataRequest', response_json[NO_DATA_FAMILY_GUID])
        self._assert_open(data_request)
        response = self.client.get(reverse(project_data_requests, args=[PROJECT_GUID]))
        self.assertListEqual(response.json()['dataRequestsByGuid'][data_request.guid]['items'], [
            {'field': 'codedPhenotype', 'label': 'Family phenotype description', 'recorded': True},
            {'field': 'mondoId', 'label': 'Family MONDO disease ID', 'recorded': False},
        ])

        self._post_edit(url, {'mondoId': 'MONDO:0044970'})
        self._assert_fulfilled(data_request, self.collaborator_user)
        self.assertListEqual(self._notifications(), [(
            Project.objects.get(guid=PROJECT_GUID), self.manager_user,
            'Data request for individual NA20870 fulfilled',
        )])

    def test_fulfil_on_edit_families(self):
        url = reverse(edit_families_handler, args=[PROJECT_GUID])
        self.check_manager_login(url)

        self._create_request(MISSING_MONDO_INDIVIDUAL_GUID, fields=['mondoId'], status='D')
        response_json = self._post_edit(url, {'families': [
            {'familyGuid': MISSING_MONDO_FAMILY_GUID, 'mondoId': 'MONDO:0044970'},
            {'familyGuid': NO_DATA_FAMILY_GUID, 'description': 'Updated'},
        ]}, expected_tables=['seqr_individual'])
        self.assertSetEqual(set(response_json), {'familiesByGuid', 'individualsByGuid'})
        self.assertNotIn('openDataRequestId', response_json['individualsByGuid'][MISSING_MONDO_INDIVIDUAL_GUID])

        Family.objects.filter(guid=MISSING_MONDO_FAMILY_GUID).update(mondo_id=None)
        data_request = self._create_request(MISSING_MONDO_INDIVIDUAL_GUID, fields=['mondoId'])
        open_request = self._create_request(NO_DATA_INDIVIDUAL_GUID, fields=['mondoId', 'features'])
        response_json = self._post_edit(url, {'families': [
            {'familyGuid': MISSING_MONDO_FAMILY_GUID, 'mondoId': 'MONDO:0044970'},
            {'familyGuid': NO_DATA_FAMILY_GUID, 'mondoId': 'MONDO:0044976'},
        ]})
        self.assertSetEqual(set(response_json), {'familiesByGuid', 'individualsByGuid', 'dataRequestsByGuid'})
        self.assertSetEqual(set(response_json['dataRequestsByGuid']), {data_request.guid, open_request.guid})
        self.assertDictEqual(response_json['dataRequestsByGuid'][data_request.guid], {
            **DATA_REQUEST_JSON,
            'individualGuid': MISSING_MONDO_INDIVIDUAL_GUID,
            'familyGuid': MISSING_MONDO_FAMILY_GUID,
            'individualName': 'NA19675_1',
            'items': [{'field': 'mondoId', 'label': 'Family MONDO disease ID', 'recorded': True}],
            'status': 'F',
            'resolvedBy': MANAGER_NAME,
            'resolvedDate': mock.ANY,
            'canCancel': False,
        })
        open_request_json = response_json['dataRequestsByGuid'][open_request.guid]
        self.assertEqual(open_request_json['status'], 'O')
        self.assertListEqual([item['recorded'] for item in open_request_json['items']], [True, False])
        self.assertTrue(open_request_json['canResolve'])
        self.assertNotIn('openDataRequestId', response_json['individualsByGuid'][MISSING_MONDO_INDIVIDUAL_GUID])
        self._assert_fulfilled(data_request, self.manager_user)
        self._assert_open(open_request)

    @mock.patch('seqr.views.apis.individual_api.load_uploaded_file')
    def test_fulfil_on_metadata_upload(self, mock_load_uploaded_file):
        url = reverse(save_individuals_metadata_table_handler, args=[PROJECT_GUID, 'abc123'])
        self.check_manager_login(url)

        mock_load_uploaded_file.return_value = ([
            {'individual_guid': INDIVIDUAL_GUID, 'birth_year': 2000, 'onset_age': 'J'},
            {'individual_guid': NO_DATA_INDIVIDUAL_GUID, 'birth_year': 1990},
        ], None)
        self._create_request(status='C')
        response_json = self._post_edit(url, {}, expected_tables=['seqr_individual'])
        self.assertSetEqual(set(response_json), {'individualsByGuid'})
        self.assertNotIn('openDataRequestId', response_json['individualsByGuid'][INDIVIDUAL_GUID])

        Individual.objects.filter(guid__in=[INDIVIDUAL_GUID, NO_DATA_INDIVIDUAL_GUID]).update(birth_year=None)
        data_request = self._create_request()
        open_request = self._create_request(NO_DATA_INDIVIDUAL_GUID)
        response_json = self._post_edit(url, {})
        self.assertSetEqual(set(response_json), {'individualsByGuid', 'dataRequestsByGuid'})
        self.assertDictEqual(
            {guid: request['status'] for guid, request in response_json['dataRequestsByGuid'].items()},
            {data_request.guid: 'F', open_request.guid: 'O'})
        self.assertListEqual(
            [item['recorded'] for item in response_json['dataRequestsByGuid'][open_request.guid]['items']],
            [False, True])
        self._assert_fulfilled(data_request, self.manager_user)
        self._assert_open(open_request)
        self.assertListEqual(self._notifications(), [(
            Project.objects.get(guid=PROJECT_GUID), self.collaborator_user,
            'Data request for individual HG00731_a fulfilled',
        )])


class LocalDataRequestAPITest(AuthenticationTestCase, DataRequestAPITest):
    fixtures = ['users', '1kg_project', 'reference_data']


class AnvilDataRequestAPITest(AnvilAuthenticationTestCase, DataRequestAPITest):
    fixtures = ['users', 'social_auth', '1kg_project', 'reference_data']
