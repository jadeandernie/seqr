import json
import mock
from datetime import datetime

from django.core.management import call_command
from django.urls.base import reverse

from clickhouse_search.all_search_tests import ClickhouseSearchTestCase
from seqr.models import Family, Individual, Project, ReportTemplate, SavedVariant, VariantNote, VariantTag
from seqr.utils.report_template_utils import PLACEHOLDER_REFERENCE, validate_template
from seqr.views.apis.report_template_api import project_report_templates, create_report_template, \
    update_report_template, delete_report_template, family_report, preview_family_report
from seqr.views.utils.test_utils import AuthenticationTestCase

PROJECT_GUID = 'R0001_1kg'
NO_ACCESS_PROJECT_GUID = 'R0004_non_analyst_project'
FAMILY_GUID = 'F000001_1'
KEY_VARIANT_FAMILY_GUID = 'F000002_2'
NO_VARIANT_FAMILY_GUID = 'F000003_3'
NO_ACCESS_FAMILY_GUID = 'F000014_14'
RESEARCHER_TEMPLATE_GUID = 'RT0000001_family_analysis_summ'
CLINICIAN_TEMPLATE_GUID = 'RT0000002_findings_summary'

RESEARCH_USE = '> **Research use only — not a clinical report**'
TEMPLATE_FIELDS = {
    'reportTemplateGuid', 'projectGuid', 'name', 'description', 'audience', 'body', 'createdDate', 'lastModifiedDate',
}
VARIANTS_BODY = '{{#variants}}[{{variant.variantId}}|{{variant.genes}}|{{variant.hgvsc}}|{{variant.hgvsp}}|' \
                '{{variant.zygosity}}|{{variant.gnomadFrequency}}|{{variant.clinvar}}|{{variant.acmg}}|' \
                '{{variant.tags}}]\n{{/variants}}{{^variants}}No saved variants{{/variants}}'
CLICKHOUSE_ANNOTATIONS = [{
    'key': 100,
    'variantId': '1-248367227-TC-T',
    'clinvar': {'alleleId': 12345, 'pathogenicity': 'Likely_pathogenic', 'goldStars': None},
    'populations': {
        'seqr': {'ac': 8, 'hom': 3},
        'topmed': {'af': 0.07842, 'ac': 20757},
        'gnomad_exomes': {'af': 0.0, 'ac': 0, 'an': 0},
        'gnomad_genomes': {'af': 0.03444932, 'ac': 927, 'an': 26912},
    },
    'transcripts': {
        'ENSG00000240361': [
            {'geneId': 'ENSG00000240361', 'transcriptId': 'ENST00000505820', 'hgvsc': 'ENST00000505820.2:c.1586-17C>G', 'hgvsp': None, 'transcriptRank': 1},
        ],
        'ENSG00000135953': [
            {'geneId': 'ENSG00000135953', 'transcriptId': 'ENST00000371839', 'hgvsc': 'ENST00000371839.1:c.4_5del', 'hgvsp': 'ENSP00000371839.1:p.Leu2fs', 'transcriptRank': 0},
        ],
    },
    'mainTranscriptId': None,
}]


def _body(markdown):
    header = f'{RESEARCH_USE}\n\n'
    footer = f'\n\n{RESEARCH_USE}\n'
    assert markdown.startswith(header) and markdown.endswith(footer)
    return markdown[len(header):-len(footer)]


class ReportTemplateAPITest(AuthenticationTestCase):
    databases = {'default', 'reference_data'}
    fixtures = ['users', '1kg_project', 'reference_data', 'report_templates']

    def setUp(self):
        super().setUp()
        patcher = mock.patch('seqr.views.utils.report_context_utils.get_clickhouse_variant_annotations')
        self.mock_get_annotations = patcher.start()
        self.mock_get_annotations.return_value = CLICKHOUSE_ANNOTATIONS
        self.addCleanup(patcher.stop)
        patcher = mock.patch('seqr.views.utils.report_context_utils.timezone')
        patcher.start().now.return_value = datetime(2026, 11, 26, 10, 30)
        self.addCleanup(patcher.stop)

    def _post(self, url, data):
        return self.client.post(url, content_type='application/json', data=json.dumps(data))

    def _preview(self, family_guid, body):
        response = self._post(reverse(preview_family_report, args=[family_guid]), {'body': body})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_default_template_fixture(self):
        templates = {t.guid: t for t in ReportTemplate.objects.all()}
        self.assertSetEqual(set(templates.keys()), {RESEARCHER_TEMPLATE_GUID, CLINICIAN_TEMPLATE_GUID})
        self.assertEqual(templates[RESEARCHER_TEMPLATE_GUID].name, 'Family analysis summary')
        self.assertEqual(templates[RESEARCHER_TEMPLATE_GUID].audience, 'researcher')
        self.assertEqual(templates[CLINICIAN_TEMPLATE_GUID].name, 'Findings summary')
        self.assertEqual(templates[CLINICIAN_TEMPLATE_GUID].audience, 'clinician')
        for template in templates.values():
            self.assertIsNone(template.project)
            self.assertTrue(template.description)
            self.assertListEqual(validate_template(template.body), [])
            self.assertNotRegex(template.body.lower(), r'\{\{[^}]*note')
            self.assertEqual(template.guid, template._compute_guid())

        # Loading the fixture again, as the docker entrypoint does on every start, does not duplicate templates
        call_command('loaddata', 'report_templates', verbosity=0)
        self.assertEqual(ReportTemplate.objects.count(), 2)

        self.login_collaborator()
        for family_guid in [FAMILY_GUID, KEY_VARIANT_FAMILY_GUID, NO_VARIANT_FAMILY_GUID]:
            for template_guid in templates:
                response = self.client.get(reverse(family_report, args=[family_guid, template_guid]))
                self.assertEqual(response.status_code, 200)
                markdown = response.json()['markdown']
                self.assertEqual(markdown.count(RESEARCH_USE), 2)
                self.assertNotIn('{{', markdown)

    def test_project_report_templates(self):
        other_project = Project.objects.get(guid=NO_ACCESS_PROJECT_GUID)
        project_template = ReportTemplate.objects.create(
            project=Project.objects.get(guid=PROJECT_GUID), name='Project summary', audience='clinician', body='x')
        ReportTemplate.objects.create(project=other_project, name='Other project summary', audience='clinician', body='x')

        url = reverse(project_report_templates, args=[PROJECT_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {
            'reportTemplatesByGuid', 'placeholders', 'audiences', 'researchUseLine', 'canEditProjectTemplates',
            'canEditGlobalTemplates',
        })
        templates = response_json['reportTemplatesByGuid']
        self.assertSetEqual(
            set(templates.keys()), {RESEARCHER_TEMPLATE_GUID, CLINICIAN_TEMPLATE_GUID, project_template.guid})
        self.assertSetEqual(set(templates[project_template.guid].keys()), TEMPLATE_FIELDS)
        self.assertEqual(templates[project_template.guid]['projectGuid'], PROJECT_GUID)
        self.assertIsNone(templates[RESEARCHER_TEMPLATE_GUID]['projectGuid'])
        self.assertEqual(templates[RESEARCHER_TEMPLATE_GUID]['audience'], 'researcher')
        self.assertEqual(templates[CLINICIAN_TEMPLATE_GUID]['audience'], 'clinician')
        self.assertListEqual(response_json['placeholders'], PLACEHOLDER_REFERENCE)
        self.assertListEqual(response_json['audiences'], [
            {'value': 'researcher', 'text': 'Researcher'}, {'value': 'clinician', 'text': 'Clinician'},
        ])
        self.assertEqual(response_json['researchUseLine'], 'Research use only — not a clinical report')
        self.assertFalse(response_json['canEditProjectTemplates'])
        self.assertFalse(response_json['canEditGlobalTemplates'])

        response = self.client.get(reverse(project_report_templates, args=[NO_ACCESS_PROJECT_GUID]))
        self.assertEqual(response.status_code, 403)

        self.login_manager()
        response_json = self.client.get(url).json()
        self.assertTrue(response_json['canEditProjectTemplates'])
        self.assertFalse(response_json['canEditGlobalTemplates'])

        self.login_data_manager_user()
        response_json = self.client.get(url).json()
        self.assertTrue(response_json['canEditProjectTemplates'])
        self.assertTrue(response_json['canEditGlobalTemplates'])

        response = self.client.get(reverse(project_report_templates, args=['R_missing']))
        self.assertEqual(response.status_code, 404)

    def test_create_update_delete_project_template(self):
        create_url = reverse(create_report_template, args=[PROJECT_GUID])
        self.check_manager_login(create_url)

        response = self._post(create_url, {})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'Name is required', 'Audience must be one of: researcher, clinician', 'Template body is required',
        ])

        response = self._post(create_url, {
            'name': 'n' * 101, 'audience': ['researcher'], 'description': 5,
            'body': '# {{family.displayName}}\n{{family.notes}}\n{{#variants}}',
        })
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'Name must be at most 100 characters', 'Audience must be one of: researcher, clinician',
            'Description must be text', 'Line 2: Unknown placeholder {{family.notes}}',
            'Line 3: {{#variants}} is never closed',
        ])
        self.assertEqual(ReportTemplate.objects.count(), 2)

        body = '# {{family.displayName}}\n{{#variants tag="Review"}}- {{variant.genes}}\n{{/variants}}'
        response = self._post(create_url, {
            'name': '  Review summary ', 'audience': 'researcher', 'description': 'Variants for review', 'body': body,
            'projectGuid': NO_ACCESS_PROJECT_GUID, 'guid': 'RT_chosen', 'createdBy': 1, 'id': 77,
        })
        self.assertEqual(response.status_code, 200)
        templates = response.json()['reportTemplatesByGuid']
        self.assertEqual(len(templates), 1)
        guid = next(iter(templates))
        self.assertTrue(guid.startswith('RT'))
        self.assertNotEqual(guid, 'RT_chosen')
        self.assertDictEqual(templates[guid], {
            'reportTemplateGuid': guid, 'projectGuid': PROJECT_GUID, 'name': 'Review summary', 'audience': 'researcher',
            'description': 'Variants for review', 'body': body, 'createdDate': mock.ANY, 'lastModifiedDate': mock.ANY,
        })
        template = ReportTemplate.objects.get(guid=guid)
        self.assertEqual(template.project.guid, PROJECT_GUID)
        self.assertEqual(template.created_by, self.manager_user)
        self.assertNotEqual(template.id, 77)

        # Names are unique per project and audience
        create_body = {'name': 'Review summary', 'audience': 'researcher', 'body': body}
        response = self._post(create_url, create_body)
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'A researcher report template named "Review summary" already exists for project "1kg project n\xe5me with uni\xe7\xf8de"',
        ])
        response = self._post(create_url, {**create_body, 'audience': 'clinician'})
        self.assertEqual(response.status_code, 200)
        clinician_guid = next(iter(response.json()['reportTemplatesByGuid']))
        response = self._post(create_url, {**create_body, 'name': 'Family analysis summary'})
        self.assertEqual(response.status_code, 200)

        update_url = reverse(update_report_template, args=[guid])
        response = self._post(update_url, {'body': '{{family.secret}}'})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], ['Line 1: Unknown placeholder {{family.secret}}'])
        self.assertEqual(ReportTemplate.objects.get(guid=guid).body, body)

        response = self._post(reverse(update_report_template, args=[clinician_guid]), {'audience': 'researcher'})
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'A researcher report template named "Review summary" already exists for project "1kg project n\xe5me with uni\xe7\xf8de"',
        ])

        response = self._post(update_url, {
            'name': 'Updated summary', 'body': 'Updated {{date}}', 'description': None,
            'projectGuid': NO_ACCESS_PROJECT_GUID, 'project': None, 'guid': 'RT_changed', 'createdBy': None,
        })
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json()['reportTemplatesByGuid'], {guid: {
            'reportTemplateGuid': guid, 'projectGuid': PROJECT_GUID, 'name': 'Updated summary', 'audience': 'researcher',
            'description': None, 'body': 'Updated {{date}}', 'createdDate': mock.ANY, 'lastModifiedDate': mock.ANY,
        }})
        template = ReportTemplate.objects.get(guid=guid)
        self.assertEqual(template.project.guid, PROJECT_GUID)
        self.assertEqual(template.created_by, self.manager_user)

        # Saving a template with only its own name unchanged is not a duplicate
        response = self._post(update_url, {'name': 'Updated summary', 'description': 'Again'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reportTemplatesByGuid'][guid]['description'], 'Again')

        delete_url = reverse(delete_report_template, args=[guid])
        self.login_collaborator()
        self.assertEqual(self._post(update_url, {'name': 'Collaborator edit'}).status_code, 403)
        self.assertEqual(self._post(delete_url, {}).status_code, 403)
        self.assertEqual(self._post(create_url, create_body).status_code, 403)
        self.assertEqual(ReportTemplate.objects.get(guid=guid).name, 'Updated summary')

        self.login_manager()
        response = self._post(delete_url, {})
        self.assertEqual(response.status_code, 200)
        self.assertDictEqual(response.json(), {'reportTemplatesByGuid': {guid: None}})
        self.assertFalse(ReportTemplate.objects.filter(guid=guid).exists())
        self.assertEqual(self._post(delete_url, {}).status_code, 404)
        self.assertEqual(self._post(update_url, {}).status_code, 404)

    def test_cross_project_template_permissions(self):
        other_project = Project.objects.get(guid=NO_ACCESS_PROJECT_GUID)
        other_template = ReportTemplate.objects.create(
            project=other_project, name='Other project summary', audience='clinician', body='Other {{date}}')

        # Analysts can edit the main test project but have no access to the other project
        self.login_analyst_user()
        response = self._post(reverse(create_report_template, args=[PROJECT_GUID]), {'name': 'Mine', 'audience': 'clinician', 'body': 'x'})
        self.assertEqual(response.status_code, 200)
        create_body = {'name': 'New', 'audience': 'researcher', 'body': 'x'}
        self.assertEqual(self._post(reverse(create_report_template, args=[NO_ACCESS_PROJECT_GUID]), create_body).status_code, 403)
        self.assertEqual(self._post(reverse(create_report_template, args=['R_missing']), create_body).status_code, 404)
        self.assertEqual(self._post(reverse(update_report_template, args=[other_template.guid]), {'name': 'Mine'}).status_code, 403)
        self.assertEqual(self._post(reverse(delete_report_template, args=[other_template.guid]), {}).status_code, 403)
        other_template.refresh_from_db()
        self.assertEqual(other_template.name, 'Other project summary')

        # A template from another project can not be used to generate a report, even by guid
        response = self.client.get(reverse(family_report, args=[FAMILY_GUID, other_template.guid]))
        self.assertEqual(response.status_code, 404)
        response = self.client.get(reverse(family_report, args=[NO_ACCESS_FAMILY_GUID, other_template.guid]))
        self.assertEqual(response.status_code, 403)
        response = self.client.get(reverse(family_report, args=[NO_ACCESS_FAMILY_GUID, RESEARCHER_TEMPLATE_GUID]))
        self.assertEqual(response.status_code, 403)
        response = self._post(reverse(preview_family_report, args=[NO_ACCESS_FAMILY_GUID]), {'body': '{{family.displayName}}'})
        self.assertEqual(response.status_code, 403)

        self.login_data_manager_user()
        response = self.client.get(reverse(family_report, args=[NO_ACCESS_FAMILY_GUID, other_template.guid]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_body(response.json()['markdown']), 'Other 2026-11-26')
        response = self.client.get(reverse(family_report, args=[FAMILY_GUID, other_template.guid]))
        self.assertEqual(response.status_code, 404)

    def test_global_template_permissions(self):
        create_url = reverse(create_report_template)
        self.check_data_manager_login(create_url)

        response = self._post(create_url, {
            'name': 'Family analysis summary', 'audience': 'researcher', 'body': 'Global {{date}}',
        })
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], [
            'A researcher report template named "Family analysis summary" already exists for all projects',
        ])

        response = self._post(create_url, {'name': 'Global summary', 'audience': 'researcher', 'body': 'Global {{date}}'})
        self.assertEqual(response.status_code, 200)
        templates = response.json()['reportTemplatesByGuid']
        guid = next(iter(templates))
        self.assertIsNone(templates[guid]['projectGuid'])
        self.assertIsNone(ReportTemplate.objects.get(guid=guid).project)

        update_url = reverse(update_report_template, args=[guid])
        delete_url = reverse(delete_report_template, args=[guid])
        for login in [self.login_manager, self.login_pm_user, self.login_analyst_user]:
            login()
            self.assertEqual(self._post(create_url, {'name': 'Mine', 'audience': 'researcher', 'body': 'x'}).status_code, 403)
            self.assertEqual(self._post(update_url, {'body': 'Hijacked'}).status_code, 403)
            self.assertEqual(self._post(delete_url, {}).status_code, 403)
            response = self.client.get(reverse(family_report, args=[FAMILY_GUID, guid]))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(_body(response.json()['markdown']), 'Global 2026-11-26')

        self.login_data_manager_user()
        response = self._post(update_url, {'body': 'Updated global {{date}}'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reportTemplatesByGuid'][guid]['body'], 'Updated global {{date}}')
        response = self._post(delete_url, {})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ReportTemplate.objects.filter(guid=guid).exists())

    def test_family_report(self):
        url = reverse(family_report, args=[FAMILY_GUID, RESEARCHER_TEMPLATE_GUID])
        self.check_collaborator_login(url)

        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        response_json = response.json()
        self.assertSetEqual(set(response_json.keys()), {'familyGuid', 'markdown', 'usedData', 'warnings'})
        self.assertEqual(response_json['familyGuid'], FAMILY_GUID)
        self.assertListEqual(response_json['warnings'], [])
        self.assertListEqual(response_json['usedData'], [
            'date', 'family.analysisStatus', 'family.codedPhenotype', 'family.displayName', 'family.mondoId',
            'individual.affected', 'individual.hpoAbsent', 'individual.hpoPresent', 'individual.id',
            'individual.onset', 'individual.sex', 'individuals', 'project.genomeVersion', 'project.name',
            'variant.acmg', 'variant.clinvar', 'variant.genes', 'variant.gnomadFrequency', 'variant.hgvsc',
            'variant.hgvsp', 'variant.tags', 'variant.variantId', 'variant.zygosity', 'variants',
        ])
        self.assertEqual(_body(response_json['markdown']), EXPECTED_RESEARCHER_REPORT)
        self.mock_get_annotations.assert_not_called()

        response = self.client.get(reverse(family_report, args=[FAMILY_GUID, CLINICIAN_TEMPLATE_GUID]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_body(response.json()['markdown']), EXPECTED_CLINICIAN_REPORT)

        self.assertEqual(self.client.get(reverse(family_report, args=[FAMILY_GUID, 'RT_missing'])).status_code, 404)
        self.assertEqual(self.client.get(reverse(family_report, args=['F_missing', RESEARCHER_TEMPLATE_GUID])).status_code, 404)

        # Reports are generated on demand and never stored
        self.assertEqual(ReportTemplate.objects.count(), 2)

    def test_family_report_annotations_and_tag_filter(self):
        url = reverse(preview_family_report, args=[KEY_VARIANT_FAMILY_GUID])
        self.check_collaborator_login(url, request_data={'body': VARIANTS_BODY})

        response_json = self._preview(KEY_VARIANT_FAMILY_GUID, VARIANTS_BODY)
        self.assertEqual(response_json['familyGuid'], KEY_VARIANT_FAMILY_GUID)
        self.assertEqual(_body(response_json['markdown']), EXPECTED_KEY_VARIANT)
        self.mock_get_annotations.assert_called_once_with('37', 'SNV_INDEL', {100})

        # The saved variant's selected transcript takes priority
        SavedVariant.objects.filter(family__guid=KEY_VARIANT_FAMILY_GUID).update(selected_main_transcript_id='ENST00000505820')
        self.assertIn(
            '|ENST00000505820.2:c.1586-17C\\>G|Not recorded|',
            self._preview(KEY_VARIANT_FAMILY_GUID, VARIANTS_BODY)['markdown'],
        )

        # Variants with no annotations in clickhouse still render
        self.mock_get_annotations.return_value = []
        self.assertEqual(_body(self._preview(KEY_VARIANT_FAMILY_GUID, VARIANTS_BODY)['markdown']), EXPECTED_UNANNOTATED_KEY_VARIANT)

        tag_body = '{{#variants tag="%s"}}[{{variant.variantId}}]{{/variants}}{{^variants tag="%s"}}None{{/variants}}'
        tag_names = set(VariantTag.objects.filter(saved_variants__family__guid=FAMILY_GUID).values_list('variant_tag_type__name', flat=True))
        self.assertIn('Review', tag_names)
        review_variant_ids = sorted(SavedVariant.objects.filter(
            family__guid=FAMILY_GUID, varianttag__variant_tag_type__name='Review',
        ).values_list('xpos', 'variant_id'))
        self.assertGreater(SavedVariant.objects.filter(family__guid=FAMILY_GUID).count(), len(review_variant_ids))
        response_json = self._preview(FAMILY_GUID, tag_body % ('review', 'review'))
        self.assertEqual(_body(response_json['markdown']), ''.join(f'[{variant_id}]' for _, variant_id in review_variant_ids))
        self.assertListEqual(response_json['usedData'], ['variant.variantId', 'variants tag="review"'])
        self.assertEqual(_body(self._preview(FAMILY_GUID, tag_body % ('Not a tag', 'Not a tag'))['markdown']), 'None')

    def test_family_report_no_saved_variants(self):
        self.login_collaborator()
        self.assertFalse(SavedVariant.objects.filter(family__guid=NO_VARIANT_FAMILY_GUID).exists())
        self.assertEqual(_body(self._preview(NO_VARIANT_FAMILY_GUID, VARIANTS_BODY)['markdown']), 'No saved variants')
        self.mock_get_annotations.assert_not_called()

        response = self.client.get(reverse(family_report, args=[NO_VARIANT_FAMILY_GUID, CLINICIAN_TEMPLATE_GUID]))
        self.assertEqual(response.status_code, 200)
        markdown = response.json()['markdown']
        self.assertIn('The research team has not noted any genetic changes for this family so far.', markdown)
        self.assertNotIn('### A change in', markdown)

        empty_family = Family.objects.create(project=Project.objects.get(guid=PROJECT_GUID), family_id='empty')
        response = self.client.get(reverse(family_report, args=[empty_family.guid, RESEARCHER_TEMPLATE_GUID]))
        markdown = response.json()['markdown']
        self.assertIn('No individuals are recorded for this family.', markdown)
        self.assertIn('No variants have been saved for this family.', markdown)

    def test_preview_family_report_validation(self):
        url = reverse(preview_family_report, args=[FAMILY_GUID])
        self.login_collaborator()

        for body, errors in {
            None: ['Template body is required'],
            '{{family.displayName}} {{family.caseReviewNotes}}': ['Line 1: Unknown placeholder {{family.caseReviewNotes}}'],
            '{{#individuals}}{{individual.notes}}{{/individuals}}': ['Line 1: Unknown placeholder {{individual.notes}}'],
            '{{#variants}}': ['Line 1: {{#variants}} is never closed'],
        }.items():
            response = self._post(url, {'body': body})
            self.assertEqual(response.status_code, 400)
            self.assertListEqual(response.json()['errors'], errors)

        # A stored template which is no longer valid reports its errors rather than rendering blanks
        template = ReportTemplate.objects.create(name='Outdated', audience='researcher', body='{{family.removedField}}')
        response = self.client.get(reverse(family_report, args=[FAMILY_GUID, template.guid]))
        self.assertEqual(response.status_code, 400)
        self.assertListEqual(response.json()['errors'], ['Line 1: Unknown placeholder {{family.removedField}}'])

        # Previewing never saves anything
        response = self._post(url, {'body': 'Draft {{date}}', 'name': 'Draft', 'audience': 'researcher'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_body(response.json()['markdown']), 'Draft 2026-11-26')
        self.assertEqual(ReportTemplate.objects.count(), 3)

    def test_family_report_escapes_data_and_excludes_notes(self):
        family = Family.objects.get(guid=FAMILY_GUID)
        family.display_name = '[click](javascript:alert(1))'
        family.coded_phenotype = '<script>alert(1)</script> | `x`\n\n# Injected heading'
        family.description = 'SECRET family description'
        family.case_review_notes = 'SECRET case review notes'
        family.save()
        Individual.objects.filter(family=family).update(notes='SECRET individual notes')
        Project.objects.filter(guid=PROJECT_GUID).update(name='**Project** _name_')
        self.assertTrue(family.familynote_set.exists())
        variant_note = VariantNote.objects.create(note='A variant note naming the patient')
        variant_note.saved_variants.set(SavedVariant.objects.filter(family=family))

        self.login_collaborator()
        body = '# {{family.displayName}}\n{{family.codedPhenotype}}\n{{project.name}}'
        self.assertEqual(_body(self._preview(FAMILY_GUID, body)['markdown']), '\n'.join([
            '# \\[click\\]\\(javascript:alert\\(1\\)\\)',
            '\\<script\\>alert\\(1\\)\\</script\\> \\| \\`x\\` \\# Injected heading',
            '\\*\\*Project\\*\\* \\_name\\_',
        ]))

        notes = [
            'SECRET', variant_note.note, *family.familynote_set.values_list('note', flat=True),
        ]
        self.assertGreater(len(notes), 2)
        for template_guid in [RESEARCHER_TEMPLATE_GUID, CLINICIAN_TEMPLATE_GUID]:
            markdown = self.client.get(reverse(family_report, args=[FAMILY_GUID, template_guid])).json()['markdown']
            for note in notes:
                self.assertNotIn(note, markdown)

    @mock.patch('seqr.views.utils.report_context_utils.MAX_REPORT_VARIANTS', 2)
    def test_family_report_context_details(self):
        self.login_collaborator()
        family = Family.objects.get(guid=FAMILY_GUID)
        self.assertEqual(SavedVariant.objects.filter(family=family).count(), 3)
        response_json = self._preview(FAMILY_GUID, '{{#variants}}[{{variant.variantId}}]{{/variants}}')
        self.assertEqual(_body(response_json['markdown']), '[1-46859832-G-A][1-1562437-G-CA]')
        self.assertListEqual(response_json['warnings'], [
            'This family has more than 2 saved variants, only the first 2 are available to the report',
        ])

        family = Family.objects.create(project=family.project, family_id='FAM_X', display_name='')
        male = Individual.objects.create(family=family, individual_id='MALE_1', sex='M')
        female = Individual.objects.create(family=family, individual_id='FEMALE', sex='F')
        genotypes = {
            male.guid: {'numAlt': 1}, female.guid: {'numAlt': 1}, 'I_not_in_family': {'numAlt': 2},
        }
        SavedVariant.objects.create(
            family=family, xpos=23000000100, variant_id='X-100-A-T', genotypes=genotypes, dataset_type='SNV_INDEL',
            gene_ids=['ENSG00000135953', 'ENSG00000UNKNOWN'], acmg_classification={'classify': 'Likely Pathogenic', 'score': 7},
        )
        SavedVariant.objects.create(
            family=family, xpos=25000000200, variant_id='M-200-A-T', dataset_type='MITO', key=7, genotypes={
                male.guid: {'numAlt': 2}, female.guid: {'numAlt': 0},
            },
        )
        SavedVariant.objects.create(
            family=family, xpos=1000000300, xpos_end=1000000900, variant_id='DEL_1', dataset_type='SV_WGS', key=8,
            sv_type='DEL', genotypes={male.guid: {'numAlt': -1, 'cn': 1}, female.guid: {'numAlt': -1}},
        )
        self.mock_get_annotations.side_effect = lambda genome_version, dataset_type, keys: {
            'MITO': [{'key': 7, 'populations': {'gnomad_mito': {'af': 0.00012346}, 'gnomad_genomes': None}, 'clinvar': None, 'transcripts': {
                'ENSG00000198744': [{'transcriptId': 'ENST1', 'hgvsc': 'c.1A>T'}, {'transcriptId': 'ENST2', 'hgvsc': 'c.2A>T'}],
            }}],
            'SV_WGS': [{'key': 8, 'populations': {'gnomad_svs': {'af': 0.5}}, 'transcripts': {}}, {'key': 99}],
        }[dataset_type]

        with mock.patch('seqr.views.utils.report_context_utils.MAX_REPORT_VARIANTS', 3):
            response_json = self._preview(family.guid, VARIANTS_BODY)
        self.assertListEqual(response_json['warnings'], [])
        self.assertEqual(_body(response_json['markdown']), '\n'.join([
            '[DEL\\_1|Not recorded|Not recorded|Not recorded|FEMALE: No call, MALE\\_1: Copy number 1|structural variants 0.5|Not recorded|Not recorded|Not recorded]',
            '[X-100-A-T|RP11, ENSG00000UNKNOWN|Not recorded|Not recorded|FEMALE: Heterozygous, MALE\\_1: Hemizygous|Not recorded|Not recorded|Likely Pathogenic|Not recorded]',
            '[M-200-A-T|MTCO3P12|c.1A\\>T|Not recorded|FEMALE: Homozygous reference, MALE\\_1: Homozygous|mitochondrial 0.0001235|Not recorded|Not recorded|Not recorded]',
            '',
        ]))
        self.mock_get_annotations.assert_has_calls(
            [mock.call('37', 'MITO', {7}), mock.call('37', 'SV_WGS', {8})], any_order=True)

        Project.objects.filter(guid=PROJECT_GUID).update(genome_version='38')
        Family.objects.filter(guid=family.guid).update(analysis_status='S_kgfp', mondo_id='MONDO:0044976')
        Individual.objects.filter(id=male.id).update(
            onset_age='G', features=[{'id': 'HP:0001252'}, {'id': 'HP:9999999'}], absent_features=[{'id': 'HP:0011675'}])
        body = '{{family.displayName}}|{{family.analysisStatus}}|{{family.mondoId}}|{{project.genomeVersion}}' \
               '{{#individuals}}|{{individual.id}}:{{individual.onset}}:{{individual.hpoPresent}}:{{individual.hpoAbsent}}{{/individuals}}'
        self.assertEqual(_body(self._preview(family.guid, body)['markdown']).split('|'), [
            'FAM\\_X', 'Solved - known gene for phenotype', 'MONDO:0044976', 'GRCh38',
            'FEMALE:Not recorded:Not recorded:Not recorded',
            'MALE\\_1:Congenital onset:Muscular hypotonia \\(HP:0001252\\), HP:9999999:Arrhythmia \\(HP:0011675\\)',
        ])


class ReportTemplateClickhouseAPITest(ClickhouseSearchTestCase):
    fixtures = ['users', 'social_auth', '1kg_project', 'reference_data', 'clickhouse_search', 'clickhouse_transcripts']

    def test_family_report_clickhouse_annotations(self):
        Project.objects.filter(guid=PROJECT_GUID).update(genome_version='38')
        SavedVariant.objects.create(
            family=Family.objects.get(guid=KEY_VARIANT_FAMILY_GUID), key=2, variant_id='1-38724419-T-G',
            xpos=1038724419, dataset_type='SNV_INDEL',
            genotypes={'I000004_hg00731': {'numAlt': 2}, 'I000005_hg00732': {'numAlt': 1}},
        )
        self.login_data_manager_user()

        response = self.client.post(
            reverse(preview_family_report, args=[KEY_VARIANT_FAMILY_GUID]), content_type='application/json',
            data=json.dumps({'body': VARIANTS_BODY}))
        self.assertEqual(response.status_code, 200)
        variants = [line.strip('[]').split('|') for line in _body(response.json()['markdown']).strip().split('\n')]
        self.assertEqual(len(variants), 2)
        genes = variants[0][1]
        self.assertListEqual(variants[0], [
            '1-38724419-T-G', genes, 'ENST00000383791.8:c.156A\\>C', 'ENSP00000373301.3:p.Leu52Phe',
            'HG00731: Homozygous, HG00732: Heterozygous', 'genomes 0.003445, exomes 0.00289',
            'Conflicting classifications of pathogenicity', 'Not recorded', 'Not recorded',
        ])
        self.assertEqual(genes.split(', ')[0], 'MTHFR')
        self.assertEqual(len(genes.split(', ')), 2)


EXPECTED_RESEARCHER_REPORT = '''# Family analysis summary: 1

- Project: 1kg project nåme with uniçøde
- Genome build: GRCh37
- Date generated: 2026-11-26
- Analysis status: Waiting for data
- Coded phenotype: myopathy
- MONDO ID: Not recorded

## Individuals

### NA19675\\_1

- Sex: XXY
- Affected status: Affected
- Age of onset: Adult onset
- HPO terms present: Defect in the atrial septum \\(HP:0001631\\), Morphological abnormality of the central nervous system \\(HP:0002011\\), Tetralogy of Fallot \\(HP:0001636\\)
- HPO terms absent: Arrhythmia \\(HP:0011675\\), Complete atrioventricular canal defect \\(HP:0001674\\), Failure to thrive \\(HP:0001508\\)

### NA19678

- Sex: Male
- Affected status: Unaffected
- Age of onset: Not recorded
- HPO terms present: Not recorded
- HPO terms absent: Not recorded

### NA19679

- Sex: Female
- Affected status: Unaffected
- Age of onset: Not recorded
- HPO terms present: Not recorded
- HPO terms absent: Not recorded

## Saved variants

### CELSR1: 1-46859832-G-A

- HGVS c.: ENST00000505820.2:c.1067-4G\\>A
- HGVS p.: Not recorded
- Zygosity: NA19678: Homozygous reference, NA19679: Homozygous reference
- gnomAD allele frequency: Not recorded
- ClinVar significance: Not recorded
- ACMG classification: Not recorded
- Tags: Not recorded

### MIB2: 1-1562437-G-CA

- HGVS c.: ENST00000262738.3:c.3955G\\>A
- HGVS p.: ENST00000505820.2:c.1586-17C\\>G
- Zygosity: NA19678: Homozygous reference, NA19679: Heterozygous
- gnomAD allele frequency: Not recorded
- ClinVar significance: Not recorded
- ACMG classification: Not recorded
- Tags: Not recorded

### RP11: 21-3343353-GAGA-G

- HGVS c.: ENST00000258436.5:c.375\\_377delTCT
- HGVS p.: ENSP00000258436.5:p.Leu126del
- Zygosity: NA19675\\_1: Heterozygous, NA19678: Homozygous reference, NA19679: Homozygous reference
- gnomAD allele frequency: Not recorded
- ClinVar significance: Not recorded
- ACMG classification: Not recorded
- Tags: Review, Tier 1 - Novel gene and phenotype

'''
EXPECTED_CLINICIAN_REPORT = '''# Findings summary for family 1

Prepared on 2026-11-26 from the research project 1kg project nåme with uniçøde.

This summary describes findings from a research analysis. It has not been produced by an accredited diagnostic laboratory. Any finding that could affect care needs to be confirmed by an accredited laboratory before it is acted on.

## Where the analysis is up to

- Current status of the analysis: Waiting for data
- Condition being investigated: myopathy

## Who was included

- NA19675\\_1: XXY, Affected. Clinical features recorded: Defect in the atrial septum \\(HP:0001631\\), Morphological abnormality of the central nervous system \\(HP:0002011\\), Tetralogy of Fallot \\(HP:0001636\\)
- NA19678: Male, Unaffected. Clinical features recorded: Not recorded
- NA19679: Female, Unaffected. Clinical features recorded: Not recorded

## Genetic changes the research team has noted

### A change in CELSR1

- The change: ENST00000505820.2:c.1067-4G\\>A (effect on the protein: Not recorded)
- Who carries it: NA19678: Homozygous reference, NA19679: Homozygous reference
- How common it is in the general population (gnomAD): Not recorded
- What public records say about it (ClinVar): Not recorded
- How the research team has classified it (ACMG): Not recorded

### A change in MIB2

- The change: ENST00000262738.3:c.3955G\\>A (effect on the protein: ENST00000505820.2:c.1586-17C\\>G)
- Who carries it: NA19678: Homozygous reference, NA19679: Heterozygous
- How common it is in the general population (gnomAD): Not recorded
- What public records say about it (ClinVar): Not recorded
- How the research team has classified it (ACMG): Not recorded

### A change in RP11

- The change: ENST00000258436.5:c.375\\_377delTCT (effect on the protein: ENSP00000258436.5:p.Leu126del)
- Who carries it: NA19675\\_1: Heterozygous, NA19678: Homozygous reference, NA19679: Homozygous reference
- How common it is in the general population (gnomAD): Not recorded
- What public records say about it (ClinVar): Not recorded
- How the research team has classified it (ACMG): Not recorded

'''
EXPECTED_KEY_VARIANT = '''[1-248367227-TC-T|OR4G11P, RP11|ENST00000371839.1:c.4\\_5del|ENSP00000371839.1:p.Leu2fs|HG00731: Homozygous, HG00732: Heterozygous|genomes 0.03445, exomes 0|Likely pathogenic|Not recorded|AIP, Excluded, Known gene for phenotype]
'''
EXPECTED_UNANNOTATED_KEY_VARIANT = '''[1-248367227-TC-T|OR4G11P, RP11|Not recorded|Not recorded|HG00731: Homozygous, HG00732: Heterozygous|Not recorded|Not recorded|Not recorded|AIP, Excluded, Known gene for phenotype]
'''
