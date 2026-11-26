export type KnownVariantCheck = {
  checkGuid: string
  genomeVersion: string
  datasetType: string
  variantId: string
  geneIds: string[]
  geneNames: string[]
  verdict: string
  pubmedId: string | null
  clinvarAccession: string | null
  isGlobal: boolean
  isActive: boolean
  createdDate: string
  createdBy: string | null
  sourceProjectGuid: string | null
  sourceProjectName: string | null
  canEdit: boolean
  numMatches: number
  numNewMatches: number
}

export type KnownVariantMatch = {
  matchGuid: string
  familyGuid: string
  projectGuid: string
  status: string
  firstSeen: string
  reviewedBy: string | null
  savedVariantGuid: string | null
  genomeVersion: string
  datasetType: string
  variantId: string
  geneIds: string[]
  geneNames: string[]
  verdict: string
  pubmedId: string | null
  clinvarAccession: string | null
  createdBy: string | null
  sourceProjectName: string | null
}

export type CheckFormValues = {
  verdict?: string
  pubmedId?: string
  clinvarAccession?: string
  isGlobal?: boolean
  genomeVersion?: string
  datasetType?: string
  variantId?: string
}

export const VERDICT_OPTIONS = [
  { value: 'C', text: 'Confirmed causal', color: 'red' },
  { value: 'S', text: 'Suspected, confirmed on follow-up', color: 'orange' },
  { value: 'R', text: 'Suspected, refuted on follow-up', color: 'blue' },
  { value: 'B', text: 'Benign or artefact (expected noise)', color: 'grey' },
] as const

export const MATCH_STATUS_NEW = 'N'
export const MATCH_STATUS_RELEVANT = 'R'
export const MATCH_STATUS_DISMISSED = 'D'
export const MATCH_STATUS_LABELS: Record<string, string> = {
  [MATCH_STATUS_NEW]: 'New',
  [MATCH_STATUS_RELEVANT]: 'Reviewed: relevant',
  [MATCH_STATUS_DISMISSED]: 'Dismissed',
}

export const KNOWN_VARIANT_GENOME_VERSION_OPTIONS = [
  { value: '38', text: 'GRCh38' },
  { value: '37', text: 'GRCh37' },
]
export const KNOWN_VARIANT_DATASET_TYPE_OPTIONS = [
  { value: 'SNV_INDEL', text: 'SNV / indel' },
  { value: 'MITO', text: 'Mitochondrial (GRCh38 only)' },
]

const PUBMED_ID_REGEX = /^[1-9][0-9]{0,8}$/
const CLINVAR_ACCESSION_REGEX = /^(VCV|RCV|SCV)[0-9]{9}(\.[0-9]{1,3})?$/

export const getPubmedUrl = (pubmedId?: string | null): string | null => (
  pubmedId && PUBMED_ID_REGEX.test(pubmedId) ? `https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/` : null
)

export const getClinvarUrl = (clinvarAccession?: string | null): string | null => (
  clinvarAccession && CLINVAR_ACCESSION_REGEX.test(clinvarAccession) ?
    `https://www.ncbi.nlm.nih.gov/clinvar/?term=${clinvarAccession}` : null
)

export const getMatchVariantPath = (match: KnownVariantMatch): string => (
  match.savedVariantGuid ?
    `/project/${match.projectGuid}/saved_variants/variant/${match.savedVariantGuid}` :
    `/variant_search/variant/${match.variantId}/family/${match.familyGuid}`
)

export const getRequestErrors = (exception: unknown): string[] => {
  const { body, message } = (exception || {}) as { body?: { errors?: string[] }, message?: string }
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    return body.errors
  }
  return [message || 'An unknown error occurred']
}
