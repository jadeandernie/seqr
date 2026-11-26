import fs from 'fs'
import path from 'path'

import {
  GENE_RESOURCES, VARIANT_RESOURCES, DISEASE_RESOURCES, getGeneResourceLinks, getVariantResourceLinks,
  getOtherGeneNames, has37Coords, ResourceLink,
} from './externalResources'

const GENE = {
  geneId: 'ENSG00000155657',
  geneSymbol: 'TTN',
  geneNames: 'TTN;CMD1G;TMD',
  mimNumber: 188840,
  mgiMarkerId: 'MGI:98864',
  clinGen: { href: 'https://dosage.clinicalgenome.org/clingen_gene.cgi?sym=TTN&subject=' },
}

const SNV = {
  chrom: '2',
  pos: 179400000,
  ref: 'C',
  alt: 'T',
  genomeVersion: '38',
  liftedOverGenomeVersion: '37',
  liftedOverPos: 179500000,
  CAID: 'CA123',
  rsid: 'rs456',
  hgvsc: '1282C>T',
  genes: [GENE],
  variations: ['c.1282C>T', 'p.Arg428=Ter'],
}

const SV = { chrom: '2', pos: 1000, end: 5000, svType: 'DEL', genomeVersion: '38', genes: [GENE], variations: [] as string[] }

const MITO = {
  chrom: 'M', pos: 3243, ref: 'A', alt: 'G', genomeVersion: '38', genes: [{ ...GENE, gencodeGeneType: 'Mt-tRNA' }], variations: [] as string[],
}

const byKey = (links: ResourceLink[]) => Object.fromEntries(links.map(({ key, url }) => [key, url]))

test('gene links keep their order and build https URLs', () => {
  const links = getGeneResourceLinks(GENE, { isAnalyst: true })
  expect(links.map(({ label }) => label)).toEqual([
    'OMIM', 'PubMed', 'GeneCards', 'Protein Atlas', 'NCBI Gene', 'GTEx Portal', 'Monarch', 'Decipher', 'UniProt',
    'Geno2MP', 'gnomAD', 'primAD', 'MGI', 'IMPC', 'KEGG', 'ClinGen', 'ClinVar', 'HGMD',
  ])
  expect(byKey(links)).toEqual({
    omim: 'https://www.omim.org/entry/188840',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed/?term=(TTN OR CMD1G OR TMD)',
    genecards: 'https://www.genecards.org/cgi-bin/carddisp.pl?gene=ENSG00000155657',
    proteinAtlas: 'https://www.proteinatlas.org/ENSG00000155657/tissue',
    ncbiGene: 'https://www.ncbi.nlm.nih.gov/gene/?term=ENSG00000155657',
    gtex: 'https://www.gtexportal.org/home/gene/ENSG00000155657',
    monarch: 'https://monarchinitiative.org/explore?search=TTN#search',
    decipher: 'https://www.deciphergenomics.org/gene/ENSG00000155657/overview/protein-genomic-info',
    uniprot: 'https://www.uniprot.org/uniprot?query=ENSG00000155657+AND(reviewed:true)+AND(organism_id:9606)',
    geno2mp: 'https://geno2mp.gs.washington.edu/Geno2MP/#/gene/TTN/gene/0/0/0',
    gnomad: 'https://gnomad.broadinstitute.org/gene/ENSG00000155657?dataset=gnomad_r4',
    primad: 'https://primad.basespace.illumina.com/gene/TTN',
    mgi: 'https://www.informatics.jax.org/marker/MGI:98864',
    impc: 'https://www.mousephenotype.org/data/genes/MGI:98864',
    kegg: 'https://www.kegg.jp/kegg-bin/search_pathway_text?keyword=TTN&viewImage=true',
    clingen: 'https://dosage.clinicalgenome.org/clingen_gene.cgi?sym=TTN&subject=',
    clinvar: 'https://www.ncbi.nlm.nih.gov/clinvar?term=TTN[gene]',
    hgmd: 'https://my.qiagendigitalinsights.com/bbp/view/hgmd/pro/gene.php?gene=TTN',
  })
  expect(links.filter(({ frameable }) => frameable).map(({ key }) => key)).toEqual(
    ['proteinAtlas', 'gtex', 'monarch', 'uniprot', 'geno2mp', 'gnomad', 'mgi'],
  )
})

test('gene links omit resources without data or permission', () => {
  const links = getGeneResourceLinks({ geneId: 'ENSG00000155657', geneSymbol: 'TTN' }, {})
  expect(links.map(({ key }) => key)).toEqual([
    'pubmed', 'genecards', 'proteinAtlas', 'ncbiGene', 'gtex', 'monarch', 'decipher', 'uniprot', 'geno2mp', 'gnomad',
    'primad', 'kegg', 'clinvar',
  ])
  expect(byKey(links).pubmed).toEqual('https://www.ncbi.nlm.nih.gov/pubmed/?term=(TTN)')
  expect(getGeneResourceLinks({ geneId: 'ENSG00000155657', geneSymbol: 'TTN' }, undefined)).toEqual(links)
})

test('SNV links', () => {
  expect(byKey(getVariantResourceLinks(SNV, { isAnalyst: true }))).toEqual({
    google: 'https://scholar.google.com/scholar?q=(TTN OR CMD1G OR TMD) AND (c.1282C>T OR p.Arg428Ter)',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed?term=(TTN OR CMD1G OR TMD) AND (c.1282C>T OR p.Arg428=Ter)',
    aou: 'https://databrowser.researchallofus.org/variants/2-179400000-C-T',
    iranome: 'https://www.iranome.com/variant/2-179400000-C-T',
    geno2mp: 'https://geno2mp.gs.washington.edu/Geno2MP/#/gene/2:179400000/chrLoc/179400000/179400000/2',
    mastermind: 'https://mastermind.genomenon.com/detail?gene=TTN&mutation=TTN:1282C>T',
    bch: 'https://aggregator.bchresearch.org/variant.html?variant=2:179500000:C:T',
    litvar2: 'https://ncbi.nlm.nih.gov/research/litvar2/docsum?variant=litvar@CA123%23rs456%23%23&query=CA123',
  })
})

test('SNV links depend on genome build, user and available annotations', () => {
  const grch37 = { ...SNV, genomeVersion: '37', liftedOverGenomeVersion: '38' }
  expect(byKey(getVariantResourceLinks(grch37, { isAnalyst: true })).bch).toEqual(
    'https://aggregator.bchresearch.org/variant.html?variant=2:179400000:C:T',
  )
  expect(getVariantResourceLinks(SNV, {}).map(({ key }) => key)).not.toContain('bch')
  expect(getVariantResourceLinks({ ...SNV, liftedOverPos: undefined }, { isAnalyst: true }).map(({ key }) => key))
    .not.toContain('bch')

  const bare = { ...SNV, CAID: undefined as string, hgvsc: undefined as string, genes: [] as typeof SNV.genes }
  expect(getVariantResourceLinks(bare, {}).map(({ key }) => key)).toEqual(['aou', 'iranome', 'geno2mp'])

  expect(byKey(getVariantResourceLinks({ ...SNV, variations: [] }, {})).pubmed).toEqual(
    'https://www.ncbi.nlm.nih.gov/pubmed?term=(TTN OR CMD1G OR TMD)',
  )
})

test('SV links', () => {
  expect(byKey(getVariantResourceLinks(SV, {}))).toEqual({
    gnomad: 'https://gnomad.broadinstitute.org/region/2-1000-5000?dataset=gnomad_sv_r4',
    decipher: 'https://www.deciphergenomics.org/search/patients/results?q=2:1000-5000',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed?term=(TTN OR CMD1G OR TMD)',
  })
  expect(byKey(getVariantResourceLinks({ ...SV, genomeVersion: '37', endChrom: '3' }, {}))).toEqual({
    gnomad: 'https://gnomad.broadinstitute.org/region/2-1000-1000?dataset=gnomad_sv_r4',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed?term=(TTN OR CMD1G OR TMD)',
  })
})

test('mitochondrial links', () => {
  expect(byKey(getVariantResourceLinks(MITO, {}))).toEqual({
    mitomap: 'https://www.mitomap.org/foswiki/bin/view/Main/SearchAllele',
    mitovisualize: 'https://www.mitovisualize.org/variant/m-3243-A-G',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed?term=(TTN OR CMD1G OR TMD)',
    aou: 'https://databrowser.researchallofus.org/variants/M-3243-A-G',
  })
  expect(getVariantResourceLinks({ ...MITO, genes: [GENE] }, {}).map(({ key }) => key)).not.toContain('mitovisualize')
})

test('disease links', () => {
  expect(DISEASE_RESOURCES.map(({ getUrl }) => getUrl({ mimNumber: 604145 }))).toEqual(
    ['https://www.omim.org/entry/604145'],
  )
})

test('resources are well formed', () => {
  const groups = { gene: GENE_RESOURCES, variant: VARIANT_RESOURCES, disease: DISEASE_RESOURCES }
  Object.entries(groups).forEach(([entity, resources]) => {
    expect(resources.every(resource => resource.entity === entity)).toBe(true)
    expect(new Set(resources.map(({ key }) => key)).size).toEqual(resources.length)
  })
})

test('helpers', () => {
  expect(getOtherGeneNames(GENE)).toEqual(['CMD1G', 'TMD'])
  expect(getOtherGeneNames({ geneId: 'ENSG1', geneSymbol: 'A' })).toEqual([])
  expect(has37Coords({ genomeVersion: '37' })).toBe(true)
  expect(has37Coords({ genomeVersion: '38', liftedOverGenomeVersion: '37', liftedOverPos: 5 })).toBe(true)
  expect(has37Coords({ genomeVersion: '38', liftedOverGenomeVersion: '37' })).toBe(false)
})

test('frameable origins match the CSP frame-src allow-list in settings.py', () => {
  const allLinks = [
    ...getGeneResourceLinks(GENE, { isAnalyst: true }),
    ...getVariantResourceLinks(SNV, { isAnalyst: true }),
    ...getVariantResourceLinks(SV, { isAnalyst: true }),
    ...getVariantResourceLinks(MITO, { isAnalyst: true }),
    ...DISEASE_RESOURCES.map(({ frameable, getUrl }) => ({ frameable, url: getUrl({ mimNumber: 1 }) })),
  ]
  const frameableOrigins = new Set(allLinks.filter(({ frameable }) => frameable).map(({ url }) => new URL(url).origin))

  const settings = fs.readFileSync(path.resolve(__dirname, '../../../settings.py'), 'utf8')
  const frameSrc = settings.match(/^CSP_FRAME_SRC = \(([^)]*)\)/m)[1]
  const cspOrigins = frameSrc.match(/'[^']+'|"[^"]+"/g).map(source => source.slice(1, -1)).filter(
    source => source !== "'self'",
  )

  expect(cspOrigins.sort()).toEqual([...frameableOrigins].sort())
})
