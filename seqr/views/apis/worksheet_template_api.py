"""
APIs for worksheet templates: a named list of queries (search patterns) that worksheets of a workbook are created from.

A worksheet that is created from a template gets a copy of the queries of the template and keeps the guid of the
template as provenance only. Changing or deleting a template never changes a worksheet, its queries or its history.

Permissions:
- A template can be viewed and used by its creator, by everyone if it is public, and by users with view access to a
  project it is attached to.
- A template can be changed and deleted by its creator, and by analysts and data managers if it is public. Only
  analysts and data managers can make a template public, and only its creator can make it private again.
- Attaching a template to a project requires view access to the template and edit access to the project. Detaching
  requires edit access to the project.
- The default templates are public templates without a creator, loaded from the worksheet_templates fixture.
- As for saved searches without a creator, HGMD filters of templates of other users are not given to users that are
  not analysts.
"""
from copy import deepcopy
import json

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q

from seqr.models import Worksheet, WorksheetQuery, WorksheetTemplate
from seqr.utils.logging_utils import SeqrLogger, log_model_update
from seqr.views.apis.variant_search_api import validate_saved_search_json
from seqr.views.apis.workbook_api import _by_guid, _check_unique_name, _error, _get_workbook, _next_order, \
    _parse_name, _parse_optional_text, _queries_json, _worksheets_json
from seqr.views.utils.json_to_orm_utils import create_model_from_json, update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.orm_to_json_utils import _get_json_for_models
from seqr.views.utils.permissions_utils import check_worksheet_template_permissions, \
    get_project_and_check_edit_permission, get_project_guids_user_can_view, has_worksheet_template_edit_permission, \
    login_and_policies_required, user_can_set_worksheet_template_public, user_is_analyst

logger = SeqrLogger(__name__)

MAX_TEMPLATE_QUERIES = 50


def _queries_for_user(template, user, is_analyst):
    queries = deepcopy(template.queries)
    if is_analyst or template.created_by_id == user.id:
        return queries
    for query in queries:
        pathogenicity = query['search'].get('pathogenicity') or {}
        if pathogenicity.get('hgmd'):
            query['search']['pathogenicity'] = {k: v for k, v in pathogenicity.items() if k != 'hgmd'}
    return queries


def _templates_json(templates, user):
    project_guids = set(get_project_guids_user_can_view(user))
    is_analyst = user_is_analyst(user)
    can_set_public = user_can_set_worksheet_template_public(user)

    def _process_result(result, template):
        is_creator = template.created_by_id == user.id
        result.update({
            'queries': _queries_for_user(template, user, is_analyst),
            'projectGuids': sorted(project.guid for project in template.projects.all() if project.guid in project_guids),
            'isCreator': is_creator,
            'canEdit': is_creator or (template.is_public and can_set_public),
        })

    return _by_guid(_get_json_for_models(templates, process_result=_process_result), 'worksheetTemplateGuid')


def _template_response(template, user):
    return create_json_response({'worksheetTemplatesByGuid': _templates_json([template], user)})


def _get_template(template_guid, user, can_edit=False):
    template = WorksheetTemplate.objects.get(guid=template_guid)
    check_worksheet_template_permissions(template, user)
    if can_edit and not has_worksheet_template_edit_permission(template, user):
        raise PermissionDenied(f'{user} does not have sufficient permissions to edit {template}')
    return template


def parse_template_queries(queries):
    if not (isinstance(queries, list) and queries):
        raise _error('"queries" must be a list of at least one query')
    if len(queries) > MAX_TEMPLATE_QUERIES:
        raise _error(f'A template can not have more than {MAX_TEMPLATE_QUERIES} queries')

    parsed_queries = []
    for query in queries:
        if not isinstance(query, dict):
            raise _error('Every query must have a "name" and a "search"')
        name = _parse_name(query)
        search = query.get('search')
        if not isinstance(search, dict):
            raise _error(f'The "search" of query "{name}" must be a JSON object')
        error = validate_saved_search_json(search)
        if error:
            raise _error(f'{name}: {error}')
        parsed_queries.append({'name': name, 'search': search})
    return parsed_queries


def _parse_is_public(request_json, user, current_is_public=False):
    is_public = request_json['isPublic']
    if not isinstance(is_public, bool):
        raise _error('"isPublic" must be true or false')
    if is_public != current_is_public and not user_can_set_worksheet_template_public(user):
        raise PermissionDenied(f'{user} does not have sufficient permissions to change if a template is public')
    return is_public


def _check_can_make_private(template, user):
    # A private template is only visible to its creator, anyone else would lose the template by making it private
    if template.created_by_id != user.id:
        raise _error('Only the creator of a template can make it private')


def _get_worksheet_queries(request_json, user):
    workbook = _get_workbook(request_json.get('workbookGuid'), user)
    worksheet = workbook.worksheet_set.get(guid=request_json['worksheetGuid'])
    queries = [
        {'name': query.name, 'search': deepcopy(query.search)}
        for query in worksheet.worksheetquery_set.order_by('order', 'id')
    ]
    if not queries:
        raise _error(f'Worksheet "{worksheet.name}" has no queries to save as a template')
    return queries


@login_and_policies_required
def worksheet_templates_handler(request):
    project_guids = get_project_guids_user_can_view(request.user)
    templates = WorksheetTemplate.objects.filter(
        Q(is_public=True) | Q(created_by=request.user) | Q(projects__guid__in=project_guids),
    ).distinct().order_by('name', 'id').prefetch_related('projects')
    return create_json_response({'worksheetTemplatesByGuid': _templates_json(list(templates), request.user)})


@login_and_policies_required
def create_worksheet_template_handler(request):
    request_json = json.loads(request.body)
    has_worksheet = 'worksheetGuid' in request_json
    if has_worksheet == ('queries' in request_json):
        raise _error('Exactly one of "queries" or "worksheetGuid" is required')

    template_json = {'name': _parse_name(request_json)}
    if 'description' in request_json:
        template_json['description'] = _parse_optional_text(request_json, 'description')
    if 'isPublic' in request_json:
        template_json['is_public'] = _parse_is_public(request_json, request.user)
    template_json['queries'] = _get_worksheet_queries(request_json, request.user) if has_worksheet else \
        parse_template_queries(request_json['queries'])

    template = create_model_from_json(WorksheetTemplate, template_json, request.user)
    return _template_response(template, request.user)


@login_and_policies_required
def update_worksheet_template_handler(request, template_guid):
    template = _get_template(template_guid, request.user, can_edit=True)
    request_json = json.loads(request.body)

    update_json = {}
    if 'name' in request_json:
        update_json['name'] = _parse_name(request_json)
    if 'description' in request_json:
        update_json['description'] = _parse_optional_text(request_json, 'description')
    if 'queries' in request_json:
        update_json['queries'] = parse_template_queries(request_json['queries'])
    if 'isPublic' in request_json:
        update_json['is_public'] = _parse_is_public(request_json, request.user, current_is_public=template.is_public)
        if template.is_public and not update_json['is_public']:
            _check_can_make_private(template, request.user)
    update_model_from_json(template, update_json, request.user)

    return _template_response(template, request.user)


@login_and_policies_required
def delete_worksheet_template_handler(request, template_guid):
    template = _get_template(template_guid, request.user, can_edit=True)
    template.delete_model(request.user, user_can_delete=True)
    return create_json_response({'worksheetTemplatesByGuid': {template_guid: None}})


def _set_project_template(request, project_guid, template_guid, attach):
    project = get_project_and_check_edit_permission(project_guid, request.user)
    template = WorksheetTemplate.objects.get(guid=template_guid)
    if attach:
        check_worksheet_template_permissions(template, request.user)
        template.projects.add(project)
    else:
        template.projects.remove(project)
    log_model_update(logger, template, request.user, 'update', update_fields=['projects'])
    return _template_response(template, request.user)


@login_and_policies_required
def attach_project_worksheet_template_handler(request, project_guid, template_guid):
    return _set_project_template(request, project_guid, template_guid, attach=True)


@login_and_policies_required
def detach_project_worksheet_template_handler(request, project_guid, template_guid):
    return _set_project_template(request, project_guid, template_guid, attach=False)


@login_and_policies_required
def create_worksheet_from_template_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user, can_edit=True)
    request_json = json.loads(request.body)
    template = _get_template(request_json.get('worksheetTemplateGuid'), request.user)
    name = _parse_name({'name': request_json.get('name') or template.name})
    _check_unique_name(workbook.worksheet_set, name, 'worksheet')

    with transaction.atomic():
        worksheet = create_model_from_json(Worksheet, {
            'workbook': workbook, 'name': name, 'order': _next_order(workbook.worksheet_set),
            'template_guid': template.guid,
        }, request.user)
        queries = [
            create_model_from_json(WorksheetQuery, {'worksheet': worksheet, 'order': order, **query}, request.user)
            for order, query in enumerate(_queries_for_user(template, request.user, user_is_analyst(request.user)))
        ]

    return create_json_response({
        'worksheetsByGuid': _worksheets_json([worksheet], workbook),
        'worksheetQueriesByGuid': _queries_json(queries),
    })
