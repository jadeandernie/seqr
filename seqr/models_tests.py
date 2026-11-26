from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from seqr.models import DataRequest, Individual
from seqr.views.utils.test_utils import AuthenticationTestCase

INDIVIDUAL_GUID = 'I000004_hg00731'


class DataRequestModelTest(AuthenticationTestCase):
    fixtures = ['users', '1kg_project']

    def _create(self, **kwargs):
        return DataRequest.objects.create(**{
            'individual': Individual.objects.get(guid=INDIVIDUAL_GUID), 'requested_fields': ['onsetAge', 'mondoId'],
            'created_by': self.collaborator_user, **kwargs,
        })

    def test_create(self):
        data_request = self._create()
        self.assertEqual(data_request.guid, f'DR{data_request.id:07d}_hg00731')
        self.assertEqual(str(data_request), 'HG00731')
        self.assertEqual(data_request.status, DataRequest.STATUS_OPEN)
        self.assertIsNone(data_request.reason)
        self.assertIsNone(data_request.assigned_to)
        self.assertIsNone(data_request.resolved_by)
        self.assertIsNone(data_request.resolved_date)
        self.assertIsNone(data_request.status_last_modified_by)
        self.assertIsNone(data_request.status_last_modified_date)
        data_request.full_clean()

        # Requests are removed with the individual, and kept when their users are removed
        data_request.assigned_to = self.manager_user
        data_request.save()
        self.manager_user.delete()
        data_request = DataRequest.objects.get(id=data_request.id)
        self.assertIsNone(data_request.assigned_to)
        data_request.individual.delete()
        self.assertEqual(DataRequest.objects.count(), 0)

    def test_validation(self):
        invalid_values = {
            'requested_fields': [
                (['onsetAge', 'notes', 'age'], 'Invalid clinical data fields: age, notes'),
                ([], 'This field cannot be blank.'),
            ],
            'reason': [('Z', "Value 'Z' is not a valid choice."), ('Free text', None)],
            'status': [('X', "Value 'X' is not a valid choice.")],
        }
        for field, values in invalid_values.items():
            for value, error in values:
                data_request = DataRequest(individual=Individual.objects.get(guid=INDIVIDUAL_GUID), **{
                    'requested_fields': ['onsetAge'], field: value,
                })
                with self.assertRaises(ValidationError) as cm:
                    data_request.full_clean(exclude=['guid'])
                self.assertListEqual(list(cm.exception.message_dict), [field])
                if error:
                    self.assertIn(error, cm.exception.message_dict[field])

    def test_one_open_request_per_individual(self):
        data_request = self._create()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self._create(requested_fields=['birthYear'])

        for status in [DataRequest.STATUS_FULFILLED, DataRequest.STATUS_DECLINED, DataRequest.STATUS_CANCELLED]:
            data_request.status = status
            data_request.save()
            data_request = self._create()
        self.assertEqual(DataRequest.objects.count(), 4)
        self._create(individual=Individual.objects.get(guid='I000007_na20870'))
        self.assertEqual(DataRequest.objects.filter(status=DataRequest.STATUS_OPEN).count(), 2)
