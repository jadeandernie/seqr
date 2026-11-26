from copy import deepcopy
import json
import mock

from django.urls.base import reverse
from notifications.models import Notification

from seqr.models import Project, VariantSearch, Workbook, Worksheet, WorksheetQuery, WorksheetTemplate
from seqr.views.apis.project_api import project_notifications
from seqr.views.apis.workbook_api import project_workbooks_handler, workbook_detail_handler, update_workbook_handler, \
    delete_workbook_handler, create_worksheet_handler, run_worksheet_query_handler, update_workbook_editors_handler
from seqr.views.apis.worksheet_template_api import worksheet_templates_handler, create_worksheet_template_handler, \
    update_worksheet_template_handler, delete_worksheet_template_handler, attach_project_worksheet_template_handler, \
    detach_project_worksheet_template_handler, create_worksheet_from_template_handler, parse_template_queries
from seqr.views.utils.test_utils import AuthenticationTestCase, AnvilAuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
NO_ACCESS_PROJECT_GUID = 'R0004_non_analyst_project'
WORKBOOK_GUID = 'WB0000001_trio_analysis'
NO_ACCESS_WORKBOOK_GUID = 'WB0000002_non_analyst_workbook'
DE_NOVO_WORKSHEET_GUID = 'WS0000001_de_novo'
NO_ACCESS_WORKSHEET_GUID = 'WS0000003_other'
RESTRICTIVE_QUERY_GUID = 'WSQ0000001_de_novo_restrictive'
FAMILY_TARGET_GUID = 'WBT0000001_1'

DE_NOVO_TEMPLATE_GUID = 'WST9000001_de_novo_dominant'
RECESSIVE_TEMPLATE_GUID = 'WST9000002_recessive'
X_LINKED_TEMPLATE_GUID = 'WST9000003_x_linked'
DEFAULT_TEMPLATE_GUIDS = {DE_NOVO_TEMPLATE_GUID, RECESSIVE_TEMPLATE_GUID, X_LINKED_TEMPLATE_GUID}

MANAGER_NAME = 'Test Manager User'
COLLABORATOR_NAME = 'Test Collaborator User'

RESTRICTIVE_SEARCH = {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.001}}}
PERMISSIVE_SEARCH = {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.01}}}
WORKSHEET_QUERIES = [
    {'name': 'De novo restrictive', 'search': RESTRICTIVE_SEARCH},
    {'name': 'De novo permissive', 'search': PERMISSIVE_SEARCH},
]
HGMD_SEARCH = {
    'inheritance': {'mode': 'recessive'},
    'pathogenicity': {'hgmd': ['disease_causing'], 'clinvar': ['pathogenic']},
}
TEMPLATE_QUERIES = [{'name': 'Recessive', 'search': {'inheritance': {'mode': 'recessive'}}}]

FIXTURES = ['users', 'social_auth', '1kg_project', 'reference_data', 'variant_searches', 'workbooks', 'worksheet_templates']


@mock.patch('seqr.views.utils.permissions_utils.safe_redis_get_json', lambda *args: None)
class WorksheetTemplateAPITest(object):

    def _post(self, url, body=None):
        return self.client.post(url, content_type='application/json', data=json.dumps(body or {}))

    def _assert_error(self, response, error):
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [error])

    def _create_templates(self):
        project = Project.objects.get(guid=PROJECT_GUID)
        no_access_project = Project.objects.get(guid=NO_ACCESS_PROJECT_GUID)
        self.collaborator_template = WorksheetTemplate.objects.create(
            name='Collaborator template', queries=deepcopy(TEMPLATE_QUERIES), created_by=self.collaborator_user)
        self.manager_template = WorksheetTemplate.objects.create(
            name='Manager template', queries=[{'name': 'HGMD', 'search': deepcopy(HGMD_SEARCH)}],
            created_by=self.manager_user)
        self.project_template = WorksheetTemplate.objects.create(
            name='Project template', description='For 1kg', queries=[{'name': 'HGMD', 'search': deepcopy(HGMD_SEARCH)}],
            created_by=self.manager_user)
        self.project_template.projects.add(project, no_access_project)
        self.other_project_template = WorksheetTemplate.objects.create(
            name='Other project template', queries=deepcopy(TEMPLATE_QUERIES), created_by=self.manager_user)
        self.other_project_template.projects.add(no_access_project)

    def _get_templates(self):
        response = self.client.get(reverse(worksheet_templates_handler))
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(response.json().keys()), ['worksheetTemplatesByGuid'])
        return response.json()['worksheetTemplatesByGuid']

    def _assert_visible_templates(self, expected_templates, expected_can_edit):
        templates = self._get_templates()
        expected_guids = DEFAULT_TEMPLATE_GUIDS | {template.guid for template in expected_templates}
        self.assertSetEqual(set(templates.keys()), expected_guids)
        self.assertSetEqual(
            {guid for guid, template in templates.items() if template['canEdit']},
            {template if isinstance(template, str) else template.guid for template in expected_can_edit})

        # A template can be used exactly when it is listed
        all_templates = [
            self.collaborator_template, self.manager_template, self.project_template, self.other_project_template]
        workbook = Workbook.objects.create(
            project=Project.objects.get(guid=PROJECT_GUID), name='Visibility', created_by=self.manager_user)
        workbook.editors.add(self.collaborator_user, self.analyst_user, self.data_manager_user)
        url = reverse(create_worksheet_from_template_handler, args=[workbook.guid])
        for template in all_templates:
            response = self._post(url, {'worksheetTemplateGuid': template.guid})
            self.assertEqual(response.status_code, 200 if template.guid in expected_guids else 403)
        workbook.delete()
        return templates

    def test_worksheet_templates(self):
        url = reverse(worksheet_templates_handler)
        self.check_require_login(url)
        self._create_templates()

        # A user without projects only has the public templates, which include the default templates
        templates = self._get_templates()
        self.assertSetEqual(set(templates.keys()), DEFAULT_TEMPLATE_GUIDS)
        self.assertDictEqual(templates[DE_NOVO_TEMPLATE_GUID], {
            'worksheetTemplateGuid': DE_NOVO_TEMPLATE_GUID, 'name': 'De Novo / Dominant', 'description': mock.ANY,
            'queries': mock.ANY, 'isPublic': True, 'createdDate': '2026-11-26T00:00:00Z', 'createdBy': None,
            'lastModifiedDate': '2026-11-26T00:00:00Z', 'projectGuids': [], 'isCreator': False, 'canEdit': False,
        })
        self.assertListEqual(
            [query['name'] for query in templates[DE_NOVO_TEMPLATE_GUID]['queries']],
            ['De Novo/Dominant Restrictive', 'De Novo/Dominant Permissive'])
        self.assertListEqual(
            [template['name'] for template in templates.values()], ['De Novo / Dominant', 'Recessive', 'X-Linked'])
        # As for the default saved searches, HGMD filters are only given to analysts
        default_pathogenicity = templates[DE_NOVO_TEMPLATE_GUID]['queries'][0]['search']['pathogenicity']
        self.assertDictEqual(
            default_pathogenicity, {'clinvar': ['pathogenic', 'likely_pathogenic', 'conflicting_p_lp']})

        # A collaborator of a project also has their own templates and the templates of the project
        self.login_collaborator()
        templates = self._assert_visible_templates(
            [self.collaborator_template, self.project_template], expected_can_edit=[self.collaborator_template])
        self.assertDictEqual(templates[self.collaborator_template.guid], {
            'worksheetTemplateGuid': self.collaborator_template.guid, 'name': 'Collaborator template',
            'description': None, 'queries': TEMPLATE_QUERIES, 'isPublic': False, 'createdDate': mock.ANY,
            'createdBy': COLLABORATOR_NAME, 'lastModifiedDate': mock.ANY, 'projectGuids': [], 'isCreator': True,
            'canEdit': True,
        })
        # Only projects the user can view are listed, and HGMD filters of other users are not given
        self.assertDictEqual(templates[self.project_template.guid], {
            'worksheetTemplateGuid': self.project_template.guid, 'name': 'Project template', 'description': 'For 1kg',
            'queries': [{'name': 'HGMD', 'search': {**HGMD_SEARCH, 'pathogenicity': {'clinvar': ['pathogenic']}}}],
            'isPublic': False, 'createdDate': mock.ANY, 'createdBy': MANAGER_NAME, 'lastModifiedDate': mock.ANY,
            'projectGuids': [PROJECT_GUID], 'isCreator': False, 'canEdit': False,
        })

        self.login_manager()
        manager_templates = [self.manager_template, self.project_template, self.other_project_template]
        templates = self._assert_visible_templates(manager_templates, expected_can_edit=manager_templates)
        self.assertListEqual(templates[self.project_template.guid]['projectGuids'], [PROJECT_GUID, NO_ACCESS_PROJECT_GUID])
        self.assertDictEqual(templates[self.project_template.guid]['queries'][0]['search'], HGMD_SEARCH)

        # Analysts can change public templates, and have their HGMD filters
        self.login_analyst_user()
        templates = self._assert_visible_templates([self.project_template], expected_can_edit=DEFAULT_TEMPLATE_GUIDS)
        self.assertDictEqual(templates[self.project_template.guid]['queries'][0]['search'], HGMD_SEARCH)
        self.assertDictEqual(templates[DE_NOVO_TEMPLATE_GUID]['queries'][0]['search']['pathogenicity'], {
            **default_pathogenicity, 'hgmd': ['disease_causing'],
        })

        # Data managers can change public templates. As for gene lists, they only have the templates of the projects
        # they are a member of
        self.login_data_manager_user()
        self._assert_visible_templates([], expected_can_edit=DEFAULT_TEMPLATE_GUIDS)

    def test_default_templates(self):
        searches = {search.name: search.search for search in VariantSearch.objects.filter(created_by__isnull=True)}
        recessive_searches = [searches['Recessive Restrictive'], searches['Recessive Permissive']]
        expected_searches = {
            DE_NOVO_TEMPLATE_GUID: [searches['De Novo/Dominant Restrictive'], searches['De Novo/Dominant Permissive']],
            RECESSIVE_TEMPLATE_GUID: recessive_searches,
            # The default recessive searches, limited to X-linked recessive inheritance
            X_LINKED_TEMPLATE_GUID: [
                {**search, 'inheritance': {**search['inheritance'], 'mode': 'x_linked_recessive'}}
                for search in recessive_searches
            ],
        }
        templates = WorksheetTemplate.objects.all()
        self.assertSetEqual({template.guid for template in templates}, DEFAULT_TEMPLATE_GUIDS)
        for template in templates:
            self.assertTrue(template.is_public)
            self.assertIsNone(template.created_by)
            self.assertEqual(template.projects.count(), 0)
            self.assertTrue(template.description)
            # The queries pass the validation of queries that are created through the API
            self.assertListEqual(parse_template_queries(deepcopy(template.queries)), template.queries)
            self.assertListEqual([query['search'] for query in template.queries], expected_searches[template.guid])
            self.assertEqual(len({query['name'] for query in template.queries}), 2)

    def test_create_worksheet_template(self):
        url = reverse(create_worksheet_template_handler)
        self.check_require_login(url)
        self.login_collaborator()

        body = {'name': 'New template', 'queries': TEMPLATE_QUERIES}
        self._assert_error(self._post(url, {'queries': TEMPLATE_QUERIES}), '"Name" is required')
        source_error = 'Exactly one of "queries" or "worksheetGuid" is required'
        self._assert_error(self._post(url, {'name': 'New template'}), source_error)
        self._assert_error(self._post(url, {**body, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID}), source_error)
        for queries in [None, [], 'invalid', {}]:
            self._assert_error(self._post(url, {**body, 'queries': queries}), '"queries" must be a list of at least one query')
        self._assert_error(
            self._post(url, {**body, 'queries': ['invalid']}), 'Every query must have a "name" and a "search"')
        self._assert_error(self._post(url, {**body, 'queries': [{'search': {}}]}), '"Name" is required')
        self._assert_error(
            self._post(url, {**body, 'queries': [{'name': 'A', 'search': 'invalid'}]}),
            'The "search" of query "A" must be a JSON object')
        self._assert_error(
            self._post(url, {**body, 'queries': [
                {'name': 'A', 'search': {'inheritance': {'filter': {'genotype': {'I000001_na19675': 'ref_ref'}}}}},
            ]}), 'A: Saved searches cannot include custom genotype filters')
        with mock.patch('seqr.views.apis.worksheet_template_api.MAX_TEMPLATE_QUERIES', 1):
            self._assert_error(
                self._post(url, {**body, 'queries': TEMPLATE_QUERIES * 2}), 'A template can not have more than 1 queries')
        self._assert_error(self._post(url, {**body, 'description': ['invalid']}), '"description" must be text')
        self._assert_error(self._post(url, {**body, 'isPublic': 'yes'}), '"isPublic" must be true or false')
        # Only analysts and data managers can create public templates
        self.assertEqual(self._post(url, {**body, 'isPublic': True}).status_code, 403)
        self.assertEqual(WorksheetTemplate.objects.exclude(guid__in=DEFAULT_TEMPLATE_GUIDS).count(), 0)

        response = self._post(url, {
            'name': ' New template ', 'description': 'A description', 'isPublic': False,
            'queries': [{'name': ' Recessive ', 'search': {'inheritance': {'mode': 'recessive'}}, 'order': 5}],
            'createdBy': 'ignored', 'projectGuids': [PROJECT_GUID],
        })
        self.assertEqual(response.status_code, 200)
        templates = response.json()['worksheetTemplatesByGuid']
        self.assertEqual(len(templates), 1)
        template_guid = next(iter(templates))
        self.assertDictEqual(templates[template_guid], {
            'worksheetTemplateGuid': template_guid, 'name': 'New template', 'description': 'A description',
            'queries': TEMPLATE_QUERIES, 'isPublic': False, 'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME,
            'lastModifiedDate': mock.ANY, 'projectGuids': [], 'isCreator': True, 'canEdit': True,
        })
        template = WorksheetTemplate.objects.get(guid=template_guid)
        self.assertEqual(template.created_by, self.collaborator_user)
        self.assertListEqual(template.queries, TEMPLATE_QUERIES)
        self.assertEqual(template.projects.count(), 0)

        # Saving a worksheet as a template copies its queries, for any user who can view the workbook
        worksheet_body = {'name': 'From worksheet', 'workbookGuid': WORKBOOK_GUID, 'worksheetGuid': DE_NOVO_WORKSHEET_GUID}
        response = self._post(url, worksheet_body)
        self.assertEqual(response.status_code, 200)
        worksheet_template_guid = next(iter(response.json()['worksheetTemplatesByGuid']))
        self.assertDictEqual(response.json()['worksheetTemplatesByGuid'][worksheet_template_guid], {
            'worksheetTemplateGuid': worksheet_template_guid, 'name': 'From worksheet', 'description': None,
            'queries': WORKSHEET_QUERIES, 'isPublic': False, 'createdDate': mock.ANY, 'createdBy': COLLABORATOR_NAME,
            'lastModifiedDate': mock.ANY, 'projectGuids': [], 'isCreator': True, 'canEdit': True,
        })
        # Later changes of the worksheet do not change the template
        WorksheetQuery.objects.filter(guid=RESTRICTIVE_QUERY_GUID).update(name='Renamed', search={})
        self.assertListEqual(WorksheetTemplate.objects.get(guid=worksheet_template_guid).queries, WORKSHEET_QUERIES)

        empty_worksheet = Worksheet.objects.create(workbook=Workbook.objects.get(guid=WORKBOOK_GUID), name='Empty')
        self._assert_error(
            self._post(url, {**worksheet_body, 'worksheetGuid': empty_worksheet.guid}),
            'Worksheet "Empty" has no queries to save as a template')
        self.assertEqual(self._post(url, {**worksheet_body, 'worksheetGuid': NO_ACCESS_WORKSHEET_GUID}).status_code, 404)
        self.assertEqual(self._post(url, {'name': 'A', 'worksheetGuid': DE_NOVO_WORKSHEET_GUID}).status_code, 404)
        self.assertEqual(self._post(url, {
            'name': 'A', 'workbookGuid': NO_ACCESS_WORKBOOK_GUID, 'worksheetGuid': NO_ACCESS_WORKSHEET_GUID,
        }).status_code, 403)
        self.assertEqual(WorksheetTemplate.objects.exclude(guid__in=DEFAULT_TEMPLATE_GUIDS).count(), 2)

        for login in [self.login_analyst_user, self.login_data_manager_user]:
            login()
            response = self._post(url, {**body, 'isPublic': True})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(next(iter(response.json()['worksheetTemplatesByGuid'].values()))['isPublic'])

    def test_update_and_delete_worksheet_template(self):
        self._create_templates()
        url = reverse(update_worksheet_template_handler, args=[self.collaborator_template.guid])
        delete_url = reverse(delete_worksheet_template_handler, args=[self.collaborator_template.guid])
        self.check_require_login(url)

        # Users who can not view a template or can only view it can not change or delete it
        project_template_urls = [
            reverse(update_worksheet_template_handler, args=[self.project_template.guid]),
            reverse(delete_worksheet_template_handler, args=[self.project_template.guid]),
        ]
        for login, no_access_urls in [
            (self.login_base_user, [url, delete_url, *project_template_urls]),
            (self.login_manager, [url, delete_url]),
            (self.login_collaborator, project_template_urls),
            (self.login_analyst_user, project_template_urls),
            (self.login_data_manager_user, project_template_urls),
        ]:
            login()
            for no_access_url in no_access_urls:
                self.assertEqual(self._post(no_access_url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(WorksheetTemplate.objects.filter(name='Not allowed').count(), 0)
        self.assertEqual(WorksheetTemplate.objects.count(), 7)

        self.login_collaborator()
        self._assert_error(self._post(url, {'name': ' '}), '"Name" is required')
        self._assert_error(self._post(url, {'description': 1}), '"description" must be text')
        self._assert_error(self._post(url, {'queries': []}), '"queries" must be a list of at least one query')
        self._assert_error(self._post(url, {'isPublic': None}), '"isPublic" must be true or false')
        self.assertEqual(self._post(url, {'isPublic': True}).status_code, 403)

        response = self._post(url)
        self.assertEqual(response.status_code, 200)
        template_json = response.json()['worksheetTemplatesByGuid'][self.collaborator_template.guid]
        self.assertEqual(template_json['name'], 'Collaborator template')

        new_queries = [{'name': 'Dominant', 'search': {'inheritance': {'mode': 'de_novo'}}}]
        response = self._post(url, {
            'name': 'Renamed template', 'description': 'Described', 'queries': new_queries, 'isPublic': False,
        })
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetTemplatesByGuid': {self.collaborator_template.guid: {
            **template_json, 'name': 'Renamed template', 'description': 'Described', 'queries': new_queries,
            'lastModifiedDate': mock.ANY,
        }}})
        self.collaborator_template.refresh_from_db()
        self.assertEqual(self.collaborator_template.name, 'Renamed template')
        self.assertListEqual(self.collaborator_template.queries, new_queries)
        self.assertEqual(self.collaborator_template.created_by, self.collaborator_user)

        # An analyst can make a template they can view public, and can then change it
        self.collaborator_template.projects.add(Project.objects.get(guid=PROJECT_GUID))
        self.login_analyst_user()
        self.assertEqual(self._post(url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(self._post(delete_url).status_code, 403)
        analyst_template = WorksheetTemplate.objects.create(
            name='Analyst template', queries=TEMPLATE_QUERIES, created_by=self.analyst_user)
        analyst_url = reverse(update_worksheet_template_handler, args=[analyst_template.guid])
        response = self._post(analyst_url, {'isPublic': True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['worksheetTemplatesByGuid'][analyst_template.guid]['isPublic'])
        default_url = reverse(update_worksheet_template_handler, args=[DE_NOVO_TEMPLATE_GUID])
        response = self._post(default_url, {'description': 'Updated default'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['worksheetTemplatesByGuid'][DE_NOVO_TEMPLATE_GUID]['description'], 'Updated default')
        # Only its creator can make a public template private, as nobody else could view it afterwards
        self._assert_error(
            self._post(default_url, {'isPublic': False}), 'Only the creator of a template can make it private')
        self.assertTrue(WorksheetTemplate.objects.get(guid=DE_NOVO_TEMPLATE_GUID).is_public)
        response = self._post(analyst_url, {'isPublic': False})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['worksheetTemplatesByGuid'][analyst_template.guid]['isPublic'])
        self.assertEqual(self._post(analyst_url, {'isPublic': True}).status_code, 200)

        # Users who are not analysts can change the public templates they created, but not make them private
        WorksheetTemplate.objects.filter(id=self.collaborator_template.id).update(is_public=True)
        self.login_collaborator()
        self.assertEqual(self._post(url, {'isPublic': False}).status_code, 403)
        response = self._post(url, {'name': 'Public template', 'isPublic': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._post(analyst_url, {'name': 'Not allowed'}).status_code, 403)
        self.assertEqual(
            self._post(reverse(delete_worksheet_template_handler, args=[analyst_template.guid])).status_code, 403)

        # Data managers can change and delete public templates, as analysts can
        self.login_data_manager_user()
        self.assertEqual(self._post(analyst_url, {'name': 'Renamed by a data manager'}).status_code, 200)
        response = self._post(reverse(delete_worksheet_template_handler, args=[analyst_template.guid]))
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetTemplatesByGuid': {analyst_template.guid: None}})

        self.login_collaborator()
        response = self._post(delete_url)
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'worksheetTemplatesByGuid': {self.collaborator_template.guid: None}})
        self.assertEqual(self._post(delete_url).status_code, 404)
        self.assertEqual(self._post(url).status_code, 404)
        self.assertEqual(WorksheetTemplate.objects.count(), 6)
        self.assertEqual(Project.objects.filter(guid=PROJECT_GUID).count(), 1)

    def test_attach_and_detach_project_worksheet_template(self):
        self._create_templates()
        attach_url = reverse(attach_project_worksheet_template_handler, args=[PROJECT_GUID, self.manager_template.guid])
        detach_url = reverse(detach_project_worksheet_template_handler, args=[PROJECT_GUID, self.manager_template.guid])
        self.check_manager_login(attach_url)

        # Attaching requires edit access to the project and view access to the template
        collaborator_attach_url = reverse(
            attach_project_worksheet_template_handler, args=[PROJECT_GUID, self.collaborator_template.guid])
        self.assertEqual(self._post(collaborator_attach_url).status_code, 403)
        self.login_collaborator()
        self.assertEqual(self._post(collaborator_attach_url).status_code, 403)
        self.assertEqual(self._post(reverse(
            attach_project_worksheet_template_handler, args=[PROJECT_GUID, DE_NOVO_TEMPLATE_GUID])).status_code, 403)
        self.assertEqual(self._post(reverse(
            detach_project_worksheet_template_handler, args=[PROJECT_GUID, self.project_template.guid])).status_code, 403)
        self.assertEqual(self.collaborator_template.projects.count(), 0)
        self.assertEqual(self.project_template.projects.count(), 2)
        self.assertEqual(WorksheetTemplate.objects.get(guid=DE_NOVO_TEMPLATE_GUID).projects.count(), 0)

        self.login_manager()
        self.assertEqual(self._post(reverse(
            attach_project_worksheet_template_handler, args=[PROJECT_GUID, 'WST0000000_invalid'])).status_code, 404)
        self.assertEqual(self._post(reverse(
            attach_project_worksheet_template_handler, args=['R0000_invalid', self.manager_template.guid])).status_code, 404)

        response = self._post(attach_url)
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(response.json().keys()), ['worksheetTemplatesByGuid'])
        self.assertListEqual(
            response.json()['worksheetTemplatesByGuid'][self.manager_template.guid]['projectGuids'], [PROJECT_GUID])
        self.assertEqual(self._post(attach_url).status_code, 200)
        self.assertListEqual(list(self.manager_template.projects.values_list('guid', flat=True)), [PROJECT_GUID])
        response = self._post(reverse(
            attach_project_worksheet_template_handler, args=[PROJECT_GUID, DE_NOVO_TEMPLATE_GUID]))
        self.assertEqual(response.status_code, 200)

        # The project members can now view and use the template, and still can not change it
        self.login_collaborator()
        templates = self._get_templates()
        self.assertFalse(templates[self.manager_template.guid]['canEdit'])
        self.assertListEqual(templates[self.manager_template.guid]['projectGuids'], [PROJECT_GUID])
        self.assertEqual(self._post(detach_url).status_code, 403)

        self.login_manager()
        response = self._post(detach_url)
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(
            response.json()['worksheetTemplatesByGuid'][self.manager_template.guid]['projectGuids'], [])
        self.assertEqual(self.manager_template.projects.count(), 0)
        self.login_collaborator()
        self.assertNotIn(self.manager_template.guid, self._get_templates())

        # A template the user can not view any more can still be detached from a project the user can edit
        self.collaborator_template.projects.add(Project.objects.get(guid=PROJECT_GUID))
        WorksheetTemplate.objects.filter(id=self.collaborator_template.id).update(created_by=self.no_access_user)
        self.login_manager()
        response = self._post(reverse(
            detach_project_worksheet_template_handler, args=[PROJECT_GUID, self.collaborator_template.guid]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.collaborator_template.projects.count(), 0)
        self.assertEqual(self._post(collaborator_attach_url).status_code, 403)
        self.assertEqual(self.collaborator_template.projects.count(), 0)

    def test_create_worksheet_from_template(self):
        self._create_templates()
        url = reverse(create_worksheet_from_template_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(url)

        self.assertEqual(self._post(url).status_code, 404)
        self.assertEqual(self._post(url, {'worksheetTemplateGuid': 'WST0000000_invalid'}).status_code, 404)
        self.assertEqual(self._post(url, {'worksheetTemplateGuid': self.collaborator_template.guid}).status_code, 403)
        self._assert_error(
            self._post(url, {'worksheetTemplateGuid': self.project_template.guid, 'name': 'De Novo'}),
            'A worksheet named "De Novo" already exists')
        self.assertEqual(Worksheet.objects.count(), 3)

        response = self._post(url, {'worksheetTemplateGuid': self.project_template.guid})
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {'worksheetsByGuid', 'worksheetQueriesByGuid'})
        worksheet_guid = next(iter(response_json['worksheetsByGuid']))
        worksheet_json = {
            'worksheetGuid': worksheet_guid, 'workbookGuid': WORKBOOK_GUID, 'name': 'Project template', 'order': 2,
            'rerunIntervalDays': None, 'templateGuid': self.project_template.guid,
        }
        self.assertDictEqual(response_json['worksheetsByGuid'], {worksheet_guid: worksheet_json})
        query_guid = next(iter(response_json['worksheetQueriesByGuid']))
        query_json = {
            'worksheetQueryGuid': query_guid, 'worksheetGuid': worksheet_guid, 'name': 'HGMD', 'order': 0,
            'search': HGMD_SEARCH, 'createdDate': mock.ANY, 'createdBy': MANAGER_NAME,
        }
        self.assertDictEqual(response_json['worksheetQueriesByGuid'], {query_guid: query_json})
        self._assert_error(
            self._post(url, {'worksheetTemplateGuid': self.project_template.guid}),
            'A worksheet named "Project template" already exists')

        # The queries of a default template are copied in their order, without HGMD filters for users who are not analysts
        response = self._post(url, {'worksheetTemplateGuid': RECESSIVE_TEMPLATE_GUID, 'name': ' Recessive defaults '})
        self.assertEqual(response.status_code, 200)
        default_worksheet = next(iter(response.json()['worksheetsByGuid'].values()))
        self.assertDictEqual(default_worksheet, {
            'worksheetGuid': mock.ANY, 'workbookGuid': WORKBOOK_GUID, 'name': 'Recessive defaults', 'order': 3,
            'rerunIntervalDays': None, 'templateGuid': RECESSIVE_TEMPLATE_GUID,
        })
        default_queries = sorted(response.json()['worksheetQueriesByGuid'].values(), key=lambda query: query['order'])
        self.assertListEqual(
            [(query['name'], query['order']) for query in default_queries],
            [('Recessive Restrictive', 0), ('Recessive Permissive', 1)])
        template_searches = [query['search'] for query in WorksheetTemplate.objects.get(guid=RECESSIVE_TEMPLATE_GUID).queries]
        for query, template_search in zip(default_queries, template_searches):
            self.assertIn('hgmd', template_search['pathogenicity'])
            self.assertDictEqual(query['search'], {
                **template_search,
                'pathogenicity': {k: v for k, v in template_search['pathogenicity'].items() if k != 'hgmd'},
            })

        # Worksheets are copies: changing or deleting the template does not change them
        template_url = reverse(update_worksheet_template_handler, args=[self.project_template.guid])
        response = self._post(template_url, {'name': 'Changed template', 'queries': TEMPLATE_QUERIES * 2})
        self.assertEqual(response.status_code, 200)
        detail_url = reverse(workbook_detail_handler, args=[WORKBOOK_GUID])

        def _assert_worksheet_unchanged():
            detail_json = self.client.get(detail_url).json()
            self.assertDictEqual(detail_json['worksheetsByGuid'][worksheet_guid], worksheet_json)
            self.assertDictEqual({
                guid: query for guid, query in detail_json['worksheetQueriesByGuid'].items()
                if query['worksheetGuid'] == worksheet_guid
            }, {query_guid: query_json})

        _assert_worksheet_unchanged()
        response = self._post(reverse(delete_worksheet_template_handler, args=[self.project_template.guid]))
        self.assertEqual(response.status_code, 200)
        _assert_worksheet_unchanged()
        # The template itself was not changed by the worksheets that were created from it
        self.assertEqual(len(WorksheetTemplate.objects.get(guid=RECESSIVE_TEMPLATE_GUID).queries), 2)

        # Analysts get the HGMD filters of a default template
        self.login_analyst_user()
        response = self._post(url, {'worksheetTemplateGuid': RECESSIVE_TEMPLATE_GUID, 'name': 'Analyst recessive'})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(
            [query['search'] for query in
             sorted(response.json()['worksheetQueriesByGuid'].values(), key=lambda query: query['order'])],
            template_searches)

        # Users who can not edit the workbook can not add worksheets to it
        self.login_collaborator()
        self.assertEqual(self._post(url, {'worksheetTemplateGuid': DE_NOVO_TEMPLATE_GUID}).status_code, 403)
        self.assertEqual(self._post(
            reverse(create_worksheet_from_template_handler, args=[NO_ACCESS_WORKBOOK_GUID]),
            {'worksheetTemplateGuid': DE_NOVO_TEMPLATE_GUID},
        ).status_code, 403)
        self.assertEqual(Worksheet.objects.count(), 6)

    def _get_workbook_json(self):
        response = self.client.get(reverse(workbook_detail_handler, args=[WORKBOOK_GUID]))
        self.assertEqual(response.status_code, 200)
        return response.json()['workbooksByGuid'][WORKBOOK_GUID]

    def _get_notification_verbs(self):
        response = self.client.get(reverse(project_notifications, args=[PROJECT_GUID, 'unread']))
        self.assertEqual(response.status_code, 200)
        return [notification['verb'] for notification in response.json()['unreadNotifications']]

    def test_update_workbook_editors(self):
        url = reverse(update_workbook_editors_handler, args=[WORKBOOK_GUID])
        self.check_manager_login(url)
        workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        Notification.objects.all().delete()

        self._assert_error(self._post(url), '"usernames" must be a list of usernames')
        self._assert_error(self._post(url, {'usernames': 'test_user_collaborator'}), '"usernames" must be a list of usernames')
        self._assert_error(self._post(url, {'usernames': [12]}), '"usernames" must be a list of usernames')
        # Only users with access to the project can be editors. Users that do not exist get the same error
        self._assert_error(
            self._post(url, {'usernames': [
                'test_user_collaborator', 'test_user_no_access', 'unknown_user', 'test_user_inactive', 'unknown_user',
            ]}),
            'The following users do not have access to this project: test_user_inactive, test_user_no_access, unknown_user')
        self.assertEqual(workbook.editors.count(), 0)
        self.assertEqual(Notification.objects.count(), 0)

        response = self._post(url, {'usernames': ['test_user_collaborator', 'test_user_manager']})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(list(response.json().keys()), ['workbooksByGuid'])
        editors_json = [
            {'username': 'test_user_collaborator', 'displayName': COLLABORATOR_NAME, 'email': 'test_user_collaborator@test.com'},
            {'username': 'test_user_manager', 'displayName': MANAGER_NAME, 'email': 'test_user_manager@test.com'},
        ]
        workbook_json = response.json()['workbooksByGuid'][WORKBOOK_GUID]
        self.assertListEqual(workbook_json['editors'], editors_json)
        self.assertTrue(workbook_json['canEdit'])
        self.assertTrue(workbook_json['canManageEditors'])
        self.assertSetEqual(set(workbook.editors.all()), {self.collaborator_user, self.manager_user})

        # Added editors are notified, the user who shares is not
        notification = Notification.objects.get()
        self.assertEqual(notification.recipient, self.collaborator_user)
        self.assertEqual(notification.actor, workbook.project)
        self.assertEqual(notification.verb, 'Test Manager User shared workbook Trio analysis with you')
        self.assertFalse(notification.public)
        # Editors that stay editors are not notified again
        self.assertEqual(self._post(url, {'usernames': ['test_user_collaborator']}).status_code, 200)
        self.assertEqual(Notification.objects.count(), 1)

        # The notification is only shown to the added editor, not to the other members of the project
        self.login_analyst_user()
        self.assertListEqual(self._get_notification_verbs(), [])
        self.assertEqual(Notification.objects.count(), 1)

        # An editor can change the workbook, but not delete it or change its editors
        self.login_collaborator()
        self.assertListEqual(self._get_notification_verbs(), ['Test Manager User shared workbook Trio analysis with you'])
        workbook_json = self._get_workbook_json()
        self.assertTrue(workbook_json['canEdit'])
        self.assertFalse(workbook_json['canManageEditors'])
        self.assertListEqual(workbook_json['editors'], editors_json[:1])
        response = self.client.get(reverse(project_workbooks_handler, args=[PROJECT_GUID]))
        self.assertTrue(response.json()['workbooksByGuid'][WORKBOOK_GUID]['canEdit'])
        response = self._post(reverse(update_workbook_handler, args=[WORKBOOK_GUID]), {'description': 'By an editor'})
        self.assertEqual(response.status_code, 200)
        response = self._post(reverse(create_worksheet_handler, args=[WORKBOOK_GUID]), {'name': 'By an editor'})
        self.assertEqual(response.status_code, 200)
        response = self._post(
            reverse(create_worksheet_from_template_handler, args=[WORKBOOK_GUID]),
            {'worksheetTemplateGuid': X_LINKED_TEMPLATE_GUID})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._post(url, {'usernames': []}).status_code, 403)
        self.assertEqual(self._post(reverse(delete_workbook_handler, args=[WORKBOOK_GUID])).status_code, 403)
        self.assertEqual(workbook.editors.count(), 1)
        # Being an editor of one workbook does not allow anything in other workbooks and projects
        self.assertEqual(self._post(
            reverse(update_workbook_editors_handler, args=[NO_ACCESS_WORKBOOK_GUID]), {'usernames': []}).status_code, 403)

        # The creator of a workbook can share it without edit access to the project
        collaborator_workbook = Workbook.objects.create(
            project=workbook.project, name='Collaborator workbook', created_by=self.collaborator_user)
        collaborator_url = reverse(update_workbook_editors_handler, args=[collaborator_workbook.guid])
        response = self._post(collaborator_url, {'usernames': ['test_user_manager']})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(
            response.json()['workbooksByGuid'][collaborator_workbook.guid]['editors'], editors_json[1:])
        self.assertEqual(
            Notification.objects.get(recipient=self.manager_user).verb,
            'Test Collaborator User shared workbook Collaborator workbook with you')
        self.assertEqual(self._post(reverse(delete_workbook_handler, args=[collaborator_workbook.guid])).status_code, 200)

        # Removing an editor removes their edit access
        self.login_manager()
        response = self._post(url, {'usernames': []})
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(response.json()['workbooksByGuid'][WORKBOOK_GUID]['editors'], [])
        self.login_collaborator()
        self.assertFalse(self._get_workbook_json()['canEdit'])
        response = self._post(reverse(update_workbook_handler, args=[WORKBOOK_GUID]), {'description': 'Not allowed'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._post(reverse(update_workbook_editors_handler, args=['WB0000000_invalid'])).status_code, 404)

    def test_editor_without_project_access(self):
        # Editors are only added with access to the project, this is an editor whose access was removed afterwards
        workbook = Workbook.objects.get(guid=WORKBOOK_GUID)
        workbook.editors.add(self.no_access_user)
        no_access_workbook = Workbook.objects.get(guid=NO_ACCESS_WORKBOOK_GUID)
        no_access_workbook.editors.add(self.collaborator_user)
        url = reverse(workbook_detail_handler, args=[WORKBOOK_GUID])
        self.check_collaborator_login(url)

        def _assert_no_access(workbook_guid, project_guid, cell_args):
            for get_url in [
                reverse(workbook_detail_handler, args=[workbook_guid]),
                reverse(project_workbooks_handler, args=[project_guid]),
                reverse(project_notifications, args=[project_guid, 'unread']),
            ]:
                self.assertEqual(self.client.get(get_url).status_code, 403)
            for post_url in [
                reverse(update_workbook_handler, args=[workbook_guid]),
                reverse(delete_workbook_handler, args=[workbook_guid]),
                reverse(update_workbook_editors_handler, args=[workbook_guid]),
                reverse(create_worksheet_handler, args=[workbook_guid]),
                reverse(create_worksheet_from_template_handler, args=[workbook_guid]),
                reverse(run_worksheet_query_handler, args=cell_args),
            ]:
                response = self._post(post_url, {'name': 'Not allowed', 'worksheetTemplateGuid': DE_NOVO_TEMPLATE_GUID})
                self.assertEqual(response.status_code, 403)

        _assert_no_access(
            NO_ACCESS_WORKBOOK_GUID, NO_ACCESS_PROJECT_GUID,
            [NO_ACCESS_WORKBOOK_GUID, 'WSQ0000004_other', 'WBT0000003_fam14'])
        self.login_base_user()
        _assert_no_access(WORKBOOK_GUID, PROJECT_GUID, [WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID])
        self.assertEqual(Workbook.objects.filter(name='Not allowed').count(), 0)
        self.assertEqual(Worksheet.objects.count(), 3)


class LocalWorksheetTemplateAPITest(AuthenticationTestCase, WorksheetTemplateAPITest):
    fixtures = FIXTURES


class AnvilWorksheetTemplateAPITest(AnvilAuthenticationTestCase, WorksheetTemplateAPITest):
    fixtures = FIXTURES
