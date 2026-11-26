import json
from functools import wraps

from django.core.exceptions import PermissionDenied
from django.db.models import Q
from django.utils import timezone

from clinvar_submission.clinvar_client import send_submission
from clinvar_submission.clinvar_utils import get_clinvar_mode, get_config_error, get_assertion_criteria, \
    get_variant_context, get_default_fields, build_submission_content, build_deletion_content, map_classification, validate_fields
from clinvar_submission.constants import SENDING_MODES, EDITABLE_FIELDS, MODES_OF_INHERITANCE, COLLECTION_METHODS, \
    AFFECTED_STATUSES, ALLELE_ORIGINS, RECORD_STATUS_NOVEL, RECORD_STATUS_UPDATE
from clinvar_submission.models import ClinvarSubmission
from seqr.models import SavedVariant
from seqr.views.utils.json_to_orm_utils import update_model_from_json
from seqr.views.utils.json_utils import create_json_response, _to_camel_case, _to_snake_case
from seqr.views.utils.permissions_utils import login_and_policies_required, analyst_required, \
    check_project_edit_permission, get_project_and_check_view_permission, get_project_guids_user_can_view

USER_FIELDS = [
    'created_by', 'last_edited_by', 'reviewed_by', 'submitted_by', 'withdrawal_requested_by', 'status_last_modified_by',
]
UNSAVED_LOCAL_KEY = 'assigned-when-saved'
NOTHING_SENT_MESSAGE = 'DRY RUN: nothing was sent to ClinVar'


def _error_response(error, status=400):
    return create_json_response({'error': error}, status=status, reason=error)


def _clinvar_enabled(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        config_error = get_config_error()
        if config_error:
            return _error_response(config_error, status=403)
        return view_func(request, *args, **kwargs)
    return _wrapped


def clinvar_view(view_func):
    return login_and_policies_required(_clinvar_enabled(view_func))


def _user_display(user):
    return (user.get_full_name() or user.email) if user else None


def _get_json_for_submission(submission):
    saved_variant = submission.saved_variant
    family = saved_variant.family if saved_variant else None
    result = {
        _to_camel_case(field): getattr(submission, field) for field in ClinvarSubmission._meta.json_fields if field != 'guid'
    }
    result.update({_to_camel_case(field): _user_display(getattr(submission, field)) for field in USER_FIELDS})
    result.update({
        'submissionGuid': submission.guid,
        'statusLastModifiedDate': submission.status_last_modified_date,
        'recordStatus': RECORD_STATUS_UPDATE if submission.scv_accession else RECORD_STATUS_NOVEL,
        'variantGuid': saved_variant.guid if saved_variant else None,
        'variantId': saved_variant.variant_id if saved_variant else None,
        'familyGuid': family.guid if family else None,
        'projectGuid': family.project.guid if family else None,
    })
    return result


def _submission_queryset():
    return ClinvarSubmission.objects.select_related('saved_variant__family__project', *USER_FIELDS)


def _get_submission_and_check_permission(submission_guid, user):
    submission = _submission_queryset().get(guid=submission_guid)
    if not submission.saved_variant:
        raise PermissionDenied('The saved variant for this ClinVar submission no longer exists')
    check_project_edit_permission(submission.saved_variant.family.project, user)
    return submission


def _submission_fields(submission):
    return {field: getattr(submission, field) for field in EDITABLE_FIELDS}


def _build_content(saved_variant, fields, local_key, scv_accession, context=None):
    context = context or get_variant_context(saved_variant)
    content, errors = build_submission_content(
        context, fields, local_key, scv_accession=scv_accession, assertion_criteria=get_assertion_criteria(),
        require_assertion_criteria=get_clinvar_mode() in SENDING_MODES,
    )
    classification, _ = map_classification(context['acmgClassification'])
    return context, {'classification': classification, 'payload': content, 'validation_errors': errors}


def _back_to_draft_if_changed(submission, user):
    """The approved record must be the record that is sent: any drift in the underlying data restarts the review."""
    _, built = _build_content(
        submission.saved_variant, _submission_fields(submission), submission.guid, submission.scv_accession)
    if built['payload'] is not None and built['payload'] == submission.payload:
        return None
    update_model_from_json(submission, {
        **built, 'status': ClinvarSubmission.STATUS_DRAFT, 'reviewed_by': None, 'reviewed_date': None,
    }, user)
    if built['validation_errors']:
        return _error_response(f'The record is not valid: {"; ".join(built["validation_errors"])}')
    return _error_response(
        'The variant, family or configuration changed since this record was drafted. It has been rebuilt and '
        'returned to draft: check it and request review again')


def _draft_response(submission, saved_variant, context, preview=None):
    submission_json = _get_json_for_submission(submission) if submission else {
        **{_to_camel_case(k): v for k, v in preview.items()},
        'submissionGuid': None, 'status': None, 'recordStatus': RECORD_STATUS_NOVEL, 'variantGuid': saved_variant.guid,
    }
    return create_json_response({
        'clinvarSubmission': submission_json,
        'clinvarMode': get_clinvar_mode(),
        'observation': context['observation'],
        'options': {
            'conditionId': context['conditionOptions'],
            'modeOfInheritance': MODES_OF_INHERITANCE,
            'collectionMethod': COLLECTION_METHODS,
            'affectedStatus': AFFECTED_STATUSES,
            'alleleOrigin': ALLELE_ORIGINS,
        },
    })


@clinvar_view
def clinvar_submission_draft(request, variant_guid):
    saved_variant = SavedVariant.objects.select_related('family__project').get(guid=variant_guid)
    check_project_edit_permission(saved_variant.family.project, request.user)
    submission = _submission_queryset().filter(saved_variant=saved_variant).exclude(
        status=ClinvarSubmission.STATUS_WITHDRAWN).first()

    if request.method != 'POST':
        context = get_variant_context(saved_variant)
        if submission:
            return _draft_response(submission, saved_variant, context)
        fields = get_default_fields(context)
        _, built = _build_content(saved_variant, fields, UNSAVED_LOCAL_KEY, None, context=context)
        return _draft_response(submission, saved_variant, context, preview={**fields, **built})

    request_fields = {_to_snake_case(k): v for k, v in json.loads(request.body).items()}
    not_editable = sorted(set(request_fields) - set(EDITABLE_FIELDS))
    if not_editable:
        return _error_response(f'These fields cannot be set: {", ".join(not_editable)}. The ClinVar record is built by seqr')
    if submission and submission.status not in ClinvarSubmission.EDITABLE_STATUSES:
        return _error_response(
            f'A {submission.get_status_display().lower()} ClinVar submission cannot be edited until ClinVar has processed it')

    context = get_variant_context(saved_variant)
    field_errors = validate_fields(context, request_fields)
    if field_errors:
        return _error_response('; '.join(field_errors))
    if 'citations' in request_fields:
        request_fields['citations'] = [str(c) for c in request_fields['citations'] or []]

    if submission:
        fields = {**_submission_fields(submission), **request_fields}
    else:
        fields = {**get_default_fields(context), **request_fields}
        submission = ClinvarSubmission.objects.create(saved_variant=saved_variant, created_by=request.user)

    _, built = _build_content(saved_variant, fields, submission.guid, submission.scv_accession, context=context)
    update_model_from_json(submission, {
        **fields, **built, 'status': ClinvarSubmission.STATUS_DRAFT, 'last_edited_by': request.user,
        'reviewed_by': None, 'reviewed_date': None, 'withdrawal_requested_by': None, 'withdrawal_requested_date': None,
    }, request.user)
    return _draft_response(submission, saved_variant, context)


def _submission_response(submission, **kwargs):
    return create_json_response({'clinvarSubmission': _get_json_for_submission(submission), **kwargs})


@clinvar_view
def request_clinvar_submission_review(request, submission_guid):
    submission = _get_submission_and_check_permission(submission_guid, request.user)
    if submission.status != ClinvarSubmission.STATUS_DRAFT:
        return _error_response('Only a draft can be sent for review')
    changed_response = _back_to_draft_if_changed(submission, request.user)
    if changed_response:
        return changed_response
    update_model_from_json(submission, {'status': ClinvarSubmission.STATUS_IN_REVIEW}, request.user)
    return _submission_response(submission)


@clinvar_view
def approve_clinvar_submission(request, submission_guid):
    submission = _get_submission_and_check_permission(submission_guid, request.user)
    if submission.status != ClinvarSubmission.STATUS_IN_REVIEW:
        return _error_response('Only a submission that is in review can be approved')
    if request.user in {submission.created_by, submission.last_edited_by}:
        return _error_response('A ClinVar submission must be approved by a different user than its author', status=403)
    changed_response = _back_to_draft_if_changed(submission, request.user)
    if changed_response:
        return changed_response
    update_model_from_json(submission, {
        'status': ClinvarSubmission.STATUS_APPROVED, 'reviewed_by': request.user, 'reviewed_date': timezone.now(),
    }, request.user)
    return _submission_response(submission)


@clinvar_view
def submit_clinvar_submission(request, submission_guid):
    submission = _get_submission_and_check_permission(submission_guid, request.user)
    is_retry = submission.status == ClinvarSubmission.STATUS_ERROR and submission.reviewed_by
    if not (submission.status in ClinvarSubmission.SUBMITTABLE_STATUSES or is_retry):
        return _error_response('Only an approved submission can be submitted')
    changed_response = _back_to_draft_if_changed(submission, request.user)
    if changed_response:
        return changed_response

    dry_run = send_submission(submission.payload, request.user, dry_run=True)
    update_json = {'response': {'dryRun': dry_run}, 'status': ClinvarSubmission.STATUS_ERROR}
    message = dry_run['message']
    if dry_run['ok']:
        update_json['status'] = ClinvarSubmission.STATUS_DRY_RUN_PASSED
        mode = get_clinvar_mode()
        if mode in SENDING_MODES:
            result = send_submission(submission.payload, request.user, dry_run=False)
            update_json['response']['submission'] = result
            message = result['message']
            if result['ok']:
                update_json.update({
                    'status': ClinvarSubmission.STATUS_SUBMITTED, 'ncbi_submission_id': result['submissionId'],
                    'submission_mode': mode, 'submitted_by': request.user, 'submitted_date': timezone.now(),
                })
            else:
                update_json['status'] = ClinvarSubmission.STATUS_ERROR
        else:
            message = f'{NOTHING_SENT_MESSAGE}. {message}'
    update_model_from_json(submission, update_json, request.user)
    return _submission_response(submission, message=message)


@clinvar_view
def withdraw_clinvar_submission(request, submission_guid):
    submission = _get_submission_and_check_permission(submission_guid, request.user)
    if submission.status == ClinvarSubmission.STATUS_WITHDRAWN:
        return _error_response('This submission is already withdrawn')
    if submission.status == ClinvarSubmission.STATUS_SUBMITTED:
        return _error_response('ClinVar has not processed this submission yet: it can be withdrawn once it has an accession')

    if not submission.scv_accession:
        update_model_from_json(submission, {'status': ClinvarSubmission.STATUS_WITHDRAWN}, request.user)
        return _submission_response(submission, message='Withdrawn. Nothing had been published in ClinVar')

    if not submission.withdrawal_requested_by:
        update_model_from_json(submission, {
            'withdrawal_requested_by': request.user, 'withdrawal_requested_date': timezone.now(),
        }, request.user)
        return _submission_response(
            submission, message=f'Deletion of {submission.scv_accession} requested: a different user must confirm it')
    if submission.withdrawal_requested_by == request.user:
        return _error_response(
            'The deletion must be confirmed by a different user than the one who requested it', status=403)

    content = build_deletion_content(submission.scv_accession)
    dry_run = send_submission(content, request.user, dry_run=True)
    response = {**(submission.response or {}), 'deletionPayload': content, 'deletionDryRun': dry_run}
    update_json = {'response': response}
    message = dry_run['message']
    if dry_run['ok']:
        if get_clinvar_mode() in SENDING_MODES:
            result = send_submission(content, request.user, dry_run=False)
            response['deletion'] = result
            message = result['message']
            if result['ok']:
                update_json['status'] = ClinvarSubmission.STATUS_WITHDRAWN
        else:
            message = f'{NOTHING_SENT_MESSAGE}. {message}'
    update_model_from_json(submission, update_json, request.user)
    return _submission_response(submission, message=message)


def _submissions_response(submissions):
    return create_json_response({
        'clinvarSubmissions': [_get_json_for_submission(s) for s in submissions.order_by('-last_modified_date')],
        'clinvarMode': get_clinvar_mode(),
    })


@clinvar_view
def project_clinvar_submissions(request, project_guid):
    project = get_project_and_check_view_permission(project_guid, request.user)
    return _submissions_response(_submission_queryset().filter(saved_variant__family__project=project))


@analyst_required
@_clinvar_enabled
def all_clinvar_submissions(request):
    project_guids = get_project_guids_user_can_view(request.user)
    return _submissions_response(_submission_queryset().filter(
        Q(saved_variant__family__project__guid__in=project_guids) | Q(saved_variant__isnull=True)))
