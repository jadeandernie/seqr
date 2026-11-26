from datetime import timedelta
import fnmatch
import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from notifications.models import Notification

from clickhouse_search.constants import TOO_MANY_RESULTS_ERROR
from seqr.models import AnalysisGroup, Dataset, Family, Project, SavedVariant, VariantSearchResults, VariantTag, \
    VariantTagType, Workbook, WorkbookTarget, Worksheet, WorksheetQuery, WorksheetQueryResult, WorksheetQueryRun
from seqr.views.apis.variant_search_api import load_search_results
from seqr.views.utils.test_utils import AuthenticationTestMixin
from seqr.views.utils.workbook_rerun_utils import NO_ACCESS_ERROR, NO_CREATOR_ERROR, get_due_cells, rerun_due_cells

PROJECT_GUID = 'R0001_1kg'
WORKBOOK_GUID = 'WB0000001_trio_analysis'
OTHER_PROJECT_WORKBOOK_GUID = 'WB0000002_non_analyst_workbook'
FAMILY_GUID = 'F000001_1'
NEVER_RUN_CELL_GUID = 'WQR0000001_1_1'

VARIANT = {'variantId': '1-100-A-T', 'key': 11, 'familyGuids': [FAMILY_GUID], 'transcripts': {'ENSG00000177000': []}}
NEW_VARIANT = {'variantId': '1-800-A-T', 'key': 15, 'familyGuids': [FAMILY_GUID], 'transcripts': {'ENSG00000097046': []}}
OTHER_NEW_VARIANT = {'variantId': '2-900-C-G', 'key': 16, 'familyGuids': [FAMILY_GUID], 'transcripts': {}}
VARIANT_KEY = [FAMILY_GUID, 'SNV_INDEL', '1-100-A-T']
NEW_VARIANT_KEY = [FAMILY_GUID, 'SNV_INDEL', '1-800-A-T']

COMMAND_LOGGER = 'seqr.management.commands.rerun_workbook_queries.logger'
UTILS_LOGGER = 'seqr.views.utils.workbook_rerun_utils.logger'
LOAD_COMMAND = 'seqr.management.commands.check_for_new_samples_from_pipeline'


class FakeRedis(object):

    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value):
        self.store[key] = value

    def expire(self, *args):
        pass

    def keys(self, pattern):
        return [key for key in self.store if fnmatch.fnmatch(key, pattern)]

    def delete(self, *keys):
        for key in keys:
            del self.store[key]


class RerunWorkbookQueriesTest(AuthenticationTestMixin, TestCase):
    fixtures = ['users', '1kg_project', 'variant_searches', 'workbooks']

    @classmethod
    def setUpTestData(cls):
        cls.set_up_users()
        Notification.objects.all().delete()

    def setUp(self):
        self.redis = FakeRedis()
        patcher = mock.patch('seqr.utils.redis_utils.redis.StrictRedis')
        patcher.start().return_value = self.redis
        self.addCleanup(patcher.stop)
        patcher = mock.patch('seqr.views.apis.variant_search_api.get_clickhouse_variants')
        self.mock_search = patcher.start()
        self.mock_search.return_value = [VARIANT]
        self.addCleanup(patcher.stop)
        patcher = mock.patch('seqr.utils.communication_utils.EmailMultiAlternatives')
        self.mock_email = patcher.start()
        self.addCleanup(patcher.stop)

        self.now = timezone.now()
        self.manager = User.objects.get(username='test_user_manager')
        self.workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        self.workbook.rerun_interval_days = 7
        self.workbook.save()
        self.de_novo_worksheet, self.recessive_worksheet = Worksheet.objects.filter(
            workbook=self.workbook).order_by('order')
        self.restrictive_query, self.permissive_query = self.de_novo_worksheet.worksheetquery_set.order_by('order')
        self.recessive_query = self.recessive_worksheet.worksheetquery_set.get()
        self.family_target, self.group_target = self.workbook.workbooktarget_set.order_by('order')

    def _cell(self, query, target, days_since_run):
        return WorksheetQueryResult.objects.create(
            query=query, target=target, last_run_date=self.now - timedelta(days=days_since_run), last_run_by=self.manager)

    def _set_last_run(self, cell, days_since_run):
        WorksheetQueryResult.objects.filter(id=cell.id).update(last_run_date=timezone.now() - timedelta(days=days_since_run))

    def _load_data(self, individual_id, days_since_load, active=True):
        dataset = Dataset.objects.create(
            dataset_type='SNV_INDEL', sample_type='WES', data_source='new_run',
            loaded_date=(self.now - timedelta(days=days_since_load)) if days_since_load else timezone.now())
        (dataset.active_individuals if active else dataset.inactive_individuals).add(individual_id)
        return dataset

    def _cached_search_keys(self):
        return sorted(self.redis.keys('search_results__*'))

    def _assert_due(self, expected_cells, **kwargs):
        self.assertListEqual(list(get_due_cells(now=self.now, **kwargs)), expected_cells)

    def _runs(self, cell):
        return list(cell.worksheetqueryrun_set.order_by('id').values(
            'trigger', 'status', 'error', 'num_results', 'num_new', 'result_keys', 'created_by__username'))

    @staticmethod
    def _run(**kwargs):
        return {
            'trigger': 'S', 'status': 'C', 'error': None, 'num_results': 1, 'num_new': 0, 'result_keys': None,
            'created_by__username': 'test_user_manager', **kwargs,
        }

    def _tag_excluded(self, variant_id):
        saved_variant = SavedVariant.objects.create(
            variant_id=variant_id, family=Family.objects.get(guid=FAMILY_GUID), xpos=1000000100, ref='A', alt='T')
        tag = VariantTag.objects.create(variant_tag_type=VariantTagType.objects.get(name='Excluded'))
        tag.saved_variants.add(saved_variant)

    def test_due_by_interval(self):
        # Cells that were never run are not due, whatever the interval
        self.assertIsNone(WorksheetQueryResult.objects.get(guid=NEVER_RUN_CELL_GUID).last_run_date)
        self._assert_due([])

        due_cell = self._cell(self.permissive_query, self.family_target, days_since_run=8)
        boundary_cell = self._cell(self.permissive_query, self.group_target, days_since_run=7)
        recessive_cell = self._cell(self.recessive_query, self.family_target, days_since_run=6)
        self._assert_due([due_cell, boundary_cell])
        self.assertEqual(get_due_cells().count(), 2)

        # A worksheet overrides the interval of its workbook, other worksheets still inherit it
        self.recessive_worksheet.rerun_interval_days = 1
        self.recessive_worksheet.save()
        # Ordered by the date they became due: 5 days ago, 1 day ago and now
        self._assert_due([recessive_cell, due_cell, boundary_cell])
        self.de_novo_worksheet.rerun_interval_days = 30
        self.de_novo_worksheet.save()
        self._assert_due([recessive_cell])

        # Without an interval on the workbook only worksheets with an interval are rerun
        self.workbook.rerun_interval_days = None
        self.workbook.save()
        self._assert_due([recessive_cell])
        self.recessive_worksheet.rerun_interval_days = None
        self.recessive_worksheet.save()
        self._set_last_run(due_cell, 400)
        self.de_novo_worksheet.rerun_interval_days = None
        self.de_novo_worksheet.save()
        self._assert_due([])

    def test_due_by_data_load(self):
        family_cell = self._cell(self.permissive_query, self.family_target, days_since_run=3)
        group_cell = self._cell(self.permissive_query, self.group_target, days_since_run=5)
        # The fixture data was loaded long before the runs
        self._assert_due([])
        self._assert_due([], data_loaded_only=True)

        # Data of an individual of family 2, which is not a target and not in the analysis group
        self._load_data(individual_id=4, days_since_load=1)
        self._assert_due([])
        # Data that was replaced since, and data that was loaded before the last run
        self._load_data(individual_id=1, days_since_load=1, active=False)
        self._load_data(individual_id=1, days_since_load=4)
        self._assert_due([group_cell])
        self.assertIsNotNone(get_due_cells(now=self.now).get().data_loaded_date)

        # Cells are due since the last load for their families
        self._load_data(individual_id=2, days_since_load=2)
        self._assert_due([family_cell, group_cell])
        self._assert_due([family_cell, group_cell], data_loaded_only=True)

        # Data of family 3, which is only in the analysis group
        dataset = self._load_data(individual_id=7, days_since_load=6)
        self._assert_due([family_cell, group_cell])
        Dataset.objects.filter(id=dataset.id).update(loaded_date=self.now - timedelta(days=1))
        self._assert_due([family_cell, group_cell])
        self._set_last_run(family_cell, 1.5)
        self._assert_due([group_cell])
        self._set_last_run(family_cell, 3)

        # Cells that are only due by their interval are not due for a data load
        interval_cell = self._other_project_cell(days_since_run=10)
        self.assertIsNone(get_due_cells(now=self.now).get(id=interval_cell.id).data_loaded_date)
        self._assert_due([interval_cell, family_cell, group_cell])
        self._assert_due([family_cell, group_cell], data_loaded_only=True)

        # Only cells with a target that has one of the families
        self._assert_due([group_cell], data_loaded_only=True, family_guids=['F000003_3'])
        self._assert_due([family_cell, group_cell], data_loaded_only=True, family_guids=['F000003_3', FAMILY_GUID])
        self._assert_due([family_cell, group_cell], family_guids=[FAMILY_GUID])
        self._assert_due([interval_cell], family_guids=['F000014_14'])
        self._assert_due([], data_loaded_only=True, family_guids=['F000014_14'])
        self._assert_due([], family_guids=['F000002_2'])
        self._assert_due([], family_guids=[])

        # Without automatic reruns a data load does not rerun anything
        self.workbook.rerun_interval_days = None
        self.workbook.save()
        self._assert_due([interval_cell])

    def _other_project_cell(self, days_since_run):
        workbook = Workbook.objects.get(guid=OTHER_PROJECT_WORKBOOK_GUID)
        workbook.rerun_interval_days = 1
        workbook.save()
        return self._cell(
            WorksheetQuery.objects.get(worksheet__workbook=workbook), workbook.workbooktarget_set.get(), days_since_run)

    @mock.patch(COMMAND_LOGGER)
    def test_command_filters_bounds_and_dry_run(self, mock_logger):
        cells = [
            self._cell(self.permissive_query, self.family_target, days_since_run=9),
            self._cell(self.recessive_query, self.family_target, days_since_run=20),
            self._cell(self.permissive_query, self.group_target, days_since_run=8),
        ]
        other_cell = self._other_project_cell(days_since_run=3)
        oldest_due_first = [cells[1].guid, cells[0].guid, other_cell.guid, cells[2].guid]

        for args, error in [
            (['--max-cells=0'], '--max-cells must be at least 1'),
            (['--workbook=WB0000000_invalid'], 'Invalid workbook: WB0000000_invalid'),
            (['--project=R0000_invalid'], 'Invalid project: R0000_invalid'),
        ]:
            with self.assertRaises(CommandError) as ce:
                call_command('rerun_workbook_queries', *args)
            self.assertEqual(str(ce.exception), error)

        def _assert_dry_run(args, expected_guids):
            call_command('rerun_workbook_queries', '--dry-run', *args)
            mock_logger.info.assert_called_with(
                f'{len(expected_guids)} workbook queries are due: {", ".join(expected_guids)}')

        _assert_dry_run([], oldest_due_first)
        _assert_dry_run(['--max-cells=2'], oldest_due_first[:2])
        _assert_dry_run([f'--workbook={WORKBOOK_GUID}'], [cells[1].guid, cells[0].guid, cells[2].guid])
        _assert_dry_run([f'--workbook={WORKBOOK_GUID}', '--max-cells=1'], [cells[1].guid])
        _assert_dry_run([f'--project={PROJECT_GUID}'], [cells[1].guid, cells[0].guid, cells[2].guid])
        _assert_dry_run(['--project=R0004_non_analyst_project'], [other_cell.guid])
        _assert_dry_run([f'--project={PROJECT_GUID}', f'--workbook={OTHER_PROJECT_WORKBOOK_GUID}'], [])
        self.assertListEqual(rerun_due_cells(max_cells=3, dry_run=True)['cells'], oldest_due_first[:3])

        # A dry run does not search or record anything
        self.mock_search.assert_not_called()
        self.assertEqual(WorksheetQueryRun.objects.count(), 0)
        self.assertEqual(VariantSearchResults.objects.filter(search_hash__startswith='WB').count(), 0)
        self.assertListEqual(self._cached_search_keys(), [])
        for cell in cells:
            last_run_date = cell.last_run_date
            cell.refresh_from_db()
            self.assertEqual(cell.last_run_date, last_run_date)

        # Only the cells within the bound are run, the others stay due
        call_command('rerun_workbook_queries', '--max-cells=2')
        mock_logger.info.assert_called_with(
            'Reran 2 workbook queries: 2 completed, 0 failed, 0 skipped. Notified 0 workbooks of new results')
        self.assertEqual(self.mock_search.call_count, 2)
        self.assertEqual(WorksheetQueryRun.objects.count(), 2)
        _assert_dry_run([], oldest_due_first[2:])

        call_command('rerun_workbook_queries')
        mock_logger.info.assert_called_with(
            'Reran 2 workbook queries: 2 completed, 0 failed, 0 skipped. Notified 0 workbooks of new results')
        self.assertEqual(WorksheetQueryRun.objects.count(), 4)
        call_command('rerun_workbook_queries')
        mock_logger.info.assert_called_with(
            'Reran 0 workbook queries: 0 completed, 0 failed, 0 skipped. Notified 0 workbooks of new results')
        self.assertEqual(WorksheetQueryRun.objects.count(), 4)

    def test_rerun_records_runs_and_refreshes_cache(self):
        cell = self._cell(self.permissive_query, self.family_target, days_since_run=8)
        start = timezone.now()

        # The first run of a cell is the baseline for later runs, it is run and recorded as the creator of the workbook
        summary = rerun_due_cells()
        self.assertDictEqual(summary, {
            'cells': [cell.guid], 'completed': 1, 'failed': 0, 'skipped': 0, 'notified_workbooks': 0,
        })
        self.mock_search.assert_called_once_with(mock.ANY, self.manager, sort='xpos', **self.permissive_query.search)
        self.assertListEqual([family.guid for family in self.mock_search.call_args.args[0]], [FAMILY_GUID])
        self.assertListEqual(self._runs(cell), [self._run(result_keys=[VARIANT_KEY])])
        cell.refresh_from_db()
        self.assertGreaterEqual(cell.last_run_date, start)
        self.assertEqual(cell.last_run_by, self.manager)
        self.assertEqual(cell.num_results, 1)
        self.assertFalse(cell.has_unreviewed)
        results_model = cell.results
        self.assertRegex(results_model.search_hash, '^WB[0-9a-f]{48}$')
        cache_key = f'search_results__{results_model.guid}__xpos'
        self.assertListEqual(self._cached_search_keys(), [cache_key])
        self._assert_due([])

        # Results loaded by a user come from the cache, also when the data would return other results
        self.mock_search.reset_mock()
        self.mock_search.return_value = [VARIANT, NEW_VARIANT]
        self.assertListEqual(load_search_results(results_model, self.manager), [VARIANT])
        self.mock_search.assert_not_called()
        self.assertEqual(len(self._runs(cell)), 1)

        # A scheduled rerun removes the results cached for every sort and searches again
        self.redis.set(f'search_results__{results_model.guid}__gnomad', '[]')
        self.redis.set('search_results__VSR0000000_other__xpos', '[]')
        self._set_last_run(cell, 8)
        self.assertEqual(rerun_due_cells()['completed'], 1)
        self.mock_search.assert_called_once()
        self.assertListEqual(self._runs(cell), [
            self._run(result_keys=[VARIANT_KEY]),
            self._run(num_results=2, num_new=1, result_keys=[VARIANT_KEY, NEW_VARIANT_KEY]),
        ])
        cell.refresh_from_db()
        self.assertTrue(cell.has_unreviewed)
        self.assertListEqual(self._cached_search_keys(), ['search_results__VSR0000000_other__xpos', cache_key])
        self.assertListEqual(load_search_results(results_model, self.manager), [VARIANT, NEW_VARIANT])
        self.mock_search.assert_called_once()

        # Unchanged results are recorded as a run without keys. A rerun after a data load has its own trigger
        self._load_data(individual_id=1, days_since_load=0)
        self.assertEqual(rerun_due_cells()['completed'], 1)
        self.assertEqual(self.mock_search.call_count, 2)
        self.assertDictEqual(self._runs(cell)[2], self._run(trigger='D', num_results=2))
        self.assertEqual(len(self._runs(cell)), 3)

        # Cells of other workbooks with the same search and target share the results, which are searched once
        other_workbook = Workbook.objects.create(
            project=self.workbook.project, name='Other', created_by=self.manager, rerun_interval_days=1)
        other_cell = self._cell(
            WorksheetQuery.objects.create(
                worksheet=Worksheet.objects.create(workbook=other_workbook, name='A'), name='A',
                search=self.permissive_query.search),
            WorkbookTarget.objects.create(workbook=other_workbook, family=self.family_target.family), days_since_run=2)
        self._set_last_run(cell, 8)
        self.mock_search.reset_mock()
        summary = rerun_due_cells()
        self.assertCountEqual(summary['cells'], [cell.guid, other_cell.guid])
        self.assertEqual(summary['completed'], 2)
        self.mock_search.assert_called_once()
        other_cell.refresh_from_db()
        self.assertEqual(other_cell.results, results_model)
        self.assertEqual(len(self._runs(cell)), 4)
        self.assertListEqual(self._runs(other_cell), [
            self._run(trigger='D', num_results=2, result_keys=[VARIANT_KEY, NEW_VARIANT_KEY])])

    @mock.patch(UTILS_LOGGER)
    def test_creator_without_access_is_not_searched(self, mock_logger):
        cell = self._cell(self.permissive_query, self.family_target, days_since_run=8)
        failed = {'cells': [cell.guid], 'completed': 0, 'failed': 0, 'skipped': 1, 'notified_workbooks': 0}

        def _assert_skipped(created_by, error, username):
            self._set_last_run(cell, 8)
            Workbook.objects.filter(id=self.workbook.id).update(created_by=created_by)
            start = timezone.now()
            self.assertDictEqual(rerun_due_cells(), failed)
            self.assertDictEqual(self._runs(cell)[-1], self._run(
                status='E', error=error, num_results=None, created_by__username=username))
            mock_logger.warning.assert_called_with(f'Rerun of workbook query {cell.guid} failed: {error}')
            # The failed run is not tried again until the cell is due again
            cell.refresh_from_db()
            self.assertGreaterEqual(cell.last_run_date, start)
            self._assert_due([])

        # A creator who can no longer view the project
        _assert_skipped(User.objects.get(username='test_user_no_access'), NO_ACCESS_ERROR, 'test_user_no_access')
        # A creator who can view the project but not the families of the target
        with mock.patch(
            'seqr.views.utils.permissions_utils.get_project_analysis_group_guids_user_can_view',
            lambda *args, **kwargs: ([], []),
        ):
            _assert_skipped(self.manager, NO_ACCESS_ERROR, 'test_user_manager')
        _assert_skipped(User.objects.get(username='test_user_inactive'), NO_CREATOR_ERROR, 'test_user_inactive')
        _assert_skipped(None, NO_CREATOR_ERROR, None)

        self.assertEqual(len(self._runs(cell)), 4)
        self.mock_search.assert_not_called()
        self.assertEqual(VariantSearchResults.objects.filter(search_hash__startswith='WB').count(), 0)
        self.assertIsNone(cell.results)
        self.assertEqual(Notification.objects.count(), 0)

    @mock.patch(UTILS_LOGGER)
    def test_failed_cells_do_not_stop_the_batch(self, mock_logger):
        empty_group = AnalysisGroup.objects.create(project=self.workbook.project, name='Empty', created_by=self.manager)
        empty_target = WorkbookTarget.objects.create(workbook=self.workbook, analysis_group=empty_group, order=2)
        cells = [
            self._cell(self.permissive_query, self.family_target, days_since_run=12),
            self._cell(self.recessive_query, self.family_target, days_since_run=11),
            self._cell(self.permissive_query, empty_target, days_since_run=10),
            self._cell(self.permissive_query, self.group_target, days_since_run=9),
        ]
        self.mock_search.side_effect = [Exception('ClickHouse is down'), Exception(TOO_MANY_RESULTS_ERROR), [VARIANT]]

        self.assertDictEqual(rerun_due_cells(), {
            'cells': [cell.guid for cell in cells], 'completed': 1, 'failed': 3, 'skipped': 0, 'notified_workbooks': 0,
        })
        self.assertEqual(self.mock_search.call_count, 3)
        self.assertListEqual(self._runs(cells[0]), [self._run(status='E', error='ClickHouse is down', num_results=None)])
        self.assertListEqual(self._runs(cells[1]), [self._run(status='T', error=TOO_MANY_RESULTS_ERROR, num_results=None)])
        no_families_error = 'Empty has no families to search'
        self.assertListEqual(self._runs(cells[2]), [self._run(status='E', error=no_families_error, num_results=None)])
        self.assertListEqual(self._runs(cells[3]), [self._run(result_keys=[VARIANT_KEY])])
        mock_logger.warning.assert_has_calls([
            mock.call(f'Rerun of workbook query {cells[0].guid} failed: ClickHouse is down'),
            mock.call(f'Rerun of workbook query {cells[1].guid} failed: {TOO_MANY_RESULTS_ERROR}'),
            mock.call(f'Rerun of workbook query {cells[2].guid} failed: {no_families_error}'),
        ])
        self._assert_due([])

    def _assert_notifications(self, expected_verbs, expected_recipients=None):
        notifications = Notification.objects.order_by('id')
        self.assertListEqual(sorted({notification.verb for notification in notifications}), sorted(expected_verbs))
        project = Project.objects.get(guid=PROJECT_GUID)
        for notification in notifications:
            self.assertEqual(notification.actor, project)
        if expected_recipients is not None:
            self.assertSetEqual({notification.recipient.username for notification in notifications}, expected_recipients)
        Notification.objects.all().delete()

    @staticmethod
    def _mark_reviewed(cell):
        result_keys = [key for run in WorksheetQueryRun.objects.filter(cell=cell) for key in run.result_keys or []]
        WorksheetQueryResult.objects.filter(id=cell.id).update(has_unreviewed=False, reviewed_keys=result_keys)

    def _rerun_all(self, cells, results):
        for cell in cells:
            self._set_last_run(cell, 8)
        self.mock_search.return_value = results
        return rerun_due_cells()['notified_workbooks']

    @mock.patch('seqr.views.utils.workbook_rerun_utils.BASE_URL', 'https://seqr.org/')
    def test_notifications(self):
        self.workbook.notify_on_new_results = True
        self.workbook.save()
        cells = [
            self._cell(self.permissive_query, self.family_target, days_since_run=8),
            self._cell(self.recessive_query, self.family_target, days_since_run=8),
        ]

        # The first results of a cell are its baseline and do not notify, neither do unchanged results
        self.assertEqual(self._rerun_all(cells, [VARIANT]), 0)
        self.assertEqual(self._rerun_all(cells, [VARIANT]), 0)
        self._assert_notifications([])
        self.mock_email.assert_not_called()

        # A new result that is tagged as excluded sets the stored flag but is nothing to review
        self._tag_excluded('1-800-A-T')
        self.assertEqual(self._rerun_all(cells, [VARIANT, NEW_VARIANT]), 0)
        self.assertTrue(WorksheetQueryResult.objects.get(id=cells[0].id).has_unreviewed)
        self._assert_notifications([])
        self.mock_email.assert_not_called()

        # One notification and one email per workbook for all cells that went from nothing to review to new results
        self.assertEqual(self._rerun_all(cells, [VARIANT, NEW_VARIANT, OTHER_NEW_VARIANT]), 1)
        message = '2 queries in workbook Trio analysis have new results to review'
        self._assert_notifications([message], expected_recipients={'test_user_manager'})
        url = f'https://seqr.org/project/{PROJECT_GUID}/workbook/{WORKBOOK_GUID}'
        self.mock_email.assert_called_once_with(
            body=f'Dear seqr user,\n\n{message}: {url}\n\nAll the best,\nThe seqr team',
            to=['test_user_manager@test.com'], subject='New workbook results to review in seqr',
        )
        self.mock_email.return_value.attach_alternative.assert_called_once_with(
            f'Dear seqr user,<br /><br />{message}: <a href={url}>{url}</a><br /><br />All the best,<br />The seqr team',
            'text/html')
        self.mock_email.return_value.send.assert_called_once()
        # The email and the notification do not name variants, genes or families
        for detail in ['2-900', '1-800', 'ENSG', FAMILY_GUID, 'F00']:
            self.assertNotIn(detail, str(self.mock_email.call_args) + str(self.mock_email.return_value.mock_calls))

        # Cells that already had results to review do not notify again
        self.mock_email.reset_mock()
        self.assertEqual(self._rerun_all(cells, [VARIANT, NEW_VARIANT, OTHER_NEW_VARIANT, {**VARIANT, 'variantId': '3-1-A-C'}]), 0)
        self._assert_notifications([])
        self.mock_email.assert_not_called()

        # A cell notifies again once its results were reviewed. A failed email does not fail the batch
        self._mark_reviewed(cells[1])
        self.mock_email.return_value.send.side_effect = Exception('No email server')
        with mock.patch(UTILS_LOGGER) as mock_logger:
            self.assertEqual(self._rerun_all(cells, [VARIANT, {**VARIANT, 'variantId': '4-1-A-C'}]), 1)
        mock_logger.error.assert_called_with(
            f'Error in notification of new results of workbook {WORKBOOK_GUID}: No email server')
        self._assert_notifications(['1 query in workbook Trio analysis has new results to review'])
        self.mock_email.return_value.send.side_effect = None

        # Nothing is sent for a workbook that does not notify
        self.mock_email.reset_mock()
        self.workbook.notify_on_new_results = False
        self.workbook.save()
        self._mark_reviewed(cells[1])
        self.assertEqual(self._rerun_all(cells, [VARIANT, {**VARIANT, 'variantId': '5-1-A-C'}]), 0)
        self._assert_notifications([])
        self.mock_email.assert_not_called()

    def test_notifications_of_shared_results(self):
        # A workbook without reruns of its own, which shares the results of a cell that is rerun
        collaborator = User.objects.get(username='test_user_collaborator')
        shared_workbook = Workbook.objects.create(
            project=self.workbook.project, name='Shared', created_by=collaborator, notify_on_new_results=True)
        cell = self._cell(self.permissive_query, self.family_target, days_since_run=8)
        shared_cell = self._cell(
            WorksheetQuery.objects.create(
                worksheet=Worksheet.objects.create(workbook=shared_workbook, name='A'), name='A',
                search=self.permissive_query.search),
            WorkbookTarget.objects.create(workbook=shared_workbook, family=self.family_target.family), days_since_run=1)
        self.assertEqual(self._rerun_all([cell], [VARIANT]), 0)
        shared_cell.results = WorksheetQueryResult.objects.get(id=cell.id).results
        shared_cell.save()
        load_search_results(shared_cell.results, collaborator)
        self.assertEqual(WorksheetQueryRun.objects.filter(cell=shared_cell).count(), 1)

        message = '1 query in workbook Shared has new results to review'
        self.assertEqual(self._rerun_all([cell], [VARIANT, NEW_VARIANT]), 1)
        self._assert_notifications([message], expected_recipients={'test_user_manager', 'test_user_collaborator'})
        self.mock_email.assert_called_once()
        self.assertListEqual(self.mock_email.call_args.kwargs['to'], ['test_user_collaborator@test.com'])

        # A creator who can not view the project any more or has no email address is not emailed
        self.mock_email.reset_mock()
        User.objects.filter(id=collaborator.id).update(email='')
        for i, (created_by, recipients) in enumerate([
            (User.objects.get(username='test_user_no_access'), {'test_user_manager'}),
            (None, {'test_user_manager'}),
            (collaborator, {'test_user_manager', 'test_user_collaborator'}),
        ]):
            Workbook.objects.filter(id=shared_workbook.id).update(created_by=created_by)
            self._mark_reviewed(shared_cell)
            self.assertEqual(self._rerun_all([cell], [VARIANT]), 0)
            self.assertEqual(self._rerun_all([cell], [VARIANT, {**VARIANT, 'variantId': f'9-{i + 1}-A-C'}]), 1)
            self._assert_notifications([message], expected_recipients=recipients)
        self.mock_email.assert_not_called()

    @mock.patch(f'{LOAD_COMMAND}.reset_cached_search_results')
    @mock.patch(f'{LOAD_COMMAND}.Command._load_new_samples')
    @mock.patch(f'{LOAD_COMMAND}.Command._get_runs')
    @mock.patch(f'{LOAD_COMMAND}.logger')
    def test_rerun_after_data_load(self, mock_logger, mock_get_runs, mock_load_new_samples, mock_reset_cache):
        run = {
            'files': {'_CLICKHOUSE_LOAD_SUCCESS'}, 'genome_version': 'GRCh38', 'dataset_type': 'SNV_INDEL',
        }
        mock_get_runs.return_value = {
            'gs://runs/a': {**run, 'run_version': 'run_a'}, 'gs://runs/b': {**run, 'run_version': 'run_b'},
            'gs://runs/c': {**run, 'run_version': 'run_c'},
        }
        mock_load_new_samples.side_effect = [{'F000014_14'}, Exception('Invalid run'), {FAMILY_GUID}]
        family_cell = self._cell(self.permissive_query, self.family_target, days_since_run=3)
        group_cell = self._cell(self.permissive_query, self.group_target, days_since_run=3)
        interval_cell = self._other_project_cell(days_since_run=10)
        self._load_data(individual_id=1, days_since_load=0)
        self._load_data(individual_id=7, days_since_load=0)

        # A failure of the reruns is logged and does not fail the load
        with mock.patch(f'{LOAD_COMMAND}.rerun_due_cells') as mock_rerun:
            mock_rerun.side_effect = Exception('Rerun failed')
            call_command('check_for_new_samples_from_pipeline')
            mock_rerun.assert_called_once_with(
                max_cells=10, family_guids=['F000001_1', 'F000014_14'], data_loaded_only=True)
        mock_logger.error.assert_has_calls([
            mock.call('Error loading run_b: Invalid run'),
            mock.call('Error in rerun of workbook queries for the loaded families: Rerun failed'),
        ])
        mock_logger.info.assert_called_with('DONE')
        mock_reset_cache.assert_called_once_with(project=None)
        self.assertEqual(WorksheetQueryRun.objects.count(), 0)

        # Only the cells of the loaded families that are due by the data load are rerun, within the bound
        mock_load_new_samples.side_effect = [{'F000014_14'}, set(), {FAMILY_GUID}]
        with mock.patch(f'{LOAD_COMMAND}.DATA_LOAD_MAX_CELLS', 1):
            call_command('check_for_new_samples_from_pipeline')
        mock_logger.info.assert_any_call('Reran 1 workbook queries for the loaded families')
        self.assertListEqual(self._runs(family_cell), [self._run(trigger='D', result_keys=[VARIANT_KEY])])
        self.assertEqual(WorksheetQueryRun.objects.count(), 1)

        mock_load_new_samples.side_effect = [{'F000014_14'}, set(), {FAMILY_GUID}]
        call_command('check_for_new_samples_from_pipeline')
        self.assertEqual(len(self._runs(group_cell)), 1)
        self.assertEqual(WorksheetQueryRun.objects.count(), 2)

        # Nothing is logged when no cell is due, cells due by their interval are left to the scheduled command
        mock_logger.reset_mock()
        mock_load_new_samples.side_effect = [{'F000014_14'}, set(), {FAMILY_GUID}]
        call_command('check_for_new_samples_from_pipeline')
        self.assertListEqual(mock_logger.info.call_args_list, [
            mock.call('Loading new samples from 3 run(s)'), mock.call('DONE'),
        ])
        self.assertListEqual(self._runs(interval_cell), [])
        mock_logger.error.assert_not_called()
