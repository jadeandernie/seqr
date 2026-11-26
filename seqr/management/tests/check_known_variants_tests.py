import mock

from django.core.management import call_command

from seqr.models import Project
from seqr.utils.known_variant_utils_tests import KnownVariantTestMixin, GRCH37_VARIANT_ID, GRCH38_VARIANT_ID, \
    OTHER_PROJECT_GUID, NON_ANALYST_PROJECT_GUID
from seqr.views.utils.test_utils import AuthenticationTestCase


@mock.patch('seqr.utils.communication_utils.EmailMultiAlternatives')
@mock.patch('seqr.management.commands.check_known_variants.logger')
class CheckKnownVariantsTest(KnownVariantTestMixin, AuthenticationTestCase):
    fixtures = ['users', '1kg_project']

    def setUp(self):
        super().setUp()
        self.set_up_clickhouse_mocks()

    def test_command(self, mock_logger, mock_email):
        call_command('check_known_variants')
        mock_logger.info.assert_called_with('Found 0 new known variant matches in all projects')
        self.mock_key_lookup.assert_not_called()

        self.create_check(self.manager_user)
        self.create_check(
            self.manager_user, variant_id=GRCH38_VARIANT_ID, genome_version='38',
            source_project_guid=NON_ANALYST_PROJECT_GUID,
        )

        with self.assertRaises(Project.DoesNotExist):
            call_command('check_known_variants', '--project=R0000_invalid')
        self.mock_key_lookup.assert_not_called()

        # Backfill a single project
        call_command('check_known_variants', f'--project={OTHER_PROJECT_GUID}')
        mock_logger.info.assert_called_with(f'Found 1 new known variant matches in {OTHER_PROJECT_GUID}')
        self.assertSetEqual(self.match_families(), {(GRCH37_VARIANT_ID, 'F000011_11')})
        self.mock_family_keys.assert_called_once_with(
            '37', 'SNV_INDEL', [OTHER_PROJECT_GUID], ['F000011_11', 'F000012_12'], [10],
        )
        mock_email.assert_not_called()

        # Backfill all projects, with notifications
        call_command('check_known_variants', '--notify')
        mock_logger.info.assert_called_with('Found 2 new known variant matches in all projects')
        self.assertSetEqual(self.match_families(), {
            (GRCH37_VARIANT_ID, 'F000011_11'), (GRCH37_VARIANT_ID, 'F000001_1'), (GRCH38_VARIANT_ID, 'F000014_14'),
        })
        self.assertEqual(mock_email.call_count, 2)
        self.assertSetEqual({call.kwargs['subject'] for call in mock_email.call_args_list}, {
            'New known variant matches in seqr',
        })

        # Running again finds and notifies nothing
        mock_email.reset_mock()
        call_command('check_known_variants', '--notify')
        mock_logger.info.assert_called_with('Found 0 new known variant matches in all projects')
        self.assertEqual(len(self.match_families()), 3)
        mock_email.assert_not_called()
