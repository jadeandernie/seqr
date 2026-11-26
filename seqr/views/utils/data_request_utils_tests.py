from django.db import connection
from django.test.utils import CaptureQueriesContext
from notifications.models import Notification

from seqr.models import DataRequest, Family, Individual, Project
from seqr.views.utils.data_request_utils import fulfil_data_requests, fulfil_family_data_requests, \
    get_individual_completeness_and_fulfil_data_requests, FAMILY_OPEN_DATA_REQUEST_ANNOTATION
from seqr.views.utils.individual_utils import add_or_update_individuals_and_families
from seqr.views.utils.test_utils import AuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
FAMILY_GUID = 'F000003_3'
INDIVIDUAL_GUID = 'I000007_na20870'


class DataRequestUtilsTest(AuthenticationTestCase):
    fixtures = ['users', '1kg_project', 'reference_data']

    def _create_request(self, fields, **kwargs):
        return DataRequest.objects.create(
            individual=Individual.objects.get(guid=INDIVIDUAL_GUID), requested_fields=fields,
            created_by=self.collaborator_user, **kwargs)

    def _update_pedigree(self, expected_tables=None, **kwargs):
        record = {'individualId': 'NA20870', 'familyId': '3', 'codedPhenotype': 'myopathy', 'maternalEthnicity': ['Asian']}
        record.update(kwargs.pop('record', {}))
        with CaptureQueriesContext(connection) as queries:
            result = add_or_update_individuals_and_families(
                Project.objects.get(guid=PROJECT_GUID), [record], self.manager_user, **kwargs)
        if expected_tables is not None:
            data_request_queries = [q['sql'] for q in queries.captured_queries if 'seqr_datarequest' in q['sql']]
            self.assertListEqual(
                [sql.split('"')[1] for sql in data_request_queries], expected_tables, msg=data_request_queries)
        return result

    def _reset_data(self):
        Family.objects.filter(guid=FAMILY_GUID).update(coded_phenotype=None, mondo_id=None)
        Individual.objects.filter(guid=INDIVIDUAL_GUID).update(maternal_ethnicity=None)

    def _status(self, data_request):
        return DataRequest.objects.get(id=data_request.id).status

    def test_fulfil_on_pedigree_update(self):
        # Without an open request, data requests are only read by the queries that already load the updated models
        self._create_request(['codedPhenotype'], status='D')
        pedigree_json = self._update_pedigree(expected_tables=['seqr_family', 'seqr_individual'])
        self.assertSetEqual(set(pedigree_json), {'individualsByGuid', 'familiesByGuid'})
        self.assertSetEqual(set(pedigree_json['individualsByGuid']), {INDIVIDUAL_GUID})
        self.assertNotIn('openDataRequestId', pedigree_json['individualsByGuid'][INDIVIDUAL_GUID])

        # Partially satisfied requests are returned and stay open
        self._reset_data()
        data_request = self._create_request(['codedPhenotype', 'ancestry', 'mondoId'])
        pedigree_json = self._update_pedigree()
        self.assertSetEqual(set(pedigree_json), {'individualsByGuid', 'familiesByGuid', 'dataRequestsByGuid'})
        self.assertSetEqual(set(pedigree_json['dataRequestsByGuid']), {data_request.guid})
        request_json = pedigree_json['dataRequestsByGuid'][data_request.guid]
        self.assertEqual(request_json['status'], 'O')
        self.assertListEqual([item['recorded'] for item in request_json['items']], [True, True, False])
        self.assertNotIn('openDataRequestId', pedigree_json['individualsByGuid'][INDIVIDUAL_GUID])

        # Family fields recorded through an individual's record fulfil requests, even if the individual is unchanged
        pedigree_json = self._update_pedigree(record={'mondoId': 'MONDO:0044970'})
        self.assertDictEqual(pedigree_json['individualsByGuid'], {})
        request_json = pedigree_json['dataRequestsByGuid'][data_request.guid]
        self.assertEqual(request_json['status'], 'F')
        self.assertEqual(request_json['resolvedBy'], 'Test Manager User')
        self.assertListEqual([item['recorded'] for item in request_json['items']], [True, True, True])
        data_request = DataRequest.objects.get(id=data_request.id)
        self.assertEqual(data_request.resolved_by, self.manager_user)
        notification = Notification.objects.get(verb='Data request for individual NA20870 fulfilled')
        self.assertEqual(notification.actor, Project.objects.get(guid=PROJECT_GUID))
        self.assertEqual(notification.recipient, self.collaborator_user)

        # Individual fields fulfil requests
        self._reset_data()
        data_request = self._create_request(['ancestry'])
        pedigree_json = self._update_pedigree()
        self.assertEqual(pedigree_json['dataRequestsByGuid'][data_request.guid]['status'], 'F')
        self.assertEqual(self._status(data_request), 'F')

        # Family fields are checked when the updated models are not returned
        self._reset_data()
        data_request = self._create_request(['codedPhenotype'])
        pedigree_json, individual_ids = self._update_pedigree(get_update_json=False, get_individual_db_ids=True)
        self.assertIsNone(pedigree_json)
        self.assertSetEqual(individual_ids, {7})
        self.assertEqual(self._status(data_request), 'F')

    def test_fulfil_without_open_requests(self):
        family = Family.objects.get(guid=FAMILY_GUID)
        annotated_family = Family.objects.annotate(**FAMILY_OPEN_DATA_REQUEST_ANNOTATION).get(guid=FAMILY_GUID)
        self.assertIs(annotated_family.hasOpenDataRequest, False)
        with self.assertNumQueries(0):
            self.assertDictEqual(fulfil_family_data_requests([family, annotated_family], self.manager_user), {})
            self.assertDictEqual(fulfil_data_requests([{'openDataRequestId': None}], self.manager_user), {})

        individual = Individual.objects.get(guid=INDIVIDUAL_GUID)
        with self.assertNumQueries(1):
            completeness = get_individual_completeness_and_fulfil_data_requests(individual, self.manager_user)
        self.assertEqual(completeness['score'], 9)

        self._create_request(['features'])
        annotated_family = Family.objects.annotate(**FAMILY_OPEN_DATA_REQUEST_ANNOTATION).get(guid=FAMILY_GUID)
        self.assertIs(annotated_family.hasOpenDataRequest, True)
        data_requests = fulfil_family_data_requests([family, annotated_family], self.manager_user)
        self.assertListEqual([request['status'] for request in data_requests.values()], ['O'])
