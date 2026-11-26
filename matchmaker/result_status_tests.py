from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from matchmaker.models import MatchmakerResult
from matchmaker.result_status import get_status_for_flags, get_status_for_flag_update, backfill_result_status, \
    iter_flag_combinations, STATUSES, STATUS_FLAG_UPDATES, STATUS_NEW, STATUS_REVIEWING, STATUS_RELEVANT, \
    STATUS_NOT_RELEVANT, STATUS_RESPONDED

NO_FLAGS = {'we_contacted': False, 'host_contacted': False, 'deemed_irrelevant': False, 'flag_for_analysis': False}


def _flags(**kwargs):
    return {**NO_FLAGS, **kwargs}


class ResultStatusTest(SimpleTestCase):

    def test_get_status_for_flags(self):
        self.assertEqual(get_status_for_flags(), STATUS_NEW)
        self.assertEqual(get_status_for_flags(host_contacted=True), STATUS_REVIEWING)
        self.assertEqual(get_status_for_flags(flag_for_analysis=True), STATUS_RELEVANT)
        self.assertEqual(get_status_for_flags(flag_for_analysis=True, host_contacted=True), STATUS_RELEVANT)
        self.assertEqual(get_status_for_flags(we_contacted=True), STATUS_RESPONDED)
        self.assertEqual(
            get_status_for_flags(we_contacted=True, flag_for_analysis=True, host_contacted=True), STATUS_RESPONDED)
        self.assertEqual(get_status_for_flags(deemed_irrelevant=True), STATUS_NOT_RELEVANT)
        self.assertEqual(get_status_for_flags(
            deemed_irrelevant=True, we_contacted=True, flag_for_analysis=True, host_contacted=True,
        ), STATUS_NOT_RELEVANT)

        all_flags = list(iter_flag_combinations())
        self.assertEqual(len(all_flags), 16)
        self.assertEqual(len({tuple(sorted(flags.items())) for flags in all_flags}), 16)
        self.assertSetEqual({get_status_for_flags(**flags) for flags in all_flags}, set(STATUSES))

    def test_status_flag_updates_round_trip(self):
        self.assertSetEqual(set(STATUS_FLAG_UPDATES.keys()), set(STATUSES))
        for status, updates in STATUS_FLAG_UPDATES.items():
            self.assertEqual(updates['deemed_irrelevant'], status == STATUS_NOT_RELEVANT)
            self.assertNotIn('host_contacted', updates)
            self.assertNotEqual(updates.get('we_contacted'), False)
            self.assertEqual(get_status_for_flags(**_flags(**updates)), STATUS_NEW if status == STATUS_REVIEWING else status)

    def test_get_status_for_flag_update(self):
        for status in STATUSES:
            self.assertEqual(get_status_for_flag_update(
                status, _flags(we_contacted=True), _flags(we_contacted=True, deemed_irrelevant=True),
            ), STATUS_NOT_RELEVANT)

        self.assertEqual(get_status_for_flag_update(
            STATUS_RELEVANT, _flags(flag_for_analysis=True), _flags(flag_for_analysis=True, we_contacted=True),
        ), STATUS_RESPONDED)

        flagged = _flags(flag_for_analysis=True)
        self.assertEqual(get_status_for_flag_update(STATUS_NEW, NO_FLAGS, flagged), STATUS_RELEVANT)
        self.assertEqual(get_status_for_flag_update(STATUS_REVIEWING, NO_FLAGS, flagged), STATUS_RELEVANT)
        self.assertEqual(get_status_for_flag_update(
            STATUS_RESPONDED, _flags(we_contacted=True), _flags(we_contacted=True, flag_for_analysis=True),
        ), STATUS_RESPONDED)

        host_contacted = _flags(host_contacted=True)
        self.assertEqual(get_status_for_flag_update(STATUS_NEW, NO_FLAGS, host_contacted), STATUS_REVIEWING)
        self.assertEqual(get_status_for_flag_update(
            STATUS_RELEVANT, flagged, _flags(flag_for_analysis=True, host_contacted=True),
        ), STATUS_RELEVANT)

        # Clearing the flag a status depends on falls back to the mapping used for the backfill
        self.assertEqual(get_status_for_flag_update(
            STATUS_NOT_RELEVANT, _flags(deemed_irrelevant=True, host_contacted=True), host_contacted,
        ), STATUS_REVIEWING)
        self.assertEqual(get_status_for_flag_update(STATUS_RELEVANT, flagged, NO_FLAGS), STATUS_NEW)
        self.assertEqual(get_status_for_flag_update(
            STATUS_RESPONDED, _flags(we_contacted=True, flag_for_analysis=True), flagged,
        ), STATUS_RELEVANT)

        # Edits which do not contradict the status leave it alone
        self.assertEqual(get_status_for_flag_update(STATUS_REVIEWING, host_contacted, NO_FLAGS), STATUS_REVIEWING)
        self.assertEqual(get_status_for_flag_update(
            STATUS_NEW, _flags(we_contacted=True, host_contacted=True), _flags(we_contacted=True),
        ), STATUS_NEW)


class ResultStatusModelTest(TestCase):
    fixtures = ['users', '1kg_project']

    def _create_result(self, **kwargs):
        return MatchmakerResult.objects.create(submission_id=1, result_data={'patient': {'id': 'P1'}}, **kwargs)

    def _assert_result(self, result, status, **flags):
        db_result = MatchmakerResult.objects.get(pk=result.pk)
        self.assertEqual(db_result.status, status)
        self.assertDictEqual(
            {flag: getattr(db_result, flag) for flag in NO_FLAGS}, _flags(**flags))

    def test_backfill_result_status(self):
        results_by_flags = [
            (flags, self._create_result(**flags).pk) for flags in iter_flag_combinations()
        ]
        # Simulate the state after the schema change and before the backfill: every row has the default status
        MatchmakerResult.objects.update(status=STATUS_NEW)

        backfill_result_status(MatchmakerResult)

        for flags, pk in results_by_flags:
            self.assertEqual(MatchmakerResult.objects.get(pk=pk).status, get_status_for_flags(**flags), flags)
        self.assertDictEqual({
            guid: MatchmakerResult.objects.get(guid=guid).status
            for guid in ['MR0003552_SHE_1006P_1', 'MR0007228_VCGS_FAM50_156', 'MR0004688_RGP_105_3']
        }, {
            'MR0003552_SHE_1006P_1': STATUS_NOT_RELEVANT,
            'MR0007228_VCGS_FAM50_156': STATUS_NEW,
            'MR0004688_RGP_105_3': STATUS_RESPONDED,
        })

    def test_create_result(self):
        self._assert_result(self._create_result(), STATUS_NEW)
        self._assert_result(self._create_result(host_contacted=True), STATUS_REVIEWING, host_contacted=True)
        self._assert_result(
            self._create_result(status=STATUS_RELEVANT, host_contacted=True), STATUS_RELEVANT,
            host_contacted=True, flag_for_analysis=True)
        self._assert_result(
            self._create_result(status=STATUS_NOT_RELEVANT, flag_for_analysis=True), STATUS_NOT_RELEVANT,
            deemed_irrelevant=True)

    def test_status_update_sets_flags(self):
        result = self._create_result(host_contacted=True)

        result.status = STATUS_RELEVANT
        result.save()
        self._assert_result(result, STATUS_RELEVANT, host_contacted=True, flag_for_analysis=True)

        result.status = STATUS_NOT_RELEVANT
        result.save()
        self._assert_result(result, STATUS_NOT_RELEVANT, host_contacted=True, deemed_irrelevant=True)

        result = MatchmakerResult.objects.get(pk=result.pk)
        result.status = STATUS_RESPONDED
        result.save()
        self._assert_result(result, STATUS_RESPONDED, host_contacted=True, we_contacted=True)

        # Contact flags record facts and are kept when the status moves on
        result.status = STATUS_REVIEWING
        result.save()
        self._assert_result(result, STATUS_REVIEWING, host_contacted=True, we_contacted=True)

        # The status wins when a status and a contradicting flag are saved together
        result.status = STATUS_RELEVANT
        result.deemed_irrelevant = True
        result.save()
        self._assert_result(
            result, STATUS_RELEVANT, host_contacted=True, we_contacted=True, flag_for_analysis=True)

        result.status = STATUS_NEW
        result.save()
        self._assert_result(result, STATUS_NEW, host_contacted=True, we_contacted=True)

    def test_flag_update_sets_status(self):
        result = self._create_result()

        result.host_contacted = True
        result.save()
        self._assert_result(result, STATUS_REVIEWING, host_contacted=True)

        result = MatchmakerResult.objects.get(pk=result.pk)
        result.flag_for_analysis = True
        result.save()
        self._assert_result(result, STATUS_RELEVANT, host_contacted=True, flag_for_analysis=True)

        result.deemed_irrelevant = True
        result.save()
        self._assert_result(
            result, STATUS_NOT_RELEVANT, host_contacted=True, flag_for_analysis=True, deemed_irrelevant=True)

        result.deemed_irrelevant = False
        result.save()
        self._assert_result(result, STATUS_RELEVANT, host_contacted=True, flag_for_analysis=True)

        result.we_contacted = True
        result.save()
        self._assert_result(
            result, STATUS_RESPONDED, host_contacted=True, flag_for_analysis=True, we_contacted=True)

        # Saving other fields leaves the triage state alone
        result.status = STATUS_REVIEWING
        result.save()
        result.comments = 'A comment'
        result.assigned_to = User.objects.get(username='test_user')
        result.save()
        self._assert_result(result, STATUS_REVIEWING, host_contacted=True, we_contacted=True)
        self.assertEqual(MatchmakerResult.objects.get(pk=result.pk).comments, 'A comment')
