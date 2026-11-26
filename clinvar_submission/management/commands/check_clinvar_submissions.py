from django.core.management.base import BaseCommand, CommandError

from clinvar_submission.clinvar_client import get_submission_status
from clinvar_submission.clinvar_utils import get_config_error, get_api_key
from clinvar_submission.models import ClinvarSubmission
from seqr.utils.logging_utils import SeqrLogger
from seqr.views.utils.json_to_orm_utils import update_model_from_json

logger = SeqrLogger(__name__)


class Command(BaseCommand):
    help = 'Poll ClinVar for the status of submitted records and store their SCV accessions. Run it from a scheduler.'

    def handle(self, *args, **options):
        config_error = get_config_error()
        if config_error or not get_api_key():
            raise CommandError(config_error or 'CLINVAR_API_KEY is not configured')

        submissions = ClinvarSubmission.objects.filter(
            status=ClinvarSubmission.STATUS_SUBMITTED, ncbi_submission_id__isnull=False,
        ).order_by('id')
        counts = {ClinvarSubmission.STATUS_PROCESSED: 0, ClinvarSubmission.STATUS_ERROR: 0, 'pending': 0}
        for submission in submissions:
            result = get_submission_status(submission.ncbi_submission_id, submission.submission_mode, None)
            update_json = {'response': {**(submission.response or {}), 'status': result}}
            accession = next(iter(result.get('accessions') or []), None)
            if result.get('status') == 'processed' and accession:
                update_json.update({'status': ClinvarSubmission.STATUS_PROCESSED, 'scv_accession': accession})
            elif result.get('status') == 'error':
                update_json['status'] = ClinvarSubmission.STATUS_ERROR
            counts[update_json.get('status', 'pending')] += 1
            update_model_from_json(submission, update_json, user=None)

        logger.info(
            f'Checked {len(submissions)} ClinVar submissions: {counts[ClinvarSubmission.STATUS_PROCESSED]} processed, '
            f'{counts[ClinvarSubmission.STATUS_ERROR]} failed, {counts["pending"]} pending', None)
