"""
APIs for workbooks: a workbook belongs to one project and holds targets (a family or an analysis group), worksheets and
their queries (search patterns). A WorksheetQueryResult is the "cell" for one query and one target.

Permissions:
- All endpoints require view access to the project of the workbook.
- Any user with view access to a project can create a workbook in it. Changing a workbook and its targets, worksheets
  and queries requires view access and either edit access to the project or being the creator of the workbook.
- Updating or running a cell requires view access to the project and to the families of the target.
- Every endpoint that returns or uses targets checks view access to the families of those targets.
"""
from copy import deepcopy
import json

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Max, Q, prefetch_related_objects
from django.utils import timezone
from django.utils.crypto import salted_hmac

from seqr.models import AnalysisGroup, Family, Workbook, WorkbookTarget, Worksheet, WorksheetQuery, WorksheetQueryResult
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.apis.variant_search_api import _get_or_create_results_model, get_saved_search_models, \
    validate_saved_search_json
from seqr.views.utils.json_to_orm_utils import create_model_from_json, get_or_create_model_from_json, \
    update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.orm_to_json_utils import _get_json_for_models, get_json_for_saved_searches
from seqr.views.utils.permissions_utils import check_families_view_permission, get_project_and_check_view_permission, \
    has_project_edit_permission, login_and_policies_required

# The search page hashes are 32 character hex MD5 digests, so a prefixed hash can never be equal to one of them
SEARCH_HASH_PREFIX = 'WB'
SEARCH_HASH_SALT = 'seqr.workbook.search_hash'
SEARCH_HASH_DIGEST_LENGTH = 48


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


def _query_results_json(query_results):
    def _process_result(result, query_result):
        user = query_result.last_run_by
        result['lastRunBy'] = (user.get_full_name() or user.email) if user else None

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
    name = _parse_name(json.loads(request.body))
    _check_unique_name(workbook.worksheet_set.exclude(id=worksheet.id), name, 'worksheet')
    update_model_from_json(worksheet, {'name': name}, request.user)
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


@login_and_policies_required
def run_worksheet_query_handler(request, workbook_guid, query_guid, target_guid):
    workbook, query, target, family_guids = _get_query_and_target(workbook_guid, query_guid, target_guid, request.user)
    if not family_guids:
        raise _error(f'{target} has no families to search')

    results_model = _get_results_model(workbook.project, query.search, family_guids, request.user)
    query_result, _ = get_or_create_model_from_json(
        WorksheetQueryResult, {'query': query, 'target': target}, None, request.user)
    update_json = {'results': results_model, 'last_run_date': timezone.now(), 'last_run_by': request.user}
    if query_result.results_id != results_model.id:
        update_json['num_results'] = None
    update_model_from_json(query_result, update_json, request.user)

    return create_json_response({
        'searchHash': results_model.search_hash,
        'worksheetQueryResultsByGuid': _query_results_json([query_result]),
    })
