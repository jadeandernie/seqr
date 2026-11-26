import mock
from datetime import date

from django.db import IntegrityError, transaction
from notifications.models import Notification

from seqr.models import Family, KnownVariantCheck, KnownVariantMatch, Project, SavedVariant
from seqr.utils.known_variant_utils import find_known_variant_matches, notify_known_variant_matches
from seqr.views.utils.test_utils import AuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
OTHER_PROJECT_GUID = 'R0003_test'
NON_ANALYST_PROJECT_GUID = 'R0004_non_analyst_project'

GRCH37_VARIANT_ID = '21-3343353-GAGA-G'
GRCH37_VARIANT_ID_2 = '1-248367227-TC-T'
GRCH38_VARIANT_ID = '1-9310123-T-C'
MITO_VARIANT_ID = 'M-4429-G-A'
ABSENT_VARIANT_ID = '2-1234-A-C'

MOCK_KEY_LOOKUP = {
    ('37', 'SNV_INDEL'): {GRCH37_VARIANT_ID: 10, GRCH37_VARIANT_ID_2: 11},
    ('38', 'SNV_INDEL'): {GRCH38_VARIANT_ID: 22},
    ('38', 'MITO'): {MITO_VARIANT_ID: 6},
}
MOCK_FAMILY_KEYS = {
    ('37', 'SNV_INDEL'): {('F000001_1', 10), ('F000011_11', 10), ('F000002_2', 11), ('F000012_12', 11)},
    ('38', 'SNV_INDEL'): {('F000014_14', 22)},
    ('38', 'MITO'): {('F000014_14', 6)},
}


def mock_key_lookup(genome_version, dataset_type, variant_ids):
    lookup = MOCK_KEY_LOOKUP[(genome_version, dataset_type)]
    return {variant_id: lookup[variant_id] for variant_id in variant_ids if variant_id in lookup}


def mock_family_keys(genome_version, dataset_type, project_guids, family_guids, keys):
    project_guids_by_family = dict(Family.objects.values_list('guid', 'project__guid'))
    return {
        (family_guid, key) for family_guid, key in MOCK_FAMILY_KEYS[(genome_version, dataset_type)]
        if family_guid in family_guids and key in keys and project_guids_by_family[family_guid] in project_guids
    }


class KnownVariantTestMixin(object):

    def set_up_clickhouse_mocks(self):
        patcher = mock.patch('seqr.utils.known_variant_utils.get_clickhouse_key_lookup')
        self.mock_key_lookup = patcher.start()
        self.mock_key_lookup.side_effect = mock_key_lookup
        self.addCleanup(patcher.stop)
        patcher = mock.patch('seqr.utils.known_variant_utils.get_clickhouse_family_keys')
        self.mock_family_keys = patcher.start()
        self.mock_family_keys.side_effect = mock_family_keys
        self.addCleanup(patcher.stop)

    @staticmethod
    def create_check(user, variant_id=GRCH37_VARIANT_ID, genome_version='37', dataset_type='SNV_INDEL', verdict='C',
                     source_project_guid=PROJECT_GUID, **kwargs):
        source_project = Project.objects.get(guid=source_project_guid) if source_project_guid else None
        return KnownVariantCheck.objects.create(
            created_by=user, variant_id=variant_id, genome_version=genome_version, dataset_type=dataset_type,
            verdict=verdict, source_project=source_project, **kwargs,
        )

    @staticmethod
    def match_families(check=None):
        matches = KnownVariantMatch.objects.all()
        if check:
            matches = matches.filter(known_variant_check=check)
        return set(matches.values_list('known_variant_check__variant_id', 'family__guid'))


class KnownVariantModelTest(KnownVariantTestMixin, AuthenticationTestCase):
    fixtures = ['users', '1kg_project']

    def test_known_variant_check(self):
        check = self.create_check(self.collaborator_user, source_saved_variant=SavedVariant.objects.get(id=4))
        self.assertRegex(check.guid, r'^KVC\d{7}_21_3343353_gaga_g$')
        self.assertTrue(check.is_active)
        self.assertFalse(check.is_global)
        self.assertListEqual(check.gene_ids, [])
        self.assertIsNone(check.pubmed_id)
        self.assertIsNone(check.clinvar_accession)

        # A user can only record a variant once per genome build and dataset type
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.create_check(self.collaborator_user, verdict='B', source_project_guid=None)
        self.create_check(self.manager_user)
        self.create_check(self.collaborator_user, genome_version='38')
        self.create_check(self.collaborator_user, variant_id=GRCH37_VARIANT_ID_2)
        self.assertEqual(KnownVariantCheck.objects.count(), 4)

        self.assertSetEqual(
            {choice[0] for choice in KnownVariantCheck.DATASET_TYPE_CHOICES}, {'SNV_INDEL', 'MITO'},
        )
        self.assertListEqual([choice[1] for choice in KnownVariantCheck.VERDICT_CHOICES], [
            'Confirmed causal', 'Suspected, confirmed on follow-up', 'Suspected, refuted on follow-up',
            'Benign or artefact (expected noise)',
        ])

        # Checks outlive the saved variant, project and user they were recorded from
        SavedVariant.objects.filter(id=4).delete()
        check.refresh_from_db()
        self.assertIsNone(check.source_saved_variant)
        self.assertEqual(check.source_project.guid, PROJECT_GUID)

    def test_known_variant_match(self):
        check = self.create_check(self.collaborator_user)
        family = Family.objects.get(guid='F000001_1')
        match = KnownVariantMatch.objects.create(known_variant_check=check, family=family)
        self.assertRegex(match.guid, r'^KVM\d{7}_\d+_1$')
        self.assertEqual(match.status, 'N')
        self.assertEqual(match.first_seen, date.today())
        self.assertIsNone(match.reviewed_by)

        with self.assertRaises(IntegrityError), transaction.atomic():
            KnownVariantMatch.objects.create(known_variant_check=check, family=family)
        KnownVariantMatch.objects.create(known_variant_check=check, family=Family.objects.get(guid='F000002_2'))

        check.delete()
        self.assertEqual(KnownVariantMatch.objects.count(), 0)


@mock.patch('seqr.utils.known_variant_utils.BASE_URL', 'https://seqr.org/')
class KnownVariantMatchingTest(KnownVariantTestMixin, AuthenticationTestCase):
    fixtures = ['users', '1kg_project']

    def setUp(self):
        super().setUp()
        self.set_up_clickhouse_mocks()

    def test_find_known_variant_matches(self):
        all_families = Family.objects.all()

        self.assertListEqual(find_known_variant_matches(all_families), [])
        self.assertListEqual(find_known_variant_matches(Family.objects.none()), [])
        self.mock_key_lookup.assert_not_called()
        self.mock_family_keys.assert_not_called()

        # Inactive checks are never looked up
        inactive_check = self.create_check(self.collaborator_user, is_active=False)
        self.assertListEqual(find_known_variant_matches(all_families), [])
        self.mock_key_lookup.assert_not_called()

        # Variants which are not present in any callset are not searched for in families
        self.create_check(self.collaborator_user, variant_id=ABSENT_VARIANT_ID)
        self.assertListEqual(find_known_variant_matches(all_families), [])
        self.mock_key_lookup.assert_called_once_with('37', 'SNV_INDEL', [ABSENT_VARIANT_ID])
        self.mock_family_keys.assert_not_called()

        # Checks only match families in the same genome build which carry the variant, whatever the verdict
        self.mock_key_lookup.reset_mock()
        causal_check = self.create_check(self.manager_user, verdict='C')
        noise_check = self.create_check(self.manager_user, variant_id=GRCH37_VARIANT_ID_2, verdict='B')
        grch38_check = self.create_check(
            self.manager_user, variant_id=GRCH38_VARIANT_ID, genome_version='38', verdict='R',
            source_project_guid=NON_ANALYST_PROJECT_GUID,
        )
        mito_check = self.create_check(
            self.manager_user, variant_id=MITO_VARIANT_ID, genome_version='38', dataset_type='MITO', verdict='S',
            source_project_guid=NON_ANALYST_PROJECT_GUID,
        )
        unsupported_check = self.create_check(
            self.manager_user, variant_id=MITO_VARIANT_ID, genome_version='37', dataset_type='MITO',
        )
        matches = find_known_variant_matches(all_families)
        expected_matches = {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
            (GRCH37_VARIANT_ID_2, 'F000002_2'), (GRCH37_VARIANT_ID_2, 'F000012_12'),
            (GRCH38_VARIANT_ID, 'F000014_14'), (MITO_VARIANT_ID, 'F000014_14'),
        }
        self.assertSetEqual({(m.known_variant_check.variant_id, m.family.guid) for m in matches}, expected_matches)
        self.assertSetEqual(self.match_families(), expected_matches)
        self.assertSetEqual(self.match_families(causal_check), {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
        })
        self.assertSetEqual(self.match_families(noise_check), {
            (GRCH37_VARIANT_ID_2, 'F000002_2'), (GRCH37_VARIANT_ID_2, 'F000012_12'),
        })
        self.assertSetEqual(self.match_families(grch38_check), {(GRCH38_VARIANT_ID, 'F000014_14')})
        self.assertSetEqual(self.match_families(mito_check), {(MITO_VARIANT_ID, 'F000014_14')})
        self.assertSetEqual(self.match_families(unsupported_check), set())
        self.assertSetEqual(self.match_families(inactive_check), set())
        self.assertSetEqual(
            set(KnownVariantMatch.objects.values_list('status', 'first_seen', 'reviewed_by', 'created_by')),
            {('N', date.today(), None, None)},
        )

        # Lookups are batched by data type: one key lookup and one family lookup each, however many checks there are
        self.mock_key_lookup.assert_has_calls([
            mock.call('37', 'SNV_INDEL', [GRCH37_VARIANT_ID_2, ABSENT_VARIANT_ID, GRCH37_VARIANT_ID]),
            mock.call('38', 'SNV_INDEL', [GRCH38_VARIANT_ID]),
            mock.call('38', 'MITO', [MITO_VARIANT_ID]),
        ], any_order=True)
        self.assertEqual(self.mock_key_lookup.call_count, 3)
        grch37_family_guids = sorted(Family.objects.filter(project__genome_version='37').values_list('guid', flat=True))
        self.assertEqual(len(grch37_family_guids), 13)
        self.mock_family_keys.assert_has_calls([
            mock.call('37', 'SNV_INDEL', ['R0001_1kg', 'R0003_test'], grch37_family_guids, [10, 11]),
            mock.call('38', 'SNV_INDEL', ['R0004_non_analyst_project'], ['F000014_14'], [22]),
            mock.call('38', 'MITO', ['R0004_non_analyst_project'], ['F000014_14'], [6]),
        ], any_order=True)
        self.assertEqual(self.mock_family_keys.call_count, 3)

        # Matching is idempotent, and keeps the review status of existing matches
        KnownVariantMatch.objects.filter(family__guid='F000001_1').update(status='D')
        self.assertListEqual(find_known_variant_matches(all_families), [])
        self.assertSetEqual(self.match_families(), expected_matches)
        self.assertEqual(KnownVariantMatch.objects.get(family__guid='F000001_1').status, 'D')

        # Only the given families and checks are matched
        KnownVariantMatch.objects.all().delete()
        self.mock_family_keys.reset_mock()
        matches = find_known_variant_matches(
            Family.objects.filter(guid__in=['F000001_1', 'F000002_2']),
            checks=KnownVariantCheck.objects.filter(id=causal_check.id),
        )
        self.assertEqual(len(matches), 1)
        self.assertSetEqual(self.match_families(), {(GRCH37_VARIANT_ID, 'F000001_1')})
        self.mock_family_keys.assert_called_once_with(
            '37', 'SNV_INDEL', ['R0001_1kg'], ['F000001_1', 'F000002_2'], [10],
        )

    @mock.patch('seqr.utils.known_variant_utils.FAMILY_BATCH_SIZE', 5)
    def test_find_known_variant_matches_batching(self):
        for i in range(30):
            self.create_check(self.manager_user, variant_id=f'3-{i + 1}-A-C')
        self.create_check(self.manager_user)
        self.create_check(self.collaborator_user)

        matches = find_known_variant_matches(Family.objects.all())
        self.assertEqual(len(matches), 4)
        self.assertEqual(self.mock_key_lookup.call_count, 1)
        self.assertEqual(len(self.mock_key_lookup.call_args.args[2]), 31)
        self.assertEqual(self.mock_family_keys.call_count, 3)
        self.assertListEqual(
            [len(call.args[3]) for call in self.mock_family_keys.call_args_list], [5, 5, 3],
        )
        for call in self.mock_family_keys.call_args_list:
            self.assertListEqual(call.args[4], [10])

    def test_find_known_variant_matches_visibility(self):
        families = Family.objects.all()
        grch38_kwargs = {'variant_id': GRCH38_VARIANT_ID, 'genome_version': '38', 'source_project_guid': None}

        # The collaborator can view the GRCh37 projects but not the GRCh38 project
        collaborator_check = self.create_check(self.collaborator_user, **grch38_kwargs)
        collaborator_grch37_check = self.create_check(self.collaborator_user)
        # A user without access to any project
        no_access_check = self.create_check(self.no_access_user, source_project_guid=None)
        # Data managers are only treated as viewers of the projects they are explicitly added to
        data_manager_check = self.create_check(self.data_manager_user, **grch38_kwargs)
        # Checks from inactive or deleted users only match in their source project
        inactive_check = self.create_check(self.inactive_user, source_project_guid=OTHER_PROJECT_GUID)
        no_creator_check = self.create_check(None, source_project_guid=PROJECT_GUID)

        find_known_variant_matches(families)
        self.assertSetEqual(self.match_families(collaborator_check), set())
        self.assertSetEqual(self.match_families(collaborator_grch37_check), {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
        })
        self.assertSetEqual(self.match_families(no_access_check), set())
        self.assertSetEqual(self.match_families(data_manager_check), set())
        self.assertSetEqual(self.match_families(inactive_check), {(GRCH37_VARIANT_ID, 'F000011_11')})
        self.assertSetEqual(self.match_families(no_creator_check), {(GRCH37_VARIANT_ID, 'F000001_1')})

        # The manager can view all projects
        manager_check = self.create_check(self.manager_user, **grch38_kwargs)
        find_known_variant_matches(families)
        self.assertSetEqual(self.match_families(manager_check), {(GRCH38_VARIANT_ID, 'F000014_14')})

        # Access is checked at the time of matching: existing matches are kept, new ones are not created
        KnownVariantMatch.objects.filter(family__guid='F000011_11').delete()
        self.collaborator_user.groups.clear()
        self.manager_user.groups.clear()
        KnownVariantMatch.objects.filter(known_variant_check=manager_check).delete()
        find_known_variant_matches(families)
        self.assertSetEqual(self.match_families(collaborator_grch37_check), {(GRCH37_VARIANT_ID, 'F000001_1')})
        self.assertSetEqual(self.match_families(manager_check), set())
        self.assertSetEqual(self.match_families(inactive_check), {(GRCH37_VARIANT_ID, 'F000011_11')})

        # Global checks match in all projects
        KnownVariantCheck.objects.filter(
            id__in=[collaborator_check.id, no_access_check.id, no_creator_check.id],
        ).update(is_global=True)
        find_known_variant_matches(families)
        self.assertSetEqual(self.match_families(collaborator_check), {(GRCH38_VARIANT_ID, 'F000014_14')})
        self.assertSetEqual(self.match_families(no_access_check), {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
        })
        self.assertSetEqual(self.match_families(no_creator_check), {
            (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH37_VARIANT_ID, 'F000011_11'),
        })
        self.assertSetEqual(self.match_families(data_manager_check), set())

    @mock.patch('seqr.utils.known_variant_utils.get_project_guids_user_can_view')
    def test_find_known_variant_matches_access_error(self, mock_get_project_guids):
        mock_get_project_guids.side_effect = Exception('Terra is unavailable')
        check = self.create_check(self.manager_user, source_project_guid=OTHER_PROJECT_GUID)
        self.reset_logs()

        find_known_variant_matches(Family.objects.all())

        # Without a known access level for the creator, the check is limited to its source project
        self.assertSetEqual(self.match_families(check), {(GRCH37_VARIANT_ID, 'F000011_11')})
        mock_get_project_guids.assert_called_once_with(self.manager_user)
        self.assert_json_logs(user=None, expected=[(
            'Unable to determine project access for known variant check creator test_user_manager@test.com: Terra is unavailable',
            {'severity': 'WARNING'},
        ), ('create 1 KnownVariantMatchs', {'dbUpdate': mock.ANY})])

    @mock.patch('seqr.utils.communication_utils.EmailMultiAlternatives')
    def test_notify_known_variant_matches(self, mock_email):
        notify_known_variant_matches([])
        mock_email.assert_not_called()

        self.create_check(self.manager_user, verdict='C', gene_ids=['ENSG00000135953'], pubmed_id='12345678')
        self.create_check(self.collaborator_user, verdict='C')
        self.create_check(self.manager_user, variant_id=GRCH37_VARIANT_ID_2, verdict='B')
        self.create_check(
            self.manager_user, variant_id=GRCH38_VARIANT_ID, genome_version='38', verdict='R',
            source_project_guid=NON_ANALYST_PROJECT_GUID,
        )
        matches = find_known_variant_matches(Family.objects.exclude(guid='F000012_12'))
        self.assertEqual(len(matches), 6)

        notify_known_variant_matches(matches)

        # One email per project, with the number of matches by verdict and no variant, gene, family or creator detail
        emails = {
            call.kwargs['to'][0]: call.kwargs for call in mock_email.call_args_list
        }
        self.assertEqual(mock_email.call_count, 3)
        self.assertSetEqual(set(emails.keys()), {'test_user_manager@test.com', 'test_user_collaborator@test.com'})
        self.assertSetEqual({call.kwargs['subject'] for call in mock_email.call_args_list}, {
            'New known variant matches in seqr',
        })
        bodies = sorted(call.kwargs['body'] for call in mock_email.call_args_list)
        self.assertListEqual(bodies, [
            'Dear seqr user,\n\nThis is to notify you that 1 new known variant match (1 Suspected, refuted on '
            'follow-up) was found in seqr project Non-Analyst Project. Matches are listed on the project and family '
            'pages, where they can be marked as relevant or dismissed.\n\nAll the best,\nThe seqr team',
            'Dear seqr user,\n\nThis is to notify you that 2 new known variant matches (2 Confirmed causal) were '
            'found in seqr project Test Reprocessed Project. Matches are listed on the project and family pages, '
            'where they can be marked as relevant or dismissed.\n\nAll the best,\nThe seqr team',
            'Dear seqr user,\n\nThis is to notify you that 3 new known variant matches (2 Confirmed causal, 1 Benign '
            'or artefact (expected noise)) were found in seqr project 1kg project nåme with uniçøde. '
            'Matches are listed on the project and family pages, where they can be marked as relevant or dismissed.'
            '\n\nAll the best,\nThe seqr team',
        ])
        html_bodies = [call.args[0] for call in mock_email.return_value.attach_alternative.call_args_list]
        self.assertEqual(len(html_bodies), 3)
        self.assertEqual(
            len([body for body in html_bodies if '<a href=https://seqr.org/project/R0001_1kg/project_page>' in body]), 1,
        )
        for content in bodies + html_bodies:
            for detail in [
                GRCH37_VARIANT_ID, GRCH37_VARIANT_ID_2, GRCH38_VARIANT_ID, '3343353', 'ENSG', '12345678', 'F0000',
                'Test Manager', 'Test Collaborator',
            ]:
                self.assertNotIn(detail, content)

        notifications = Notification.objects.filter(verb__startswith='Found')
        self.assertSetEqual(set(notifications.values_list('verb', 'recipient__username')), {
            ('Found 3 new known variant matches (2 Confirmed causal, 1 Benign or artefact (expected noise))', 'test_user_manager'),
            ('Found 2 new known variant matches (2 Confirmed causal)', 'test_user_manager'),
            ('Found 1 new known variant match (1 Suspected, refuted on follow-up)', 'test_user_collaborator'),
        })
