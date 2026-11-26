from collections import defaultdict
from django.utils import timezone

from clickhouse_search.search import get_clickhouse_variant_annotations
from reference_data.models import GeneInfo, HumanPhenotypeOntology
from seqr.models import Family, Individual, SavedVariant, VariantTag
from seqr.utils.xpos_utils import get_chrom_pos

MAX_REPORT_VARIANTS = 500

GENOME_BUILDS = {'37': 'GRCh37', '38': 'GRCh38'}
GNOMAD_POPULATIONS = {
    'gnomad_genomes': 'genomes', 'gnomad_exomes': 'exomes', 'gnomad_svs': 'structural variants',
    'gnomad_mito': 'mitochondrial',
}
SEX_CHROMOSOMES = {'X', 'Y'}


def _hpo_labels(features, hpo_names):
    return [
        f'{hpo_names[feature["id"]]} ({feature["id"]})' if feature['id'] in hpo_names else feature['id']
        for feature in features or []
    ]


def _get_individuals_context(individuals):
    hpo_ids = {
        feature['id'] for individual in individuals
        for feature in [*(individual.features or []), *(individual.absent_features or [])]
    }
    hpo_names = dict(HumanPhenotypeOntology.objects.filter(hpo_id__in=hpo_ids).values_list('hpo_id', 'name'))
    return [{
        'id': individual.individual_id,
        'sex': individual.get_sex_display(),
        'affected': individual.get_affected_display(),
        'onset': individual.get_onset_age_display(),
        'hpoPresent': _hpo_labels(individual.features, hpo_names),
        'hpoAbsent': _hpo_labels(individual.absent_features, hpo_names),
    } for individual in individuals]


def _zygosity(genotype, individual, chrom):
    num_alt = genotype.get('numAlt')
    if num_alt is None or num_alt < 0:
        copy_number = genotype.get('cn')
        return 'No call' if copy_number is None else f'Copy number {copy_number}'
    if num_alt == 0:
        return 'Homozygous reference'
    if chrom in SEX_CHROMOSOMES and individual.sex in Individual.MALE_SEXES:
        return 'Hemizygous'
    return 'Heterozygous' if num_alt == 1 else 'Homozygous'


def _main_transcript(variant, annotations):
    transcripts = [t for gene_transcripts in (annotations.get('transcripts') or {}).values() for t in gene_transcripts]
    main_transcript_id = variant.selected_main_transcript_id or annotations.get('mainTranscriptId')
    if not transcripts:
        return variant.main_transcript or {}
    selected = next((t for t in transcripts if t.get('transcriptId') == main_transcript_id), None)
    return selected or min(transcripts, key=lambda t: t.get('transcriptRank') or 0)


def _gnomad_frequency(annotations):
    populations = annotations.get('populations') or {}
    return [
        f'{label} {float(populations[population]["af"]):.4g}' for population, label in GNOMAD_POPULATIONS.items()
        if (populations.get(population) or {}).get('af') is not None
    ]


def _get_annotations_by_key(saved_variants, genome_version):
    keys_by_dataset_type = defaultdict(set)
    for variant in saved_variants:
        if variant.key:
            keys_by_dataset_type[variant.dataset_type].add(variant.key)
    return {
        (dataset_type, annotations['key']): annotations
        for dataset_type, keys in keys_by_dataset_type.items()
        for annotations in get_clickhouse_variant_annotations(genome_version, dataset_type, keys)
    }


def _get_variants_context(family, individuals, genome_version):
    saved_variants = list(
        SavedVariant.objects.filter(family=family).order_by('xpos', 'variant_id', 'id')[:MAX_REPORT_VARIANTS + 1]
    )
    warnings = []
    if len(saved_variants) > MAX_REPORT_VARIANTS:
        saved_variants = saved_variants[:MAX_REPORT_VARIANTS]
        warnings.append(f'This family has more than {MAX_REPORT_VARIANTS} saved variants, only the first {MAX_REPORT_VARIANTS} are available to the report')

    tags_by_variant = defaultdict(list)
    for variant_id, tag_name in VariantTag.objects.filter(
        saved_variants__in=saved_variants,
    ).order_by('variant_tag_type__name').values_list('saved_variants__id', 'variant_tag_type__name'):
        tags_by_variant[variant_id].append(tag_name)

    annotations_by_key = _get_annotations_by_key(saved_variants, genome_version)
    variant_annotations = [annotations_by_key.get((v.dataset_type, v.key), {}) for v in saved_variants]
    variant_gene_ids = [
        variant.gene_ids or sorted((annotations.get('transcripts') or {}).keys())
        for variant, annotations in zip(saved_variants, variant_annotations)
    ]
    gene_symbols = dict(GeneInfo.objects.filter(
        gene_id__in={gene_id for gene_ids in variant_gene_ids for gene_id in gene_ids},
    ).values_list('gene_id', 'gene_symbol'))

    individuals_by_guid = {individual.guid: individual for individual in individuals}
    variants = []
    for variant, annotations, gene_ids in zip(saved_variants, variant_annotations, variant_gene_ids):
        chrom, _ = get_chrom_pos(variant.xpos)
        main_transcript = _main_transcript(variant, annotations)
        genotypes = sorted([
            (individuals_by_guid[guid].individual_id, individuals_by_guid[guid], genotype)
            for guid, genotype in variant.genotypes.items() if guid in individuals_by_guid
        ], key=lambda g: g[0])
        variants.append({
            'variantId': variant.variant_id,
            'genes': [
                gene_symbols.get(gene_id) or (len(gene_ids) == 1 and main_transcript.get('geneSymbol')) or gene_id
                for gene_id in gene_ids
            ] or main_transcript.get('geneSymbol'),
            'hgvsc': main_transcript.get('hgvsc'),
            'hgvsp': main_transcript.get('hgvsp'),
            'zygosity': [
                f'{individual_id}: {_zygosity(genotype, individual, chrom)}'
                for individual_id, individual, genotype in genotypes
            ],
            'gnomadFrequency': _gnomad_frequency(annotations),
            'clinvar': ((annotations.get('clinvar') or {}).get('pathogenicity') or '').replace('_', ' '),
            'acmg': (variant.acmg_classification or {}).get('classify'),
            'tags': tags_by_variant[variant.id],
        })
    return variants, warnings


def get_family_report_context(family):
    """
    The complete set of data a report template can reference. Free text notes are deliberately never included,
    as they may contain identifying text.
    """
    project = family.project
    individuals = list(family.individual_set.order_by('individual_id'))
    variants, warnings = _get_variants_context(family, individuals, project.genome_version)
    return {
        'date': timezone.now().strftime('%Y-%m-%d'),
        'project': {
            'name': project.name,
            'genomeVersion': GENOME_BUILDS.get(project.genome_version, project.genome_version),
        },
        'family': {
            'displayName': family.display_name or family.family_id,
            'analysisStatus': dict(Family.ANALYSIS_STATUS_CHOICES).get(family.analysis_status),
            'codedPhenotype': family.coded_phenotype,
            'mondoId': family.mondo_id,
        },
        'individuals': _get_individuals_context(individuals),
        'variants': variants,
    }, warnings
