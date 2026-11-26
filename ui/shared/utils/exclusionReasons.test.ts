import {
  EXCLUSION_REASONS,
  NO_EXCLUSION_REASON,
  getExclusionReasonOptions,
  getExclusionReasonFilterOptions,
  matchesExclusionReason,
} from './exclusionReasons'

test('EXCLUSION_REASONS lists the standard reasons in review order', () => {
  expect(EXCLUSION_REASONS).toEqual([
    'Likely noise / artifact',
    'Poor quality data',
    'Inheritance does not fit',
    'Phenotype does not fit',
    'Too common in population',
    'Benign / likely benign evidence',
    'Other',
  ])
})

test('getExclusionReasonOptions returns only the standard reasons when there is no custom value', () => {
  const expected = EXCLUSION_REASONS.map(value => ({ value }))
  expect(getExclusionReasonOptions()).toEqual(expected)
  expect(getExclusionReasonOptions(null)).toEqual(expected)
  expect(getExclusionReasonOptions('')).toEqual(expected)
  expect(getExclusionReasonOptions('Poor quality data')).toEqual(expected)
})

test('getExclusionReasonOptions keeps an existing free-text reason selectable', () => {
  expect(getExclusionReasonOptions('seen in unaffected sib')).toEqual([
    ...EXCLUSION_REASONS.map(value => ({ value })),
    { value: 'seen in unaffected sib' },
  ])
  expect(getExclusionReasonOptions('seen in unaffected sib', 'Other', 'mosaic in parent', undefined)).toEqual([
    ...EXCLUSION_REASONS.map(value => ({ value })),
    { value: 'mosaic in parent' },
    { value: 'seen in unaffected sib' },
  ])
})

test('getExclusionReasonFilterOptions lists standard reasons, custom reasons in use and no-reason', () => {
  expect(getExclusionReasonFilterOptions([])).toEqual([
    { value: null, text: 'View All' },
    ...EXCLUSION_REASONS.map(value => ({ value })),
    { value: NO_EXCLUSION_REASON, text: 'No reason given' },
  ])

  expect(getExclusionReasonFilterOptions(
    ['seen in unaffected sib', 'Poor quality data', null, undefined, '', ' mosaic in parent ', 'seen in unaffected sib'],
  )).toEqual([
    { value: null, text: 'View All' },
    ...EXCLUSION_REASONS.map(value => ({ value })),
    { value: 'mosaic in parent' },
    { value: 'seen in unaffected sib' },
    { value: NO_EXCLUSION_REASON, text: 'No reason given' },
  ])
})

test('matchesExclusionReason', () => {
  expect(matchesExclusionReason('Poor quality data', 'Poor quality data')).toBe(true)
  expect(matchesExclusionReason(' Poor quality data ', 'Poor quality data')).toBe(true)
  expect(matchesExclusionReason('Poor quality data', 'Other')).toBe(false)
  expect(matchesExclusionReason('poor quality data', 'Poor quality data')).toBe(false)
  expect(matchesExclusionReason(null, 'Poor quality data')).toBe(false)
  expect(matchesExclusionReason(undefined, 'Poor quality data')).toBe(false)

  expect(matchesExclusionReason(null, NO_EXCLUSION_REASON)).toBe(true)
  expect(matchesExclusionReason(undefined, NO_EXCLUSION_REASON)).toBe(true)
  expect(matchesExclusionReason('', NO_EXCLUSION_REASON)).toBe(true)
  expect(matchesExclusionReason('  ', NO_EXCLUSION_REASON)).toBe(true)
  expect(matchesExclusionReason('Other', NO_EXCLUSION_REASON)).toBe(false)
})
