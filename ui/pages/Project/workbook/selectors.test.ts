import {
  DE_NOVO_WORKSHEET, FAMILY_TARGET, FAMILY_TARGET_GUID, GROUP_TARGET, GROUP_TARGET_GUID, OTHER_WORKBOOK,
  PERMISSIVE_QUERY, PERMISSIVE_QUERY_GUID, QUERY_RESULT, RECESSIVE_QUERY, RECESSIVE_QUERY_GUID, RECESSIVE_WORKSHEET,
  RESTRICTIVE_QUERY, RESTRICTIVE_QUERY_GUID, SAVED_SEARCH_GUID, STATE as FIXTURE_STATE, WORKBOOK, WORKBOOK_GUID,
} from './fixtures'
import {
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
