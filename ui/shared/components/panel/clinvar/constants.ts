export type ClinvarMode = 'dry_run' | 'test' | 'live'

export type ClinvarResult = { ok: boolean, message: string, errors?: string[] }

export type ClinvarSubmission = {
  submissionGuid: string | null
  status: string | null
  recordStatus: string
  variantGuid: string | null
  variantId?: string | null
  projectGuid?: string | null
  classification: string | null
  conditionId: string | null
  modeOfInheritance: string | null
  collectionMethod: string | null
  affectedStatus: string | null
  alleleOrigin: string | null
  citations: string[]
  payload: Record<string, unknown> | null
  validationErrors: string[]
  scvAccession?: string | null
  ncbiSubmissionId?: string | null
  response?: Record<string, ClinvarResult> | null
  createdBy?: string | null
  lastEditedBy?: string | null
  reviewedBy?: string | null
  reviewedDate?: string | null
  submittedBy?: string | null
  submittedDate?: string | null
  withdrawalRequestedBy?: string | null
  lastModifiedDate?: string | null
}

export const MODE_BANNERS: Record<ClinvarMode, { header: string, content: string, color: 'blue' | 'orange' | 'red' }> = {
  dry_run: {
    header: 'DRY RUN — nothing is sent to ClinVar',
    content: 'Records are drafted, reviewed and validated here, but this seqr installation cannot submit them.',
    color: 'blue',
  },
  test: {
    header: 'TEST MODE — records are sent to the ClinVar test endpoint only',
    content: 'ClinVar validates test submissions but never makes them public.',
    color: 'orange',
  },
  live: {
    header: 'LIVE — approved records are published in ClinVar',
    content: 'Submitting publishes the classification publicly under your organisation\'s name.',
    color: 'red',
  },
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  dry_run_passed: 'Dry run passed',
  submitted: 'Submitted',
  processed: 'Processed',
  error: 'Error',
  withdrawn: 'Withdrawn',
}

export const NOT_SAVED_LABEL = 'Not saved'

export const formatDate = (date?: string | null): string => (date ? new Date(date).toLocaleDateString() : '')
