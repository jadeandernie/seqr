import json
from collections import defaultdict
from datetime import datetime, timedelta
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q
from django.db.models.fields.json import KT
from django.utils import timezone

from matchmaker.matchmaker_utils import get_mme_genes_phenotypes_for_results, get_gene_ids_for_feature
from matchmaker.models import MatchmakerResult, MatchmakerSubmission, MatchmakerSubmissionGenes
from matchmaker.result_status import STATUSES, STATUS_NEW, STATUS_REVIEWING
from seqr.models import Family
from seqr.utils.gene_utils import get_genes, get_gene_ids_for_gene_symbols
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.utils.json_to_orm_utils import update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.permissions_utils import login_and_policies_required, \
    get_project_analysis_group_guids_user_can_view

ALL_STATUSES = 'all'
DEFAULT_STATUSES = [STATUS_NEW, STATUS_REVIEWING]
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_BULK_UPDATE_RESULTS = 500
DATE_FORMAT = '%Y-%m-%d'
SOURCES = [source for source, _ in MatchmakerResult.SOURCE_CHOICES]

PROJECT_GUID_FIELD = 'submission__individual__family__project__guid'
PROJECT_NAME_FIELD = 'submission__individual__family__project__name'


def _get_triage_results(user, limit_data_manager=True):
    project_guids, analysis_group_guids = get_project_analysis_group_guids_user_can_view(
        user, limit_data_manager=limit_data_manager)
    families = Family.objects.filter(
        Q(project__guid__in=project_guids) | Q(analysisgroup__guid__in=analysis_group_guids or []),
        project__is_mme_enabled=True, project__is_demo=False,
    )
    return MatchmakerResult.objects.filter(
        submission__individual__family__in=families, submission__deleted_date__isnull=True,
    ).annotate(institution=KT('result_data__patient__contact__institution'))


def _invalid(message):
    return ErrorsWarningsException([message])


def _parse_int_param(request, key, default, max_value=None):
    value = request.GET.get(key)
    if not value:
        return default
    if not value.isdigit() or int(value) < 1:
        raise _invalid(f'Invalid {key}: {value}')
    return min(int(value), max_value) if max_value else int(value)


def _parse_date_param(request, key):
    value = request.GET.get(key)
    if not value:
        return None
    try:
        return timezone.make_aware(datetime.strptime(value, DATE_FORMAT))
    except ValueError:
        raise _invalid(f'Invalid {key}: {value}. Dates must be formatted as YYYY-MM-DD')


def _parse_choices_param(request, key, choices):
    values = [value for value in request.GET.get(key, '').split(',') if value]
    invalid = [value for value in values if value not in choices]
    if invalid:
        raise _invalid(f'Invalid {key}: {", ".join(invalid)}')
    return values


def _get_gene_filter(gene):
    names = {gene, gene.upper()}
    for gene_ids in get_gene_ids_for_gene_symbols(names).values():
        names.update(gene_ids)
    names.update({gene['geneSymbol'] for gene in get_genes(names).values()})

    gene_q = Q(submission__in=MatchmakerSubmission.objects.filter(matchmakersubmissiongenes__gene_id__in=names))
    for name in names:
        gene_q |= Q(result_data__patient__genomicFeatures__contains=[{'gene': {'id': name}}])
    return gene_q


def _filter_results(request, results):
    if request.GET.get('includeRemoved') != 'true':
        results = results.filter(match_removed=False)

    project_guid = request.GET.get('projectGuid')
    if project_guid:
        results = results.filter(**{PROJECT_GUID_FIELD: project_guid})

    institution = request.GET.get('institution')
    if institution:
        results = results.filter(institution__iexact=institution)

    sources = _parse_choices_param(request, 'source', SOURCES)
    if sources:
        results = results.filter(source__in=sources)

    if request.GET.get('assignedToMe') == 'true':
        results = results.filter(assigned_to=request.user)

    start_date = _parse_date_param(request, 'startDate')
    if start_date:
        results = results.filter(created_date__gte=start_date)
    end_date = _parse_date_param(request, 'endDate')
    if end_date:
        results = results.filter(created_date__lt=end_date + timedelta(days=1))

    gene = request.GET.get('gene', '').strip()
    if gene:
        results = results.filter(_get_gene_filter(gene))

    return results


@login_and_policies_required
def matchmaker_inbox(request):
    statuses = _parse_choices_param(request, 'status', [ALL_STATUSES, *STATUSES]) or DEFAULT_STATUSES
    page = _parse_int_param(request, 'page', 1)
    per_page = _parse_int_param(request, 'perPage', DEFAULT_PAGE_SIZE, max_value=MAX_PAGE_SIZE)

    accessible_results = _get_triage_results(request.user)
    results = _filter_results(request, accessible_results)

    status_counts = {status: 0 for status in STATUSES}
    status_counts.update({
        agg['status']: agg['count'] for agg in results.order_by().values('status').annotate(count=Count('pk'))
    })

    if ALL_STATUSES not in statuses:
        results = results.filter(status__in=statuses)
    total = results.count()
    offset = (page - 1) * per_page
    page_results = list(results.order_by('-created_date', 'guid').select_related(
        'submission__individual__family__project', 'assigned_to',
    )[offset:offset + per_page])

    institutions = accessible_results.exclude(institution__isnull=True).exclude(institution='').order_by().values_list(
        'institution', flat=True).distinct()
    projects = accessible_results.order_by(PROJECT_NAME_FIELD).values_list(
        PROJECT_GUID_FIELD, PROJECT_NAME_FIELD).distinct()

    return create_json_response({
        'results': _get_results_json(page_results, request.user),
        'totalResults': total,
        'page': page,
        'perPage': per_page,
        'statusCounts': status_counts,
        'institutions': sorted(institutions),
        'projects': [{'projectGuid': guid, 'name': name} for guid, name in projects],
    })


def _get_results_json(results, user):
    if not results:
        return []

    submission_gene_ids = defaultdict(list)
    for submission_id, gene_id in MatchmakerSubmissionGenes.objects.filter(
            matchmaker_submission_id__in={result.submission_id for result in results},
    ).order_by('gene_id').values_list('matchmaker_submission_id', 'gene_id').distinct():
        submission_gene_ids[submission_id].append(gene_id)

    hpo_terms_by_id, genes_by_id, gene_symbols_to_ids = get_mme_genes_phenotypes_for_results(
        [result.result_data for result in results],
        additional_genes={gene_id for gene_ids in submission_gene_ids.values() for gene_id in gene_ids},
        additional_hpo_ids={
            feature['id'] for result in results for feature in (result.submission.features or []) if feature.get('id')
        },
    )

    return [
        _get_result_json(
            result, user, submission_gene_ids[result.submission_id], hpo_terms_by_id, genes_by_id, gene_symbols_to_ids,
        ) for result in results
    ]


def _string_or_none(value):
    return value if isinstance(value, str) else None


def _get_phenotypes_json(features, hpo_terms_by_id):
    return [{
        'id': feature['id'],
        'label': hpo_terms_by_id.get(feature['id']),
        'observed': feature.get('observed', 'yes'),
    } for feature in features or [] if _string_or_none(feature.get('id'))]


def _get_observed_hpo_ids(phenotypes):
    return {phenotype['id'] for phenotype in phenotypes if phenotype['observed'] != 'no'}


def _get_assignee_json(result, user):
    assigned_to = result.assigned_to
    return {
        'assignedTo': (assigned_to.get_full_name() or assigned_to.email) if assigned_to else None,
        'assignedToMe': assigned_to == user,
    }


def _get_gene_json(gene_id, genes_by_id, label=None):
    return {'geneId': gene_id, 'geneSymbol': genes_by_id.get(gene_id, {}).get('geneSymbol') or label or gene_id}


def _get_result_json(result, user, submission_gene_ids, hpo_terms_by_id, genes_by_id, gene_symbols_to_ids):
    submission = result.submission
    individual = submission.individual
    family = individual.family
    project = family.project
    patient = result.result_data['patient']
    contact = patient.get('contact')
    if not isinstance(contact, dict):
        contact = {}

    match_genes = []
    gene_overlap = set()
    for feature in patient.get('genomicFeatures') or []:
        gene_ids = get_gene_ids_for_feature(feature, gene_symbols_to_ids)
        overlap_ids = [gene_id for gene_id in gene_ids if gene_id in submission_gene_ids]
        gene_overlap.update(overlap_ids)
        gene_id = next(iter(overlap_ids or gene_ids), None)
        match_genes.append(_get_gene_json(gene_id, genes_by_id, label=feature['gene']['id']))

    submission_phenotypes = _get_phenotypes_json(submission.features, hpo_terms_by_id)
    match_phenotypes = _get_phenotypes_json(patient.get('features'), hpo_terms_by_id)
    hpo_overlap = _get_observed_hpo_ids(submission_phenotypes) & _get_observed_hpo_ids(match_phenotypes)

    score = (result.result_data.get('score') or {}).get('patient')

    return {
        'matchmakerResultGuid': result.guid,
        'status': result.status,
        'source': result.source,
        'comments': result.comments,
        'createdDate': result.created_date,
        'lastModifiedDate': result.last_modified_date,
        'matchRemoved': result.match_removed,
        'weContacted': result.we_contacted,
        'hostContacted': result.host_contacted,
        **_get_assignee_json(result, user),
        'submission': {
            'submissionGuid': submission.guid,
            'individualGuid': individual.guid,
            'individualDisplayName': individual.display_name or individual.individual_id,
            'familyGuid': family.guid,
            'familyDisplayName': family.display_name or family.family_id,
            'projectGuid': project.guid,
            'projectName': project.name,
            'genes': [_get_gene_json(gene_id, genes_by_id) for gene_id in submission_gene_ids],
            'phenotypes': submission_phenotypes,
        },
        'match': {
            'patientId': _string_or_none(patient.get('id')),
            'label': _string_or_none(patient.get('label')),
            'institution': _string_or_none(contact.get('institution')),
            'contactName': _string_or_none(contact.get('name')),
            'contactHref': _string_or_none(contact.get('href')),
            'contactEmail': _string_or_none(contact.get('email')),
            'genes': match_genes,
            'phenotypes': match_phenotypes,
            'score': score if isinstance(score, (int, float)) else None,
        },
        'geneOverlap': sorted(gene_overlap),
        'hpoOverlap': sorted(hpo_overlap),
    }


@login_and_policies_required
def update_matchmaker_inbox_results(request):
    request_json = json.loads(request.body)

    result_guids = request_json.get('resultGuids')
    if not (isinstance(result_guids, list) and result_guids and all(isinstance(guid, str) for guid in result_guids)):
        raise _invalid('A list of result guids is required')
    if len(result_guids) > MAX_BULK_UPDATE_RESULTS:
        raise _invalid(f'No more than {MAX_BULK_UPDATE_RESULTS} results can be updated at once')

    update_json = {}
    if 'status' in request_json:
        if request_json['status'] not in STATUSES:
            raise _invalid(f'Invalid status: {request_json["status"]}')
        update_json['status'] = request_json['status']
    if 'assignedToMe' in request_json:
        if not isinstance(request_json['assignedToMe'], bool):
            raise _invalid('Invalid assignedToMe')
        update_json['assigned_to'] = request.user if request_json['assignedToMe'] else None
    if not update_json:
        raise _invalid('A status or assignee is required')

    results = list(_get_triage_results(request.user, limit_data_manager=False).filter(
        guid__in=result_guids).select_related('assigned_to'))
    no_access_guids = sorted(set(result_guids) - {result.guid for result in results})
    if no_access_guids:
        raise PermissionDenied(
            f'{request.user} does not have sufficient permissions for {", ".join(no_access_guids)}')

    for result in results:
        if any(getattr(result, field) != value for field, value in update_json.items()):
            update_model_from_json(result, {**update_json, 'last_modified_by': request.user}, request.user)

    return create_json_response({'mmeResultsByGuid': {
        result.guid: {'status': result.status, **_get_assignee_json(result, request.user)} for result in results
    }})
