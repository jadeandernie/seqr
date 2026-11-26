import mock
import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from clinvar_submission.models import ClinvarSubmission
from seqr.models import SavedVariant

API_KEY = 'k' * 64
PRODUCTION_URL = 'https://submit.ncbi.nlm.nih.gov/api/v1/submissions/'
TEST_URL = 'https://submit.ncbi.nlm.nih.gov/apitest/v1/submissions/'
SUMMARY_URL = 'https://submit.ncbi.nlm.nih.gov/api/2.0/files/abc/summary.json'


def _status_response(status, with_file=True):
    return {'actions': [{'id': 'SUB1-1', 'status': status, 'targetDb': 'clinvar', 'responses': [{
        'status': status, 'files': [{'url': SUMMARY_URL}] if with_file else [],
        'message': {'errorCode': None, 'severity': 'info', 'text': f'Status is {status}'},
    }]}]}


@override_settings(CLINVAR_SUBMISSION_MODE='live', CLINVAR_API_KEY=API_KEY)
@mock.patch('clinvar_submission.clinvar_client.logger')
@mock.patch('clinvar_submission.management.commands.check_clinvar_submissions.logger')
class CheckClinvarSubmissionsTest(TestCase):
    fixtures = ['users', '1kg_project']

    @classmethod
    def setUpTestData(cls):
        saved_variants = SavedVariant.objects.filter(dataset_type='SNV_INDEL').order_by('id')
        cls.processed, cls.failed, cls.pending, cls.no_accession, cls.draft = [
            ClinvarSubmission.objects.create(saved_variant=saved_variant, **kwargs) for saved_variant, kwargs in zip(
                saved_variants, [
                    {'status': 'submitted', 'ncbi_submission_id': 'SUB1', 'submission_mode': 'live',
                     'response': {'dryRun': {'ok': True}}},
                    {'status': 'submitted', 'ncbi_submission_id': 'SUB2', 'submission_mode': 'test'},
                    {'status': 'submitted', 'ncbi_submission_id': 'SUB3', 'submission_mode': 'live'},
                    {'status': 'submitted', 'ncbi_submission_id': 'SUB4', 'submission_mode': 'live'},
                    {'status': 'draft'},
                ])
        ]

    @responses.activate
    def test_command(self, mock_logger, mock_client_logger):
        responses.add(responses.GET, f'{PRODUCTION_URL}SUB1/actions/', json=_status_response('processed'))
        responses.add(responses.GET, SUMMARY_URL, json={'batchProcessingStatus': 'Success', 'submissions': [
            {'identifiers': {'clinvarAccession': 'SCV000123456'}, 'processingStatus': 'Success'},
        ]})
        responses.add(responses.GET, f'{TEST_URL}SUB2/actions/', json=_status_response('error', with_file=False))
        responses.add(responses.GET, f'{PRODUCTION_URL}SUB3/actions/', json=_status_response('processing', with_file=False))
        responses.add(responses.GET, f'{PRODUCTION_URL}SUB4/actions/', json=_status_response('processed', with_file=False))

        call_command('check_clinvar_submissions')

        self.assertListEqual([call.request.url for call in responses.calls], [
            f'{PRODUCTION_URL}SUB1/actions/', SUMMARY_URL, f'{TEST_URL}SUB2/actions/', f'{PRODUCTION_URL}SUB3/actions/',
            f'{PRODUCTION_URL}SUB4/actions/',
        ])
        mock_logger.info.assert_called_with('Checked 4 ClinVar submissions: 1 processed, 1 failed, 2 pending', None)

        self.processed.refresh_from_db()
        self.assertEqual(self.processed.status, 'processed')
        self.assertEqual(self.processed.scv_accession, 'SCV000123456')
        self.assertDictEqual(self.processed.response, {'dryRun': {'ok': True}, 'status': {
            'ok': True, 'status': 'processed', 'accessions': ['SCV000123456'], 'errors': [],
            'batchProcessingStatus': 'Success', 'message': 'Status is processed',
        }})

        self.failed.refresh_from_db()
        self.assertEqual(self.failed.status, 'error')
        self.assertIsNone(self.failed.scv_accession)
        self.assertEqual(self.failed.response['status']['message'], 'Status is error')

        for submission, ncbi_status in [(self.pending, 'processing'), (self.no_accession, 'processed')]:
            submission.refresh_from_db()
            self.assertEqual(submission.status, 'submitted')
            self.assertIsNone(submission.scv_accession)
            self.assertEqual(submission.response['status']['status'], ncbi_status)

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, 'draft')
        self.assertIsNone(self.draft.response)

        for mock_log in [mock_logger, mock_client_logger]:
            self.assertNotIn(API_KEY, str(mock_log.mock_calls))

    @responses.activate
    def test_http_error_leaves_submission_pending(self, mock_logger, mock_client_logger):
        ClinvarSubmission.objects.exclude(id=self.processed.id).delete()
        responses.add(responses.GET, f'{PRODUCTION_URL}SUB1/actions/', status=500)
        call_command('check_clinvar_submissions')
        mock_logger.info.assert_called_with('Checked 1 ClinVar submissions: 0 processed, 0 failed, 1 pending', None)
        self.processed.refresh_from_db()
        self.assertEqual(self.processed.status, 'submitted')
        self.assertDictEqual(self.processed.response['status'], {
            'ok': False, 'httpStatus': 500, 'message': 'ClinVar returned 500: Internal Server Error',
        })

    @responses.activate
    def test_not_configured(self, mock_logger, mock_client_logger):
        for settings_update, error in [
            ({'CLINVAR_SUBMISSION_MODE': 'disabled'}, 'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")'),
            ({'CLINVAR_API_KEY': None}, 'CLINVAR_SUBMISSION_MODE is "live" but CLINVAR_API_KEY is not configured: refusing to operate'),
            ({'CLINVAR_SUBMISSION_MODE': 'dry_run', 'CLINVAR_API_KEY': None}, 'CLINVAR_API_KEY is not configured'),
        ]:
            with override_settings(**settings_update):
                with self.assertRaises(CommandError) as cm:
                    call_command('check_clinvar_submissions')
            self.assertEqual(str(cm.exception), error)
        self.assertEqual(len(responses.calls), 0)
        mock_logger.info.assert_not_called()
