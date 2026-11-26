"""
Automatic reruns of workbook cells (WorksheetQueryResult). seqr has no scheduler: the reruns happen when the
rerun_workbook_queries command is run, which a deployment must schedule, and after data is loaded.

- Only cells that a user has run before, in a workbook or worksheet with a rerun interval, are rerun.
- A cell is due when its interval has passed since its last run, or when data was loaded for a family of its target
  after its last run (a Dataset with active individuals of the family and a later loaded date).
- A rerun is the run of the workbook page (run_worksheet_query, then load_search_results) as the creator of the
  workbook, so it has the access checks, the search limits and the run history of a manual run. It differs in two ways:
  the results cached for the search are removed first so that the search is really run again, and the run is recorded
  as scheduled or data load. A creator without an active account or without access is never searched for: the run is
  recorded as failed.
- A workbook with notify_on_new_results gets one notification per batch for its cells that had nothing to review
  before the batch and have results to review after it, with the exact count that leaves out excluded variants.
"""
from datetime import timedelta
import logging

from django.contrib.auth.models import User
from django.core.exceptions import PermissionDenied
from django.db.models import Case, DateTimeField, DurationField, ExpressionWrapper, F, OuterRef, Q, Subquery, Value, \
    When
from django.db.models.functions import Coalesce, Least
from django.utils import timezone
from notifications.signals import notify

from seqr.models import Dataset, WorkbookTarget, WorksheetQueryResult, WorksheetQueryRun
from seqr.utils.communication_utils import BASE_EMAIL_TEMPLATE, send_html_email
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.apis.variant_search_api import load_search_results
from seqr.views.apis.workbook_api import run_worksheet_query
from seqr.views.utils.permissions_utils import get_project_and_check_view_permission
from seqr.views.utils.workbook_utils import get_unreviewed_keys_by_cell, record_failed_run
from settings import BASE_URL

logger = logging.getLogger(__name__)

DEFAULT_MAX_CELLS = 25
DATA_LOAD_MAX_CELLS = 10

NO_CREATOR_ERROR = 'Not run: the creator of the workbook does not have an active account'
NO_ACCESS_ERROR = 'Not run: the creator of the workbook does not have access to the workbook or the families searched'

STATUS_COMPLETED = 'completed'
STATUS_FAILED = 'failed'
STATUS_SKIPPED = 'skipped'


def _latest_loaded_date(**family_filter):
    return Subquery(
        Dataset.objects.filter(**family_filter).order_by('-loaded_date').values('loaded_date')[:1],
        output_field=DateTimeField(),
    )


def get_due_cells(now=None, workbook_guid=None, project_guid=None, family_guids=None, data_loaded_only=False):
    cells = WorksheetQueryResult.objects.filter(last_run_date__isnull=False).annotate(
        interval_days=Coalesce(
            'query__worksheet__rerun_interval_days', 'query__worksheet__workbook__rerun_interval_days'),
    ).filter(interval_days__isnull=False)
    if workbook_guid:
        cells = cells.filter(target__workbook__guid=workbook_guid)
    if project_guid:
        cells = cells.filter(target__workbook__project__guid=project_guid)
    if family_guids is not None:
        cells = cells.filter(target__in=WorkbookTarget.objects.filter(
            Q(family__guid__in=family_guids) | Q(analysis_group__families__guid__in=family_guids)))

    cells = cells.annotate(
        loaded_date=Coalesce(
            _latest_loaded_date(active_individuals__family=OuterRef('target__family')),
            _latest_loaded_date(active_individuals__family__analysisgroup=OuterRef('target__analysis_group')),
        ),
    ).annotate(
        data_loaded_date=Case(
            When(loaded_date__gt=F('last_run_date'), then=F('loaded_date')), output_field=DateTimeField()),
        interval_due_date=ExpressionWrapper(F('last_run_date') + ExpressionWrapper(
            F('interval_days') * Value(timedelta(days=1)), output_field=DurationField(),
        ), output_field=DateTimeField()),
    ).annotate(
        due_date=F('data_loaded_date') if data_loaded_only else Least('interval_due_date', 'data_loaded_date'),
    )
    return cells.filter(due_date__lte=now or timezone.now()).order_by('due_date', 'id')


def _count_unreviewed(cell_ids):
    cells = list(WorksheetQueryResult.objects.filter(id__in=cell_ids))
    unreviewed_keys = get_unreviewed_keys_by_cell(cells)
    return {cell.id: len(unreviewed_keys.get(cell.id, [])) for cell in cells}


def _rerun_cell(cell, user, trigger, refreshed_results_ids):
    if not (user and user.is_active):
        raise PermissionDenied(NO_CREATOR_ERROR)
    try:
        _, results_model = run_worksheet_query(
            cell.query.worksheet.workbook.guid, cell.query.guid, cell.target.guid, user)
    except PermissionDenied:
        raise PermissionDenied(NO_ACCESS_ERROR)

    # Cells with the same search and families share their results, which are only searched once per batch
    refresh = results_model.id not in refreshed_results_ids
    refreshed_results_ids.add(results_model.id)
    load_search_results(results_model, user, refresh=refresh, trigger=trigger)


def _safe_rerun_cell(cell, trigger, refreshed_results_ids):
    user = cell.query.worksheet.workbook.created_by
    start = timezone.now()
    try:
        _rerun_cell(cell, user, trigger, refreshed_results_ids)
    except Exception as e:
        # Every attempt is in the history, and is not tried again until the cell is due again
        error = '; '.join(e.errors) if isinstance(e, ErrorsWarningsException) else str(e)
        if not cell.worksheetqueryrun_set.filter(created_date__gte=start).exists():
            record_failed_run(cell, user, error, trigger)
        logger.warning(f'Rerun of workbook query {cell.guid} failed: {error}')
        return STATUS_SKIPPED if isinstance(e, PermissionDenied) else STATUS_FAILED
    return STATUS_COMPLETED


def _can_view_project(project, user):
    try:
        get_project_and_check_view_permission(project.guid, user)
    except PermissionDenied:
        return False
    return True


def _notify_new_results(workbook, num_cells):
    project = workbook.project
    queries = '1 query' if num_cells == 1 else f'{num_cells} queries'
    message = f'{queries} in workbook {workbook.name} {"has" if num_cells == 1 else "have"} new results to review'

    creator = workbook.created_by
    notify_creator = bool(creator and creator.is_active and _can_view_project(project, creator))
    recipient_q = Q(groups=project.subscribers)
    if notify_creator:
        recipient_q |= Q(id=creator.id)
    recipients = User.objects.filter(recipient_q).distinct()
    # Project notifications are found by the id of their actor, which has to stay the project
    notify.send(project, recipient=recipients, verb=message)

    if notify_creator and creator.email:
        url = f'{BASE_URL}project/{project.guid}/workbook/{workbook.guid}'
        send_html_email(
            email_body=BASE_EMAIL_TEMPLATE.format(f'{message}: <a href={url}>{url}</a>'), to=[creator.email],
            subject='New workbook results to review in seqr',
        )


def _notify_workbooks(unreviewed_before, unreviewed_after):
    new_cell_ids = [
        cell_id for cell_id, num_unreviewed in unreviewed_after.items()
        if num_unreviewed and not unreviewed_before.get(cell_id)
    ]
    cells = WorksheetQueryResult.objects.filter(
        id__in=new_cell_ids, target__workbook__notify_on_new_results=True,
    ).select_related('target__workbook__project', 'target__workbook__created_by').order_by('target__workbook_id')
    num_cells_by_workbook = {}
    for cell in cells:
        workbook, num_cells = num_cells_by_workbook.get(cell.target.workbook_id, (cell.target.workbook, 0))
        num_cells_by_workbook[cell.target.workbook_id] = (workbook, num_cells + 1)

    for workbook, num_cells in num_cells_by_workbook.values():
        try:
            _notify_new_results(workbook, num_cells)
        except Exception as e:
            logger.error(f'Error in notification of new results of workbook {workbook.guid}: {e}')
    return len(num_cells_by_workbook)


def rerun_due_cells(max_cells=DEFAULT_MAX_CELLS, dry_run=False, **due_kwargs):
    """
    Reruns at most max_cells due cells, the longest due first. A cell that fails does not stop the others.
    """
    cells = list(get_due_cells(**due_kwargs).select_related(
        'query__worksheet__workbook__created_by', 'target',
    )[:max_cells])
    summary = {
        'cells': [cell.guid for cell in cells], STATUS_COMPLETED: 0, STATUS_FAILED: 0, STATUS_SKIPPED: 0,
        'notified_workbooks': 0,
    }
    if dry_run or not cells:
        return summary

    def _watched_cell_ids():
        results_ids = WorksheetQueryResult.objects.filter(
            id__in=cell_ids, results__isnull=False).values_list('results_id', flat=True)
        return set(cell_ids) | set(
            WorksheetQueryResult.objects.filter(results_id__in=list(results_ids)).values_list('id', flat=True))

    cell_ids = [cell.id for cell in cells]
    unreviewed_before = _count_unreviewed(_watched_cell_ids())
    refreshed_results_ids = set()
    for cell in cells:
        trigger = WorksheetQueryRun.TRIGGER_DATA_LOAD if cell.data_loaded_date else WorksheetQueryRun.TRIGGER_SCHEDULED
        summary[_safe_rerun_cell(cell, trigger, refreshed_results_ids)] += 1
    unreviewed_after = _count_unreviewed(_watched_cell_ids())

    summary['notified_workbooks'] = _notify_workbooks(unreviewed_before, unreviewed_after)
    return summary
