import json

from django.core.exceptions import PermissionDenied
from django.db.models import Q

from seqr.models import Family, Project, ReportTemplate
from seqr.utils.middleware import ErrorsWarningsException
from seqr.utils.report_template_utils import PLACEHOLDER_REFERENCE, RESEARCH_USE_LINE, render_template, \
    validate_template
from seqr.views.utils.json_to_orm_utils import create_model_from_json, update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.orm_to_json_utils import get_json_for_queryset
from seqr.views.utils.permissions_utils import login_and_policies_required, user_is_data_manager, \
    has_project_edit_permission, check_family_view_permission, \
    get_project_analysis_groups_and_check_view_permission
from seqr.views.utils.report_context_utils import get_family_report_context

EDITABLE_FIELDS = ['name', 'description', 'audience', 'body']
AUDIENCES = dict(ReportTemplate.AUDIENCE_CHOICES)
MAX_NAME_LENGTH = ReportTemplate._meta.get_field('name').max_length


def _get_templates_json(templates):
    return {
        template['reportTemplateGuid']: template
        for template in get_json_for_queryset(templates, nested_fields=[{'fields': ('project', 'guid')}])
    }


def _can_edit_template(project, user):
    return has_project_edit_permission(project, user) if project else user_is_data_manager(user)


def _check_template_edit_permission(project, user):
    if not _can_edit_template(project, user):
        raise PermissionDenied(
            f'{user} does not have permission to edit {f"report templates for {project}" if project else "global report templates"}'
        )


def _validate_template_fields(fields, project, template=None):
    errors = []
    name = fields['name']
    if not isinstance(name, str) or not name.strip():
        errors.append('Name is required')
    elif len(name.strip()) > MAX_NAME_LENGTH:
        errors.append(f'Name must be at most {MAX_NAME_LENGTH} characters')
    else:
        fields['name'] = name.strip()
    if not isinstance(fields['audience'], str) or fields['audience'] not in AUDIENCES:
        errors.append(f'Audience must be one of: {", ".join(AUDIENCES)}')
    if not (fields['description'] is None or isinstance(fields['description'], str)):
        errors.append('Description must be text')
    errors += validate_template(fields['body'])

    if not errors:
        duplicates = ReportTemplate.objects.filter(project=project, audience=fields['audience'], name=fields['name'])
        if template:
            duplicates = duplicates.exclude(id=template.id)
        if duplicates.exists():
            scope = f'project "{project.name}"' if project else 'all projects'
            errors.append(f'A {fields["audience"]} report template named "{fields["name"]}" already exists for {scope}')
    if errors:
        raise ErrorsWarningsException(errors)


@login_and_policies_required
def project_report_templates(request, project_guid):
    project, _ = get_project_analysis_groups_and_check_view_permission(project_guid, request.user)
    templates = ReportTemplate.objects.filter(Q(project=project) | Q(project__isnull=True))
    return create_json_response({
        'reportTemplatesByGuid': _get_templates_json(templates),
        'placeholders': PLACEHOLDER_REFERENCE,
        'audiences': [{'value': value, 'text': text} for value, text in ReportTemplate.AUDIENCE_CHOICES],
        'researchUseLine': RESEARCH_USE_LINE,
        'canEditProjectTemplates': _can_edit_template(project, request.user),
        'canEditGlobalTemplates': _can_edit_template(None, request.user),
    })


@login_and_policies_required
def create_report_template(request, project_guid=None):
    project = Project.objects.get(guid=project_guid) if project_guid else None
    _check_template_edit_permission(project, request.user)

    request_json = json.loads(request.body)
    fields = {field: request_json.get(field) for field in EDITABLE_FIELDS}
    _validate_template_fields(fields, project)
    template = create_model_from_json(ReportTemplate, {'project': project, **fields}, request.user)

    return create_json_response({
        'reportTemplatesByGuid': _get_templates_json(ReportTemplate.objects.filter(id=template.id)),
    })


@login_and_policies_required
def update_report_template(request, template_guid):
    template = ReportTemplate.objects.select_related('project').get(guid=template_guid)
    _check_template_edit_permission(template.project, request.user)

    request_json = json.loads(request.body)
    fields = {field: request_json.get(field, getattr(template, field)) for field in EDITABLE_FIELDS}
    _validate_template_fields(fields, template.project, template=template)
    update_model_from_json(template, fields, request.user)

    return create_json_response({
        'reportTemplatesByGuid': _get_templates_json(ReportTemplate.objects.filter(id=template.id)),
    })


@login_and_policies_required
def delete_report_template(request, template_guid):
    template = ReportTemplate.objects.select_related('project').get(guid=template_guid)
    _check_template_edit_permission(template.project, request.user)
    template.delete_model(request.user, user_can_delete=True)
    return create_json_response({'reportTemplatesByGuid': {template_guid: None}})


def _get_family_and_check_permission(family_guid, user):
    family = Family.objects.select_related('project').get(guid=family_guid)
    check_family_view_permission(family, user)
    return family


def _render_family_report(family, body):
    errors = validate_template(body)
    if errors:
        raise ErrorsWarningsException(errors)
    context, warnings = get_family_report_context(family)
    rendered = render_template(body, context)
    rendered['warnings'] = warnings + rendered['warnings']
    return create_json_response({'familyGuid': family.guid, **rendered})


@login_and_policies_required
def family_report(request, family_guid, template_guid):
    family = _get_family_and_check_permission(family_guid, request.user)
    template = ReportTemplate.objects.get(Q(project=family.project) | Q(project__isnull=True), guid=template_guid)
    return _render_family_report(family, template.body)


@login_and_policies_required
def preview_family_report(request, family_guid):
    family = _get_family_and_check_permission(family_guid, request.user)
    return _render_family_report(family, json.loads(request.body).get('body'))
