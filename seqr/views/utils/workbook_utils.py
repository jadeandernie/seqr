"""
The run history of workbook cells (WorksheetQueryResult): which results a worksheet query returned for a target, and
which of them have not been reviewed yet.

- A run is recorded when the results of a search linked to a cell are loaded and either no run was recorded since the
  cell was last run or refreshed, or the results are not the results of the last completed run (for example after
  the stored results were removed by a data load). Reloading unchanged results records nothing.
- A run with the same results as the run before it is recorded without keys and without a diff, and never alerts.
- A search that fails, for example because it returns too many results, is recorded once per run or refresh, is not
  diffed and does not change what has been reviewed.
- The first completed run of a cell is the baseline for later runs: its results are not "new" and do not alert.
- Results are identified by the keys described on WorksheetQueryRun. A change in the annotation of a variant that
  does not add it to or remove it from the results is not detected.
"""
import hashlib
import json

from django.db import transaction

from clickhouse_search.constants import TOO_MANY_RESULTS_ERROR
from seqr.models import SavedVariant, WorksheetQueryResult, WorksheetQueryRun
from seqr.views.utils.variant_utils import variant_dataset_type

EXCLUDED_TAG_NAME = 'Excluded'


def get_result_keys(results):
    keys = set()
    for result in results:
        variants = result if isinstance(result, list) else [result]
        identity = sorted((variant_dataset_type(variant), variant['variantId']) for variant in variants)
        family_guids = set.intersection(*[set(variant.get('familyGuids') or []) for variant in variants])
        keys.update((family_guid, *[part for variant in identity for part in variant]) for family_guid in family_guids)
    return sorted(keys)


def get_key_variant_ids(key):
    return key[2::2]


def _get_keys_hash(keys):
    return hashlib.sha256(json.dumps(keys).encode()).hexdigest()


def to_key_set(keys):
    return {tuple(key) for key in keys}


def get_completed_runs(cell):
    return cell.worksheetqueryrun_set.filter(result_keys__isnull=False).order_by('-id')


def _record_error_run(cell, user, error, is_new_execution):
    if is_new_execution:
        is_too_many_results = str(error) == TOO_MANY_RESULTS_ERROR
        WorksheetQueryRun.objects.create(
            cell=cell, created_by=user, error=str(error),
            status=WorksheetQueryRun.STATUS_TOO_MANY_RESULTS if is_too_many_results else WorksheetQueryRun.STATUS_ERROR,
        )


def _record_completed_run(cell, user, num_results, keys, keys_hash, is_new_execution):
    cell_update = {'num_results': num_results}
    previous_run = get_completed_runs(cell).only('keys_hash').first()
    is_changed = previous_run is None or previous_run.keys_hash != keys_hash
    if is_changed or is_new_execution:
        run = WorksheetQueryRun(cell=cell, created_by=user, num_results=num_results, keys_hash=keys_hash)
        if previous_run is None:
            run.result_keys = keys
            cell_update['reviewed_keys'] = keys
        elif is_changed:
            current_keys = set(keys)
            previous_keys = to_key_set(previous_run.result_keys)
            run.result_keys = keys
            run.new_keys = sorted(current_keys - previous_keys)
            run.removed_keys = sorted(previous_keys - current_keys)
            run.num_new = len(run.new_keys)
            run.num_removed = len(run.removed_keys)
            cell_update['has_unreviewed'] = bool(current_keys - to_key_set(cell.reviewed_keys))
        run.save()
    # Not a user edit of the cell, so its modified date and audit fields do not change
    WorksheetQueryResult.objects.filter(id=cell.id).update(**cell_update)


def _record_runs(cell_ids, user, results=None, error=None):
    keys = keys_hash = None
    if error is None:
        keys = get_result_keys(results)
        keys_hash = _get_keys_hash(keys)

    with transaction.atomic():
        for cell in WorksheetQueryResult.objects.select_for_update().filter(id__in=cell_ids).order_by('id'):
            last_run = cell.worksheetqueryrun_set.order_by('-id').only('created_date').first()
            is_new_execution = last_run is None or bool(
                cell.last_run_date and last_run.created_date < cell.last_run_date)
            if error is None:
                _record_completed_run(cell, user, len(results), keys, keys_hash, is_new_execution)
            else:
                _record_error_run(cell, user, error, is_new_execution)


def get_results_and_record_worksheet_query_runs(results_model, user, get_results):
    cell_ids = list(WorksheetQueryResult.objects.filter(results=results_model).values_list('id', flat=True))
    if not cell_ids:
        return get_results()

    try:
        results = get_results()
    except Exception as e:
        _record_runs(cell_ids, user, error=e)
        raise
    _record_runs(cell_ids, user, results=results)
    return results


def _get_excluded_family_variants(family_guids):
    return set(SavedVariant.objects.filter(
        family__guid__in=family_guids, varianttag__variant_tag_type__name=EXCLUDED_TAG_NAME,
    ).values_list('family__guid', 'variant_id'))


def get_unreviewed_keys_by_cell(cells):
    """
    The keys of the last completed run of each cell that were not reviewed and have no variant that is tagged as
    excluded for the family of the key, like "Hide Excluded" for saved variants. Only has cells with such keys.
    """
    flagged_cells = [cell for cell in cells if cell.has_unreviewed]
    if not flagged_cells:
        return {}

    runs = WorksheetQueryRun.objects.filter(cell__in=flagged_cells, result_keys__isnull=False).order_by(
        'cell_id', '-id').distinct('cell_id').only('cell_id', 'result_keys')
    result_keys_by_cell = {run.cell_id: run.result_keys for run in runs}
    unreviewed_by_cell = {
        cell.id: to_key_set(result_keys_by_cell[cell.id]) - to_key_set(cell.reviewed_keys) for cell in flagged_cells
    }
    excluded = _get_excluded_family_variants({key[0] for keys in unreviewed_by_cell.values() for key in keys})
    unreviewed_by_cell = {
        cell_id: sorted(
            key for key in keys if not any((key[0], variant_id) in excluded for variant_id in get_key_variant_ids(key))
        ) for cell_id, keys in unreviewed_by_cell.items()
    }
    return {cell_id: keys for cell_id, keys in unreviewed_by_cell.items() if keys}
