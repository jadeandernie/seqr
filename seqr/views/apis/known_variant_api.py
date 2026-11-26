import json
import re

from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q

from reference_data.models import GeneInfo, GENOME_VERSION_LOOKUP
from seqr.models import Family, KnownVariantCheck, KnownVariantMatch, SavedVariant
from seqr.utils.known_variant_utils import find_known_variant_matches, get_creator_project_guids, \
    is_supported_dataset_type
from seqr.utils.logging_utils import SeqrLogger
from seqr.utils.middleware import ErrorsWarningsException
from seqr.views.utils.json_to_orm_utils import create_model_from_json, update_model_from_json
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.permissions_utils import login_and_policies_required, user_is_analyst, \
    check_family_view_permission, get_project_and_check_view_permission, \
    get_project_analysis_group_guids_user_can_view

logger = SeqrLogger(__name__)

MAX_CREATE_MATCH_FAMILIES = 2000
MAX_GENES = 20

VARIANT_ID_REGEX = {
    'SNV_INDEL': re.compile(r'^([1-9]|1[0-9]|2[0-2]|X|Y)-[1-9][0-9]{0,8}-[ACGT]{1,500}-[ACGT]{1,500}$'),
    'MITO': re.compile(r'^M-[1-9][0-9]{0,4}-[ACGT]{1,500}-[ACGT]{1,500}$'),
}
GENE_ID_REGEX = re.compile(r'^ENSG[0-9]{11}$')
REFERENCE_FIELD_REGEX = {
    'pubmed_id': re.compile(r'^[1-9][0-9]{0,8}$'),
    'clinvar_accession': re.compile(r'^(VCV|RCV|SCV)[0-9]{9}(\.[0-9]{1,3})?$'),
}
REFERENCE_FIELD_ERROR = {
    'pubmed_id': 'PubMed ID must be a number, for example 12345678',
    'clinvar_accession': 'ClinVar accession must be a VCV, RCV or SCV accession, for example VCV000012345',
}
REQUEST_FIELDS = {
    'verdict': 'verdict', 'pubmedId': 'pubmed_id', 'clinvarAccession': 'clinvar_accession',
    'isActive': 'is_active', 'isGlobal': 'is_global',
}
BOOLEAN_FIELDS = {'is_active', 'is_global'}


def _user_project_guids(user):
    return set(get_project_analysis_group_guids_user_can_view(user, limit_data_manager=False)[0])


def _visible_checks(user, project_guids):
    return KnownVariantCheck.objects.filter(
        Q(created_by=user) | Q(is_global=True) | Q(source_project__guid__in=project_guids)
    )


def _user_display_name(user):
    return (user.get_full_name() or user.email) if user else None


def _gene_names(gene_ids):
    return dict(
        GeneInfo.objects.filter(gene_id__in=gene_ids).order_by('gencode_release').values_list('gene_id', 'gene_symbol')
    )


def _check_json(check, user, project_guids, gene_names, is_analyst=False):
    source_project = check.source_project
    is_creator = check.created_by_id == user.id
    can_view_source = is_creator or bool(source_project and source_project.guid in project_guids)
    return {
        'checkGuid': check.guid,
        'genomeVersion': check.genome_version,
        'datasetType': check.dataset_type,
        'variantId': check.variant_id,
        'geneIds': check.gene_ids,
        'geneNames': [gene_names.get(gene_id, gene_id) for gene_id in check.gene_ids],
        'verdict': check.verdict,
        'pubmedId': check.pubmed_id,
        'clinvarAccession': check.clinvar_accession,
        'isGlobal': check.is_global,
        'isActive': check.is_active,
        'createdDate': check.created_date,
        'createdBy': _user_display_name(check.created_by) if can_view_source else None,
        'sourceProjectGuid': source_project.guid if source_project and can_view_source else None,
        'sourceProjectName': source_project.name if source_project and can_view_source else None,
        'canEdit': is_creator or is_analyst,
    }


def _checks_response(checks, user, project_guids, is_analyst):
    checks = list(checks.select_related('created_by', 'source_project').annotate(
        num_matches=Count('knownvariantmatch', filter=Q(knownvariantmatch__family__project__guid__in=project_guids)),
        num_new_matches=Count('knownvariantmatch', filter=Q(
            knownvariantmatch__family__project__guid__in=project_guids,
            knownvariantmatch__status=KnownVariantMatch.STATUS_NEW,
        )),
    ))
    gene_names = _gene_names({gene_id for check in checks for gene_id in check.gene_ids})
    return {
        check.guid: {
            **_check_json(check, user, project_guids, gene_names, is_analyst=is_analyst),
            'numMatches': check.num_matches,
            'numNewMatches': check.num_new_matches,
        } for check in checks
    }


@login_and_policies_required
def known_variant_checks(request):
    project_guids = _user_project_guids(request.user)
    return create_json_response({'knownVariantChecksByGuid': _checks_response(
        _visible_checks(request.user, project_guids), request.user, project_guids, user_is_analyst(request.user),
    )})


def _parse_check_update(request_json, is_analyst, allowed_fields):
    update = {}
    errors = []
    for json_field, field in REQUEST_FIELDS.items():
        if json_field not in request_json or field not in allowed_fields:
            continue
        value = request_json[json_field]
        if field == 'is_global' and not is_analyst:
            raise PermissionDenied('Only analysts can share a known variant check with all projects')
        if field in BOOLEAN_FIELDS:
            if not isinstance(value, bool):
                errors.append(f'Invalid value for {json_field}')
        elif field == 'verdict':
            if value not in dict(KnownVariantCheck.VERDICT_CHOICES):
                errors.append('Invalid verdict')
        else:
            value = str(value).strip() if value else None
            if value and not REFERENCE_FIELD_REGEX[field].match(value):
                errors.append(REFERENCE_FIELD_ERROR[field])
        update[field] = value
    return update, errors


def _parse_saved_variant(saved_variant_guid, user):
    saved_variant = SavedVariant.objects.select_related('family__project').get(guid=saved_variant_guid)
    check_family_view_permission(saved_variant.family, user)
    project = saved_variant.family.project
    return {
        'genome_version': project.genome_version,
        'dataset_type': saved_variant.dataset_type,
        'variant_id': saved_variant.variant_id,
        'gene_ids': saved_variant.gene_ids or [],
        'source_saved_variant': saved_variant,
        'source_project': project,
    }


def _parse_new_variant(request_json, errors):
    gene_ids = request_json.get('geneIds') or []
    if not isinstance(gene_ids, list) or len(gene_ids) > MAX_GENES or \
            any(not (isinstance(gene_id, str) and GENE_ID_REGEX.match(gene_id)) for gene_id in gene_ids):
        errors.append(f'Genes must be a list of up to {MAX_GENES} Ensembl gene IDs')
    return {
        'genome_version': str(request_json.get('genomeVersion')),
        'dataset_type': str(request_json.get('datasetType')),
        'variant_id': request_json.get('variantId'),
        'gene_ids': gene_ids,
    }


@login_and_policies_required
def create_known_variant_check(request):
    request_json = json.loads(request.body)
    user = request.user
    is_analyst = user_is_analyst(user)

    errors = []
    if request_json.get('savedVariantGuid'):
        variant_json = _parse_saved_variant(request_json['savedVariantGuid'], user)
    elif is_analyst:
        variant_json = _parse_new_variant(request_json, errors)
    else:
        raise PermissionDenied('Only analysts can record a known variant without a saved variant')

    genome_version = variant_json['genome_version']
    dataset_type = variant_json['dataset_type']
    variant_id = variant_json['variant_id']
    if genome_version not in GENOME_VERSION_LOOKUP or not is_supported_dataset_type(genome_version, dataset_type):
        errors.append(
            'Known variant checks are only supported for SNV/indel and mitochondrial variants, not structural variants'
        )
    elif not (isinstance(variant_id, str) and VARIANT_ID_REGEX[dataset_type].match(variant_id)):
        errors.append('Invalid variant ID, expected the format chrom-pos-ref-alt, for example 1-248367227-TC-T')

    if 'verdict' not in request_json:
        errors.append('Verdict is required')
    update_json, update_errors = _parse_check_update(
        request_json, is_analyst, allowed_fields={'verdict', 'pubmed_id', 'clinvar_accession', 'is_global'},
    )
    errors += update_errors
    if errors:
        raise ErrorsWarningsException(errors)

    if KnownVariantCheck.objects.filter(
        created_by=user, genome_version=genome_version, dataset_type=dataset_type, variant_id=variant_id,
    ).exists():
        raise ErrorsWarningsException(['You have already recorded this variant as a known variant'])

    check = create_model_from_json(KnownVariantCheck, {**variant_json, **update_json}, user)

    is_matched = _match_new_check(check, user)
    return create_json_response({
        'knownVariantChecksByGuid': _checks_response(
            KnownVariantCheck.objects.filter(id=check.id), user, _user_project_guids(user), is_analyst,
        ),
        'matchingDeferred': not is_matched,
    })


def _match_new_check(check, user):
    families = Family.objects.filter(
        project__guid__in=get_creator_project_guids(user), project__genome_version=check.genome_version,
    )
    if families.count() > MAX_CREATE_MATCH_FAMILIES:
        return False
    try:
        find_known_variant_matches(families, checks=KnownVariantCheck.objects.filter(id=check.id))
    except Exception as e:
        logger.error(f'Error matching new known variant check {check.guid}: {e}', user)
        return False
    return True


def _get_editable_check(check_guid, user):
    check = _visible_checks(user, _user_project_guids(user)).get(guid=check_guid)
    is_analyst = user_is_analyst(user)
    if not (is_analyst or check.created_by_id == user.id):
        raise PermissionDenied(f'{user} does not have edit permissions for {check}')
    return check, is_analyst


@login_and_policies_required
def update_known_variant_check(request, check_guid):
    check, is_analyst = _get_editable_check(check_guid, request.user)

    update_json, errors = _parse_check_update(json.loads(request.body), is_analyst, allowed_fields=REQUEST_FIELDS.values())
    if errors:
        raise ErrorsWarningsException(errors)
    update_model_from_json(check, update_json, request.user)

    project_guids = _user_project_guids(request.user)
    return create_json_response({'knownVariantChecksByGuid': _checks_response(
        KnownVariantCheck.objects.filter(id=check.id), request.user, project_guids, is_analyst,
    )})


@login_and_policies_required
def delete_known_variant_check(request, check_guid):
    check, _ = _get_editable_check(check_guid, request.user)
    check.delete_model(request.user, user_can_delete=True)
    return create_json_response({'knownVariantChecksByGuid': {check_guid: None}})


def _matches_response(matches, user):
    matches = list(matches.filter(known_variant_check__is_active=True).select_related(
        'family__project', 'reviewed_by', 'known_variant_check__created_by', 'known_variant_check__source_project',
    ).order_by('family__family_id', 'known_variant_check__variant_id'))
    project_guids = _user_project_guids(user)
    gene_names = _gene_names({gene_id for match in matches for gene_id in match.known_variant_check.gene_ids})
    saved_variant_guids = {
        (family_id, variant_id): guid for family_id, variant_id, guid in SavedVariant.objects.filter(
            family__in={match.family for match in matches},
            variant_id__in={match.known_variant_check.variant_id for match in matches},
        ).values_list('family_id', 'variant_id', 'guid')
    }
    response = {}
    for match in matches:
        check_json = _check_json(match.known_variant_check, user, project_guids, gene_names)
        response[match.guid] = {
            'matchGuid': match.guid,
            'familyGuid': match.family.guid,
            'projectGuid': match.family.project.guid,
            'status': match.status,
            'firstSeen': match.first_seen,
            'reviewedBy': _user_display_name(match.reviewed_by),
            'savedVariantGuid': saved_variant_guids.get((match.family_id, match.known_variant_check.variant_id)),
            **{field: check_json[field] for field in [
                'genomeVersion', 'datasetType', 'variantId', 'geneIds', 'geneNames', 'verdict', 'pubmedId',
                'clinvarAccession', 'createdBy', 'sourceProjectName',
            ]},
        }
    return {'knownVariantMatchesByGuid': response}


@login_and_policies_required
def project_known_variant_matches(request, project_guid):
    project = get_project_and_check_view_permission(project_guid, request.user)
    return create_json_response(_matches_response(
        KnownVariantMatch.objects.filter(family__project=project), request.user,
    ))


@login_and_policies_required
def family_known_variant_matches(request, family_guid):
    family = Family.objects.select_related('project').get(guid=family_guid)
    check_family_view_permission(family, request.user)
    return create_json_response(_matches_response(KnownVariantMatch.objects.filter(family=family), request.user))


@login_and_policies_required
def update_known_variant_match(request, match_guid):
    match = KnownVariantMatch.objects.select_related('family__project').get(guid=match_guid)
    check_family_view_permission(match.family, request.user)

    status = json.loads(request.body).get('status')
    if status not in dict(KnownVariantMatch.STATUS_CHOICES):
        raise ErrorsWarningsException(['Invalid status'])
    reviewed_by = None if status == KnownVariantMatch.STATUS_NEW else request.user
    update_model_from_json(match, {'status': status, 'reviewed_by': reviewed_by}, request.user)

    return create_json_response(_matches_response(KnownVariantMatch.objects.filter(id=match.id), request.user))
