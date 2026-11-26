import unittest

from seqr.utils.report_template_utils import COLLECTIONS, MAX_BODY_LENGTH, MAX_LOOP_ITEMS, MAX_PLACEHOLDERS, \
    MAX_VALUE_LENGTH, MISSING_VALUE, PLACEHOLDER_REFERENCE, RESEARCH_USE_LINE, SCALAR_PLACEHOLDERS, TemplateError, \
    escape_markdown, parse_template, render_template, validate_template

RESEARCH_USE = '> **Research use only — not a clinical report**'
HEADER = f'{RESEARCH_USE}\n\n'
FOOTER = f'\n\n{RESEARCH_USE}\n'

CONTEXT = {
    'date': '2026-11-26',
    'project': {'name': 'Rare Disease Project', 'genomeVersion': 'GRCh38'},
    'family': {
        'displayName': 'FAM_1', 'analysisStatus': 'Solved', 'codedPhenotype': 'myopathy', 'mondoId': 'MONDO:0044976',
    },
    'individuals': [
        {
            'id': 'NA19675', 'sex': 'Male', 'affected': 'Affected', 'onset': 'Congenital onset',
            'hpoPresent': ['Muscular hypotonia (HP:0001252)', 'Arrhythmia (HP:0011675)'], 'hpoAbsent': [],
        },
        {'id': 'NA19678', 'sex': 'Female', 'affected': 'Unaffected', 'onset': None, 'hpoPresent': [], 'hpoAbsent': ['HP:1']},
    ],
    'variants': [
        {
            'variantId': '1-248367227-TC-T', 'genes': ['OR4G11P', 'MFSD9'], 'hgvsc': 'ENST00000371839.1:c.4_5del',
            'hgvsp': 'ENSP00000371839.1:p.Leu2fs', 'zygosity': ['NA19675: Heterozygous', 'NA19678: Homozygous reference'],
            'gnomadFrequency': ['genomes 0.03445', 'exomes 0'], 'clinvar': 'Likely pathogenic', 'acmg': 'Pathogenic',
            'tags': ['Known gene for phenotype', 'Review'],
        },
        {
            'variantId': '21-3343353-GAGA-G', 'genes': ['MTHFR'], 'hgvsc': None, 'hgvsp': '', 'zygosity': [],
            'gnomadFrequency': None, 'clinvar': None, 'acmg': None, 'tags': ['Review'],
        },
    ],
}

ALL_PLACEHOLDERS_TEMPLATE = '''# {{family.displayName}} ({{project.name}}, {{project.genomeVersion}}) {{date}}
Status: {{family.analysisStatus}}; Phenotype: {{family.codedPhenotype}}; MONDO: {{family.mondoId}}
{{#individuals}}
* {{individual.id}} / {{individual.sex}} / {{individual.affected}} / {{individual.onset}} / {{individual.hpoPresent}} / {{individual.hpoAbsent}}
{{/individuals}}
{{#variants}}
* {{variant.variantId}} / {{variant.genes}} / {{variant.hgvsc}} / {{variant.hgvsp}} / {{variant.zygosity}} / {{variant.gnomadFrequency}} / {{variant.clinvar}} / {{variant.acmg}} / {{variant.tags}}
{{/variants}}'''

ALL_PLACEHOLDERS_RENDERED = '''# FAM\\_1 (Rare Disease Project, GRCh38) 2026-11-26
Status: Solved; Phenotype: myopathy; MONDO: MONDO:0044976
* NA19675 / Male / Affected / Congenital onset / Muscular hypotonia \\(HP:0001252\\), Arrhythmia \\(HP:0011675\\) / Not recorded
* NA19678 / Female / Unaffected / Not recorded / Not recorded / HP:1
* 1-248367227-TC-T / OR4G11P, MFSD9 / ENST00000371839.1:c.4\\_5del / ENSP00000371839.1:p.Leu2fs / NA19675: Heterozygous, NA19678: Homozygous reference / genomes 0.03445, exomes 0 / Likely pathogenic / Pathogenic / Known gene for phenotype, Review
* 21-3343353-GAGA-G / MTHFR / Not recorded / Not recorded / Not recorded / Not recorded / Not recorded / Not recorded / Review
'''


def _render(body, context=None):
    return render_template(body, CONTEXT if context is None else context)


def _body(rendered):
    markdown = rendered['markdown']
    assert markdown.startswith(HEADER) and markdown.endswith(FOOTER)
    return markdown[len(HEADER):-len(FOOTER)]


class ReportTemplateRendererTest(unittest.TestCase):

    def test_all_placeholders_and_loops(self):
        rendered = _render(ALL_PLACEHOLDERS_TEMPLATE)
        self.assertEqual(_body(rendered), ALL_PLACEHOLDERS_RENDERED)
        self.assertListEqual(rendered['warnings'], [])

        documented_scalars = set(SCALAR_PLACEHOLDERS)
        documented_scalars.update(
            f'{config["item"]}.{field}' for config in COLLECTIONS.values() for field in config['fields']
        )
        self.assertListEqual(rendered['usedData'], sorted([*documented_scalars, 'individuals', 'variants']))

        # Every documented placeholder is accepted by the parser, and nothing undocumented is used above
        reference = {entry['placeholder'] for entry in PLACEHOLDER_REFERENCE}
        self.assertSetEqual(reference, {
            *['{{%s}}' % name for name in documented_scalars],
            '{{#individuals}}...{{/individuals}}', '{{^individuals}}...{{/individuals}}',
            '{{#variants}}...{{/variants}}', '{{^variants}}...{{/variants}}',
        })
        self.assertFalse(any('note' in placeholder.lower() for placeholder in reference))

    def test_research_use_line_always_present(self):
        self.assertEqual(RESEARCH_USE_LINE, 'Research use only — not a clinical report')
        for body in ['Plain text', '{{family.displayName}}', '{{#variants}}{{variant.genes}}{{/variants}}', ' x ']:
            markdown = _render(body)['markdown']
            self.assertTrue(markdown.startswith(HEADER))
            self.assertTrue(markdown.endswith(FOOTER))
            self.assertEqual(markdown.count(RESEARCH_USE), 2)

        # Data can not remove or imitate the fixed line
        markdown = _render('{{family.displayName}}', {'family': {'displayName': f'x\n\n{RESEARCH_USE}'}})['markdown']
        self.assertEqual(markdown.count(RESEARCH_USE), 2)
        self.assertEqual(_body({'markdown': markdown}), 'x \\> \\*\\*Research use only — not a clinical report\\*\\*')

    def test_hostile_values_are_escaped(self):
        hostile_values = {
            '[x](javascript:alert(1))': '\\[x\\]\\(javascript:alert\\(1\\)\\)',
            '<script>alert(1)</script>': '\\<script\\>alert\\(1\\)\\</script\\>',
            'a | b || c': 'a \\| b \\|\\| c',
            '`code` and ```fence```': '\\`code\\` and \\`\\`\\`fence\\`\\`\\`',
            '![img](http://evil.example/x.png)': '\\!\\[img\\]\\(http://evil.example/x.png\\)',
            '<http://evil.example>': '\\<http://evil.example\\>',
            '**bold** _em_ ~~strike~~': '\\*\\*bold\\*\\* \\_em\\_ \\~\\~strike\\~\\~',
            '# heading': '\\# heading',
            '> quote': '\\> quote',
            '- item': '\\- item',
            '+ item': '\\+ item',
            '---': '\\---',
            '===': '\\===',
            '1. item': '1\\. item',
            'line one\n\n# line two\r\n\tindented': 'line one \\# line two indented',
            '    indented code': 'indented code',
            '&lt;b&gt; &#x6A;': '\\&lt;b\\&gt; \\&\\#x6A;',
            'back\\slash': 'back\\\\slash',
            '{{family.mondoId}}': '\\{\\{family.mondoId\\}\\}',
            '[ref]: http://evil.example': '\\[ref\\]: http://evil.example',
        }
        for value, expected in hostile_values.items():
            self.assertEqual(escape_markdown(value), expected)
            self.assertEqual(_body(_render('{{family.displayName}}', {'family': {'displayName': value}})), expected)
            self.assertEqual(
                _body(_render('{{#variants}}{{variant.tags}}{{/variants}}', {'variants': [{'tags': ['ok', value]}]})),
                f'ok, {expected}',
            )

        # Values which only look like markup at the start of a line are left readable
        for value in ['0.034', '-5', '1-248367227-TC-T', 'c.375_377del'.replace('_', ''), 'p.Leu126del', '3.5 years']:
            self.assertEqual(escape_markdown(value), value)

        long_value = 'a' * (MAX_VALUE_LENGTH + 50)
        self.assertEqual(escape_markdown(long_value), 'a' * MAX_VALUE_LENGTH + '…')
        self.assertEqual(escape_markdown(12), '12')
        self.assertEqual(escape_markdown(0.5), '0.5')

    def test_values_are_not_reinterpreted_as_placeholders(self):
        rendered = _render('{{family.displayName}} {{family.mondoId}}', {
            'family': {'displayName': '{{family.mondoId}}{{#variants}}', 'mondoId': 'MONDO:1'},
        })
        self.assertEqual(_body(rendered), '\\{\\{family.mondoId\\}\\}\\{\\{\\#variants\\}\\} MONDO:1')

    def test_missing_and_unsupported_values(self):
        template = '{{date}}|{{family.displayName}}|{{project.name}}'
        for context in [
            {}, {'family': None, 'project': 'a string'}, {'family': {'displayName': ''}, 'project': {'name': None}},
            {'date': {'nested': 'x'}, 'family': {'displayName': True}, 'project': {'name': []}},
            {'date': [None, {}, ''], 'family': {'displayName': object()}, 'project': {'name': [[1]]}},
        ]:
            self.assertEqual(_body(_render(template, context)), '|'.join([MISSING_VALUE] * 3))

        self.assertEqual(_body(_render(template, {'date': 0, 'family': {'displayName': 0.0}, 'project': {'name': ('a', 1)}})), '0|0.0|a, 1')

        loops = '{{#individuals}}[{{individual.id}}]{{/individuals}}{{#variants}}[{{variant.genes}}]{{/variants}}'
        for context in [{}, {'individuals': None, 'variants': 'abc'}, {'individuals': {'id': 'x'}, 'variants': 5}]:
            self.assertEqual(_body(_render(loops, context)), '')
        self.assertEqual(
            _body(_render(loops, {'individuals': ['x', None, {'id': 'I1'}, {}], 'variants': [{'genes': 'G'}, ['x']]})),
            '[I1][Not recorded][G]',
        )

    def test_tag_filter(self):
        template = '{{#variants tag="Known gene for phenotype"}}[{{variant.variantId}}]{{/variants}}'
        rendered = _render(template)
        self.assertEqual(_body(rendered), '[1-248367227-TC-T]')
        self.assertListEqual(rendered['usedData'], ['variant.variantId', 'variants tag="Known gene for phenotype"'])

        self.assertEqual(_body(_render('{{#variants tag="  known GENE for phenotype "}}[{{variant.variantId}}]{{/variants}}')), '[1-248367227-TC-T]')
        self.assertEqual(_body(_render('{{#variants tag="Review"}}[{{variant.variantId}}]{{/variants}}')), '[1-248367227-TC-T][21-3343353-GAGA-G]')
        self.assertEqual(_body(_render('{{#variants tag="Known"}}[{{variant.variantId}}]{{/variants}}')), '')
        self.assertEqual(_body(_render('{{#variants tag=""}}[{{variant.variantId}}]{{/variants}}')), '')
        self.assertEqual(
            _body(_render('{{#variants tag="Review"}}x{{/variants}}', {'variants': [{'tags': None}, {}, {'tags': ['review']}]})), 'x',
        )

    def test_inverted_blocks(self):
        template = '{{#variants}}[{{variant.genes}}]{{/variants}}{{^variants}}No saved variants{{/variants}}'
        self.assertEqual(_body(_render(template)), '[OR4G11P, MFSD9][MTHFR]')
        self.assertEqual(_body(_render(template, {'variants': []})), 'No saved variants')
        self.assertEqual(_body(_render(template, {})), 'No saved variants')

        template = '{{^variants tag="Excluded"}}None excluded for {{family.displayName}}{{/variants}}{{^individuals}}Nobody{{/individuals}}'
        rendered = _render(template)
        self.assertEqual(_body(rendered), 'None excluded for FAM\\_1')
        self.assertListEqual(rendered['usedData'], ['family.displayName', 'individuals', 'variants tag="Excluded"'])
        self.assertEqual(_body(_render(template.replace('Excluded', 'Review'))), '')

    def test_loop_bounds(self):
        variants = [{'variantId': f'v{i}', 'tags': ['Review'] if i % 2 else []} for i in range(MAX_LOOP_ITEMS + 25)]
        rendered = _render('{{#variants}}[{{variant.variantId}}]{{/variants}}', {'variants': variants})
        self.assertEqual(_body(rendered), ''.join(f'[v{i}]' for i in range(MAX_LOOP_ITEMS)))
        self.assertListEqual(rendered['warnings'], [f'Only the first {MAX_LOOP_ITEMS} of {MAX_LOOP_ITEMS + 25} variants are included'])

        rendered = _render('{{#variants tag="Review"}}[{{variant.variantId}}]{{/variants}}', {'variants': variants})
        self.assertEqual(_body(rendered).count('['), 62)
        self.assertListEqual(rendered['warnings'], [])

        individuals = [{'id': str(i)} for i in range(MAX_LOOP_ITEMS + 1)]
        rendered = _render('{{#individuals}}.{{/individuals}}', {'individuals': individuals})
        self.assertEqual(_body(rendered), '.' * MAX_LOOP_ITEMS)
        self.assertListEqual(rendered['warnings'], [f'Only the first {MAX_LOOP_ITEMS} of {MAX_LOOP_ITEMS + 1} individuals are included'])

    def test_unknown_placeholder_errors(self):
        expected_errors = {
            '{{family.name}}': ['Line 1: Unknown placeholder {{family.name}}'],
            'a\nb {{foo}}\n{{family.displayName}} {{bar.baz}}': [
                'Line 2: Unknown placeholder {{foo}}', 'Line 3: Unknown placeholder {{bar.baz}}',
            ],
            '{{family.notes}}': ['Line 1: Unknown placeholder {{family.notes}}'],
            '{{#variants}}{{variant.notes}}{{/variants}}': ['Line 1: Unknown placeholder {{variant.notes}}'],
            '{{#notes}}x{{/notes}}': ['Line 1: Unknown block {{#notes}}', 'Line 1: {{/notes}} does not close an open block'],
            '{{individual.id}}': ['Line 1: {{individual.id}} can only be used inside {{#individuals}}...{{/individuals}}'],
            '{{#variants}}{{individual.id}}{{/variants}}': [
                'Line 1: {{individual.id}} can only be used inside {{#individuals}}...{{/individuals}}',
            ],
            '{{^variants}}{{variant.genes}}{{/variants}}': [
                'Line 1: {{variant.genes}} can not be used inside {{^variants}}, which is only shown when there are no variants',
            ],
            '{{individual}}': ['Line 1: Unknown placeholder {{individual}}'],
            '{{variants}}': ['Line 1: Unknown placeholder {{variants}}'],
            '{{Family.displayName}}': ['Line 1: Unknown placeholder {{Family.displayName}}'],
        }
        for body, errors in expected_errors.items():
            self.assertListEqual(validate_template(body), errors)
            with self.assertRaises(TemplateError) as cm:
                _render(body)
            self.assertListEqual(cm.exception.errors, errors)
            self.assertEqual(str(cm.exception), '; '.join(errors))

    def test_no_expressions_or_attribute_traversal(self):
        for placeholder in [
            'family.__class__', 'family.displayName.upper', 'family.displayName()', 'family["displayName"]', '7*7',
            'family.displayName|safe', '% import os %', 'date + date', '> partial', '!comment', '& family.displayName',
            'family displayName', '#variants tag=Review', '#variants tag="a" tag="b"',
            '#variants limit="5"', '', '.', 'family.', '.displayName', 'família.displayName',
        ]:
            body = '{{%s}}' % placeholder
            errors = validate_template(body)
            self.assertEqual(len(errors), 1, body)
            self.assertRegex(errors[0], r'^Line 1: (Invalid placeholder|Unterminated or unmatched placeholder braces)')

        class Secret:
            password = 'hunter2'

            def __str__(self):
                return 'secret object'

        rendered = _render('{{family.displayName}}', {'family': Secret()})
        self.assertEqual(_body(rendered), MISSING_VALUE)
        rendered = _render('{{family.displayName}}', {'family': {'displayName': Secret()}})
        self.assertEqual(_body(rendered), MISSING_VALUE)

    def test_nested_and_unterminated_blocks(self):
        expected_errors = {
            '{{#variants}}{{#individuals}}x{{/individuals}}{{/variants}}': [
                'Line 1: {{#individuals}} can not be nested inside {{#variants}}',
                'Line 1: {{/individuals}} does not close an open block',
            ],
            '{{#variants}}{{#variants}}x{{/variants}}{{/variants}}': [
                'Line 1: {{#variants}} can not be nested inside {{#variants}}',
                'Line 1: {{/variants}} does not close an open block',
            ],
            'a\n{{#variants}}\n{{variant.genes}}': ['Line 2: {{#variants}} is never closed'],
            '{{^individuals}}nobody': ['Line 1: {{^individuals}} is never closed'],
            '{{/variants}}': ['Line 1: {{/variants}} does not close an open block'],
            '{{#variants}}x{{/individuals}}': [
                'Line 1: {{/individuals}} does not close an open block', 'Line 1: {{#variants}} is never closed',
            ],
            '{{#individuals tag="x"}}y{{/individuals}}': [
                'Line 1: {{#individuals tag="x"}} does not support a tag filter',
                'Line 1: {{/individuals}} does not close an open block',
            ],
            'a\n\n{{family.displayName': ['Line 3: Unterminated or unmatched placeholder braces'],
            'family.displayName}}': ['Line 1: Unterminated or unmatched placeholder braces'],
            '{{#variants}}{{variant.genes}{{/variants}}': ['Line 1: Unterminated or unmatched placeholder braces'],
            '{{#variants}}\n{{variant.genes\n}}{{/variants}}': [],
            '{{family.displayName}}}': [],
        }
        for body, errors in expected_errors.items():
            self.assertListEqual(validate_template(body), errors, body)

    def test_body_limits(self):
        for body in [None, '', '   \n', 5, ['{{date}}']]:
            self.assertListEqual(validate_template(body), ['Template body is required'])

        self.assertListEqual(validate_template('a' * MAX_BODY_LENGTH), [])
        self.assertListEqual(validate_template('a' * (MAX_BODY_LENGTH + 1)), [
            f'Template body is too long ({MAX_BODY_LENGTH + 1} characters, maximum {MAX_BODY_LENGTH})',
        ])

        self.assertListEqual(validate_template('{{date}}' * MAX_PLACEHOLDERS), [])
        self.assertListEqual(validate_template('{{date}}' * (MAX_PLACEHOLDERS + 1)), [
            f'Template has too many placeholders ({MAX_PLACEHOLDERS + 1}, maximum {MAX_PLACEHOLDERS})',
        ])

    def test_parse_template(self):
        nodes, errors = parse_template('Hi {{ family.displayName }}{{#variants tag="A b"}}- {{variant.genes}}\n{{/variants}}!')
        self.assertListEqual(errors, [])
        self.assertListEqual(nodes, [
            {'type': 'text', 'text': 'Hi '},
            {'type': 'scalar', 'name': 'family.displayName'},
            {'type': 'block', 'collection': 'variants', 'inverted': False, 'tag': 'A b', 'children': [
                {'type': 'text', 'text': '- '}, {'type': 'scalar', 'name': 'variant.genes'}, {'type': 'text', 'text': '\n'},
            ]},
            {'type': 'text', 'text': '!'},
        ])

    def test_standalone_block_lines(self):
        body = 'Variants:\n{{#variants}}\n- {{variant.variantId}}\n{{/variants}}\n{{^variants}}\nNone\n{{/variants}}\nEnd'
        self.assertEqual(_body(_render(body)), 'Variants:\n- 1-248367227-TC-T\n- 21-3343353-GAGA-G\nEnd')
        self.assertEqual(_body(_render(body, {})), 'Variants:\nNone\nEnd')
        self.assertEqual(_body(_render(body.replace('\n', '\r\n'), {})), 'Variants:\nNone\nEnd')

        # Block tags which share a line with other content keep their line breaks
        body = 'a {{#variants}}\n{{variant.variantId}}\n{{/variants}} b\n{{date}}\nc'
        self.assertEqual(_body(_render(body)), 'a \n1-248367227-TC-T\n\n21-3343353-GAGA-G\n b\n2026-11-26\nc')

    def test_template_markdown_is_preserved(self):
        body = '# Title\n\n| a | b |\n|---|---|\n| {{family.displayName}} | [seqr](https://seqr.broadinstitute.org) |\n'
        self.assertEqual(
            _body(_render(body)),
            '# Title\n\n| a | b |\n|---|---|\n| FAM\\_1 | [seqr](https://seqr.broadinstitute.org) |\n',
        )
