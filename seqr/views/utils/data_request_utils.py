from django.db.models import CharField, Exists, F, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce, NullIf
from django.utils import timezone
from notifications.signals import notify

from seqr.models import DataRequest, Individual
from seqr.utils.communication_utils import send_html_email, BASE_EMAIL_TEMPLATE
from seqr.utils.logging_utils import SeqrLogger
from seqr.views.utils.completeness_utils import COMPLETENESS_FIELD_LABELS
from seqr.views.utils.json_to_orm_utils import update_model_from_json
from seqr.views.utils.orm_to_json_utils import _get_json_for_individuals, _user_expr
from seqr.views.utils.permissions_utils import has_project_edit_permission
from settings import BASE_URL

logger = SeqrLogger(__name__)

# Selected in the query that already loads the edited individuals or family,
# so that edits without an open data request do not run any additional query
OPEN_DATA_REQUEST_KEY = 'openDataRequestId'
OPEN_DATA_REQUEST_VALUES = {
    OPEN_DATA_REQUEST_KEY: Subquery(DataRequest.objects.filter(
        individual=OuterRef('pk'), status=DataRequest.STATUS_OPEN,
    ).values('id')[:1]),
}
# A camel case name can not collide with a model field set from request json, as those are converted to snake case
FAMILY_OPEN_DATA_REQUEST_KEY = 'hasOpenDataRequest'
FAMILY_OPEN_DATA_REQUEST_ANNOTATION = {
    FAMILY_OPEN_DATA_REQUEST_KEY: Exists(DataRequest.objects.filter(
        individual__family=OuterRef('pk'), status=DataRequest.STATUS_OPEN,
    )),
}

RESOLVED_STATUS_VERBS = {
    DataRequest.STATUS_FULFILLED: 'fulfilled',
    DataRequest.STATUS_DECLINED: 'declined',
}

DATA_REQUEST_VALUES = dict(
    dataRequestGuid=F('guid'),
    individualGuid=F('individual__guid'),
    familyGuid=F('individual__family__guid'),
    individualName=Coalesce(
        NullIf('individual__display_name', Value('')), 'individual__individual_id', output_field=CharField()),
    requestedFields=F('requested_fields'),
    createdDate=F('created_date'),
    resolvedDate=F('resolved_date'),
    createdBy=_user_expr('created_by'),
    createdById=F('created_by_id'),
    assignedTo=_user_expr('assigned_to'),
    assignedToId=F('assigned_to_id'),
    assignedToUsername=F('assigned_to__username'),
    resolvedBy=_user_expr('resolved_by'),
)


def get_missing_fields(completeness):
    return {item['field'] for item in completeness['missing']} if completeness else None


def get_json_for_data_requests(data_requests, user, project, completeness_by_individual=None):
    """Serializes a DataRequest queryset from a single project

    Args:
        data_requests (QuerySet): DataRequest models, all for individuals in the given project
        user (User): the user the response is for, used to set the actions available to them
        project (Project): the project of the requests
        completeness_by_individual (dict): optional completeness json by individual guid, loaded if not provided
    Returns:
        dict of data request json by guid
    """
    data_requests_json = list(data_requests.values('reason', 'status', **DATA_REQUEST_VALUES))
    if not data_requests_json:
        return {}

    if completeness_by_individual is None:
        completeness_by_individual = {
            individual['individualGuid']: individual['completeness'] for individual in _get_json_for_individuals(
                Individual.objects.filter(guid__in={request['individualGuid'] for request in data_requests_json}))
        }

    can_edit = has_project_edit_permission(project, user)
    for request in data_requests_json:
        missing_fields = get_missing_fields(completeness_by_individual[request['individualGuid']])
        request['items'] = [{
            'field': field,
            'label': COMPLETENESS_FIELD_LABELS[field],
            'recorded': missing_fields is not None and field not in missing_fields,
        } for field in request.pop('requestedFields')]
        is_open = request['status'] == DataRequest.STATUS_OPEN
        request.update({
            'projectGuid': project.guid,
            'canCancel': request.pop('createdById') == user.id and is_open,
            'canResolve': is_open and (can_edit or request['assignedToId'] == user.id),
        })
        del request['assignedToId']

    return {request['dataRequestGuid']: request for request in data_requests_json}


def resolve_data_request(data_request, status, user):
    update_model_from_json(
        data_request, {'status': status, 'resolved_by': user, 'resolved_date': timezone.now()}, user)

    requester = data_request.created_by
    if status in RESOLVED_STATUS_VERBS and requester and requester != user:
        individual = data_request.individual
        notify.send(
            individual.family.project, recipient=[requester],
            verb=f'Data request for individual {_display_name(individual)} {RESOLVED_STATUS_VERBS[status]}',
        )


def fulfil_data_requests(parsed_individuals, user):
    """Marks open data requests as fulfilled once every requested field is recorded

    Args:
        parsed_individuals (list): individual json loaded with OPEN_DATA_REQUEST_VALUES, which is removed
        user (User): the user whose edit recorded the data
    Returns:
        dict of json by guid for the data requests that were open for the given individuals
    """
    individuals_by_request_id = {}
    for individual in parsed_individuals:
        request_id = individual.pop(OPEN_DATA_REQUEST_KEY)
        if request_id:
            individuals_by_request_id[request_id] = individual
    if not individuals_by_request_id:
        return {}

    data_requests = DataRequest.objects.filter(id__in=individuals_by_request_id).select_related(
        'individual__family__project', 'created_by')
    for data_request in data_requests:
        missing_fields = get_missing_fields(individuals_by_request_id[data_request.id]['completeness'])
        if missing_fields is not None and not missing_fields.intersection(data_request.requested_fields):
            resolve_data_request(data_request, DataRequest.STATUS_FULFILLED, user)

    return get_json_for_data_requests(
        DataRequest.objects.filter(id__in=individuals_by_request_id), user,
        data_requests[0].individual.family.project, completeness_by_individual={
            individual['individualGuid']: individual['completeness']
            for individual in individuals_by_request_id.values()
        })


def fulfil_family_data_requests(families, user):
    """Checks the open data requests of families loaded with FAMILY_OPEN_DATA_REQUEST_ANNOTATION"""
    family_ids = [family.id for family in families if getattr(family, FAMILY_OPEN_DATA_REQUEST_KEY, False)]
    if not family_ids:
        return {}
    return fulfil_data_requests(_get_json_for_individuals(
        Individual.objects.filter(family_id__in=family_ids, datarequest__status=DataRequest.STATUS_OPEN),
        additional_values=OPEN_DATA_REQUEST_VALUES,
    ), user)


def get_individual_completeness_and_fulfil_data_requests(individual, user):
    parsed_individuals = _get_json_for_individuals(
        Individual.objects.filter(id=individual.id), additional_values=OPEN_DATA_REQUEST_VALUES)
    fulfil_data_requests(parsed_individuals, user)
    return parsed_individuals[0]['completeness']


def notify_data_request(data_request, user, is_new, email_assignee):
    individual = data_request.individual
    project = individual.family.project
    display_name = _display_name(individual)
    assignee = data_request.assigned_to

    recipients = set(project.subscribers.user_set.all())
    if assignee:
        recipients.add(assignee)
    recipients.discard(user)
    num_fields = len(data_request.requested_fields)
    notify.send(
        # Notifications are only shown for the project once at least one user has received them
        project, recipient=list(recipients) or [user],
        verb=f'Data request {"created" if is_new else "updated"} for individual {display_name}: '
             f'{num_fields} item{"" if num_fields == 1 else "s"}',
    )

    if email_assignee and assignee and assignee != user:
        _send_assignee_email(data_request, project, display_name)


def _send_assignee_email(data_request, project, display_name):
    # Emails must not contain any patient data: only the individual display ID and a link back to seqr
    url = f'{BASE_URL}project/{project.guid}/family_page/{data_request.individual.family.guid}'
    email_kwargs = dict(
        email_body=BASE_EMAIL_TEMPLATE.format(
            f'A request for clinical data for individual {display_name} has been assigned to you in seqr. '
            f'<a href={url}>View the request in seqr</a> to see what has been requested.'
        ),
        to=[data_request.assigned_to.email],
        subject='Clinical data requested in seqr',
    )
    try:
        send_html_email(**email_kwargs)
    except Exception as e:
        logger.error(f'Error sending data request email for {data_request.guid}: {e}', None, detail=email_kwargs)


def _display_name(individual):
    return individual.display_name or individual.individual_id
