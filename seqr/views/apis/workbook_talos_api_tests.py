import mock
import tomllib

from django.contrib.auth.models import User
from django.urls.base import reverse

from panelapp.models import PaLocusList
from seqr.models import LocusList, WorksheetQuery
from seqr.utils.talos_export_utils import TALOS_VERSION_LABEL
from seqr.views.apis.workbook_talos_api import workbook_talos_export_handler
from seqr.views.utils.test_utils import AuthenticationTestCase, AnvilAuthenticationTestCase

WORKBOOK_GUID = 'WB0000001_trio_analysis'
NO_ACCESS_WORKBOOK_GUID = 'WB0000002_non_analyst_workbook'
RESTRICTIVE_QUERY_GUID = 'WSQ0000001_de_novo_restrictive'
PERMISSIVE_QUERY_GUID = 'WSQ0000002_de_novo_permissive'
RECESSIVE_QUERY_GUID = 'WSQ0000003_recessive'
PANEL_APP_LIST_GUID = 'LL00049_pid_genes_autosomal_do'
CUSTOM_LIST_GUID = 'LL00005_retina_proteome'

HEADER = [
    '# Talos configuration fragment exported from the seqr workbook "Trio analysis"',
    '# Written for Talos 12.3.2, commit d279709d4c8b601b2280ccf3fe5edb480f7a77f6',
    '# This is a starting configuration and NOT an equivalent of the seqr queries: see the fidelity report in seqr.',
    '# Talos reads one complete TOML file: merge these keys into your Talos configuration by hand.',
]
MANUAL_OVERRIDES = [{'ensg': 'ENSG00000227232', 'moi': 'Biallelic', 'symbol': 'WASH7P'}]

NO_FAMILY_ACCESS_PATCH = mock.patch(
    'seqr.views.utils.permissions_utils.get_project_analysis_group_guids_user_can_view', lambda *args, **kwargs: ([], []))


@mock.patch('seqr.views.utils.permissions_utils.safe_redis_get_json', lambda *args: None)
class WorkbookTalosAPITest(object):

    maxDiff = None

    def _set_search(self, query_guid, search):
        WorksheetQuery.objects.filter(guid=query_guid).update(search=search)

    def _get_export(self, url):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {'toml', 'report', 'talosVersion'})
        self.assertEqual(response_json['talosVersion'], TALOS_VERSION_LABEL)
        self.assertListEqual(response_json['toml'].split('\n')[:4], HEADER)
        rows = [(
            row['query'], row['parameter'], row['value'], row['outcome'], row.get('talosKey'),
        ) for row in response_json['report']]
        return tomllib.loads(response_json['toml']), rows, response_json

    def test_workbook_talos_export(self):
        url = reverse(workbook_talos_export_handler, args=[WORKBOOK_GUID])
        self.check_collaborator_login(url)

        config, rows, response_json = self._get_export(url)
        self.assertDictEqual(config, {'ValidateMOI': {'gnomad_max_af': 0.01}})
        self.assertEqual(response_json['toml'], '\n'.join(HEADER + ['', '[ValidateMOI]', 'gnomad_max_af = 0.01', '']))
        self.assertListEqual(rows, [
            ('De novo restrictive', 'inheritance.mode', 'de_novo', 'dropped', None),
            ('De novo restrictive', 'freqs.gnomad_genomes.af', 0.001, 'approximated', 'ValidateMOI.gnomad_max_af'),
            ('De novo permissive', 'inheritance.mode', 'de_novo', 'dropped', None),
            ('De novo permissive', 'freqs.gnomad_genomes.af', 0.01, 'approximated', 'ValidateMOI.gnomad_max_af'),
            ('Recessive', 'inheritance.mode', 'recessive', 'dropped', None),
        ])
        self.assertDictEqual(response_json['report'][1], {
            'query': 'De novo restrictive', 'queryGuid': RESTRICTIVE_QUERY_GUID, 'worksheet': 'De Novo',
            'parameter': 'freqs.gnomad_genomes.af', 'value': 0.001, 'outcome': 'approximated',
            'talosKey': 'ValidateMOI.gnomad_max_af', 'note': mock.ANY,
        })
        self.assertTrue(response_json['report'][1]['note'].endswith(
            'Merged: Talos gets 0.01, the highest value of the workbook, not 0.001. Talos also applies it to the '
            'variants of the queries that do not set it: "Recessive".'))

        self.assertEqual(self.client.get(reverse(workbook_talos_export_handler, args=[NO_ACCESS_WORKBOOK_GUID])).status_code, 403)
        self.assertEqual(self.client.get(reverse(workbook_talos_export_handler, args=['WB0000000_invalid'])).status_code, 404)

        with NO_FAMILY_ACCESS_PATCH:
            self.assertEqual(self.client.get(url).status_code, 403)

        # Access to an analysis group in the workbook does not grant access to the export
        self.login_base_user()
        self.assertEqual(self.client.get(url).status_code, 403)

        # The export of a workbook in another project only has the queries of that workbook
        self.login_manager()
        config, rows, response_json = self._get_export(url)
        self.assertEqual(len(rows), 5)
        response = self.client.get(reverse(workbook_talos_export_handler, args=[NO_ACCESS_WORKBOOK_GUID]))
        self.assertEqual(response.status_code, 200)
        self.assertListEqual(response.json()['report'], [{
            'query': 'Other', 'queryGuid': 'WSQ0000004_other', 'worksheet': 'Other', 'parameter': 'inheritance.mode',
            'value': 'de_novo', 'outcome': 'dropped', 'note': mock.ANY,
        }])
        self.assertDictEqual(tomllib.loads(response.json()['toml']), {})
        self.assertIn('exported from the seqr workbook "Non-analyst workbook"', response.json()['toml'])

    def test_workbook_talos_export_gene_lists(self):
        url = reverse(workbook_talos_export_handler, args=[WORKBOOK_GUID])
        self.check_collaborator_login(url)

        # A panel of the PanelApp instance Talos does not read is exported gene by gene, if seqr has the gene's MOI
        self._set_search(RESTRICTIVE_QUERY_GUID, {'locus': {
            'locusListGuid': PANEL_APP_LIST_GUID, 'rawItems': 'WASH7P, ENSG00000243485',
            'panelAppItems': {'green': 'WASH7P', 'amber': 'ENSG00000243485'},
        }, 'exclude': {'rawItems': 'MTHFR CDC7 NOTAGENE'}})
        self._set_search(PERMISSIVE_QUERY_GUID, {'locus': {
            'locusListGuid': CUSTOM_LIST_GUID, 'rawItems': 'WASH7P, OR4F5',
        }, 'exclude': {'rawItems': 'ENSG00000177000'}})
        self._set_search(RECESSIVE_QUERY_GUID, {'exclude': {'rawItems': 'MTHFR'}})
        config, rows, _ = self._get_export(url)
        self.assertDictEqual(config, {
            'GeneratePanelData': {'forbidden_genes': ['ENSG00000177000'], 'manual_overrides': MANUAL_OVERRIDES},
            'PanelApp': {'manual_overrides': MANUAL_OVERRIDES},
        })
        self.assertListEqual(rows, [
            ('De novo restrictive', 'locus.locusListGuid', 'PID genes - Autosomal dominant (PanelApp UK panel 1)',
             'dropped', None),
            ('De novo restrictive', 'locus.rawItems', ['WASH7P (Biallelic)'], 'approximated',
             'PanelApp.manual_overrides, GeneratePanelData.manual_overrides'),
            ('De novo restrictive', 'locus.rawItems', ['MIR1302-2HG'], 'dropped', None),
            ('De novo restrictive', 'exclude.rawItems', ['NOTAGENE'], 'dropped', None),
            ('De novo restrictive', 'exclude.rawItems', ['MTHFR'], 'exported', 'GeneratePanelData.forbidden_genes'),
            ('De novo restrictive', 'exclude.rawItems', ['CDC7'], 'dropped', None),
            ('De novo permissive', 'locus.rawItems', ['WASH7P', 'OR4F5'], 'dropped', None),
            ('De novo permissive', 'exclude.rawItems', ['MTHFR'], 'exported', 'GeneratePanelData.forbidden_genes'),
            ('Recessive', 'exclude.rawItems', ['MTHFR'], 'exported', 'GeneratePanelData.forbidden_genes'),
        ])

        # A panel of the PanelApp instance Talos reads is exported as a panel
        PaLocusList.objects.filter(seqr_locus_list__guid=PANEL_APP_LIST_GUID).update(source='AU', panel_app_id=275)
        config, rows, _ = self._get_export(url)
        self.assertDictEqual(config, {'GeneratePanelData': {'forbidden_genes': ['ENSG00000177000'], 'forced_panels': [275]}})
        self.assertListEqual(rows[:3], [
            ('De novo restrictive', 'locus.locusListGuid', 'PID genes - Autosomal dominant (PanelApp AU panel 275)',
             'exported', 'GeneratePanelData.forced_panels'),
            ('De novo restrictive', 'locus.panelAppItems', {'green': 'WASH7P', 'amber': 'ENSG00000243485'}, 'dropped',
             None),
            ('De novo restrictive', 'exclude.rawItems', ['NOTAGENE'], 'dropped', None),
        ])

        # Gene lists the user can not view are not resolved, and their names are not shown
        private_list = LocusList.objects.create(
            name='Private panel', is_public=False, created_by=User.objects.get(username='test_user_manager'))
        PaLocusList.objects.create(seqr_locus_list=private_list, source='AU', panel_app_id=99)
        self._set_search(RESTRICTIVE_QUERY_GUID, {'locus': {'locusListGuid': private_list.guid}})
        self._set_search(PERMISSIVE_QUERY_GUID, {'locus': {'locusListGuid': CUSTOM_LIST_GUID}})
        self._set_search(RECESSIVE_QUERY_GUID, {'locus': {'locusListGuid': 5, 'panelAppItems': 'x'}, 'exclude': 'MTHFR'})
        config, rows, response_json = self._get_export(url)
        self.assertDictEqual(config, {})
        self.assertListEqual(rows, [
            ('De novo restrictive', 'locus.locusListGuid', private_list.guid, 'dropped', None),
            ('De novo permissive', 'locus.locusListGuid', 'Retina proteome', 'dropped', None),
            ('Recessive', 'locus.locusListGuid', 5, 'dropped', None),
            ('Recessive', 'exclude', 'MTHFR', 'dropped', None),
        ])
        self.assertNotIn('Private panel', str(response_json))

        self.login_manager()
        config, rows, _ = self._get_export(url)
        self.assertDictEqual(config, {'GeneratePanelData': {'forced_panels': [99]}})
        self.assertEqual(rows[0], (
            'De novo restrictive', 'locus.locusListGuid', 'Private panel (PanelApp AU panel 99)', 'exported',
            'GeneratePanelData.forced_panels',
        ))

        # A query without a JSON object search is reported
        self._set_search(RESTRICTIVE_QUERY_GUID, ['x'])
        config, rows, _ = self._get_export(url)
        self.assertEqual(rows[0], ('De novo restrictive', 'search', ['x'], 'dropped', None))


class LocalWorkbookTalosAPITest(AuthenticationTestCase, WorkbookTalosAPITest):
    fixtures = ['users', '1kg_project', 'reference_data', 'workbooks']


class AnvilWorkbookTalosAPITest(AnvilAuthenticationTestCase, WorkbookTalosAPITest):
    fixtures = ['users', 'social_auth', '1kg_project', 'reference_data', 'workbooks']
