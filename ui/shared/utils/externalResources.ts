import { GENOME_VERSION_37, GENOME_VERSION_38, getDecipherGeneLink } from './constants'

export type ResourceEntity = 'gene' | 'variant' | 'disease'

export interface ResourceUser {
  isAnalyst?: boolean
}

export interface ResourceGene {
  geneId: string
  geneSymbol: string
  geneNames?: string
  mimNumber?: number | string
  mgiMarkerId?: string
  gencodeGeneType?: string
  clinGen?: { href?: string }
}

export interface ResourceVariant {
  chrom: string
  pos: number
  end?: number
  endChrom?: string
  ref?: string
  alt?: string
  svType?: string
  genomeVersion?: string
  liftedOverGenomeVersion?: string
  liftedOverPos?: number
  CAID?: string
  rsid?: string
  hgvsc?: string
  genes: ResourceGene[]
  variations: string[]
}

export interface ResourceDisease {
  mimNumber: number | string
}

export interface ExternalResource<T> {
  key: string
  label: string
  entity: ResourceEntity
  description?: string
  frameable: boolean
  shouldShow?: (subject: T, user: ResourceUser) => boolean
  getUrl: (subject: T) => string
}

export interface ResourceLink {
  key: string
  label: string
  description?: string
  url: string
  frameable: boolean
}

export const getOtherGeneNames = (gene: ResourceGene): string[] => (
  (gene.geneNames || '').split(';').filter(name => name && name !== gene.geneSymbol)
)

const getGeneNames = (genes: ResourceGene[]): string[] => genes.reduce(
  (acc, gene) => [gene.geneSymbol, ...getOtherGeneNames(gene), ...acc], [],
)

const getLitSearch = (genes: ResourceGene[], variations: string[]): string => {
  const search = `(${getGeneNames(genes).join(' OR ')})`
  return variations.length ? `${search} AND (${variations.join(' OR ')})` : search
}

const getSvRegion = ({ chrom, endChrom, pos, end }: ResourceVariant, divider: string): string => {
  const endOffset = endChrom ? 0 : end - pos
  return `${chrom}${divider}${pos}-${pos + endOffset}`
}

export const has37Coords = (
  { genomeVersion, liftedOverGenomeVersion, liftedOverPos }: Partial<ResourceVariant>,
): boolean => genomeVersion === GENOME_VERSION_37 || (liftedOverGenomeVersion === GENOME_VERSION_37 && !!liftedOverPos)

const isMito = ({ chrom }: ResourceVariant) => chrom === 'M'
const hasMgi = (gene: ResourceGene) => !!gene.mgiMarkerId

export const getOmimEntryUrl = (mimNumber: number | string): string => `https://www.omim.org/entry/${mimNumber}`

type ResourceConfig<T> = Omit<ExternalResource<T>, 'entity'>

const withEntity = <T>(entity: ResourceEntity, resources: ResourceConfig<T>[]): ExternalResource<T>[] => (
  resources.map(resource => ({ ...resource, entity })))

const GENE_RESOURCE_CONFIGS: ResourceConfig<ResourceGene>[] = [
  {
    key: 'omim',
    label: 'OMIM',
    description: 'Database of Mendelian phenotypes',
    frameable: false,
    shouldShow: gene => !!gene.mimNumber,
    getUrl: gene => getOmimEntryUrl(gene.mimNumber),
  },
  {
    key: 'pubmed',
    label: 'PubMed',
    description: 'Search PubMed',
    frameable: false,
    getUrl: gene => `https://www.ncbi.nlm.nih.gov/pubmed/?term=(${[gene.geneSymbol, ...getOtherGeneNames(gene)].join(' OR ')})`,
  },
  {
    key: 'genecards',
    label: 'GeneCards',
    description: 'Reference of public data for this gene',
    frameable: false,
    getUrl: gene => `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene.geneId}`,
  },
  {
    key: 'proteinAtlas',
    label: 'Protein Atlas',
    description: 'Detailed protein and transcript expression',
    frameable: true,
    getUrl: gene => `https://www.proteinatlas.org/${gene.geneId}/tissue`,
  },
  {
    key: 'ncbiGene',
    label: 'NCBI Gene',
    description: 'NCBI\'s gene information resource',
    frameable: false,
    getUrl: gene => `https://www.ncbi.nlm.nih.gov/gene/?term=${gene.geneId}`,
  },
  {
    key: 'gtex',
    label: 'GTEx Portal',
    description: 'Reference of public data for this gene',
    frameable: true,
    getUrl: gene => `https://www.gtexportal.org/home/gene/${gene.geneId}`,
  },
  {
    key: 'monarch',
    label: 'Monarch',
    description: 'Cross-species gene and phenotype resource',
    frameable: true,
    getUrl: gene => `https://monarchinitiative.org/explore?search=${gene.geneSymbol}#search`,
  },
  {
    key: 'decipher',
    label: 'Decipher',
    description: 'DatabasE of genomiC varIation and Phenotype in Humans using Ensembl Resources',
    frameable: false,
    getUrl: gene => getDecipherGeneLink(gene),
  },
  {
    key: 'uniprot',
    label: 'UniProt',
    description: 'Protein sequence and functional information',
    frameable: true,
    getUrl: gene => `https://www.uniprot.org/uniprot?query=${gene.geneId}+AND(reviewed:true)+AND(organism_id:9606)`,
  },
  {
    key: 'geno2mp',
    label: 'Geno2MP',
    description: 'Genotype to Mendelian Phenotype',
    frameable: true,
    getUrl: gene => `https://geno2mp.gs.washington.edu/Geno2MP/#/gene/${gene.geneSymbol}/gene/0/0/0`,
  },
  {
    key: 'gnomad',
    label: 'gnomAD',
    description: 'Genome Aggregation Database',
    frameable: true,
    getUrl: gene => `https://gnomad.broadinstitute.org/gene/${gene.geneId}?dataset=gnomad_r4`,
  },
  {
    key: 'primad',
    label: 'primAD',
    description: 'Primate Genome Aggregation Database',
    frameable: false,
    getUrl: gene => `https://primad.basespace.illumina.com/gene/${gene.geneSymbol}`,
  },
  {
    key: 'mgi',
    label: 'MGI',
    description: 'Mouse Genome Informatics',
    frameable: true,
    shouldShow: hasMgi,
    getUrl: gene => `https://www.informatics.jax.org/marker/${gene.mgiMarkerId}`,
  },
  {
    key: 'impc',
    label: 'IMPC',
    description: 'International Mouse Phenotyping Consortium',
    frameable: false,
    shouldShow: hasMgi,
    getUrl: gene => `https://www.mousephenotype.org/data/genes/${gene.mgiMarkerId}`,
  },
  {
    key: 'kegg',
    label: 'KEGG',
    description: 'Pathway maps representing known molecular interaction',
    frameable: false,
    getUrl: gene => `https://www.kegg.jp/kegg-bin/search_pathway_text?keyword=${gene.geneSymbol}&viewImage=true`,
  },
  {
    key: 'clingen',
    label: 'ClinGen',
    description: 'ClinGen Dosage Sensitivity',
    frameable: false,
    shouldShow: gene => !!gene.clinGen,
    getUrl: gene => gene.clinGen.href,
  },
  {
    key: 'clinvar',
    label: 'ClinVar',
    description: 'Aggregated information about human genomic variation',
    frameable: false,
    getUrl: gene => `https://www.ncbi.nlm.nih.gov/clinvar?term=${gene.geneSymbol}[gene]`,
  },
  {
    key: 'hgmd',
    label: 'HGMD',
    description: 'Human Gene Mutation Database ',
    frameable: false,
    shouldShow: (gene, user) => !!user.isAnalyst,
    getUrl: gene => `https://my.qiagendigitalinsights.com/bbp/view/hgmd/pro/gene.php?gene=${gene.geneSymbol}`,
  },
]

export const GENE_RESOURCES = withEntity('gene', GENE_RESOURCE_CONFIGS)

const VARIANT_RESOURCE_CONFIGS: ResourceConfig<ResourceVariant>[] = [
  {
    key: 'gnomad',
    label: 'gnomAD',
    frameable: true,
    shouldShow: variant => !!variant.svType,
    getUrl: variant => `https://gnomad.broadinstitute.org/region/${getSvRegion(variant, '-')}?dataset=gnomad_sv_r4`,
  },
  {
    key: 'decipher',
    label: 'Decipher',
    frameable: false,
    shouldShow: ({ svType, genomeVersion }) => !!svType && genomeVersion === GENOME_VERSION_38,
    getUrl: variant => `https://www.deciphergenomics.org/search/patients/results?q=${getSvRegion(variant, ':')}`,
  },
  {
    key: 'mitomap',
    label: 'mitomap',
    frameable: false,
    shouldShow: variant => !variant.svType && isMito(variant),
    getUrl: () => 'https://www.mitomap.org/foswiki/bin/view/Main/SearchAllele',
  },
  {
    key: 'mitovisualize',
    label: 'Mitovisualize',
    frameable: false,
    shouldShow: variant => !variant.svType && isMito(variant) && variant.genes.some(
      ({ gencodeGeneType }) => gencodeGeneType === 'Mt-tRNA' || gencodeGeneType === 'Mt-rRNA',
    ),
    getUrl: ({ pos, ref, alt }) => `https://www.mitovisualize.org/variant/m-${pos}-${ref}-${alt}`,
  },
  {
    key: 'google',
    label: 'Google',
    frameable: false,
    shouldShow: ({ genes, variations }) => genes.length > 0 && variations.length > 0,
    getUrl: ({ genes, variations }) => `https://scholar.google.com/scholar?q=${getLitSearch(genes, variations).replaceAll('=', '')}`,
  },
  {
    key: 'pubmed',
    label: 'pubmed',
    frameable: false,
    shouldShow: ({ genes }) => genes.length > 0,
    getUrl: ({ genes, variations }) => `https://www.ncbi.nlm.nih.gov/pubmed?term=${getLitSearch(genes, variations)}`,
  },
  {
    key: 'aou',
    label: 'AoU',
    frameable: false,
    shouldShow: ({ svType }) => !svType,
    getUrl: ({ chrom, pos, ref, alt }) => `https://databrowser.researchallofus.org/variants/${chrom}-${pos}-${ref}-${alt}`,
  },
  {
    key: 'iranome',
    label: 'Iranome',
    frameable: false,
    shouldShow: variant => !variant.svType && !isMito(variant),
    getUrl: ({ chrom, pos, ref, alt }) => `https://www.iranome.com/variant/${chrom}-${pos}-${ref}-${alt}`,
  },
  {
    key: 'geno2mp',
    label: 'Geno2MP',
    frameable: true,
    shouldShow: variant => !variant.svType && !isMito(variant),
    getUrl: ({ chrom, pos }) => `https://geno2mp.gs.washington.edu/Geno2MP/#/gene/${chrom}:${pos}/chrLoc/${pos}/${pos}/${chrom}`,
  },
  {
    key: 'mastermind',
    label: 'Mastermind',
    frameable: false,
    shouldShow: ({ svType, hgvsc }) => !svType && !!hgvsc,
    getUrl: ({ genes, hgvsc }) => `https://mastermind.genomenon.com/detail?gene=${genes[0].geneSymbol}&mutation=${genes[0].geneSymbol}:${hgvsc}`,
  },
  {
    key: 'bch',
    label: 'BCH',
    frameable: false,
    shouldShow: (variant, user) => has37Coords(variant) && !!user.isAnalyst,
    getUrl: ({ chrom, pos, ref, alt, genomeVersion, liftedOverPos }) => (
      `https://aggregator.bchresearch.org/variant.html?variant=${chrom}:${genomeVersion === GENOME_VERSION_37 ? pos : liftedOverPos}:${ref}:${alt}`
    ),
  },
  {
    key: 'litvar2',
    label: 'LitVar2',
    frameable: true,
    shouldShow: ({ CAID, rsid }) => !!CAID && !!rsid,
    getUrl: ({ CAID, rsid }) => (
      `https://ncbi.nlm.nih.gov/research/litvar2/docsum?variant=litvar@${CAID}%23${rsid}%23%23&query=${CAID}`
    ),
  },
]

export const VARIANT_RESOURCES = withEntity('variant', VARIANT_RESOURCE_CONFIGS)

export const DISEASE_RESOURCES = withEntity<ResourceDisease>('disease', [
  {
    key: 'omim',
    label: 'OMIM',
    description: 'Database of Mendelian phenotypes',
    frameable: false,
    getUrl: ({ mimNumber }) => getOmimEntryUrl(mimNumber),
  },
])

const getResourceLinks = <T>(resources: ExternalResource<T>[], subject: T, user: ResourceUser): ResourceLink[] => (
  resources.filter(({ shouldShow }) => !shouldShow || shouldShow(subject, user || {})).map(
    ({ key, label, description, frameable, getUrl }) => ({ key, label, description, frameable, url: getUrl(subject) }),
  )
)

export const getGeneResourceLinks = (gene: ResourceGene, user: ResourceUser): ResourceLink[] => (
  getResourceLinks(GENE_RESOURCES, gene, user))

export const getVariantResourceLinks = (variant: ResourceVariant, user: ResourceUser): ResourceLink[] => (
  getResourceLinks(VARIANT_RESOURCES, variant, user))
