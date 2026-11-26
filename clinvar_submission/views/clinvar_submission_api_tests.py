import json

import mock
import responses
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.urls.base import reverse

from clinvar_submission.models import ClinvarSubmission
from clinvar_submission.views.clinvar_submission_api import clinvar_submission_draft, \
    request_clinvar_submission_review, approve_clinvar_submission, submit_clinvar_submission, \
    withdraw_clinvar_submission, project_clinvar_submissions, all_clinvar_submissions
from seqr.models import SavedVariant, Family
from seqr.views.apis.saved_variant_api import update_variant_tags_handler
from seqr.views.utils.test_utils import AuthenticationTestMixin

PROJECT_GUID = 'R0001_1kg'
VARIANT_GUID = 'SV0000002_1248367227_r0390_100'
NO_TAG_VARIANT_GUID = 'SV0059957_11562437_f019313_1'
SV_VARIANT_GUID = 'SV0000007_prefix_19107_DEL_r00'
API_KEY = 'k' * 64
PRODUCTION_URL = 'https://submit.ncbi.nlm.nih.gov/api/v1/submissions/'
TEST_URL = 'https://submit.ncbi.nlm.nih.gov/apitest/v1/submissions/'
SCV = 'SCV000123456'

OPTIONS = {
    'conditionId': ['MONDO:0044970', 'MONDO:0044976', 'OMIM:615123'],
    'modeOfInheritance': mock.ANY, 'collectionMethod': mock.ANY, 'affectedStatus': mock.ANY, 'alleleOrigin': mock.ANY,
}
OBSERVATION = {'affectedCarriers': 1, 'unaffectedCarriers': 1, 'zygosity': {'homozygous': 1}}
NO_ACMG_ERROR = 'The variant has no ACMG classification in seqr: classify it before drafting a ClinVar submission'
DISABLED_ERROR = 'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")'


def _expected_payload(local_key, **record_update):
    return {
        'clinvarSubmissionReleaseStatus': 'public',
        'germlineSubmission': [{
            'recordStatus': 'novel',
            'localKey': local_key,
            'germlineClassification': {'germlineClassificationDescription': 'Pathogenic'},
            'conditionSet': {'condition': [{'db': 'MONDO', 'id': 'MONDO:0044970'}]},
            'observedIn': [{
                'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'collectionMethod': 'research',
                'numberOfIndividuals': 1,
            }],
            'variantSet': {'variant': [{'chromosomeCoordinates': {
                'assembly': 'GRCh37', 'chromosome': '1', 'start': 248367227, 'stop': 248367228,
                'referenceAllele': 'TC', 'alternateAllele': 'T',
            }}]},
            **record_update,
        }],
    }


@override_settings(CLINVAR_SUBMISSION_MODE='dry_run', CLINVAR_API_KEY=None, CLINVAR_ASSERTION_CRITERIA=None)
class ClinvarSubmissionAPITest(AuthenticationTestMixin, TestCase):
    fixtures = ['users', '1kg_project']

    @classmethod
    def setUpTestData(cls):
        cls.set_up_users()

    def setUp(self):
        self.set_up_test()
        SavedVariant.objects.filter(guid=VARIANT_GUID).update(
            acmg_classification={'classify': 'Pathogenic', 'score': 12, 'criteria': ['PVS1', 'PS1']})
        self.draft_url = reverse(clinvar_submission_draft, args=[VARIANT_GUID])

    def _post(self, url, data=None):
        return self.client.post(url, content_type='application/json', data=json.dumps(data or {}))

    def _create_draft(self, data=None, user=None):
        self.client.force_login(user or self.manager_user)
        response = self._post(self.draft_url, data)
        self.assertEqual(response.status_code, 200)
        return ClinvarSubmission.objects.get(guid=response.json()['clinvarSubmission']['submissionGuid'])

    def _create_approved(self):
        submission = self._create_draft()
        self.assertEqual(self._post(reverse(request_clinvar_submission_review, args=[submission.guid])).status_code, 200)
        self.login_analyst_user()
        self.assertEqual(self._post(reverse(approve_clinvar_submission, args=[submission.guid])).status_code, 200)
        return submission

    def _create_processed(self):
        submission = self._create_approved()
        ClinvarSubmission.objects.filter(guid=submission.guid).update(
            status='processed', scv_accession=SCV, ncbi_submission_id='SUB123', submission_mode='live')
        return submission

    def _assert_status(self, submission, status, **expected):
        submission.refresh_from_db()
        self.assertEqual(submission.status, status)
        for field, value in expected.items():
            self.assertEqual(getattr(submission, field), value)

    def test_disabled_and_misconfigured(self):
        submission = self._create_draft()
        urls = [
            self.draft_url, reverse(project_clinvar_submissions, args=[PROJECT_GUID]), reverse(all_clinvar_submissions),
        ] + [reverse(view, args=[submission.guid]) for view in [
            request_clinvar_submission_review, approve_clinvar_submission, submit_clinvar_submission,
            withdraw_clinvar_submission,
        ]]
        self.login_analyst_user()
        missing_key_error = 'CLINVAR_SUBMISSION_MODE is "{}" but CLINVAR_API_KEY is not configured: refusing to operate'
        for settings_update, error in [
            ({'CLINVAR_SUBMISSION_MODE': 'disabled', 'CLINVAR_API_KEY': API_KEY}, DISABLED_ERROR),
            ({'CLINVAR_SUBMISSION_MODE': 'not_a_mode', 'CLINVAR_API_KEY': API_KEY}, DISABLED_ERROR),
            ({'CLINVAR_SUBMISSION_MODE': 'live'}, missing_key_error.format('live')),
            ({'CLINVAR_SUBMISSION_MODE': 'test', 'CLINVAR_API_KEY': ''}, missing_key_error.format('test')),
        ]:
            with override_settings(**settings_update):
                for url in urls:
                    for response in [self.client.get(url), self._post(url)]:
                        self.assertEqual(response.status_code, 403)
                        self.assertDictEqual(response.json(), {'error': error})
        self._assert_status(submission, 'draft')

    def test_default_setting_is_disabled(self):
        from settings import CLINVAR_SUBMISSION_MODE, CLINVAR_API_KEY
        self.assertEqual(CLINVAR_SUBMISSION_MODE, 'disabled')
        self.assertIsNone(CLINVAR_API_KEY)

    def test_draft_prefill(self):
        self.check_manager_login(self.draft_url)

        response = self.client.get(self.draft_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {
            'clinvarMode': 'dry_run',
            'observation': OBSERVATION,
            'options': OPTIONS,
            'clinvarSubmission': {
                'submissionGuid': None, 'status': None, 'recordStatus': 'novel', 'variantGuid': VARIANT_GUID,
                'classification': 'Pathogenic', 'conditionId': 'MONDO:0044970', 'modeOfInheritance': None,
                'collectionMethod': 'research', 'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'citations': [],
                'validationErrors': [], 'payload': _expected_payload('assigned-when-saved'),
            },
        })
        self.assertIn('research', response.json()['options']['collectionMethod'])
        self.assertEqual(ClinvarSubmission.objects.count(), 0)

        SavedVariant.objects.filter(guid=VARIANT_GUID).update(acmg_classification=None)
        Family.objects.filter(guid='F000002_2').update(mondo_id=None, post_discovery_mondo_id=None, post_discovery_omim_numbers=[])
        response_json = self.client.get(self.draft_url).json()
        self.assertListEqual(response_json['options']['conditionId'], [])
        self.assertDictEqual(response_json['clinvarSubmission'], {
            'submissionGuid': None, 'status': None, 'recordStatus': 'novel', 'variantGuid': VARIANT_GUID,
            'classification': None, 'conditionId': None, 'modeOfInheritance': None, 'collectionMethod': 'research',
            'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'citations': [], 'payload': None,
            'validationErrors': [
                NO_ACMG_ERROR, 'A condition is required: set a MONDO id or post-discovery OMIM number on the family',
            ],
        })

        sv_response = self.client.get(reverse(clinvar_submission_draft, args=[SV_VARIANT_GUID]))
        self.assertEqual(sv_response.status_code, 200)
        self.assertIsNone(sv_response.json()['clinvarSubmission']['payload'])
        self.assertIn(
            'Structural variants cannot be submitted to ClinVar from seqr: only SNVs and indels are supported',
            sv_response.json()['clinvarSubmission']['validationErrors'])

    def test_create_and_update_draft(self):
        self.login_collaborator()
        self.assertEqual(self._post(self.draft_url).status_code, 403)
        self.assertEqual(ClinvarSubmission.objects.count(), 0)

        self.login_manager()
        response = self._post(self.draft_url, {
            'modeOfInheritance': 'Autosomal recessive inheritance', 'citations': [34415322, '33665635'],
        })
        self.assertEqual(response.status_code, 200)
        submission = ClinvarSubmission.objects.get()
        self.assertRegex(submission.guid, r'^CS\d{7}_clinvar$')
        expected_payload = _expected_payload(submission.guid, germlineClassification={
            'germlineClassificationDescription': 'Pathogenic', 'modeOfInheritance': 'Autosomal recessive inheritance',
            'citation': [{'db': 'PubMed', 'id': '34415322'}, {'db': 'PubMed', 'id': '33665635'}],
        })
        self.assertDictEqual(response.json(), {
            'clinvarMode': 'dry_run', 'observation': OBSERVATION, 'options': OPTIONS,
            'clinvarSubmission': {
                'submissionGuid': submission.guid, 'status': 'draft', 'recordStatus': 'novel',
                'variantGuid': VARIANT_GUID, 'variantId': '1-248367227-TC-T', 'familyGuid': 'F000002_2',
                'projectGuid': PROJECT_GUID, 'classification': 'Pathogenic', 'conditionId': 'MONDO:0044970',
                'modeOfInheritance': 'Autosomal recessive inheritance', 'collectionMethod': 'research',
                'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'citations': ['34415322', '33665635'],
                'validationErrors': [], 'payload': expected_payload, 'scvAccession': None, 'ncbiSubmissionId': None,
                'submissionMode': None, 'response': None, 'createdDate': mock.ANY, 'lastModifiedDate': mock.ANY,
                'statusLastModifiedDate': mock.ANY, 'reviewedDate': None, 'submittedDate': None,
                'withdrawalRequestedDate': None, 'createdBy': 'Test Manager User', 'lastEditedBy': 'Test Manager User',
                'reviewedBy': None, 'submittedBy': None, 'withdrawalRequestedBy': None,
                'statusLastModifiedBy': None,
            },
        })
        self.assertEqual(submission.created_by, self.manager_user)
        self.assertDictEqual(submission.payload, expected_payload)

        # A second draft for the same variant edits the existing one
        self.login_analyst_user()
        response = self._post(self.draft_url, {'conditionId': 'OMIM:615123', 'modeOfInheritance': None, 'citations': None})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ClinvarSubmission.objects.count(), 1)
        submission_json = response.json()['clinvarSubmission']
        self.assertEqual(submission_json['submissionGuid'], submission.guid)
        self.assertDictEqual(submission_json['payload'], _expected_payload(
            submission.guid, conditionSet={'condition': [{'db': 'OMIM', 'id': '615123'}]}))
        self.assertEqual(submission_json['createdBy'], 'Test Manager User')
        self.assertEqual(submission_json['lastEditedBy'], 'Test User')
        self.assertEqual(self.client.get(self.draft_url).json()['clinvarSubmission'], submission_json)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ClinvarSubmission.objects.create(saved_variant=submission.saved_variant)

    def test_draft_fields_are_restricted(self):
        submission = self._create_draft()
        original_payload = submission.payload
        for field, value in [
            ('payload', {'germlineSubmission': []}), ('status', 'approved'), ('classification', 'Benign'),
            ('scvAccession', SCV), ('reviewedBy', 'me'), ('validationErrors', []), ('response', {}),
            ('ncbiSubmissionId', 'SUB1'), ('comment', 'Patient John Smith'),
        ]:
            response = self._post(self.draft_url, {field: value, 'conditionId': 'OMIM:615123'})
            self.assertEqual(response.status_code, 400)
            self.assertIn('These fields cannot be set: ', response.json()['error'])
            self.assertIn('The ClinVar record is built by seqr', response.json()['error'])
        self._assert_status(submission, 'draft', payload=original_payload, classification='Pathogenic', scv_accession=None)

        response = self._post(self.draft_url, {
            'conditionId': 'MONDO:0000001', 'collectionMethod': 'x' * 500, 'citations': ['PMID 1'],
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], (
            'Condition "MONDO:0000001" is not one of the family\'s MONDO or OMIM ids; '
            f'Collection method "{"x" * 500}" is not a value accepted by ClinVar; Invalid PubMed id(s): PMID 1'))
        self._assert_status(submission, 'draft', payload=original_payload, collection_method='research')

        self.assertFalse(any('comment' in f.name or 'note' in f.name for f in ClinvarSubmission._meta.get_fields()))

    def test_review_workflow(self):
        submission = self._create_draft()
        review_url = reverse(request_clinvar_submission_review, args=[submission.guid])
        approve_url = reverse(approve_clinvar_submission, args=[submission.guid])
        submit_url = reverse(submit_clinvar_submission, args=[submission.guid])

        response = self._post(approve_url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Only a submission that is in review can be approved')
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Only an approved submission can be submitted')

        self.login_collaborator()
        self.assertEqual(self._post(review_url).status_code, 403)
        self.login_manager()
        response = self._post(review_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['clinvarSubmission']['status'], 'in_review')
        self.assertEqual(response.json()['clinvarSubmission']['statusLastModifiedBy'], 'Test Manager User')
        self._assert_status(submission, 'in_review', status_last_modified_by=self.manager_user)
        response = self._post(review_url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Only a draft can be sent for review')
        self.assertEqual(self._post(submit_url).status_code, 400)

        # The author cannot approve their own submission
        response = self._post(approve_url)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()['error'], 'A ClinVar submission must be approved by a different user than its author')
        self._assert_status(submission, 'in_review', reviewed_by=None)

        # Neither can a user without edit permission, or the last person to edit it
        self.login_collaborator()
        self.assertEqual(self._post(approve_url).status_code, 403)
        self.login_analyst_user()
        self.assertEqual(self._post(self.draft_url, {'alleleOrigin': 'de novo'}).status_code, 200)
        self._assert_status(submission, 'draft', last_edited_by=self.analyst_user, created_by=self.manager_user)
        self.assertEqual(self._post(review_url).status_code, 200)
        self.assertEqual(self._post(approve_url).status_code, 403)
        self.login_manager()
        self.assertEqual(self._post(approve_url).status_code, 403)
        self._assert_status(submission, 'in_review', reviewed_by=None)

        self.login_pm_user()
        response = self._post(approve_url)
        self.assertEqual(response.status_code, 200)
        submission_json = response.json()['clinvarSubmission']
        self.assertEqual(submission_json['status'], 'approved')
        self.assertEqual(submission_json['reviewedBy'], 'Test PM User')
        self.assertIsNotNone(submission_json['reviewedDate'])
        self._assert_status(submission, 'approved', reviewed_by=self.pm_user)

        # Editing an approved submission discards the approval
        self.assertEqual(self._post(self.draft_url, {'alleleOrigin': 'germline'}).status_code, 200)
        self._assert_status(submission, 'draft', reviewed_by=None, reviewed_date=None, last_edited_by=self.pm_user)

    def test_invalid_or_changed_record_returns_to_draft(self):
        SavedVariant.objects.filter(guid=VARIANT_GUID).update(acmg_classification={'classify': 'Conflicting'})
        submission = self._create_draft()
        error = 'The seqr ACMG classification "Conflicting" has no ClinVar equivalent'
        self._assert_status(submission, 'draft', payload=None, validation_errors=[error], classification=None)
        response = self._post(reverse(request_clinvar_submission_review, args=[submission.guid]))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], f'The record is not valid: {error}')
        self._assert_status(submission, 'draft')

        SavedVariant.objects.filter(guid=VARIANT_GUID).update(acmg_classification={'classify': 'Likely Pathogenic'})
        changed_error = 'The variant, family or configuration changed since this record was drafted. It has been ' \
                        'rebuilt and returned to draft: check it and request review again'
        response = self._post(reverse(request_clinvar_submission_review, args=[submission.guid]))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], changed_error)
        self._assert_status(submission, 'draft', classification='Likely pathogenic', validation_errors=[])
        self.assertEqual(self._post(reverse(request_clinvar_submission_review, args=[submission.guid])).status_code, 200)

        # A classification changed while in review cannot be approved as it was
        SavedVariant.objects.filter(guid=VARIANT_GUID).update(acmg_classification={'classify': 'Benign'})
        self.login_analyst_user()
        response = self._post(reverse(approve_clinvar_submission, args=[submission.guid]))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], changed_error)
        self._assert_status(submission, 'draft', classification='Benign', reviewed_by=None)

        # Or submitted as it was approved
        self.login_manager()
        self.assertEqual(self._post(reverse(request_clinvar_submission_review, args=[submission.guid])).status_code, 200)
        self.login_analyst_user()
        self.assertEqual(self._post(reverse(approve_clinvar_submission, args=[submission.guid])).status_code, 200)
        with override_settings(CLINVAR_ASSERTION_CRITERIA='PubMed:25741868'):
            response = self._post(reverse(submit_clinvar_submission, args=[submission.guid]))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], changed_error)
        self._assert_status(submission, 'draft', reviewed_by=None, reviewed_date=None)
        self.assertDictEqual(submission.payload['assertionCriteria'], {'db': 'PubMed', 'id': '25741868'})

    @responses.activate
    def test_submit_dry_run(self):
        submission = self._create_approved()
        submit_url = reverse(submit_clinvar_submission, args=[submission.guid])
        self.login_collaborator()
        self.assertEqual(self._post(submit_url).status_code, 403)

        # No API key: validated by seqr, no request leaves the server
        self.login_manager()
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        local_dry_run = {
            'ok': True, 'dryRun': True, 'sentToNcbi': False,
            'message': 'Validated by seqr only. CLINVAR_API_KEY is not configured, so the NCBI dry run was not performed',
        }
        self.assertEqual(response.json()['message'], f'DRY RUN: nothing was sent to ClinVar. {local_dry_run["message"]}')
        self.assertEqual(response.json()['clinvarSubmission']['status'], 'dry_run_passed')
        self.assertDictEqual(response.json()['clinvarSubmission']['response'], {'dryRun': local_dry_run})
        self.assertEqual(len(responses.calls), 0)
        self._assert_status(
            submission, 'dry_run_passed', ncbi_submission_id=None, submitted_by=None, submitted_date=None,
            submission_mode=None)

        # With a key the record goes to NCBI with dry-run=true and nothing else is sent
        responses.add(responses.POST, PRODUCTION_URL, status=204)
        with override_settings(CLINVAR_API_KEY=API_KEY):
            response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], (
            'DRY RUN: nothing was sent to ClinVar. NCBI dry run passed: the record matches the ClinVar schema. '
            'Nothing was submitted'))
        self.assertEqual(len(responses.calls), 1)
        self.assertEqual(responses.calls[0].request.url, f'{PRODUCTION_URL}?dry-run=true')
        self.assertDictEqual(json.loads(responses.calls[0].request.body), {'actions': [{
            'type': 'AddData', 'targetDb': 'clinvar', 'data': {'content': _expected_payload(submission.guid)},
        }]})
        self._assert_status(submission, 'dry_run_passed', ncbi_submission_id=None, submitted_by=None)
        self.assertNotIn(API_KEY, response.content.decode())

        # NCBI rejects the record
        responses.replace(responses.POST, PRODUCTION_URL, status=400, json={'message': 'Submission is incorrect'})
        with override_settings(CLINVAR_API_KEY=API_KEY):
            response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], 'ClinVar returned 400: Submission is incorrect')
        self.assertDictEqual(response.json()['clinvarSubmission']['response'], {'dryRun': {
            'ok': False, 'dryRun': True, 'sentToNcbi': True, 'httpStatus': 400,
            'message': 'ClinVar returned 400: Submission is incorrect',
        }})
        self._assert_status(submission, 'error', reviewed_by=self.analyst_user, ncbi_submission_id=None)

        # A reviewed submission can be retried after an error
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self._assert_status(submission, 'dry_run_passed')

        # An unreviewed one cannot
        ClinvarSubmission.objects.filter(guid=submission.guid).update(status='error', reviewed_by=None)
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Only an approved submission can be submitted')

    @responses.activate
    @override_settings(CLINVAR_SUBMISSION_MODE='test', CLINVAR_API_KEY=API_KEY, CLINVAR_ASSERTION_CRITERIA='PubMed:25741868')
    def test_submit_for_real(self):
        submission = self._create_approved()
        submit_url = reverse(submit_clinvar_submission, args=[submission.guid])
        expected_body = {'actions': [{'type': 'AddData', 'targetDb': 'clinvar', 'data': {'content': {
            **_expected_payload(submission.guid), 'assertionCriteria': {'db': 'PubMed', 'id': '25741868'},
        }}}]}

        # A failed dry run stops the real submission
        responses.add(responses.POST, TEST_URL, status=400, json={'message': 'Submission is incorrect'})
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(responses.calls), 1)
        self.assertEqual(responses.calls[0].request.url, f'{TEST_URL}?dry-run=true')
        self._assert_status(submission, 'error', ncbi_submission_id=None)

        # The dry run passes but the submission fails
        responses.calls.reset()
        responses.replace(responses.POST, TEST_URL, status=204)
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], 'ClinVar returned 204: No Content')
        self.assertListEqual([call.request.url for call in responses.calls], [f'{TEST_URL}?dry-run=true', TEST_URL])
        self._assert_status(submission, 'error', ncbi_submission_id=None, submitted_by=None)
        self.assertTrue(submission.response['dryRun']['ok'])
        self.assertFalse(submission.response['submission']['ok'])

        responses.calls.reset()
        responses.reset()
        responses.add(responses.POST, TEST_URL, status=204, match=[responses.matchers.query_param_matcher({'dry-run': 'true'})])
        responses.add(responses.POST, TEST_URL, status=201, json={'id': 'SUB14900000'}, match=[responses.matchers.query_param_matcher({})])
        response = self._post(submit_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], 'ClinVar created submission SUB14900000')
        self.assertListEqual([call.request.url for call in responses.calls], [f'{TEST_URL}?dry-run=true', TEST_URL])
        for call in responses.calls:
            self.assertDictEqual(json.loads(call.request.body), expected_body)
            self.assertEqual(call.request.headers['SP-API-KEY'], API_KEY)
        submission_json = response.json()['clinvarSubmission']
        self.assertEqual(submission_json['status'], 'submitted')
        self.assertEqual(submission_json['ncbiSubmissionId'], 'SUB14900000')
        self.assertEqual(submission_json['submissionMode'], 'test')
        self.assertEqual(submission_json['submittedBy'], 'Test User')
        self.assertNotIn(API_KEY, response.content.decode())
        self._assert_status(
            submission, 'submitted', ncbi_submission_id='SUB14900000', submitted_by=self.analyst_user,
            submission_mode='test')
        self.assertIsNotNone(submission.submitted_date)

        # Nothing can change until ClinVar has processed it
        responses.calls.reset()
        for url, error in [
            (submit_url, 'Only an approved submission can be submitted'),
            (self.draft_url, 'A submitted ClinVar submission cannot be edited until ClinVar has processed it'),
            (reverse(withdraw_clinvar_submission, args=[submission.guid]),
             'ClinVar has not processed this submission yet: it can be withdrawn once it has an accession'),
        ]:
            response = self._post(url)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()['error'], error)
        self.assertEqual(len(responses.calls), 0)
        self._assert_status(submission, 'submitted')

    def test_assertion_criteria_required_to_send(self):
        with override_settings(CLINVAR_SUBMISSION_MODE='live', CLINVAR_API_KEY=API_KEY):
            submission = self._create_draft()
            self._assert_status(submission, 'draft', payload=None, validation_errors=[
                'CLINVAR_ASSERTION_CRITERIA is not configured: ClinVar requires an assertion criteria citation'])

    def test_update_processed_submission(self):
        submission = self._create_processed()
        self.login_manager()
        response = self._post(self.draft_url, {'collectionMethod': 'clinical testing'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ClinvarSubmission.objects.count(), 1)
        submission_json = response.json()['clinvarSubmission']
        self.assertEqual(submission_json['status'], 'draft')
        self.assertEqual(submission_json['recordStatus'], 'update')
        self.assertEqual(submission_json['scvAccession'], SCV)
        self.assertIsNone(submission_json['reviewedBy'])
        expected_payload = _expected_payload(submission.guid, recordStatus='update', clinvarAccession=SCV, observedIn=[{
            'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'collectionMethod': 'clinical testing',
            'numberOfIndividuals': 1,
        }])
        self.assertDictEqual(submission_json['payload'], expected_payload)

    def test_withdraw_unpublished(self):
        submission = self._create_draft()
        withdraw_url = reverse(withdraw_clinvar_submission, args=[submission.guid])
        self.login_collaborator()
        self.assertEqual(self._post(withdraw_url).status_code, 403)
        self.login_manager()
        response = self._post(withdraw_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], 'Withdrawn. Nothing had been published in ClinVar')
        self._assert_status(submission, 'withdrawn')

        response = self._post(withdraw_url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'This submission is already withdrawn')

        # A withdrawn submission is no longer the active one
        self.assertIsNone(self.client.get(self.draft_url).json()['clinvarSubmission']['submissionGuid'])
        new_submission = self._create_draft()
        self.assertNotEqual(new_submission.guid, submission.guid)
        self.assertEqual(ClinvarSubmission.objects.count(), 2)
        self._assert_status(submission, 'withdrawn')

    @responses.activate
    def test_withdraw_published(self):
        submission = self._create_processed()
        withdraw_url = reverse(withdraw_clinvar_submission, args=[submission.guid])
        deletion_payload = {'clinvarDeletion': {'accessionSet': [{'accession': SCV}]}}

        self.login_manager()
        response = self._post(withdraw_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()['message'], f'Deletion of {SCV} requested: a different user must confirm it')
        self.assertEqual(response.json()['clinvarSubmission']['withdrawalRequestedBy'], 'Test Manager User')
        self._assert_status(submission, 'processed', withdrawal_requested_by=self.manager_user)

        response = self._post(withdraw_url)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()['error'], 'The deletion must be confirmed by a different user than the one who requested it')
        self.login_collaborator()
        self.assertEqual(self._post(withdraw_url).status_code, 403)
        self._assert_status(submission, 'processed')

        # Dry run mode: the deletion record is built and checked but nothing is sent
        self.login_analyst_user()
        response = self._post(withdraw_url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['message'].startswith('DRY RUN: nothing was sent to ClinVar. Validated by seqr only'))
        self.assertDictEqual(response.json()['clinvarSubmission']['response']['deletionPayload'], deletion_payload)
        self.assertEqual(len(responses.calls), 0)
        self._assert_status(submission, 'processed', scv_accession=SCV)

        with override_settings(CLINVAR_SUBMISSION_MODE='live', CLINVAR_API_KEY=API_KEY):
            responses.add(responses.POST, PRODUCTION_URL, status=500)
            response = self._post(withdraw_url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['message'], 'ClinVar returned 500: Internal Server Error')
            self.assertEqual(len(responses.calls), 1)
            self._assert_status(submission, 'processed')

            responses.reset()
            responses.calls.reset()
            responses.add(responses.POST, PRODUCTION_URL, status=204, match=[responses.matchers.query_param_matcher({'dry-run': 'true'})])
            responses.add(responses.POST, PRODUCTION_URL, status=401, json={'message': 'No valid API key provided'}, match=[responses.matchers.query_param_matcher({})])
            response = self._post(withdraw_url)
            self.assertEqual(response.json()['message'], 'ClinVar returned 401: No valid API key provided')
            self._assert_status(submission, 'processed')

            responses.reset()
            responses.calls.reset()
            responses.add(responses.POST, PRODUCTION_URL, status=204, match=[responses.matchers.query_param_matcher({'dry-run': 'true'})])
            responses.add(responses.POST, PRODUCTION_URL, status=201, json={'id': 'SUB777'}, match=[responses.matchers.query_param_matcher({})])
            response = self._post(withdraw_url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['message'], 'ClinVar created submission SUB777')
            self.assertListEqual(
                [call.request.url for call in responses.calls], [f'{PRODUCTION_URL}?dry-run=true', PRODUCTION_URL])
            for call in responses.calls:
                self.assertDictEqual(json.loads(call.request.body), {'actions': [{
                    'type': 'AddData', 'targetDb': 'clinvar', 'data': {'content': deletion_payload},
                }]})
        self._assert_status(submission, 'withdrawn', scv_accession=SCV)
        self.assertEqual(submission.response['deletion']['submissionId'], 'SUB777')

    def test_edit_cancels_withdrawal_request(self):
        submission = self._create_processed()
        self.login_manager()
        self.assertEqual(self._post(reverse(withdraw_clinvar_submission, args=[submission.guid])).status_code, 200)
        self.assertEqual(self._post(self.draft_url).status_code, 200)
        self._assert_status(submission, 'draft', withdrawal_requested_by=None, withdrawal_requested_date=None)

    def test_list_submissions(self):
        project_url = reverse(project_clinvar_submissions, args=[PROJECT_GUID])
        self.check_collaborator_login(project_url)
        response = self.client.get(project_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'clinvarSubmissions': [], 'clinvarMode': 'dry_run'})

        submission = self._create_draft()
        other_project_variant = SavedVariant.objects.get(guid='SV0000006_1248367227_r0004_non')
        other_submission = ClinvarSubmission.objects.create(saved_variant=other_project_variant, status='submitted')

        self.login_collaborator()
        response_json = self.client.get(project_url).json()
        self.assertListEqual([s['submissionGuid'] for s in response_json['clinvarSubmissions']], [submission.guid])
        self.assertEqual(response_json['clinvarSubmissions'][0]['projectGuid'], PROJECT_GUID)
        self.assertEqual(
            self.client.get(reverse(project_clinvar_submissions, args=['R0004_non_analyst_project'])).status_code, 403)

        all_url = reverse(all_clinvar_submissions)
        self.client.logout()
        self.check_analyst_login(all_url)
        response = self.client.get(all_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['clinvarMode'], 'dry_run')
        self.assertListEqual([s['submissionGuid'] for s in response.json()['clinvarSubmissions']], [submission.guid])

        # Submissions whose saved variant was deleted are kept and listed, but cannot be acted on
        ClinvarSubmission.objects.filter(guid=other_submission.guid).update(saved_variant=None)
        submissions = self.client.get(all_url).json()['clinvarSubmissions']
        self.assertSetEqual({s['submissionGuid'] for s in submissions}, {submission.guid, other_submission.guid})
        orphan = next(s for s in submissions if s['submissionGuid'] == other_submission.guid)
        self.assertDictContainsSubset(
            {'variantGuid': None, 'variantId': None, 'familyGuid': None, 'projectGuid': None, 'status': 'submitted'}, orphan)
        self.login_data_manager_user()
        response = self._post(reverse(withdraw_clinvar_submission, args=[other_submission.guid]))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'Permission Denied')

    def test_saved_variant_with_submission_is_kept(self):
        self.login_manager()
        ClinvarSubmission.objects.create(saved_variant=SavedVariant.objects.get(guid=NO_TAG_VARIANT_GUID))
        url = reverse(update_variant_tags_handler, args=[NO_TAG_VARIANT_GUID])
        response = self._post(url, {'tags': [], 'familyGuid': 'F000001_1'})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json()['savedVariantsByGuid'], {NO_TAG_VARIANT_GUID: {'tagGuids': []}})
        self.assertEqual(SavedVariant.objects.filter(guid=NO_TAG_VARIANT_GUID).count(), 1)

        ClinvarSubmission.objects.all().delete()
        response = self._post(url, {'tags': [], 'familyGuid': 'F000001_1'})
        self.assertDictEqual(response.json()['savedVariantsByGuid'], {NO_TAG_VARIANT_GUID: None})
        self.assertEqual(SavedVariant.objects.filter(guid=NO_TAG_VARIANT_GUID).count(), 0)
