import {
  COMPLETENESS_FAMILY_FILTERS,
  createCompletenessSortKeyGetter,
  getCompletenessByFamily,
  getFamilyCompleteness,
  getProjectCompleteness,
  hasFamilyCompletenessUpdate,
} from './completeness'

const FEATURES_ITEM = { field: 'features', label: 'Observed features (HPO terms)', weight: 30, level: 'individual' }
const ONSET_ITEM = { field: 'onsetAge', label: 'Age of onset', weight: 10, level: 'individual' }

const COMPLETE = { completeness: { score: 100, missing: [] as typeof FEATURES_ITEM[] } }
const NO_FEATURES = { completeness: { score: 70, missing: [FEATURES_ITEM] } }
const NO_ONSET = { completeness: { score: 85, missing: [ONSET_ITEM] } }
const UNAFFECTED = { completeness: null as null }

const SERVER_SUMMARY = { score: 12, numIndividuals: 3, numNoFeatures: 2 }

const INDIVIDUALS_BY_GUID = { I1: COMPLETE, I2: NO_FEATURES, I3: UNAFFECTED, I4: NO_ONSET, I5: UNAFFECTED }
const FAMILIES_BY_GUID = {
  F1: { familyGuid: 'F1', individualGuids: ['I1', 'I3'], completeness: SERVER_SUMMARY },
  F2: { familyGuid: 'F2', individualGuids: ['I2', 'I4'] },
  F3: { familyGuid: 'F3', individualGuids: ['I5'] },
  F4: { familyGuid: 'F4', individualGuids: ['I6', 'I1'], completeness: SERVER_SUMMARY },
  F5: { familyGuid: 'F5', individualGuids: [] as string[] },
  F6: { familyGuid: 'F6' },
}

describe('getFamilyCompleteness', () => {
  test('averages the scores of loaded affected individuals', () => {
    expect(getFamilyCompleteness({}, [COMPLETE, UNAFFECTED])).toEqual(
      { score: 100, numIndividuals: 1, numNoFeatures: 0 },
    )
    expect(getFamilyCompleteness({ completeness: SERVER_SUMMARY }, [COMPLETE, NO_FEATURES, NO_ONSET, NO_FEATURES])).toEqual(
      { score: 81, numIndividuals: 4, numNoFeatures: 2 },
    )
  })

  test('rounds half scores up, as the server does', () => {
    expect(getFamilyCompleteness({}, [NO_FEATURES, NO_ONSET]).score).toEqual(78)
  })

  test('does not score families with no affected individuals', () => {
    expect(getFamilyCompleteness({ completeness: SERVER_SUMMARY }, [UNAFFECTED, {}])).toBeNull()
  })

  test('falls back to the family roll-up from the server until all individuals are loaded', () => {
    expect(getFamilyCompleteness({ completeness: SERVER_SUMMARY }, [])).toEqual(SERVER_SUMMARY)
    expect(getFamilyCompleteness({ completeness: SERVER_SUMMARY })).toEqual(SERVER_SUMMARY)
    expect(getFamilyCompleteness({ completeness: SERVER_SUMMARY }, [COMPLETE, undefined])).toEqual(SERVER_SUMMARY)
    expect(getFamilyCompleteness({ completeness: null }, [])).toBeNull()
    expect(getFamilyCompleteness({}, [undefined])).toBeNull()
  })
})

test('getCompletenessByFamily scores every family', () => {
  expect(getCompletenessByFamily(FAMILIES_BY_GUID, INDIVIDUALS_BY_GUID)).toEqual({
    F1: { score: 100, numIndividuals: 1, numNoFeatures: 0 },
    F2: { score: 78, numIndividuals: 2, numNoFeatures: 1 },
    F3: null,
    F4: SERVER_SUMMARY,
    F5: null,
    F6: null,
  })
  expect(getCompletenessByFamily({}, INDIVIDUALS_BY_GUID)).toEqual({})
})

describe('getProjectCompleteness', () => {
  test('weights each family by its number of affected individuals', () => {
    const { F1, F2, F3, F4, F5 } = FAMILIES_BY_GUID
    expect(getProjectCompleteness([F1, F2, F3, F5], INDIVIDUALS_BY_GUID)).toEqual(
      { score: 85, numIndividuals: 3, numNoFeatures: 1 },
    )
    // (100 * 1 + 78 * 2 + 12 * 3) / 6
    expect(getProjectCompleteness([F1, F2, F3, F4], INDIVIDUALS_BY_GUID)).toEqual(
      { score: 49, numIndividuals: 6, numNoFeatures: 3 },
    )
  })

  test('uses the family roll-ups from the server before individuals are loaded', () => {
    const { F1, F2, F4 } = FAMILIES_BY_GUID
    expect(getProjectCompleteness([F1, F2, F4], {})).toEqual({ score: 12, numIndividuals: 6, numNoFeatures: 4 })
  })

  test('is not scored without affected individuals', () => {
    expect(getProjectCompleteness([], INDIVIDUALS_BY_GUID)).toBeNull()
    expect(getProjectCompleteness([FAMILIES_BY_GUID.F3, FAMILIES_BY_GUID.F5], INDIVIDUALS_BY_GUID)).toBeNull()
  })
})

test('createCompletenessSortKeyGetter orders families from least to most complete, with unscored families last', () => {
  const getSortKey = createCompletenessSortKeyGetter(INDIVIDUALS_BY_GUID)
  const lowScoreFamily = { familyGuid: 'F7', individualGuids: [] as string[], completeness: { ...SERVER_SUMMARY, score: 9 } }
  const families = [...Object.values(FAMILIES_BY_GUID), lowScoreFamily]
  expect(families.map(getSortKey)).toEqual(['100', '078', 'unscored', '012', 'unscored', 'unscored', '009'])
  expect(
    families.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b))).map(({ familyGuid }) => familyGuid),
  ).toEqual(['F7', 'F4', 'F2', 'F1', 'F3', 'F5', 'F6'])
})

describe('COMPLETENESS_FAMILY_FILTERS', () => {
  const FAMILIES = [
    { familyGuid: 'complete', individuals: [COMPLETE, UNAFFECTED] },
    { familyGuid: 'noFeatures', individuals: [NO_FEATURES, COMPLETE] },
    { familyGuid: 'noOnset', individuals: [NO_ONSET] },
    { familyGuid: 'unaffected', individuals: [UNAFFECTED] },
    { familyGuid: 'notLoadedLow', individuals: [undefined] as undefined[], completeness: SERVER_SUMMARY },
    { familyGuid: 'notLoadedComplete', completeness: { score: 100, numIndividuals: 1, numNoFeatures: 0 } },
    { familyGuid: 'empty', individuals: [] as undefined[] },
  ]

  const passingFamilies = (value: string) => {
    const { createFilter } = COMPLETENESS_FAMILY_FILTERS.find(filter => filter.value === value)
    return FAMILIES.filter(createFilter).map(({ familyGuid }) => familyGuid)
  }

  test('have unique values and a shared category', () => {
    expect(COMPLETENESS_FAMILY_FILTERS.map(({ value, name, category }) => ({ value, name, category }))).toEqual([
      { value: 'SHOW_CLINICAL_DATA_COMPLETE', name: 'Fully Complete', category: 'Clinical Data Completeness' },
      { value: 'SHOW_CLINICAL_DATA_INCOMPLETE', name: 'Incomplete', category: 'Clinical Data Completeness' },
      {
        value: 'SHOW_CLINICAL_DATA_UNDER_HALF',
        name: 'Less Than 50% Complete',
        category: 'Clinical Data Completeness',
      },
      {
        value: 'SHOW_CLINICAL_DATA_NO_FEATURES',
        name: 'Affected Individuals Without HPO Terms',
        category: 'Clinical Data Completeness',
      },
    ])
  })

  test('filter scored families and never match families with no affected individuals', () => {
    expect(passingFamilies('SHOW_CLINICAL_DATA_COMPLETE')).toEqual(['complete', 'notLoadedComplete'])
    expect(passingFamilies('SHOW_CLINICAL_DATA_INCOMPLETE')).toEqual(['noFeatures', 'noOnset', 'notLoadedLow'])
    expect(passingFamilies('SHOW_CLINICAL_DATA_UNDER_HALF')).toEqual(['notLoadedLow'])
    expect(passingFamilies('SHOW_CLINICAL_DATA_NO_FEATURES')).toEqual(['noFeatures', 'notLoadedLow'])
  })
})

test('hasFamilyCompletenessUpdate detects changes to the scored family fields only', () => {
  const family = { codedPhenotype: 'myopathy', mondoId: null as string, description: 'A family' }
  expect(hasFamilyCompletenessUpdate(family, { ...family })).toBe(false)
  expect(hasFamilyCompletenessUpdate(family, { ...family, description: 'Updated' })).toBe(false)
  expect(hasFamilyCompletenessUpdate(family, { ...family, mondoId: '' })).toBe(false)
  expect(hasFamilyCompletenessUpdate(family, { analysisStatus: 'Q' })).toBe(false)
  expect(hasFamilyCompletenessUpdate(family, { ...family, mondoId: 'MONDO:0044970' })).toBe(true)
  expect(hasFamilyCompletenessUpdate(family, { ...family, codedPhenotype: '' })).toBe(true)
  expect(hasFamilyCompletenessUpdate(family, { codedPhenotype: 'dystrophy' })).toBe(true)
  expect(hasFamilyCompletenessUpdate({}, { codedPhenotype: 'dystrophy' })).toBe(true)
})
