"""
Renderer for report templates: Markdown with a small, whitelisted placeholder language.

Deliberately not a general template engine: there are no expressions, no attribute traversal and no code
execution. A placeholder is either a whitelisted scalar ({{family.displayName}}) or a block over a whitelisted
collection ({{#variants}}...{{/variants}}). Every substituted value is escaped so data can not add Markdown.
"""
import re

RESEARCH_USE_LINE = 'Research use only — not a clinical report'
MISSING_VALUE = 'Not recorded'

MAX_BODY_LENGTH = 20000
MAX_PLACEHOLDERS = 500
MAX_LOOP_ITEMS = 100
MAX_VALUE_LENGTH = 500

SCALAR_PLACEHOLDERS = {
    'date': 'Date the report was generated (YYYY-MM-DD)',
    'family.displayName': 'Family display name',
    'family.analysisStatus': 'Family analysis status',
    'family.codedPhenotype': 'Family coded phenotype',
    'family.mondoId': 'Family MONDO ID',
    'project.name': 'Project name',
    'project.genomeVersion': 'Project genome build',
}
COLLECTIONS = {
    'individuals': {
        'item': 'individual',
        'description': 'Repeats its content for each individual in the family',
        'fields': {
            'id': 'Individual ID',
            'sex': 'Sex',
            'affected': 'Affected status',
            'hpoPresent': 'HPO terms recorded as present',
            'hpoAbsent': 'HPO terms recorded as absent',
            'onset': 'Age of onset',
        },
    },
    'variants': {
        'item': 'variant',
        'description': 'Repeats its content for each saved variant in the family. '
                       'Add tag="Tag name" to only include variants with that tag',
        'fields': {
            'variantId': 'Variant ID (chromosome-position-reference-alternate)',
            'genes': 'Gene symbol(s)',
            'hgvsc': 'HGVS coding change',
            'hgvsp': 'HGVS protein change',
            'zygosity': 'Zygosity for each individual',
            'gnomadFrequency': 'gnomAD allele frequency',
            'clinvar': 'ClinVar clinical significance',
            'acmg': 'ACMG classification, if recorded',
            'tags': 'Variant tags',
        },
    },
}
FILTERABLE_COLLECTIONS = {'variants'}
ITEM_COLLECTIONS = {config['item']: name for name, config in COLLECTIONS.items()}

PLACEHOLDER_REFERENCE = [
    *[{'placeholder': '{{%s}}' % name, 'description': description} for name, description in SCALAR_PLACEHOLDERS.items()],
    *[entry for name, config in COLLECTIONS.items() for entry in [
        {'placeholder': '{{#%s}}...{{/%s}}' % (name, name), 'description': config['description']},
        {'placeholder': '{{^%s}}...{{/%s}}' % (name, name), 'description': f'Content shown when there are no {name}'},
        *[
            {'placeholder': '{{%s.%s}}' % (config['item'], field), 'description': description, 'block': name}
            for field, description in config['fields'].items()
        ],
    ]],
]

_TAG_REGEX = re.compile(r'\{\{([^{}]*)\}\}')
_STRAY_BRACES_REGEX = re.compile(r'\{\{|\}\}')
_SCALAR_REGEX = re.compile(r'^[A-Za-z]+(?:\.[A-Za-z]+)?$')
_BLOCK_OPEN_REGEX = re.compile(r'^([#^])([A-Za-z]+)(?:\s+tag="([^"{}]*)")?$')
_BLOCK_CLOSE_REGEX = re.compile(r'^/([A-Za-z]+)$')
_WHITESPACE_REGEX = re.compile(r'\s+')
_ALWAYS_ESCAPED_REGEX = re.compile(r'([\\`*_{}\[\]()<>#!|~&])')
_LEADING_MARKER_REGEX = re.compile(r'^(?:([-+=])(?=[-+=\s]|$)|(\d+)(\.)(?=\s|$))')

BLOCK_TAG_PREFIXES = {'#', '^', '/'}

TEXT = 'text'
SCALAR = 'scalar'
BLOCK = 'block'


class TemplateError(Exception):

    def __init__(self, errors):
        super().__init__('; '.join(errors))
        self.errors = errors


def _line_number(body, position):
    return body.count('\n', 0, position) + 1


def _parse_scalar(name, block):
    if name in SCALAR_PLACEHOLDERS:
        return None
    scope, _, field = name.partition('.')
    collection = ITEM_COLLECTIONS.get(scope)
    if not collection or field not in COLLECTIONS[collection]['fields']:
        return f'Unknown placeholder {{{{{name}}}}}'
    if not block or block['collection'] != collection:
        return f'{{{{{name}}}}} can only be used inside {{{{#{collection}}}}}...{{{{/{collection}}}}}'
    if block['inverted']:
        return f'{{{{{name}}}}} can not be used inside {{{{^{collection}}}}}, which is only shown when there are no {collection}'
    return None


def _parse_tag(content, block, nodes):
    """Returns (error, block) for one {{...}} tag, adding parsed nodes to the current node list"""
    open_match = _BLOCK_OPEN_REGEX.match(content)
    if open_match:
        block_type, collection, tag = open_match.groups()
        if collection not in COLLECTIONS:
            return f'Unknown block {{{{{content}}}}}', block
        if block:
            return f'{{{{{content}}}}} can not be nested inside {{{{#{block["collection"]}}}}}', block
        if tag is not None and collection not in FILTERABLE_COLLECTIONS:
            return f'{{{{{content}}}}} does not support a tag filter', block
        new_block = {
            'type': BLOCK, 'collection': collection, 'inverted': block_type == '^', 'tag': tag, 'children': [],
        }
        nodes.append(new_block)
        return None, new_block

    close_match = _BLOCK_CLOSE_REGEX.match(content)
    if close_match:
        if not block or block['collection'] != close_match.group(1):
            return f'{{{{{content}}}}} does not close an open block', block
        return None, None

    if not _SCALAR_REGEX.match(content):
        return f'Invalid placeholder {{{{{content}}}}}', block
    error = _parse_scalar(content, block)
    if not error:
        (block['children'] if block else nodes).append({'type': SCALAR, 'name': content})
    return error, block


def parse_template(body):
    """Returns (nodes, errors). Parsing never evaluates anything: it only matches the whitelisted grammar"""
    if not isinstance(body, str) or not body.strip():
        return [], ['Template body is required']
    if len(body) > MAX_BODY_LENGTH:
        return [], [f'Template body is too long ({len(body)} characters, maximum {MAX_BODY_LENGTH})']

    body = body.replace('\r\n', '\n')
    nodes = []
    errors = []
    block = None
    block_line = None
    position = 0
    num_placeholders = 0

    def _add_text(start, end):
        text = body[start:end]
        stray_braces = _STRAY_BRACES_REGEX.search(text)
        if stray_braces:
            line = _line_number(body, start + stray_braces.start())
            errors.append(f'Line {line}: Unterminated or unmatched placeholder braces')
        if text:
            (block['children'] if block else nodes).append({'type': TEXT, 'text': text})

    for match in _TAG_REGEX.finditer(body):
        _add_text(position, match.start())
        position = match.end()
        is_standalone_line = (match.start() == 0 or body[match.start() - 1] == '\n') and body[position:position + 1] == '\n'
        if is_standalone_line and match.group(1).strip()[:1] in BLOCK_TAG_PREFIXES:
            # A block tag on its own line does not add a blank line to the output
            position += 1
        num_placeholders += 1
        line = _line_number(body, match.start())
        was_open = bool(block)
        error, block = _parse_tag(match.group(1).strip(), block, nodes)
        if error:
            errors.append(f'Line {line}: {error}')
        elif block and not was_open:
            block_line = line
    _add_text(position, len(body))

    if block:
        prefix = '^' if block['inverted'] else '#'
        errors.append(f'Line {block_line}: {{{{{prefix}{block["collection"]}}}}} is never closed')
    if num_placeholders > MAX_PLACEHOLDERS:
        errors.append(f'Template has too many placeholders ({num_placeholders}, maximum {MAX_PLACEHOLDERS})')

    return nodes, errors


def validate_template(body):
    return parse_template(body)[1]


def _escape_leading_marker(match):
    return f'\\{match.group(1)}' if match.group(1) else f'{match.group(2)}\\{match.group(3)}'


def escape_markdown(value):
    """Makes a data value inert: one line, bounded length, and no character that Markdown or HTML would interpret"""
    text = _WHITESPACE_REGEX.sub(' ', str(value)).strip()
    if len(text) > MAX_VALUE_LENGTH:
        text = text[:MAX_VALUE_LENGTH] + '…'
    text = _ALWAYS_ESCAPED_REGEX.sub(r'\\\1', text)
    return _LEADING_MARKER_REGEX.sub(_escape_leading_marker, text)


def _is_scalar(value):
    return isinstance(value, (str, int, float)) and not isinstance(value, bool) and value != ''


def _format_value(value):
    if isinstance(value, (list, tuple)):
        values = [escape_markdown(v) for v in value if _is_scalar(v)]
        if values:
            return ', '.join(values)
    elif _is_scalar(value):
        return escape_markdown(value)
    return MISSING_VALUE


def _lookup(name, context, item):
    if name in SCALAR_PLACEHOLDERS:
        scope, _, field = name.partition('.')
        value = context.get(scope)
        if field:
            value = value.get(field) if isinstance(value, dict) else None
        return value
    return item.get(name.partition('.')[2]) if isinstance(item, dict) else None


def _collection_items(block, context):
    items = context.get(block['collection'])
    items = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    if block['tag'] is not None:
        tag = block['tag'].strip().lower()
        items = [
            item for item in items
            if tag in {str(t).strip().lower() for t in item.get('tags') or []}
        ]
    return items


def _block_label(block):
    return block['collection'] if block['tag'] is None else f'{block["collection"]} tag="{block["tag"]}"'


def _render_nodes(nodes, context, item, output, used):
    for node in nodes:
        if node['type'] == TEXT:
            output.append(node['text'])
        else:
            used.add(node['name'])
            output.append(_format_value(_lookup(node['name'], context, item)))


def render_template(body, context):
    """
    Pure function: renders a template body against a context of plain dicts, lists and scalars.
    Returns the rendered Markdown, the placeholders it used and any warnings. Raises TemplateError if invalid.
    """
    nodes, errors = parse_template(body)
    if errors:
        raise TemplateError(errors)

    research_use = f'> **{RESEARCH_USE_LINE}**'
    output = [research_use, '\n\n']
    used = set()
    warnings = []
    for node in nodes:
        if node['type'] != BLOCK:
            _render_nodes([node], context, None, output, used)
            continue

        label = _block_label(node)
        used.add(label)
        items = _collection_items(node, context)
        if node['inverted']:
            if not items:
                _render_nodes(node['children'], context, None, output, used)
            continue
        if len(items) > MAX_LOOP_ITEMS:
            warnings.append(f'Only the first {MAX_LOOP_ITEMS} of {len(items)} {label} are included')
            items = items[:MAX_LOOP_ITEMS]
        for item in items:
            _render_nodes(node['children'], context, item, output, used)

    output += ['\n\n', research_use, '\n']
    return {'markdown': ''.join(output), 'usedData': sorted(used), 'warnings': warnings}
