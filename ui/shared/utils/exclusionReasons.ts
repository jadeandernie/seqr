export const EXCLUSION_REASON_METADATA_TITLE = 'Reason'

export const EXCLUSION_REASONS = [
  'Likely noise / artifact',
  'Poor quality data',
  'Inheritance does not fit',
  'Phenotype does not fit',
  'Too common in population',
  'Benign / likely benign evidence',
  'Other',
]

export const NO_EXCLUSION_REASON = 'NO_EXCLUSION_REASON'

type Reason = string | null | undefined

type ReasonOption = { value: string | null, text?: string }

const STANDARD_REASON_OPTIONS: ReasonOption[] = EXCLUSION_REASONS.map(value => ({ value }))

const normalizeReason = (reason: Reason): string => (reason || '').trim()

const customReasons = (reasons: Reason[]): string[] => [...new Set(reasons.map(normalizeReason))].filter(
  reason => reason && !EXCLUSION_REASONS.includes(reason),
).sort((a, b) => a.localeCompare(b))

export const getExclusionReasonOptions = (...currentReasons: Reason[]): ReasonOption[] => [
  ...STANDARD_REASON_OPTIONS,
  ...customReasons(currentReasons).map(value => ({ value })),
]

export const getExclusionReasonFilterOptions = (reasonsInUse: Reason[]): ReasonOption[] => [
  { value: null, text: 'View All' },
  ...STANDARD_REASON_OPTIONS,
  ...customReasons(reasonsInUse).map(value => ({ value })),
  { value: NO_EXCLUSION_REASON, text: 'No reason given' },
]

export const matchesExclusionReason = (reason: Reason, selectedReason: string): boolean => (
  selectedReason === NO_EXCLUSION_REASON ? !normalizeReason(reason) : normalizeReason(reason) === selectedReason
)
