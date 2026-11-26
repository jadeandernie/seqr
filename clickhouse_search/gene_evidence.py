from collections import defaultdict

from clickhouse_search.managers import InvalidSearchException
from seqr.models import RnaSample, RnaSeqOutlier, RnaSeqSpliceOutlier
from seqr.views.utils.orm_to_json_utils import rna_seq_outlier_significance_q

RNA_EXPRESSION_OUTLIER = 'rna_expression_outlier'
RNA_SPLICE_OUTLIER = 'rna_splice_outlier'
GENE_EVIDENCE_TYPES = {
    RNA_EXPRESSION_OUTLIER: (RnaSeqOutlier, RnaSample.DATA_TYPE_EXPRESSION_OUTLIER, 'RNA expression outlier'),
    RNA_SPLICE_OUTLIER: (RnaSeqSpliceOutlier, RnaSample.DATA_TYPE_SPLICE_OUTLIER, 'RNA splice outlier'),
}
RNA_EVIDENCE_DATA_TYPES = [data_type for _, data_type, _ in GENE_EVIDENCE_TYPES.values()]

MATCH_FIELD = 'match'
MATCH_ANY = 'any'
MATCH_ALL = 'all'

MAX_GENE_EVIDENCE_FAMILIES = 100


def parse_gene_evidence(gene_evidence):
    """Returns the requested evidence types and how to combine them, or None if no gene evidence is requested"""
    if not gene_evidence:
        return None
    if not isinstance(gene_evidence, dict):
        raise InvalidSearchException('Invalid gene evidence filter')

    invalid_fields = sorted(set(gene_evidence) - set(GENE_EVIDENCE_TYPES) - {MATCH_FIELD})
    if invalid_fields:
        raise InvalidSearchException(f'Invalid gene evidence filter: {", ".join(invalid_fields)}')
    invalid_values = [field for field in GENE_EVIDENCE_TYPES if not isinstance(gene_evidence.get(field, False), bool)]
    if invalid_values:
        raise InvalidSearchException(f'Invalid gene evidence filter value for {", ".join(invalid_values)}')
    match = gene_evidence.get(MATCH_FIELD) or MATCH_ANY
    if match not in {MATCH_ANY, MATCH_ALL}:
        raise InvalidSearchException(f'Invalid gene evidence match "{match}"')

    evidence_types = [field for field in GENE_EVIDENCE_TYPES if gene_evidence.get(field)]
    return (evidence_types, match) if evidence_types else None


def combine_gene_evidence(gene_sets, match):
    return set.intersection(*gene_sets) if match == MATCH_ALL else set.union(*gene_sets)


def get_family_evidence_gene_ids(families, gene_evidence):
    """Returns the gene ids with the requested evidence for each searched family, or None if no evidence is requested"""
    parsed_evidence = parse_gene_evidence(gene_evidence)
    if not parsed_evidence:
        return None
    evidence_types, match = parsed_evidence

    family_ids = dict(families.values_list('guid', 'family_id')[:MAX_GENE_EVIDENCE_FAMILIES + 1])
    if len(family_ids) > MAX_GENE_EVIDENCE_FAMILIES:
        raise InvalidSearchException(
            f'Gene evidence filters are only supported when searching {MAX_GENE_EVIDENCE_FAMILIES} or fewer families')

    family_type_gene_ids = defaultdict(list)
    for evidence_type in evidence_types:
        model, data_type, label = GENE_EVIDENCE_TYPES[evidence_type]
        loaded_families = set(RnaSample.objects.filter(
            individual__family__guid__in=family_ids, is_active=True, data_type=data_type,
        ).values_list('individual__family__guid', flat=True))
        missing_families = sorted(family_id for guid, family_id in family_ids.items() if guid not in loaded_families)
        if missing_families:
            raise InvalidSearchException(
                f'No {label} data loaded for {"family" if len(missing_families) == 1 else "families"} {", ".join(missing_families)}')

        gene_ids_by_family = defaultdict(set)
        family_genes = model.objects.filter(
            rna_seq_outlier_significance_q(model), sample__is_active=True, sample__individual__family__guid__in=family_ids,
        ).values_list('sample__individual__family__guid', 'gene_id').distinct()
        for family_guid, gene_id in family_genes:
            gene_ids_by_family[family_guid].add(gene_id)
        for family_guid in family_ids:
            family_type_gene_ids[family_guid].append(gene_ids_by_family[family_guid])

    return {family_guid: combine_gene_evidence(gene_sets, match) for family_guid, gene_sets in family_type_gene_ids.items()}
