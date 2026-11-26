export const GENE_EVIDENCE_NAME = 'gene_evidence'
export const GENE_EVIDENCE_MATCH_FIELD = 'match'
export const GENE_EVIDENCE_MATCH_ANY = 'any'
export const GENE_EVIDENCE_MATCH_ALL = 'all'

export type GeneEvidence = Record<string, boolean | string | null | undefined> | null | undefined

type GeneEvidenceType = {
  name: string
  rnaDataType: string
  label: string
  labelHelp: string
}

type ProjectFamilies = {
  projectGuid?: string
  familyGuids?: string[] | null
}

type SearchFamily = {
  projectGuid?: string
  rnaDataTypes?: string[]
}

export const GENE_EVIDENCE_TYPES: GeneEvidenceType[] = [
  {
    name: 'rna_expression_outlier',
    rnaDataType: 'E',
    label: 'RNA Expression Outlier',
    labelHelp: 'Only return variants in genes that are significant RNA-seq expression outliers in the family',
  },
  {
    name: 'rna_splice_outlier',
    rnaDataType: 'S',
    label: 'RNA Splice Outlier',
    labelHelp: 'Only return variants in genes that have a significant RNA-seq splice outlier in the family',
  },
]

export const GENE_EVIDENCE_MATCH_OPTIONS = [
  { value: GENE_EVIDENCE_MATCH_ANY, text: 'Any selected evidence' },
  { value: GENE_EVIDENCE_MATCH_ALL, text: 'All selected evidence' },
]

export const selectedGeneEvidenceTypes = (geneEvidence: GeneEvidence): GeneEvidenceType[] => (
  GENE_EVIDENCE_TYPES.filter(({ name }) => (geneEvidence || {})[name] === true)
)

export const geneEvidenceSummary = (geneEvidence: GeneEvidence): string | null => {
  const labels = selectedGeneEvidenceTypes(geneEvidence).map(({ label }) => label)
  if (!geneEvidence || !labels.length) {
    return null
  }
  const isAll = geneEvidence[GENE_EVIDENCE_MATCH_FIELD] === GENE_EVIDENCE_MATCH_ALL
  return `In genes with ${labels.join(isAll ? ' and ' : ' or ')} evidence in the family`
}

export const searchedRnaDataTypes = (
  projectFamilies: ProjectFamilies[] | null | undefined, familiesByGuid: Record<string, SearchFamily>,
): string => {
  const rnaDataTypes = new Set<string>()
  ;(projectFamilies || []).forEach(({ projectGuid, familyGuids }) => {
    const families = familyGuids ? familyGuids.map(familyGuid => familiesByGuid[familyGuid]) :
      Object.values(familiesByGuid).filter(family => family.projectGuid === projectGuid)
    families.forEach(family => ((family || {}).rnaDataTypes || []).forEach(dataType => rnaDataTypes.add(dataType)))
  })
  return Array.from(rnaDataTypes).sort().join(',')
}

export const geneEvidenceFieldNames = (rnaDataTypes: string | null | undefined, geneEvidence: GeneEvidence): string[] => {
  const loadedDataTypes = (rnaDataTypes || '').split(',')
  const selectedNames = selectedGeneEvidenceTypes(geneEvidence).map(({ name }) => name)
  return GENE_EVIDENCE_TYPES.filter(
    ({ name, rnaDataType }) => loadedDataTypes.includes(rnaDataType) || selectedNames.includes(name),
  ).map(({ name }) => name)
}
