import json

from django.contrib.auth.models import User
from django.core.exceptions import PermissionDenied

from seqr.models import DataRequest, Individual
from seqr.views.utils.completeness_utils import COMPLETENESS_FIELD_LABELS
from seqr.views.utils.data_request_utils import get_json_for_data_requests, get_missing_fields, \
    notify_data_request, resolve_data_request, OPEN_DATA_REQUEST_KEY, OPEN_DATA_REQUEST_VALUES
from seqr.views.utils.json_to_orm_utils import create_model_from_json, update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.orm_to_json_utils import _get_json_for_individuals, get_project_collaborators_by_username
from seqr.views.utils.permissions_utils import check_family_view_permission, has_project_edit_permission, \
    get_project_and_check_view_permission, login_and_policies_required

# Request bodies are written to the application log, so requests only accept coded values and never free text
CREATE_FIELDS = {'individualGuid', 'requestedFields', 'reason', 'assignedTo'}
UPDATE_STATUS_FIELDS = {'status'}

ALL_STATUSES = 'all'
STATUSES = {status for status, _ in DataRequest.STATUS_CHOICES}
REASONS = {reason for reason, _ in DataRequest.REASON_CHOICES}
RESOLVED_STATUSES = STATUSES - {DataRequest.STATUS_OPEN}


class InvalidDataRequest(Exception):
    pass


def _error_response(error):
    return create_json_response({'error': error}, status=400, reason=error)


def _parse_request_json(request, allowed_fields):
    request_json = json.loads(request.body)
    unknown_fields = sorted(set(request_json) - allowed_fields)
    if unknown_fields:
        raise InvalidDataRequest(f'Unsupported fields: {", ".join(unknown_fields)}')
    return request_json


@login_and_policies_required
def project_data_requests(request, project_guid):
    project = get_project_and_check_view_permission(project_guid, request.user)

    data_requests = DataRequest.objects.filter(individual__family__project=project)
    status = request.GET.get('status', DataRequest.STATUS_OPEN)
    if status != ALL_STATUSES:
        if status not in STATUSES:
            return _error_response(f'Invalid status: {status}')
        data_requests = data_requests.filter(status=status)
    if request.GET.get('dataRequestGuids'):
        data_requests = data_requests.filter(guid__in=request.GET['dataRequestGuids'].split(','))

    return create_json_response({
        'dataRequestsByGuid': get_json_for_data_requests(data_requests, request.user, project),
    })


@login_and_policies_required
def create_data_request(request, project_guid):
    try:
        request_json = _parse_request_json(request, CREATE_FIELDS)
    except InvalidDataRequest as e:
        return _error_response(str(e))

    individual = Individual.objects.select_related('family__project').get(
        guid=request_json.get('individualGuid'), family__project__guid=project_guid)
    project = individual.family.project
    check_family_view_permission(individual.family, request.user)

    parsed_individual = _get_json_for_individuals(
        Individual.objects.filter(id=individual.id), additional_values=OPEN_DATA_REQUEST_VALUES)[0]
    try:
        update_json = _parse_data_request(request_json, parsed_individual['completeness'], project, request.user)
    except InvalidDataRequest as e:
        return _error_response(str(e))

    open_request_id = parsed_individual[OPEN_DATA_REQUEST_KEY]
    if open_request_id:
        # An individual has at most one open request, so newly requested fields are added to it
        data_request = DataRequest.objects.get(id=open_request_id)
        previous_assignee = data_request.assigned_to
        update_json['requested_fields'] = data_request.requested_fields + [
            field for field in update_json['requested_fields'] if field not in data_request.requested_fields
        ]
        is_updated = update_model_from_json(data_request, update_json, request.user)
        if is_updated:
            notify_data_request(
                data_request, request.user, is_new=False,
                email_assignee=data_request.assigned_to != previous_assignee)
    else:
        data_request = create_model_from_json(DataRequest, {'individual': individual, **update_json}, request.user)
        notify_data_request(data_request, request.user, is_new=True, email_assignee=True)

    return create_json_response({'dataRequestsByGuid': get_json_for_data_requests(
        DataRequest.objects.filter(id=data_request.id), request.user, project,
        completeness_by_individual={individual.guid: parsed_individual['completeness']},
    )})


def _parse_data_request(request_json, completeness, project, user):
    requested_fields = request_json.get('requestedFields')
    if not (requested_fields and isinstance(requested_fields, list)):
        raise InvalidDataRequest('At least one clinical data field is required')
    invalid_fields = [
        str(field) for field in requested_fields
        if not (isinstance(field, str) and field in COMPLETENESS_FIELD_LABELS)
    ]
    if invalid_fields:
        raise InvalidDataRequest(f'Invalid clinical data fields: {", ".join(invalid_fields)}')
    requested_fields = list(dict.fromkeys(requested_fields))

    missing_fields = get_missing_fields(completeness)
    if missing_fields is None:
        raise InvalidDataRequest('Clinical data can only be requested for affected individuals')
    recorded_fields = [field for field in requested_fields if field not in missing_fields]
    if recorded_fields:
        raise InvalidDataRequest(
            f'Clinical data is already recorded or is not applicable for: {", ".join(recorded_fields)}')

    update_json = {'requested_fields': requested_fields}

    reason = request_json.get('reason')
    if reason:
        if not (isinstance(reason, str) and reason in REASONS):
            raise InvalidDataRequest(f'Invalid reason: {reason}')
        update_json['reason'] = reason

    assigned_to = request_json.get('assignedTo')
    if assigned_to:
        collaborators = get_project_collaborators_by_username(user, project, expand_user_groups=True)
        is_collaborator = isinstance(assigned_to, str) and assigned_to in collaborators
        assignee = User.objects.filter(username=assigned_to).first() if is_collaborator else None
        if not assignee:
            raise InvalidDataRequest('Data requests can only be assigned to collaborators of the project')
        update_json['assigned_to'] = assignee

    return update_json


@login_and_policies_required
def update_data_request_status(request, project_guid, data_request_guid):
    data_request = DataRequest.objects.select_related('individual__family__project', 'created_by').get(
        guid=data_request_guid, individual__family__project__guid=project_guid)
    project = data_request.individual.family.project
    check_family_view_permission(data_request.individual.family, request.user)

    try:
        request_json = _parse_request_json(request, UPDATE_STATUS_FIELDS)
    except InvalidDataRequest as e:
        return _error_response(str(e))
    status = request_json.get('status')
    if not (isinstance(status, str) and status in RESOLVED_STATUSES):
        return _error_response(f'Invalid status: {status}')

    if status == DataRequest.STATUS_CANCELLED:
        can_update = data_request.created_by == request.user
    else:
        can_update = has_project_edit_permission(project, request.user) or data_request.assigned_to_id == request.user.id
    if not can_update:
        raise PermissionDenied(f'{request.user} does not have sufficient permissions for {data_request}')

    if data_request.status != DataRequest.STATUS_OPEN:
        return _error_response('Only open data requests can be updated')

    resolve_data_request(data_request, status, request.user)

    return create_json_response({'dataRequestsByGuid': get_json_for_data_requests(
        DataRequest.objects.filter(id=data_request.id), request.user, project,
    )})
