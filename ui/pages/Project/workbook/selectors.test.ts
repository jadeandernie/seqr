import {
  DE_NOVO_WORKSHEET, FAMILY_TARGET, FAMILY_TARGET_GUID, GROUP_SUMMARY, GROUP_TARGET, GROUP_TARGET_GUID, OTHER_WORKBOOK,
  PERMISSIVE_QUERY, PERMISSIVE_QUERY_GUID, QUERY_RESULT, RECESSIVE_QUERY, RECESSIVE_QUERY_GUID, RECESSIVE_WORKSHEET,
  RESTRICTIVE_QUERY, RESTRICTIVE_QUERY_GUID, SAVED_SEARCH_GUID, STATE as FIXTURE_STATE, WORKBOOK, WORKBOOK_GUID,
} from './fixtures'
import {
  getCellGroupSummary, getCellHistory, getExcludedReasonsByFamilyVariant, getFamiliesByGuid, getGenesById,
  getGroupSummaryIsLoading, getNumUnreviewed, getNumUnreviewedByTarget, splitExcludedVariants,
  getProjectAnalysisGroupOptions, getProjectFamilyOptions, getProjectWorkbooks, getQueryResultsByQueryTarget,
  getQueryStatus, getRollUpStatus, getSavedSearchOptions, getTargetName, getWorkbook, getWorkbookDetailIsLoading,
  getWorkbookDetailLoadingError, getWorkbookPath, getWorkbookSelection, getWorkbooksIsLoading,
  getWorkbooksLoadingError, getWorkbookTargets, getWorkbookWorksheets, splitTargetTabs,
} from './selectors'
import { TargetDisplay, WorkbookReduxState } from './types'

const STATE = {
  ...FIXTURE_STATE,
  workbooksLoading: { isLoading: true, errorMessage: 'List error' },
  workbookDetailLoading: { isLoading: false, errorMessage: 'Detail error' },
} as unknown as WorkbookReduxState

const PROPS = { workbookGuid: WORKBOOK_GUID }

const FAMILY_TARGET_DISPLAY: TargetDisplay = { ...FAMILY_TARGET, name: '1', isGroup: false }
const GROUP_TARGET_DISPLAY: TargetDisplay = { ...GROUP_TARGET, name: 'Test Group', isGroup: true }
const TARGETS = [FAMILY_TARGET_DISPLAY, GROUP_TARGET_DISPLAY]
const WORKSHEETS = [
  { ...DE_NOVO_WORKSHEET, queries: [RESTRICTIVE_QUERY, PERMISSIVE_QUERY] },
  { ...RECESSIVE_WORKSHEET, queries: [RECESSIVE_QUERY] },
]

test('loading selectors', () => {
  expect(getWorkbooksIsLoading(STATE)).toBe(true)
  expect(getWorkbooksLoadingError(STATE)).toEqual('List error')
  expect(getWorkbookDetailIsLoading(STATE)).toBe(false)
  expect(getWorkbookDetailLoadingError(STATE)).toEqual('Detail error')
})

test('getProjectWorkbooks returns the workbooks of the current project sorted by name', () => {
  const state = {
    ...STATE,
    workbooksByGuid: {
      [WORKBOOK_GUID]: WORKBOOK,
      WB0000002_exomes: OTHER_WORKBOOK,
      WB0000003_other: { ...WORKBOOK, workbookGuid: 'WB0000003_other', projectGuid: 'R0002_other' },
    },
  }

  expect(getProjectWorkbooks(state)).toEqual([OTHER_WORKBOOK, WORKBOOK])
})

test('getWorkbook', () => {
  expect(getWorkbook(STATE, PROPS)).toEqual(WORKBOOK)
  expect(getWorkbook(STATE, { workbookGuid: 'WB_missing' })).toBeUndefined()
})

test('target options are limited to the families and static analysis groups of the current project', () => {
  const state = {
    ...STATE,
    familiesByGuid: {
      ...STATE.familiesByGuid,
      F000001_other: { familyGuid: 'F000001_other', displayName: 'Other', projectGuid: 'R0002_other' },
      F011652_3: { familyGuid: 'F011652_3', projectGuid: 'R0237_1000_genomes_demo' },
    },
    analysisGroupsByGuid: {
      ...STATE.analysisGroupsByGuid,
      AG0000002_other: { name: 'Other project group', projectGuid: 'R0002_other' },
      DAG0000001_dynamic: { name: 'Dynamic', projectGuid: 'R0237_1000_genomes_demo', criteria: { analysisStatus: ['Q'] } },
      DAG0000002_all: { name: 'All projects', projectGuid: null as string, criteria: {} },
    },
  }

  expect(getProjectFamilyOptions(state)).toEqual([
    { value: 'F011652_1', text: '1' }, { value: 'F011652_2', text: '2' }, { value: 'F011652_3', text: 'F011652_3' },
  ])
  expect(getProjectAnalysisGroupOptions(state)).toEqual([{ value: 'AG0000183_test_group', text: 'Test Group' }])
})

test('getSavedSearchOptions returns the saved searches sorted by name', () => {
  const state = {
    ...STATE,
    savedSearchesByGuid: {
      ...STATE.savedSearchesByGuid, VS0000001_a: { savedSearchGuid: 'VS0000001_a', name: 'A search' },
    },
  }

  expect(getSavedSearchOptions(state)).toEqual([
    { value: 'VS0000001_a', text: 'A search' }, { value: SAVED_SEARCH_GUID, text: 'De Novo/Dominant Restrictive' },
  ])
})

test('getTargetName falls back to the guid until the family or analysis group is loaded', () => {
  expect(getTargetName(FAMILY_TARGET, STATE.familiesByGuid, STATE.analysisGroupsByGuid)).toEqual('1')
  expect(getTargetName(GROUP_TARGET, STATE.familiesByGuid, STATE.analysisGroupsByGuid)).toEqual('Test Group')
  expect(getTargetName(FAMILY_TARGET, {}, {})).toEqual('F011652_1')
  expect(getTargetName(GROUP_TARGET, {}, {})).toEqual('AG0000183_test_group')
})

test('getWorkbookTargets returns the named targets of the workbook in order', () => {
  const state = {
    ...STATE,
    workbookTargetsByGuid: {
      [GROUP_TARGET_GUID]: GROUP_TARGET,
      [FAMILY_TARGET_GUID]: FAMILY_TARGET,
      WBT0000009_other: { ...FAMILY_TARGET, workbookTargetGuid: 'WBT0000009_other', workbookGuid: 'WB0000002_exomes' },
    },
  }

  expect(getWorkbookTargets(state, PROPS)).toEqual(TARGETS)
})

test('getWorkbookWorksheets returns the worksheets of the workbook with their queries in order', () => {
  const state = {
    ...STATE,
    worksheetsByGuid: {
      [RECESSIVE_WORKSHEET.worksheetGuid]: RECESSIVE_WORKSHEET,
      [DE_NOVO_WORKSHEET.worksheetGuid]: DE_NOVO_WORKSHEET,
      WS0000009_other: { ...DE_NOVO_WORKSHEET, worksheetGuid: 'WS0000009_other', workbookGuid: 'WB0000002_exomes' },
    },
    worksheetQueriesByGuid: {
      [PERMISSIVE_QUERY_GUID]: PERMISSIVE_QUERY,
      [RECESSIVE_QUERY_GUID]: RECESSIVE_QUERY,
      [RESTRICTIVE_QUERY_GUID]: RESTRICTIVE_QUERY,
    },
  }

  expect(getWorkbookWorksheets(state, PROPS)).toEqual(WORKSHEETS)
})

test('query statuses default to not reviewed', () => {
  const second = { ...QUERY_RESULT, worksheetQueryResultGuid: 'WQR0000002', workbookTargetGuid: GROUP_TARGET_GUID }
  const resultsByQueryTarget = getQueryResultsByQueryTarget({
    ...STATE, worksheetQueryResultsByGuid: { ...STATE.worksheetQueryResultsByGuid, WQR0000002: second },
  })

  expect(resultsByQueryTarget).toEqual({
    [RESTRICTIVE_QUERY_GUID]: { [FAMILY_TARGET_GUID]: QUERY_RESULT, [GROUP_TARGET_GUID]: second },
  })
  expect(getQueryStatus(resultsByQueryTarget, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID)).toEqual('I')
  expect(getQueryStatus(resultsByQueryTarget, PERMISSIVE_QUERY_GUID, FAMILY_TARGET_GUID)).toEqual('N')
  expect(getQueryStatus(resultsByQueryTarget, RESTRICTIVE_QUERY_GUID, 'WBT_missing')).toEqual('N')
  expect(getQueryStatus(resultsByQueryTarget, RESTRICTIVE_QUERY_GUID)).toEqual('N')
})

test('getRollUpStatus', () => {
  expect(getRollUpStatus([])).toEqual('N')
  expect(getRollUpStatus(['N', 'N'])).toEqual('N')
  expect(getRollUpStatus(['N', 'I'])).toEqual('I')
  expect(getRollUpStatus(['N', 'U'])).toEqual('I')
  expect(getRollUpStatus(['U', 'U'])).toEqual('U')
  expect(getRollUpStatus(['U', 'F', 'N'])).toEqual('F')
  expect(getRollUpStatus(['I', 'F'])).toEqual('F')
})

test('getWorkbookSelection defaults to the first target and query when the selection is missing or stale', () => {
  expect(getWorkbookSelection(TARGETS, WORKSHEETS, GROUP_TARGET_GUID, RECESSIVE_QUERY_GUID)).toEqual(
    { target: GROUP_TARGET_DISPLAY, query: RECESSIVE_QUERY },
  )
  expect(getWorkbookSelection(TARGETS, WORKSHEETS)).toEqual({ target: FAMILY_TARGET_DISPLAY, query: RESTRICTIVE_QUERY })
  expect(getWorkbookSelection(TARGETS, WORKSHEETS, 'WBT_deleted', 'WSQ_deleted')).toEqual(
    { target: FAMILY_TARGET_DISPLAY, query: RESTRICTIVE_QUERY },
  )
  expect(getWorkbookSelection(TARGETS, [{ ...DE_NOVO_WORKSHEET, queries: [] }, WORKSHEETS[1]])).toEqual(
    { target: FAMILY_TARGET_DISPLAY, query: RECESSIVE_QUERY },
  )
  expect(getWorkbookSelection([], [], FAMILY_TARGET_GUID, RECESSIVE_QUERY_GUID)).toEqual(
    { target: undefined, query: undefined },
  )
})

test('getWorkbookPath only includes a query for a target', () => {
  const path = '/project/R0237_1000_genomes_demo/workbook/WB0000001_trio_analysis'
  expect(getWorkbookPath(WORKBOOK)).toEqual(path)
  expect(getWorkbookPath(WORKBOOK, FAMILY_TARGET_GUID)).toEqual(`${path}/${FAMILY_TARGET_GUID}`)
  expect(getWorkbookPath(WORKBOOK, FAMILY_TARGET_GUID, RECESSIVE_QUERY_GUID)).toEqual(
    `${path}/${FAMILY_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`,
  )
  expect(getWorkbookPath(WORKBOOK, undefined, RECESSIVE_QUERY_GUID)).toEqual(path)
})

test('splitTargetTabs keeps the selected target visible', () => {
  const targets = ['a', 'b', 'c', 'd', 'e'].map(
    (name, order) => ({ ...FAMILY_TARGET_DISPLAY, workbookTargetGuid: name, name, order }),
  )
  const names = ({ visible, overflow }: ReturnType<typeof splitTargetTabs>) => [visible, overflow].map(
    tabs => tabs.map(({ name }) => name).join(''),
  )

  expect(names(splitTargetTabs(targets, 'e', 5))).toEqual(['abcde', ''])
  expect(names(splitTargetTabs(targets, 'a', 3))).toEqual(['abc', 'de'])
  expect(names(splitTargetTabs(targets, 'e', 3))).toEqual(['abe', 'cd'])
  expect(names(splitTargetTabs(targets, undefined, 3))).toEqual(['abc', 'de'])
})

test('group summary selectors only return the summary of the given cell', () => {
  const workbookGroupSummary = { cellKey: 'WSQ1/WBT2', summary: GROUP_SUMMARY }
  const state = {
    ...STATE, workbookGroupSummary, workbookGroupSummaryLoading: { isLoading: true }, genesById: { ENSG1: {} },
  } as unknown as WorkbookReduxState

  expect(getCellGroupSummary(state, 'WSQ1/WBT2')).toBe(workbookGroupSummary)
  expect(getCellGroupSummary(state, 'WSQ1/WBT3')).toEqual({})
  expect(getCellGroupSummary(state, 'WSQ1/WBT3')).toBe(getCellGroupSummary(state, 'WSQ2/WBT2'))
  expect(getGroupSummaryIsLoading(state)).toBe(true)
  expect(getGenesById(state)).toBe(state.genesById)
  expect(getFamiliesByGuid(state)).toBe(state.familiesByGuid)
})

test('getCellHistory only returns the history of the given cell', () => {
  const workbookCellHistory = { cellKey: 'WSQ1/WBT2', history: { runs: [] as object[], totalRuns: 0 } }
  const state = { ...STATE, workbookCellHistory } as unknown as WorkbookReduxState

  expect(getCellHistory(state, 'WSQ1/WBT2')).toBe(workbookCellHistory)
  expect(getCellHistory(state, 'WSQ1/WBT3')).toEqual({})
  expect(getCellHistory(state, 'WSQ1/WBT3')).toBe(getCellHistory(state, 'WSQ2/WBT2'))
})

test('counts the unreviewed results of queries for a target, and of all cells by target', () => {
  const cell = (worksheetQueryGuid: string, workbookTargetGuid: string, numUnreviewed?: number) => ({
    ...QUERY_RESULT,
    worksheetQueryResultGuid: `${worksheetQueryGuid}/${workbookTargetGuid}`,
    worksheetQueryGuid,
    workbookTargetGuid,
    numUnreviewed,
  })
  const cells = [
    cell(RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID, 2),
    cell(PERMISSIVE_QUERY_GUID, FAMILY_TARGET_GUID),
    cell(RECESSIVE_QUERY_GUID, FAMILY_TARGET_GUID, 3),
    cell(RESTRICTIVE_QUERY_GUID, GROUP_TARGET_GUID, 4),
    cell(PERMISSIVE_QUERY_GUID, 'WBT_reviewed', 0),
  ]
  const state = {
    ...STATE,
    worksheetQueryResultsByGuid: cells.reduce((acc, result) => ({ ...acc, [result.worksheetQueryResultGuid]: result }), {}),
  } as unknown as WorkbookReduxState
  const resultsByQueryTarget = getQueryResultsByQueryTarget(state)

  expect(getNumUnreviewed(resultsByQueryTarget, [RESTRICTIVE_QUERY], FAMILY_TARGET_GUID)).toEqual(2)
  expect(getNumUnreviewed(resultsByQueryTarget, [RESTRICTIVE_QUERY, PERMISSIVE_QUERY], FAMILY_TARGET_GUID)).toEqual(2)
  expect(getNumUnreviewed(resultsByQueryTarget, [RESTRICTIVE_QUERY, PERMISSIVE_QUERY, RECESSIVE_QUERY], FAMILY_TARGET_GUID)).toEqual(5)
  expect(getNumUnreviewed(resultsByQueryTarget, [RECESSIVE_QUERY], GROUP_TARGET_GUID)).toEqual(0)
  expect(getNumUnreviewed(resultsByQueryTarget, [RESTRICTIVE_QUERY], undefined)).toEqual(0)
  expect(getNumUnreviewed(resultsByQueryTarget, [], FAMILY_TARGET_GUID)).toEqual(0)
  expect(getNumUnreviewedByTarget(state)).toEqual({ [FAMILY_TARGET_GUID]: 5, [GROUP_TARGET_GUID]: 4, WBT_reviewed: 0 })
})

test('identifies excluded variants by family like the saved variants page and groups them by reason', () => {
  const savedVariant = (variantId: string, tagGuids: string[], familyGuids = ['F1']) => (
    { variantGuid: `SV_${variantId}_${familyGuids.join()}`, variantId, familyGuids, tagGuids }
  )
  const savedVariants = [
    savedVariant('1-1-A-T', ['VT_benign']),
    savedVariant('1-2-A-T', ['VT_review', 'VT_no_reason', 'VT_artifact']),
    savedVariant('1-3-A-T', ['VT_no_reason', 'VT_empty_reason']),
    savedVariant('1-4-A-T', ['VT_review']),
    savedVariant('1-5-A-T', []),
    savedVariant('1-6-A-T', ['VT_artifact'], ['F2', 'F3']),
    savedVariant('1-7-A-T', ['VT_missing']),
  ]
  const state = {
    ...STATE,
    savedVariantsByGuid: savedVariants.reduce((acc, variant) => ({ ...acc, [variant.variantGuid]: variant }), {}),
    variantTagsByGuid: {
      VT_benign: { name: 'Excluded', metadata: 'Benign' },
      VT_artifact: { name: 'Excluded', metadata: 'Artifact' },
      VT_no_reason: { name: 'Excluded', metadata: null as string },
      VT_empty_reason: { name: 'Excluded', metadata: '' },
      VT_review: { name: 'Review', metadata: 'Benign' },
    },
  } as unknown as WorkbookReduxState

  const excludedReasons = getExcludedReasonsByFamilyVariant(state)
  expect(excludedReasons).toEqual({
    'F1/1-1-A-T': 'Benign',
    'F1/1-2-A-T': 'Artifact',
    'F1/1-3-A-T': 'No reason given',
    'F2/1-6-A-T': 'Artifact',
    'F3/1-6-A-T': 'Artifact',
  })

  const variant = (variantId: string, familyGuids?: string[]) => ({ variantId, familyGuids })
  const benign = variant('1-1-A-T', ['F1'])
  const artifact = variant('1-2-A-T', ['F1'])
  const noReason = variant('1-3-A-T', ['F1'])
  const review = variant('1-4-A-T', ['F1'])
  const otherFamily = variant('1-1-A-T', ['F2'])
  const noFamilies = variant('1-1-A-T')
  const multiFamily = variant('1-6-A-T', ['F1', 'F3'])
  const excludedPair = [review, artifact]
  const pair = [review, variant('1-5-A-T', ['F1'])]

  expect(splitExcludedVariants([], excludedReasons)).toEqual({ included: [], excludedGroups: [], numExcluded: 0 })
  expect(splitExcludedVariants(
    [benign, review, excludedPair, otherFamily, noReason, pair, noFamilies, multiFamily, artifact], excludedReasons,
  )).toEqual({
    included: [review, otherFamily, pair, noFamilies],
    excludedGroups: [
      { reason: 'Artifact', variants: [excludedPair, multiFamily, artifact] },
      { reason: 'Benign', variants: [benign] },
      { reason: 'No reason given', variants: [noReason] },
    ],
    numExcluded: 5,
  })
  expect(splitExcludedVariants([benign, pair], {})).toEqual(
    { included: [benign, pair], excludedGroups: [], numExcluded: 0 },
  )
})
