"""
APIs for workbooks: a workbook belongs to one project and holds targets (a family or an analysis group), worksheets and
their queries (search patterns). A WorksheetQueryResult is the "cell" for one query and one target.

Permissions:
- All endpoints require view access to the project of the workbook.
- Any user with view access to a project can create a workbook in it. Changing a workbook and its targets, worksheets
  and queries requires view access and either edit access to the project or being the creator of the workbook.
- Updating or running a cell, marking its results as reviewed and reading its run history require view access to
  the project and to the families of the target.
- Every endpoint that returns or uses targets checks view access to the families of those targets.

The group summary of a cell is descriptive only: it counts families by gene, variant and HPO term from the cached
results of the search of the cell and never runs a search. It does not read free text (notes, nonstandard features)
and does not test for enrichment or significance.

Automatic reruns are a setting of the workbook (rerun_interval_days, with an optional override per worksheet) that is
changed like the rest of the workbook; they are run by seqr.views.utils.workbook_rerun_utils as the creator of the
workbook.

Run history and alerts are described in seqr.views.utils.workbook_utils. A cell has unreviewed results when its last
completed run has results that were not marked as reviewed, except for variants that are tagged as excluded for the
family: those never alert. Removed results are recorded in the history and do not alert.
"""
from collections import defaultdict
from copy import deepcopy
import json

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import BooleanField, ExpressionWrapper, Max, Q, prefetch_related_objects
from django.utils import timezone
from django.utils.crypto import salted_hmac

from reference_data.models import HumanPhenotypeOntology
from seqr.models import AnalysisGroup, Family, Individual, Workbook, WorkbookTarget, Worksheet, WorksheetQuery, \
    WorksheetQueryResult, WorksheetQueryRun, MIN_RERUN_INTERVAL_DAYS, MAX_RERUN_INTERVAL_DAYS
from seqr.utils.gene_utils import get_genes_for_variant_display
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.apis.variant_search_api import _get_or_create_results_model, flatten_search_results, \
    get_cached_search_results, get_gene_family_counts, get_saved_search_models, get_variant_gene_ids, \
    validate_saved_search_json
from seqr.views.utils.json_to_orm_utils import create_model_from_json, get_or_create_model_from_json, \
    update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.orm_to_json_utils import _get_json_for_models, get_json_for_saved_searches
from seqr.views.utils.permissions_utils import check_families_view_permission, get_project_and_check_view_permission, \
    has_project_edit_permission, login_and_policies_required
from seqr.views.utils.workbook_utils import get_completed_runs, get_key_variant_ids, get_unreviewed_keys_by_cell, \
    to_key_set

# The search page hashes are 32 character hex MD5 digests, so a prefixed hash can never be equal to one of them
SEARCH_HASH_PREFIX = 'WB'
SEARCH_HASH_SALT = 'seqr.workbook.search_hash'
SEARCH_HASH_DIGEST_LENGTH = 48

MAX_SUMMARY_ROWS = 200
MAX_PHENOTYPE_TERMS = 10
RESULTS_NOT_LOADED_STATUS = 409
MAX_HISTORY_RUNS = 50
MAX_UNREVIEWED_RESULTS = 100


def _error(message):
    return ErrorsWarningsException([message])


def _get_workbook(workbook_guid, user, can_edit=False):
    workbook = Workbook.objects.get(guid=workbook_guid)
    workbook.project = get_project_and_check_view_permission(workbook.project.guid, user)
    if can_edit and not _has_workbook_edit_permission(workbook, user):
        raise PermissionDenied(f'{user} does not have sufficient permissions to edit {workbook}')
    return workbook


def _has_workbook_edit_permission(workbook, user, has_project_edit=None):
    if workbook.created_by_id == user.id:
        return True
    return has_project_edit_permission(workbook.project, user) if has_project_edit is None else has_project_edit


def _get_worksheet_query(workbook, query_guid):
    return WorksheetQuery.objects.get(guid=query_guid, worksheet__workbook=workbook)


def _get_family_guids_by_target(targets, user):
    prefetch_related_objects(targets, 'family', 'analysis_group__families')
    family_guids_by_target = {
        target.guid: [target.family.guid] if target.family else sorted(
            family.guid for family in target.analysis_group.families.all()
        ) for target in targets
    }
    family_guids = {guid for guids in family_guids_by_target.values() for guid in guids}
    check_families_view_permission(Family.objects.filter(guid__in=family_guids), user)
    return family_guids_by_target


def _parse_name(request_json):
    name = request_json.get('name')
    if not (isinstance(name, str) and name.strip()):
        raise _error('"Name" is required')
    return name.strip()


def _parse_optional_text(request_json, field):
    value = request_json[field]
    if not (value is None or isinstance(value, str)):
        raise _error(f'"{field}" must be text')
    return value


def _parse_rerun_interval(request_json):
    value = request_json['rerunIntervalDays']
    is_valid = isinstance(value, int) and not isinstance(value, bool) and \
        MIN_RERUN_INTERVAL_DAYS <= value <= MAX_RERUN_INTERVAL_DAYS
    if not (value is None or is_valid):
        raise _error(
            f'"rerunIntervalDays" must be empty or a number of days from {MIN_RERUN_INTERVAL_DAYS} to '
            f'{MAX_RERUN_INTERVAL_DAYS}')
    return value


def _check_unique_name(models, name, description):
    if models.filter(name=name).exists():
        raise _error(f'A {description} named "{name}" already exists')


def _next_order(models):
    max_order = models.aggregate(max_order=Max('order'))['max_order']
    return 0 if max_order is None else max_order + 1


def _by_guid(models_json, guid_key):
    return {model_json[guid_key]: model_json for model_json in models_json}


def _deleted(guids):
    return {guid: None for guid in guids}


def _workbooks_json(workbooks, project, user):
    has_project_edit = has_project_edit_permission(project, user)

    def _process_result(result, workbook):
        result['canEdit'] = _has_workbook_edit_permission(workbook, user, has_project_edit=has_project_edit)

    return _by_guid(_get_json_for_models(
        workbooks, nested_fields=[{'fields': ('project', 'guid'), 'value': project.guid}], process_result=_process_result,
    ), 'workbookGuid')


def _targets_json(targets, workbook, user):
    family_guids_by_target = _get_family_guids_by_target(targets, user)

    def _process_result(result, target):
        result.update({
            'familyGuid': target.family.guid if target.family else None,
            'analysisGroupGuid': target.analysis_group.guid if target.analysis_group else None,
            'familyGuids': family_guids_by_target[target.guid],
        })

    return _by_guid(_get_json_for_models(
        targets, nested_fields=[{'fields': ('workbook', 'guid'), 'value': workbook.guid}], process_result=_process_result,
    ), 'workbookTargetGuid')


def _worksheets_json(worksheets, workbook):
    return _by_guid(_get_json_for_models(
        worksheets, nested_fields=[{'fields': ('workbook', 'guid'), 'value': workbook.guid}],
    ), 'worksheetGuid')


def _queries_json(queries):
    return _by_guid(_get_json_for_models(queries, nested_fields=[{'fields': ('worksheet', 'guid')}]), 'worksheetQueryGuid')


def _user_name(user):
    return (user.get_full_name() or user.email) if user else None


def _get_run_summaries():
    return WorksheetQueryRun.objects.select_related('created_by').defer(
        'keys_hash', 'result_keys', 'new_keys', 'removed_keys',
    ).annotate(is_unchanged=ExpressionWrapper(
        Q(status=WorksheetQueryRun.STATUS_COMPLETED, result_keys__isnull=True), output_field=BooleanField(),
    ))


def _run_json(run):
    return {
        'runId': run.id,
        'createdDate': run.created_date,
        'createdBy': _user_name(run.created_by),
        'trigger': run.trigger,
        'status': run.status,
        'error': run.error,
        'numResults': run.num_results,
        'numNew': run.num_new,
        'numRemoved': run.num_removed,
        'isUnchanged': run.is_unchanged,
    }


def _query_results_json(query_results, unreviewed_keys_by_cell=None):
    if unreviewed_keys_by_cell is None:
        unreviewed_keys_by_cell = get_unreviewed_keys_by_cell(query_results)
    last_runs = {
        run.cell_id: run for run in
        _get_run_summaries().filter(cell__in=query_results).order_by('cell_id', '-id').distinct('cell_id')
    }
    last_scheduled_run_dates = dict(WorksheetQueryRun.objects.filter(cell__in=query_results).exclude(
        trigger=WorksheetQueryRun.TRIGGER_MANUAL,
    ).values('cell_id').annotate(last_date=Max('created_date')).values_list('cell_id', 'last_date'))

    def _process_result(result, query_result):
        num_unreviewed = len(unreviewed_keys_by_cell.get(query_result.id, []))
        last_run = last_runs.get(query_result.id)
        result.update({
            'lastRunBy': _user_name(query_result.last_run_by),
            'hasUnreviewed': num_unreviewed > 0,
            'numUnreviewed': num_unreviewed,
            'lastRun': _run_json(last_run) if last_run else None,
            'lastScheduledRunDate': last_scheduled_run_dates.get(query_result.id),
        })

    prefetch_related_objects(query_results, 'last_run_by')
    return _by_guid(_get_json_for_models(query_results, nested_fields=[
        {'fields': ('query', 'guid'), 'key': 'worksheetQueryGuid'},
        {'fields': ('target', 'guid'), 'key': 'workbookTargetGuid'},
        {'fields': ('results', 'search_hash'), 'key': 'searchHash'},
    ], process_result=_process_result), 'worksheetQueryResultGuid')


def _workbook_detail_json(workbook, user):
    return {
        'workbooksByGuid': _workbooks_json([workbook], workbook.project, user),
        'workbookTargetsByGuid': _targets_json(list(workbook.workbooktarget_set.order_by('order', 'id')), workbook, user),
        'worksheetsByGuid': _worksheets_json(list(workbook.worksheet_set.order_by('order', 'id')), workbook),
        'worksheetQueriesByGuid': _queries_json(list(
            WorksheetQuery.objects.filter(worksheet__workbook=workbook).order_by('worksheet__order', 'order', 'id')
        )),
        'worksheetQueryResultsByGuid': _query_results_json(list(
            WorksheetQueryResult.objects.filter(target__workbook=workbook).order_by('id')
        )),
    }


@transaction.atomic
def _add_targets(workbook, request_json, user, required=False):
    family_guids = list(dict.fromkeys(request_json.get('familyGuids') or []))
    analysis_group_guids = list(dict.fromkeys(request_json.get('analysisGroupGuids') or []))
    if required and not (family_guids or analysis_group_guids):
        raise _error('Families or analysis groups are required')

    families = {family.guid: family for family in Family.objects.filter(project=workbook.project, guid__in=family_guids)}
    analysis_groups = {
        group.guid: group for group in AnalysisGroup.objects.filter(project=workbook.project, guid__in=analysis_group_guids)
    }
    invalid_guids = [guid for guid in family_guids if guid not in families] + \
                    [guid for guid in analysis_group_guids if guid not in analysis_groups]
    if invalid_guids:
        raise _error(
            f'The following families or analysis groups do not exist in this project: {", ".join(invalid_guids)}')

    existing_targets = workbook.workbooktarget_set.filter(
        Q(family__in=list(families.values())) | Q(analysis_group__in=list(analysis_groups.values())))
    if existing_targets:
        raise _error(f'The following are already targets of this workbook: {", ".join(sorted(map(str, existing_targets)))}')

    order = _next_order(workbook.workbooktarget_set)
    new_targets = [{'family': families[guid]} for guid in family_guids] + \
                  [{'analysis_group': analysis_groups[guid]} for guid in analysis_group_guids]
    targets = [
        create_model_from_json(WorkbookTarget, {'workbook': workbook, 'order': order + i, **target}, user)
        for i, target in enumerate(new_targets)
    ]
    return _targets_json(targets, workbook, user)


@transaction.atomic
def _create_workbook(project, request_json, user, source_workbook=None):
    name = _parse_name(request_json)
    _check_unique_name(project.workbook_set, name, 'workbook')
    description = source_workbook.description if source_workbook else None
    if 'description' in request_json:
        description = _parse_optional_text(request_json, 'description')

    workbook = create_model_from_json(Workbook, {'project': project, 'name': name, 'description': description}, user)
    _add_targets(workbook, request_json, user)

    worksheets = source_workbook.worksheet_set.order_by('order', 'id') if source_workbook else []
    for source_worksheet in worksheets:
        worksheet = create_model_from_json(
            Worksheet, {'workbook': workbook, 'name': source_worksheet.name, 'order': source_worksheet.order}, user)
        for query in source_worksheet.worksheetquery_set.order_by('order', 'id'):
            create_model_from_json(WorksheetQuery, {
                'worksheet': worksheet, 'name': query.name, 'order': query.order, 'search': deepcopy(query.search),
            }, user)

    return workbook


def _reorder(models, guids, model_cls, user):
    models_by_guid = {model.guid: model for model in models}
    if not isinstance(guids, list) or sorted(map(str, guids)) != sorted(models_by_guid):
        raise _error('The guid of every item is required exactly once')
    reordered_models = [models_by_guid[guid] for guid in guids]
    for order, model in enumerate(reordered_models):
        model.order = order
    model_cls.bulk_update_models(user, reordered_models, ['order'])
    return reordered_models


def _parse_query_search(request_json, user):
    search = request_json.get('search')
    saved_search_guid = request_json.get('savedSearchGuid')
    if (search is None) == (saved_search_guid is None):
        raise _error('Exactly one of "search" or "savedSearchGuid" is required')

    name = request_json.get('name')
    if saved_search_guid:
        saved_searches = get_json_for_saved_searches(get_saved_search_models(user).filter(guid=saved_search_guid), user)
        if not saved_searches:
            raise _error(f'Invalid saved search: {saved_search_guid}')
        search = saved_searches[0]['search']
        name = name or saved_searches[0]['name']

    if not isinstance(search, dict):
        raise _error('"search" must be a JSON object')
    error = validate_saved_search_json(search)
    if error:
        raise _error(error)

    return _parse_name({'name': name}), search


def _get_search_hash(search, family_guids):
    value = json.dumps({'familyGuids': sorted(family_guids), 'search': search}, sort_keys=True)
    digest = salted_hmac(SEARCH_HASH_SALT, value, algorithm='sha256').hexdigest()
    return f'{SEARCH_HASH_PREFIX}{digest[:SEARCH_HASH_DIGEST_LENGTH]}'


def _get_results_model(project, search, family_guids, user):
    search_hash = _get_search_hash(search, family_guids)
    results_model = _get_or_create_results_model(search_hash, {
        'projectFamilies': [{'projectGuid': project.guid, 'familyGuids': family_guids}],
        'search': deepcopy(search),
    }, user)
    results_family_guids = set(results_model.families.values_list('guid', flat=True))
    if results_model.variant_search.search != search or results_family_guids != set(family_guids):
        raise _error(f'The search results for {search_hash} do not match this query and target')
    return results_model


def _get_query_and_target(workbook_guid, query_guid, target_guid, user):
    workbook = _get_workbook(workbook_guid, user)
    query = _get_worksheet_query(workbook, query_guid)
    target = workbook.workbooktarget_set.get(guid=target_guid)
    family_guids = _get_family_guids_by_target([target], user)[target.guid]
    return workbook, query, target, family_guids


@login_and_policies_required
def project_workbooks_handler(request, project_guid):
    project = get_project_and_check_view_permission(project_guid, request.user)
    return create_json_response({
        'workbooksByGuid': _workbooks_json(list(project.workbook_set.order_by('name')), project, request.user),
    })


@login_and_policies_required
def create_workbook_handler(request, project_guid):
    project = get_project_and_check_view_permission(project_guid, request.user)
    workbook = _create_workbook(project, json.loads(request.body), request.user)
    return create_json_response(_workbook_detail_json(workbook, request.user))


@login_and_policies_required
def workbook_detail_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user)
    return create_json_response(_workbook_detail_json(workbook, request.user))


@login_and_policies_required
def update_workbook_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    request_json = json.loads(request.body)

    update_json = {}
    if 'name' in request_json:
        update_json['name'] = _parse_name(request_json)
        _check_unique_name(workbook.project.workbook_set.exclude(id=workbook.id), update_json['name'], 'workbook')
    if 'description' in request_json:
        update_json['description'] = _parse_optional_text(request_json, 'description')
    if 'rerunIntervalDays' in request_json:
        update_json['rerun_interval_days'] = _parse_rerun_interval(request_json)
    if 'notifyOnNewResults' in request_json:
        if not isinstance(request_json['notifyOnNewResults'], bool):
            raise _error('"notifyOnNewResults" must be true or false')
        update_json['notify_on_new_results'] = request_json['notifyOnNewResults']
    update_model_from_json(workbook, update_json, request.user)

    return create_json_response({'workbooksByGuid': _workbooks_json([workbook], workbook.project, request.user)})


@login_and_policies_required
def delete_workbook_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    workbook.delete_model(request.user, user_can_delete=True)
    return create_json_response({'workbooksByGuid': {workbook_guid: None}})


@login_and_policies_required
def duplicate_workbook_handler(request, workbook_guid):
    source_workbook = _get_workbook(workbook_guid, request.user)
    workbook = _create_workbook(
        source_workbook.project, json.loads(request.body), request.user, source_workbook=source_workbook)
    return create_json_response(_workbook_detail_json(workbook, request.user))


@login_and_policies_required
def add_workbook_targets_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    targets_json = _add_targets(workbook, json.loads(request.body), request.user, required=True)
    return create_json_response({'workbookTargetsByGuid': targets_json})


@login_and_policies_required
def reorder_workbook_targets_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    with transaction.atomic():
        targets = _reorder(
            workbook.workbooktarget_set.all(), json.loads(request.body).get('workbookTargetGuids'), WorkbookTarget,
            request.user)
        targets_json = _targets_json(targets, workbook, request.user)
    return create_json_response({'workbookTargetsByGuid': targets_json})


@login_and_policies_required
def delete_workbook_target_handler(request, workbook_guid, target_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    target = workbook.workbooktarget_set.get(guid=target_guid)
    _get_family_guids_by_target([target], request.user)
    query_result_guids = list(target.worksheetqueryresult_set.values_list('guid', flat=True))
    target.delete_model(request.user, user_can_delete=True)
    return create_json_response({
        'workbookTargetsByGuid': {target_guid: None},
        'worksheetQueryResultsByGuid': _deleted(query_result_guids),
    })


@login_and_policies_required
def create_worksheet_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    name = _parse_name(json.loads(request.body))
    _check_unique_name(workbook.worksheet_set, name, 'worksheet')
    worksheet = create_model_from_json(
        Worksheet, {'workbook': workbook, 'name': name, 'order': _next_order(workbook.worksheet_set)}, request.user)
    return create_json_response({'worksheetsByGuid': _worksheets_json([worksheet], workbook)})


@login_and_policies_required
def reorder_worksheets_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    worksheets = _reorder(
        workbook.worksheet_set.all(), json.loads(request.body).get('worksheetGuids'), Worksheet, request.user)
    return create_json_response({'worksheetsByGuid': _worksheets_json(worksheets, workbook)})


@login_and_policies_required
def update_worksheet_handler(request, workbook_guid, worksheet_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    worksheet = workbook.worksheet_set.get(guid=worksheet_guid)
    request_json = json.loads(request.body)

    update_json = {}
    if 'rerunIntervalDays' in request_json:
        update_json['rerun_interval_days'] = _parse_rerun_interval(request_json)
    if 'name' in request_json or not update_json:
        update_json['name'] = _parse_name(request_json)
        _check_unique_name(workbook.worksheet_set.exclude(id=worksheet.id), update_json['name'], 'worksheet')
    update_model_from_json(worksheet, update_json, request.user)
    return create_json_response({'worksheetsByGuid': _worksheets_json([worksheet], workbook)})


@login_and_policies_required
def delete_worksheet_handler(request, workbook_guid, worksheet_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    worksheet = workbook.worksheet_set.get(guid=worksheet_guid)
    query_guids = list(worksheet.worksheetquery_set.values_list('guid', flat=True))
    query_result_guids = list(
        WorksheetQueryResult.objects.filter(query__worksheet=worksheet).values_list('guid', flat=True))
    worksheet.delete_model(request.user, user_can_delete=True)
    return create_json_response({
        'worksheetsByGuid': {worksheet_guid: None},
        'worksheetQueriesByGuid': _deleted(query_guids),
        'worksheetQueryResultsByGuid': _deleted(query_result_guids),
    })


@login_and_policies_required
def create_worksheet_query_handler(request, workbook_guid, worksheet_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    worksheet = workbook.worksheet_set.get(guid=worksheet_guid)
    name, search = _parse_query_search(json.loads(request.body), request.user)
    query = create_model_from_json(WorksheetQuery, {
        'worksheet': worksheet, 'name': name, 'search': search, 'order': _next_order(worksheet.worksheetquery_set),
    }, request.user)
    return create_json_response({'worksheetQueriesByGuid': _queries_json([query])})


@login_and_policies_required
def reorder_worksheet_queries_handler(request, workbook_guid, worksheet_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    worksheet = workbook.worksheet_set.get(guid=worksheet_guid)
    queries = _reorder(
        worksheet.worksheetquery_set.all(), json.loads(request.body).get('worksheetQueryGuids'), WorksheetQuery,
        request.user)
    return create_json_response({'worksheetQueriesByGuid': _queries_json(queries)})


@login_and_policies_required
def update_worksheet_query_handler(request, workbook_guid, query_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    query = _get_worksheet_query(workbook, query_guid)
    request_json = json.loads(request.body)
    if 'search' in request_json or 'savedSearchGuid' in request_json:
        raise _error('The search of an existing query can not be changed, create a new query instead')
    update_model_from_json(query, {'name': _parse_name(request_json)}, request.user)
    return create_json_response({'worksheetQueriesByGuid': _queries_json([query])})


@login_and_policies_required
def delete_worksheet_query_handler(request, workbook_guid, query_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    query = _get_worksheet_query(workbook, query_guid)
    query_result_guids = list(query.worksheetqueryresult_set.values_list('guid', flat=True))
    query.delete_model(request.user, user_can_delete=True)
    return create_json_response({
        'worksheetQueriesByGuid': {query_guid: None},
        'worksheetQueryResultsByGuid': _deleted(query_result_guids),
    })


@login_and_policies_required
def update_worksheet_query_result_handler(request, workbook_guid, query_guid, target_guid):
    _, query, target, _ = _get_query_and_target(workbook_guid, query_guid, target_guid, request.user)
    request_json = json.loads(request.body)

    update_json = {}
    if 'status' in request_json:
        if request_json['status'] not in dict(WorksheetQueryResult.STATUS_CHOICES):
            raise _error(f'Invalid status: {request_json["status"]}')
        update_json['status'] = request_json['status']
    if 'note' in request_json:
        update_json['note'] = _parse_optional_text(request_json, 'note')
    if not update_json:
        raise _error('"status" or "note" is required')

    query_result, _ = get_or_create_model_from_json(
        WorksheetQueryResult, {'query': query, 'target': target}, update_json, request.user)
    return create_json_response({'worksheetQueryResultsByGuid': _query_results_json([query_result])})


def run_worksheet_query(workbook_guid, query_guid, target_guid, user):
    """
    Starts a run of a cell as the user: checks the access of the user to the workbook and to the families of the
    target, and links the cell to the search results that record the run when they are loaded.
    """
    workbook, query, target, family_guids = _get_query_and_target(workbook_guid, query_guid, target_guid, user)
    if not family_guids:
        raise _error(f'{target} has no families to search')

    results_model = _get_results_model(workbook.project, query.search, family_guids, user)
    query_result, _ = get_or_create_model_from_json(
        WorksheetQueryResult, {'query': query, 'target': target}, None, user)
    update_json = {'results': results_model, 'last_run_date': timezone.now(), 'last_run_by': user}
    if query_result.results_id != results_model.id:
        update_json['num_results'] = None
    update_model_from_json(query_result, update_json, user)
    return query_result, results_model


@login_and_policies_required
def run_worksheet_query_handler(request, workbook_guid, query_guid, target_guid):
    query_result, results_model = run_worksheet_query(workbook_guid, query_guid, target_guid, request.user)

    return create_json_response({
        'searchHash': results_model.search_hash,
        'worksheetQueryResultsByGuid': _query_results_json([query_result]),
    })


def _results_not_loaded(message):
    return create_json_response({'errors': [message], 'resultsNotLoaded': True}, status=RESULTS_NOT_LOADED_STATUS)


def _get_family_hpo_ids(family_guids):
    family_hpo_ids = defaultdict(set)
    individuals = Individual.objects.filter(
        family__guid__in=family_guids, affected=Individual.AFFECTED_STATUS_AFFECTED,
    ).values_list('family__guid', 'features')
    for family_guid, features in individuals:
        for feature in features or []:
            family_hpo_ids[family_guid].add(feature['id'])
    return family_hpo_ids


def _phenotype_rows(families_by_id, hit_families, names=None):
    rows = [{
        'id': phenotype_id,
        'name': (names or {}).get(phenotype_id),
        'numFamilies': len(families),
        'numFamiliesWithResults': len(families & hit_families),
    } for phenotype_id, families in families_by_id.items()]
    return sorted(rows, key=lambda row: (-row['numFamilies'], row['id'] or ''))


def _phenotype_cross_tab(family_hpo_ids, hit_families):
    hpo_ids = {hpo_id for hpo_ids in family_hpo_ids.values() for hpo_id in hpo_ids}
    hpo_terms = {
        hpo_id: (name, category_id) for hpo_id, name, category_id in
        HumanPhenotypeOntology.objects.filter(hpo_id__in=hpo_ids).values_list('hpo_id', 'name', 'category_id')
    }
    families_by_term = defaultdict(set)
    families_by_category = defaultdict(set)
    for family_guid, family_ids in family_hpo_ids.items():
        for hpo_id in family_ids:
            families_by_term[hpo_id].add(family_guid)
            families_by_category[hpo_terms.get(hpo_id, (None, None))[1]].add(family_guid)

    terms = _phenotype_rows(families_by_term, hit_families, names={k: name for k, (name, _) in hpo_terms.items()})
    return {
        'phenotypeCategories': _phenotype_rows(families_by_category, hit_families),
        'phenotypeTerms': terms[:MAX_PHENOTYPE_TERMS],
        'totalPhenotypeTerms': len(terms),
    }


def _group_summary(results, family_guids, gene_id):
    """
    One pass over the cached results (at most MAX_VARIANTS results, each with the guids of its families) and one over
    the HPO terms of the affected individuals: O(variant-family pairs + individual-term pairs) time and memory.
    """
    flat_variants = flatten_search_results(results)
    gene_counts = get_gene_family_counts(flat_variants)
    genes = sorted([{
        'geneId': variant_gene_id,
        'numFamilies': len(counts['families']),
        'familyGuids': sorted(counts['families']),
        'numVariants': counts['total'],
    } for variant_gene_id, counts in gene_counts.items()], key=lambda gene: (
        -gene['numFamilies'], -gene['numVariants'], gene['geneId']))

    families_by_variant = defaultdict(set)
    gene_ids_by_variant = {}
    for variant in flat_variants:
        families_by_variant[variant['variantId']].update(variant.get('familyGuids', []))
        gene_ids_by_variant[variant['variantId']] = sorted(get_variant_gene_ids(variant))
    recurrent_variants = sorted([{
        'variantId': variant_id,
        'geneIds': gene_ids_by_variant[variant_id],
        'numFamilies': len(families),
        'familyGuids': sorted(families),
    } for variant_id, families in families_by_variant.items() if len(families) > 1], key=lambda variant: (
        -variant['numFamilies'], variant['variantId']))

    families_with_results = {guid for families in families_by_variant.values() for guid in families}
    hit_families = set(gene_counts[gene_id]['families']) if gene_id in gene_counts else set()
    family_hpo_ids = _get_family_hpo_ids(family_guids)
    return {
        'numFamilies': len(family_guids),
        'numFamiliesWithResults': len(families_with_results),
        'numFamiliesWithPhenotypes': len(family_hpo_ids),
        'totalVariants': len(results),
        'genes': genes[:MAX_SUMMARY_ROWS],
        'totalGenes': len(genes),
        'recurrentVariants': recurrent_variants[:MAX_SUMMARY_ROWS],
        'totalRecurrentVariants': len(recurrent_variants),
        'phenotypeGeneId': gene_id,
        **_phenotype_cross_tab(family_hpo_ids, hit_families if gene_id else families_with_results),
    }


@login_and_policies_required
def worksheet_query_group_summary_handler(request, workbook_guid, query_guid, target_guid):
    workbook, query, target, family_guids = _get_query_and_target(workbook_guid, query_guid, target_guid, request.user)
    if not target.analysis_group:
        raise _error(f'{target} is not an analysis group')

    query_result = WorksheetQueryResult.objects.filter(query=query, target=target).select_related('results').first()
    results_model = query_result.results if query_result else None
    if not results_model:
        return _results_not_loaded(f'This query has not been run for {target} yet, run it to see patterns')
    if set(results_model.families.values_list('guid', flat=True)) != set(family_guids):
        return _results_not_loaded(
            f'The families of {target} have changed since this query was run, run it again to see patterns')
    results = get_cached_search_results(results_model, request.user)
    if results is None:
        return _results_not_loaded(
            f'The results of this query for {target} are no longer stored, run it again to see patterns')

    summary = _group_summary(results, family_guids, request.GET.get('geneId') or None)
    gene_ids = {gene['geneId'] for gene in summary['genes']}
    gene_ids.update(gene_id for variant in summary['recurrentVariants'] for gene_id in variant['geneIds'])
    return create_json_response({
        'searchHash': results_model.search_hash,
        'genesById': get_genes_for_variant_display(list(gene_ids), workbook.project.genome_version),
        **summary,
    })


@login_and_policies_required
def mark_worksheet_query_result_reviewed_handler(request, workbook_guid, query_guid, target_guid):
    _, query, target, _ = _get_query_and_target(workbook_guid, query_guid, target_guid, request.user)
    with transaction.atomic():
        query_result = WorksheetQueryResult.objects.select_for_update().filter(query=query, target=target).first()
        run = get_completed_runs(query_result).first() if query_result else None
        if not run:
            raise _error(f'This query has no results for {target} to mark as reviewed')
        reviewed_keys = sorted(to_key_set(query_result.reviewed_keys) | to_key_set(run.result_keys))
        update_model_from_json(query_result, {
            'reviewed_keys': [list(key) for key in reviewed_keys], 'has_unreviewed': False,
        }, request.user)
    return create_json_response({'worksheetQueryResultsByGuid': _query_results_json([query_result])})


def _unreviewed_results_json(keys, query_result, user):
    results = get_cached_search_results(query_result.results, user) if keys and query_result.results else None
    gene_ids_by_variant = {
        variant['variantId']: sorted(get_variant_gene_ids(variant)) for variant in flatten_search_results(results or [])
    }
    return [{
        'familyGuid': key[0],
        'variantIds': get_key_variant_ids(key),
        'geneIds': sorted({
            gene_id for variant_id in get_key_variant_ids(key) for gene_id in gene_ids_by_variant.get(variant_id, [])
        }),
    } for key in keys]


@login_and_policies_required
def worksheet_query_result_history_handler(request, workbook_guid, query_guid, target_guid):
    workbook, query, target, _ = _get_query_and_target(workbook_guid, query_guid, target_guid, request.user)
    query_result = WorksheetQueryResult.objects.filter(query=query, target=target).select_related('results').first()
    query_results = [query_result] if query_result else []

    runs = _get_run_summaries().filter(cell__in=query_results).order_by('-id')
    unreviewed_keys_by_cell = get_unreviewed_keys_by_cell(query_results)
    unreviewed_keys = unreviewed_keys_by_cell[query_result.id] if unreviewed_keys_by_cell else []
    unreviewed_results = _unreviewed_results_json(unreviewed_keys[:MAX_UNREVIEWED_RESULTS], query_result, request.user)
    gene_ids = {gene_id for result in unreviewed_results for gene_id in result['geneIds']}
    return create_json_response({
        'worksheetQueryResultsByGuid': _query_results_json(query_results, unreviewed_keys_by_cell),
        'runs': [_run_json(run) for run in runs[:MAX_HISTORY_RUNS]],
        'totalRuns': runs.count(),
        'unreviewedResults': unreviewed_results,
        'totalUnreviewedResults': len(unreviewed_keys),
        'genesById': get_genes_for_variant_display(list(gene_ids), workbook.project.genome_version),
    })
