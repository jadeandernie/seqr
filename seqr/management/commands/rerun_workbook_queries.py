import logging

from django.core.management.base import BaseCommand, CommandError

from seqr.models import Project, Workbook
from seqr.views.utils.workbook_rerun_utils import DEFAULT_MAX_CELLS, rerun_due_cells

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Rerun the workbook queries that are due for an automatic rerun. Run this on a schedule, for example hourly'

    def add_arguments(self, parser):
        parser.add_argument('--max-cells', type=int, default=DEFAULT_MAX_CELLS,
                            help='the most queries (one query for one family or analysis group) to run')
        parser.add_argument('--workbook', help='optional guid of the only workbook to rerun queries for')
        parser.add_argument('--project', help='optional guid of the only project to rerun queries for')
        parser.add_argument('--dry-run', action='store_true', help='only log the queries that are due')

    def handle(self, *args, **options):
        if options['max_cells'] < 1:
            raise CommandError('--max-cells must be at least 1')
        if options['workbook'] and not Workbook.objects.filter(guid=options['workbook']).exists():
            raise CommandError(f'Invalid workbook: {options["workbook"]}')
        if options['project'] and not Project.objects.filter(guid=options['project']).exists():
            raise CommandError(f'Invalid project: {options["project"]}')

        summary = rerun_due_cells(
            max_cells=options['max_cells'], dry_run=options['dry_run'], workbook_guid=options['workbook'],
            project_guid=options['project'],
        )
        if options['dry_run']:
            logger.info(f'{len(summary["cells"])} workbook queries are due: {", ".join(summary["cells"])}')
        else:
            logger.info(
                f'Reran {len(summary["cells"])} workbook queries: {summary["completed"]} completed, '
                f'{summary["failed"]} failed, {summary["skipped"]} skipped. '
                f'Notified {summary["notified_workbooks"]} workbooks of new results')
