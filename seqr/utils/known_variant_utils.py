from collections import defaultdict

from notifications.signals import notify

from clickhouse_search.models.search_models import ENTRY_CLASS_MAP
from clickhouse_search.search import get_clickhouse_key_lookup, get_clickhouse_family_keys
from seqr.models import KnownVariantCheck, KnownVariantMatch
from seqr.utils.communication_utils import send_project_email
from seqr.utils.logging_utils import SeqrLogger
from seqr.views.utils.permissions_utils import get_project_guids_user_can_view
from settings import BASE_URL

logger = SeqrLogger(__name__)

FAMILY_BATCH_SIZE = 1000

MATCH_EMAIL_TEMPLATE = (
    'This is to notify you that {notification} found in seqr project {project_link}. '
    'Matches are listed on the project and family pages, where they can be marked as relevant or dismissed.'
)
MATCH_EMAIL_SUBJECT = 'New known variant matches in seqr'


def is_supported_dataset_type(genome_version, dataset_type):
    return dataset_type in dict(KnownVariantCheck.DATASET_TYPE_CHOICES) and \
        dataset_type in ENTRY_CLASS_MAP.get(genome_version, {})


def get_creator_project_guids(user):
    if not (user and user.is_active):
        return set()
    try:
        return set(get_project_guids_user_can_view(user))
    except Exception as e:
        logger.warning(f'Unable to determine project access for known variant check creator {user.email}: {e}', None)
        return set()


def _can_match(check, project, creator_project_guids):
    return check.is_global or check.source_project_id == project.id \
        or project.guid in creator_project_guids[check.created_by_id]


def find_known_variant_matches(families, checks=None):
    """
    Records a KnownVariantMatch for every given family that carries the variant of an active KnownVariantCheck.

    A check only matches in its source project, in projects its creator can currently view, or anywhere if it is global.
    Variants are compared by id within a genome build: there is no liftover between builds.
    """
    families = list(families.select_related('project'))
    if checks is None:
        checks = KnownVariantCheck.objects.all()
    checks = list(checks.filter(
        is_active=True, genome_version__in={f.project.genome_version for f in families},
    ).select_related('created_by').order_by('id'))
    if not checks:
        return []

    creator_project_guids = {}
    for check in checks:
        if not check.is_global and check.created_by_id not in creator_project_guids:
            creator_project_guids[check.created_by_id] = get_creator_project_guids(check.created_by)

    matched = set(KnownVariantMatch.objects.filter(
        family__in=families, known_variant_check__in=checks,
    ).values_list('known_variant_check_id', 'family_id'))

    families_by_genome_version = defaultdict(list)
    for family in families:
        families_by_genome_version[family.project.genome_version].append(family)
    checks_by_data_type = defaultdict(lambda: defaultdict(list))
    for check in checks:
        checks_by_data_type[(check.genome_version, check.dataset_type)][check.variant_id].append(check)

    new_matches = []
    for (genome_version, dataset_type), checks_by_variant in checks_by_data_type.items():
        if not is_supported_dataset_type(genome_version, dataset_type):
            continue
        key_lookup = get_clickhouse_key_lookup(genome_version, dataset_type, sorted(checks_by_variant))
        variant_id_by_key = {key: variant_id for variant_id, key in key_lookup.items()}
        if not variant_id_by_key:
            continue
        data_type_families = families_by_genome_version[genome_version]
        for i in range(0, len(data_type_families), FAMILY_BATCH_SIZE):
            families_by_guid = {f.guid: f for f in data_type_families[i:i + FAMILY_BATCH_SIZE]}
            family_keys = get_clickhouse_family_keys(
                genome_version, dataset_type, sorted({f.project.guid for f in families_by_guid.values()}),
                sorted(families_by_guid), sorted(variant_id_by_key),
            )
            for family_guid, key in sorted(family_keys):
                family = families_by_guid[family_guid]
                for check in checks_by_variant[variant_id_by_key[key]]:
                    match_key = (check.id, family.id)
                    if match_key in matched or not _can_match(check, family.project, creator_project_guids):
                        continue
                    matched.add(match_key)
                    new_matches.append(KnownVariantMatch(known_variant_check=check, family=family))

    if new_matches:
        KnownVariantMatch.bulk_create(None, new_matches, ignore_conflicts=True)
    return new_matches


def notify_known_variant_matches(matches):
    """Sends one notification per project with the number of new matches by verdict, and no variant detail."""
    verdict_lookup = dict(KnownVariantCheck.VERDICT_CHOICES)
    verdicts_by_project = defaultdict(lambda: defaultdict(int))
    for match in matches:
        verdicts_by_project[match.family.project][match.known_variant_check.verdict] += 1

    for project, verdict_counts in verdicts_by_project.items():
        total = sum(verdict_counts.values())
        by_verdict = ', '.join([
            f'{verdict_counts[verdict]} {label}' for verdict, label in verdict_lookup.items() if verdict in verdict_counts
        ])
        summary = f'{total} new known variant {"match" if total == 1 else "matches"} ({by_verdict})'
        email = MATCH_EMAIL_TEMPLATE.format(
            notification=f'{summary} {"was" if total == 1 else "were"}',
            project_link=f'<a href={BASE_URL}project/{project.guid}/project_page>{project.name}</a>',
        )
        users = send_project_email(project, email, MATCH_EMAIL_SUBJECT)
        notify.send(project, recipient=users, verb=f'Found {summary}')
