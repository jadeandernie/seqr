import json

import mock
import requests
import responses
from django.test import SimpleTestCase, override_settings

from clinvar_submission.clinvar_client import send_submission, get_submission_status, ClinvarConfigError

API_KEY = 'aB3' * 21 + 'z'
PRODUCTION_URL = 'https://submit.ncbi.nlm.nih.gov/api/v1/submissions/'
TEST_URL = 'https://submit.ncbi.nlm.nih.gov/apitest/v1/submissions/'
CONTENT = {'clinvarDeletion': {'accessionSet': [{'accession': 'SCV000123456'}]}}
EXPECTED_BODY = {'actions': [{'type': 'AddData', 'targetDb': 'clinvar', 'data': {'content': CONTENT}}]}
SUMMARY_URL = 'https://submit.ncbi.nlm.nih.gov/api/2.0/files/abc/sub123-summary-report.json/?format=attachment'
STATUS_RESPONSE = {'actions': [{
    'id': 'SUB123-1',
    'responses': [{
        'status': 'processed',
        'message': {'errorCode': None, 'severity': 'info', 'text': 'Your ClinVar submission processing status is "Success".'},
        'files': [{'url': SUMMARY_URL}, {'url': 'https://example.com/elsewhere.json'}],
        'objects': [],
    }],
    'status': 'processed',
    'targetDb': 'clinvar',
    'updated': '2026-11-20T10:00:00.000Z',
}]}
SUMMARY_RESPONSE = {
    'batchProcessingStatus': 'Success', 'batchReleaseStatus': 'Not released', 'totalCount': 1, 'totalErrors': 0,
    'totalSuccess': 1, 'totalPublic': 0, 'submissionName': 'SUB123', 'submissionDate': '2026-11-20',
    'submissions': [{
        'identifiers': {'localKey': 'CS0000001_clinvar', 'clinvarLocalKey': 'abc', 'clinvarAccession': 'SCV000123456'},
        'processingStatus': 'Success',
    }],
}


@override_settings(CLINVAR_SUBMISSION_MODE='dry_run', CLINVAR_API_KEY=API_KEY)
class ClinvarClientTest(SimpleTestCase):

    def setUp(self):
        patcher = mock.patch('clinvar_submission.clinvar_client.logger')
        self.mock_logger = patcher.start()
        self.addCleanup(patcher.stop)
        self.user = mock.Mock()

    def _assert_key_not_exposed(self, *results):
        logged = json.dumps([
            [str(arg) for arg in call.args] + [str(v) for v in call.kwargs.values()]
            for mock_log in [self.mock_logger.info, self.mock_logger.warning, self.mock_logger.error, self.mock_logger.debug]
            for call in mock_log.call_args_list
        ])
        self.assertNotIn(API_KEY, logged)
        self.assertNotIn(API_KEY, json.dumps(results))

    def _assert_request(self, call, url, method='POST', body=EXPECTED_BODY):
        self.assertEqual(call.request.url, url)
        self.assertEqual(call.request.method, method)
        self.assertEqual(call.request.headers['SP-API-KEY'], API_KEY)
        if body:
            self.assertEqual(call.request.headers['Content-Type'], 'application/json')
            self.assertDictEqual(json.loads(call.request.body), body)

    @responses.activate
    def test_dry_run_success(self):
        responses.add(responses.POST, PRODUCTION_URL, status=204)
        result = send_submission(CONTENT, self.user)
        self.assertDictEqual(result, {
            'ok': True, 'dryRun': True, 'sentToNcbi': True, 'httpStatus': 204,
            'message': 'NCBI dry run passed: the record matches the ClinVar schema. Nothing was submitted',
        })
        self.assertEqual(len(responses.calls), 1)
        self._assert_request(responses.calls[0], f'{PRODUCTION_URL}?dry-run=true')
        self.mock_logger.info.assert_called_with(f'ClinVar POST {PRODUCTION_URL}?dry-run=true returned 204', self.user)
        self._assert_key_not_exposed(result)

        # A dry run is always a dry run, whatever the mode
        for mode, url in [('test', TEST_URL), ('live', PRODUCTION_URL)]:
            responses.calls.reset()
            responses.add(responses.POST, url, status=204)
            with override_settings(CLINVAR_SUBMISSION_MODE=mode):
                self.assertTrue(send_submission(CONTENT, self.user, dry_run=True)['ok'])
            self._assert_request(responses.calls[0], f'{url}?dry-run=true')

    @responses.activate
    def test_dry_run_unexpected_success_status(self):
        responses.add(responses.POST, PRODUCTION_URL, status=201, json={'id': 'SUB999'})
        result = send_submission(CONTENT, self.user)
        self.assertDictEqual(result, {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'httpStatus': 201,
            'message': 'ClinVar returned 201: Created',
        })

    @responses.activate
    def test_no_real_submission_unless_mode_allows(self):
        for mode in ['disabled', 'dry_run', 'unknown']:
            with override_settings(CLINVAR_SUBMISSION_MODE=mode):
                with self.assertRaises(ClinvarConfigError) as cm:
                    send_submission(CONTENT, self.user, dry_run=False)
            self.assertIn('does not allow sending to ClinVar', str(cm.exception))
        self.assertEqual(len(responses.calls), 0)

    @responses.activate
    def test_no_api_key(self):
        with override_settings(CLINVAR_API_KEY=None):
            result = send_submission(CONTENT, self.user)
            self.assertDictEqual(result, {
                'ok': True, 'dryRun': True, 'sentToNcbi': False,
                'message': 'Validated by seqr only. CLINVAR_API_KEY is not configured, so the NCBI dry run was not performed',
            })
            for mode in ['test', 'live']:
                for dry_run in [True, False]:
                    with override_settings(CLINVAR_SUBMISSION_MODE=mode):
                        with self.assertRaises(ClinvarConfigError) as cm:
                            send_submission(CONTENT, self.user, dry_run=dry_run)
                    self.assertEqual(
                        str(cm.exception), f'CLINVAR_API_KEY is not configured: refusing to operate in {mode} mode')
            with self.assertRaises(ClinvarConfigError) as cm:
                get_submission_status('SUB123', 'live', self.user)
            self.assertEqual(str(cm.exception), 'CLINVAR_API_KEY is not configured')
        self.assertEqual(len(responses.calls), 0)

    @responses.activate
    def test_real_submission(self):
        responses.add(responses.POST, TEST_URL, status=201, json={'id': 'SUB123'})
        with override_settings(CLINVAR_SUBMISSION_MODE='test'):
            result = send_submission(CONTENT, self.user, dry_run=False)
        self.assertDictEqual(result, {
            'ok': True, 'dryRun': False, 'sentToNcbi': True, 'httpStatus': 201, 'submissionId': 'SUB123',
            'message': 'ClinVar created submission SUB123',
        })
        self._assert_request(responses.calls[0], TEST_URL)

        responses.add(responses.POST, PRODUCTION_URL, status=201, json={'id': 'SUB456'})
        with override_settings(CLINVAR_SUBMISSION_MODE='live'):
            result = send_submission(CONTENT, self.user, dry_run=False)
        self.assertEqual(result['submissionId'], 'SUB456')
        self._assert_request(responses.calls[1], PRODUCTION_URL)
        self._assert_key_not_exposed(result)

        responses.replace(responses.POST, PRODUCTION_URL, status=201, body='not json')
        with override_settings(CLINVAR_SUBMISSION_MODE='live'):
            result = send_submission(CONTENT, self.user, dry_run=False)
        self.assertDictEqual(result, {
            'ok': False, 'dryRun': False, 'sentToNcbi': True, 'httpStatus': 201, 'message': 'ClinVar returned 201: Created',
        })

    @responses.activate
    def test_ncbi_validation_errors(self):
        responses.add(responses.POST, PRODUCTION_URL, status=400, json={
            'message': f'Submission is incorrect for key {API_KEY}',
            'errors': [{'userMessage': f'{API_KEY} is not of type integer'}, 'Missing recordStatus'],
        })
        result = send_submission(CONTENT, self.user)
        self.assertDictEqual(result, {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'httpStatus': 400,
            'message': 'ClinVar returned 400: Submission is incorrect for key [redacted]',
            'errors': ["{'userMessage': '[redacted] is not of type integer'}", 'Missing recordStatus'],
        })
        self._assert_key_not_exposed(result)

        responses.replace(responses.POST, PRODUCTION_URL, status=400, json={'message': 'Bad', 'errors': 'One error'})
        self.assertListEqual(send_submission(CONTENT, self.user)['errors'], ['One error'])

    @responses.activate
    def test_http_errors(self):
        responses.add(responses.POST, PRODUCTION_URL, status=401, json={'message': 'No valid API key provided'})
        self.assertDictEqual(send_submission(CONTENT, self.user), {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'httpStatus': 401,
            'message': 'ClinVar returned 401: No valid API key provided',
        })
        responses.replace(responses.POST, PRODUCTION_URL, status=500, body='<html>Server Error</html>')
        self.assertEqual(send_submission(CONTENT, self.user)['message'], 'ClinVar returned 500: Internal Server Error')
        responses.replace(responses.POST, PRODUCTION_URL, status=429, json=['Too many requests'])
        self.assertEqual(send_submission(CONTENT, self.user)['message'], 'ClinVar returned 429: Too Many Requests')

        responses.replace(
            responses.POST, PRODUCTION_URL, body=requests.exceptions.ConnectionError(f'Failed with header {API_KEY}'))
        result = send_submission(CONTENT, self.user)
        self.assertDictEqual(result, {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'message': 'ClinVar request failed: ConnectionError',
        })
        self.mock_logger.warning.assert_called_with(
            f'ClinVar POST {PRODUCTION_URL}?dry-run=true: ClinVar request failed: ConnectionError', self.user)
        self._assert_key_not_exposed(result)

    @responses.activate
    @mock.patch('clinvar_submission.clinvar_client.requests.request', wraps=requests.request)
    def test_timeout(self, mock_request):
        responses.add(responses.POST, PRODUCTION_URL, body=requests.exceptions.ReadTimeout())
        result = send_submission(CONTENT, self.user)
        self.assertDictEqual(result, {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'message': 'ClinVar request timed out after 30 seconds',
        })
        mock_request.assert_called_with(
            'POST', f'{PRODUCTION_URL}?dry-run=true', headers={'SP-API-KEY': API_KEY}, timeout=30, json=EXPECTED_BODY)
        self.mock_logger.warning.assert_called_with(
            f'ClinVar POST {PRODUCTION_URL}?dry-run=true: ClinVar request timed out after 30 seconds', self.user)
        self._assert_key_not_exposed(result)

        responses.add(responses.GET, f'{TEST_URL}SUB123/actions/', body=requests.exceptions.ConnectTimeout())
        self.assertDictEqual(get_submission_status('SUB123', 'test', self.user), {
            'ok': False, 'message': 'ClinVar request timed out after 30 seconds',
        })
        mock_request.assert_called_with(
            'GET', f'{TEST_URL}SUB123/actions/', headers={'SP-API-KEY': API_KEY}, timeout=30)

    @responses.activate
    def test_get_submission_status(self):
        status_url = f'{PRODUCTION_URL}SUB123/actions/'
        responses.add(responses.GET, status_url, json=STATUS_RESPONSE)
        responses.add(responses.GET, SUMMARY_URL, json=SUMMARY_RESPONSE)
        result = get_submission_status('SUB123', 'live', self.user)
        self.assertDictEqual(result, {
            'ok': True, 'status': 'processed', 'accessions': ['SCV000123456'], 'errors': [],
            'batchProcessingStatus': 'Success', 'message': 'Your ClinVar submission processing status is "Success".',
        })
        self.assertEqual(len(responses.calls), 2)
        self._assert_request(responses.calls[0], status_url, method='GET', body=None)
        self._assert_request(responses.calls[1], SUMMARY_URL, method='GET', body=None)
        self._assert_key_not_exposed(result)

        test_status_url = f'{TEST_URL}SUB123/actions/'
        responses.add(responses.GET, test_status_url, json={'actions': [{'status': 'submitted', 'responses': []}]})
        self.assertDictEqual(get_submission_status('SUB123', 'test', self.user), {
            'ok': True, 'status': 'submitted', 'accessions': [], 'errors': [], 'batchProcessingStatus': None,
        })
        responses.replace(responses.GET, test_status_url, json={})
        self.assertIsNone(get_submission_status('SUB123', 'test', self.user)['status'])

    @responses.activate
    def test_get_submission_status_errors(self):
        status_url = f'{PRODUCTION_URL}SUB123/actions/'
        responses.add(responses.GET, status_url, status=404, json={'message': 'Submission not found'})
        self.assertDictEqual(get_submission_status('SUB123', 'live', self.user), {
            'ok': False, 'httpStatus': 404, 'message': 'ClinVar returned 404: Submission not found',
        })

        error_status = {'actions': [{'status': 'error', 'responses': [{
            'status': 'error', 'files': [{'url': SUMMARY_URL}, {}],
            'message': {'errorCode': '2', 'severity': 'error', 'text': 'Your ClinVar submission processing status is "Error".'},
        }]}]}
        responses.replace(responses.GET, status_url, json=error_status)
        responses.add(responses.GET, SUMMARY_URL, json={
            'batchProcessingStatus': 'Error',
            'submissions': [{
                'identifiers': {'localKey': 'CS0000001_clinvar'}, 'processingStatus': 'Error',
                'errors': [{'input': [{'value': 'x', 'field': 'hgvs'}], 'output': {'errors': [
                    {'userMessage': 'The HGVS expression is not valid'}, {},
                ]}}, {}],
            }],
            'deletions': [{'identifiers': {'clinvarAccession': 'SCV000999999'}, 'processingStatus': 'Success'}],
        })
        self.assertDictEqual(get_submission_status('SUB123', 'live', self.user), {
            'ok': True, 'status': 'error', 'accessions': ['SCV000999999'], 'errors': ['The HGVS expression is not valid'],
            'batchProcessingStatus': 'Error', 'message': 'Your ClinVar submission processing status is "Error".',
        })

        responses.replace(responses.GET, SUMMARY_URL, status=403)
        self.assertListEqual(
            get_submission_status('SUB123', 'live', self.user)['errors'], ['Unable to load the ClinVar summary file (403)'])
        responses.replace(responses.GET, SUMMARY_URL, body=requests.exceptions.ConnectionError())
        self.assertListEqual(
            get_submission_status('SUB123', 'live', self.user)['errors'], ['ClinVar request failed: ConnectionError'])
