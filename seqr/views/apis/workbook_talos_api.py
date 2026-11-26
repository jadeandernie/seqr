"""
Export of a workbook to a Talos configuration fragment. Permissions are those of the workbook detail endpoint: view
access to the project of the workbook and to the families of its targets.
"""
from django.db.models import Q

from panelapp.models import PaLocusListGene
from reference_data.models import GeneInfo
from seqr.models import LocusList, WorksheetQuery
from seqr.utils.gene_utils import get_gene_ids_for_gene_symbols
from seqr.utils.talos_export_utils import TALOS_PANELAPP_SOURCE, build_talos_export, parse_locus_items, \
    render_talos_toml
from seqr.views.apis.workbook_api import _get_family_guids_by_target, _get_workbook
from seqr.views.utils.json_utils import create_json_response
from seqr.views.utils.permissions_utils import login_and_policies_required

LOCUS_SECTIONS = ['locus', 'exclude']


def _get_search_sections(queries):
    for query in queries:
        search = query['search'] if isinstance(query['search'], dict) else {}
        for section in LOCUS_SECTIONS:
            if isinstance(search.get(section), dict):
                yield section, search[section]


def _get_locus_lists(queries, project, user):
    guids = {
        section.get('locusListGuid') for name, section in _get_search_sections(queries)
        if name == 'locus' and isinstance(section.get('locusListGuid'), str)
    }
    locus_lists = LocusList.objects.filter(guid__in=guids).filter(
        Q(is_public=True) | Q(created_by=user) | Q(projects=project),
    ).distinct().select_related('palocuslist')

    locus_lists_by_guid = {}
    for locus_list in locus_lists:
        pa_locus_list = getattr(locus_list, 'palocuslist', None)
        gene_mois = {}
        if pa_locus_list and pa_locus_list.source != TALOS_PANELAPP_SOURCE:
            gene_mois = dict(PaLocusListGene.objects.filter(seqr_locus_list_gene__locus_list=locus_list).values_list(
                'seqr_locus_list_gene__gene_id', 'mode_of_inheritance'))
        locus_lists_by_guid[locus_list.guid] = {
            'name': locus_list.name,
            'paSource': pa_locus_list.source if pa_locus_list else None,
            'panelAppId': pa_locus_list.panel_app_id if pa_locus_list else None,
            'geneMois': gene_mois,
        }
    return locus_lists_by_guid


def _get_genes(queries, genome_version):
    symbols = set()
    gene_ids = set()
    for _, section in _get_search_sections(queries):
        panel_items = section.get('panelAppItems')
        for items in [section.get('rawItems'), *(panel_items.values() if isinstance(panel_items, dict) else [])]:
            parsed = parse_locus_items(items)
            symbols.update(parsed['symbols'])
            gene_ids.update(parsed['geneIds'])

    gene_ids_by_symbol = {
        symbol: symbol_gene_ids[0]
        for symbol, symbol_gene_ids in get_gene_ids_for_gene_symbols(symbols, genome_version=genome_version).items()
    } if symbols else {}
    gene_ids.update(gene_ids_by_symbol.values())

    chrom_field = f'chrom_grch{genome_version}'
    genes_by_id = {
        gene_id: {'symbol': symbol, 'chrom': chrom} for gene_id, symbol, chrom in
        GeneInfo.objects.filter(gene_id__in=gene_ids).values_list('gene_id', 'gene_symbol', chrom_field)
    } if gene_ids else {}
    return gene_ids_by_symbol, genes_by_id


@login_and_policies_required
def workbook_talos_export_handler(request, workbook_guid):
    workbook = _get_workbook(workbook_guid, request.user)
    _get_family_guids_by_target(list(workbook.workbooktarget_set.all()), request.user)

    queries = [
        {'guid': query.guid, 'name': query.name, 'worksheet': query.worksheet.name, 'search': query.search}
        for query in WorksheetQuery.objects.filter(worksheet__workbook=workbook).select_related('worksheet').order_by(
            'worksheet__order', 'order', 'id')
    ]
    gene_ids_by_symbol, genes_by_id = _get_genes(queries, workbook.project.genome_version)
    export = build_talos_export(
        queries, locus_lists=_get_locus_lists(queries, workbook.project, request.user),
        gene_ids_by_symbol=gene_ids_by_symbol, genes_by_id=genes_by_id,
    )

    return create_json_response({
        'toml': render_talos_toml(export['config'], workbook.name),
        'report': export['report'],
        'talosVersion': export['talosVersion'],
    })
