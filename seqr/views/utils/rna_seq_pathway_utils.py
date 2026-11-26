from collections import defaultdict
from statistics import median

from reference_data.models import ReactomePathway
from seqr.models import RnaSeqOutlier


def get_individual_rna_seq_pathways(individual):
    """Describe how an individual's expression outliers distribute over Reactome pathways.

    Returns:
        {
            hasReferenceData: whether any Reactome pathways are loaded,
            pathwaysBySampleType: {
                '<tissueType>-<sequencingType>': [{
                    pathwayId, name,
                    numGenes: genes annotated to the pathway,
                    numMeasured: pathway genes with an expression outlier record for the sample, significant or not,
                    numOutliers: pathway genes with a significant expression outlier record,
                    outlierGeneIds, measuredGeneIds,
                    medianZScore: median z-score of the measured genes,
                }, ...],
            },
        }
        Every active sample with expression outlier records has an entry. Only pathways with at least one significant
        outlier are listed, sorted by number of outliers and then by absolute median z-score. The numbers are
        descriptive: no enrichment statistics are computed.
    """
    z_scores_by_sample_type = defaultdict(dict)
    outlier_gene_ids_by_sample_type = defaultdict(set)
    outliers = RnaSeqOutlier.objects.filter(sample__individual=individual, sample__is_active=True).values_list(
        'sample__tissue_type', 'sample__sequencing_type', 'gene_id', 'z_score', 'p_adjust',
    )
    for tissue_type, sequencing_type, gene_id, z_score, p_adjust in outliers:
        sample_type = f'{tissue_type}-{sequencing_type}'
        z_scores_by_sample_type[sample_type][gene_id] = z_score
        if p_adjust < RnaSeqOutlier.MAX_SIGNIFICANT_P_ADJUST:
            outlier_gene_ids_by_sample_type[sample_type].add(gene_id)

    outlier_gene_ids = set().union(*outlier_gene_ids_by_sample_type.values())
    pathway_names = {}
    pathway_gene_ids = defaultdict(set)
    if outlier_gene_ids:
        outlier_pathway_ids = ReactomePathway.objects.filter(gene__gene_id__in=outlier_gene_ids).values('pathway_id')
        pathway_genes = ReactomePathway.objects.filter(pathway_id__in=outlier_pathway_ids).values_list(
            'pathway_id', 'name', 'gene__gene_id',
        )
        for pathway_id, name, gene_id in pathway_genes:
            pathway_names[pathway_id] = name
            pathway_gene_ids[pathway_id].add(gene_id)

    pathways_by_sample_type = {}
    for sample_type, z_scores in z_scores_by_sample_type.items():
        pathways = []
        for pathway_id, gene_ids in pathway_gene_ids.items():
            sample_outlier_gene_ids = sorted(gene_ids & outlier_gene_ids_by_sample_type[sample_type])
            if not sample_outlier_gene_ids:
                continue
            measured_gene_ids = sorted(gene_ids & z_scores.keys())
            pathways.append({
                'pathwayId': pathway_id,
                'name': pathway_names[pathway_id],
                'numGenes': len(gene_ids),
                'numMeasured': len(measured_gene_ids),
                'numOutliers': len(sample_outlier_gene_ids),
                'outlierGeneIds': sample_outlier_gene_ids,
                'measuredGeneIds': measured_gene_ids,
                'medianZScore': median(z_scores[gene_id] for gene_id in measured_gene_ids),
            })
        pathways_by_sample_type[sample_type] = sorted(
            pathways, key=lambda p: (-p['numOutliers'], -abs(p['medianZScore']), p['name'], p['pathwayId']),
        )

    return {
        'hasReferenceData': bool(pathway_names) or ReactomePathway.objects.exists(),
        'pathwaysBySampleType': pathways_by_sample_type,
    }
