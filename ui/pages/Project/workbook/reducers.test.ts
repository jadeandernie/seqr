import { flushAll } from '../../../shared/utils/testHelpers'
import {
  DE_NOVO_WORKSHEET_GUID, FAMILY_TARGET_GUID, GROUP_TARGET, GROUP_TARGET_GUID, OTHER_WORKBOOK, PERMISSIVE_QUERY_GUID,
  PROJECT_GUID, QUERY_RESULT, QUERY_RESULT_GUID, RECESSIVE_QUERY_GUID, RECESSIVE_WORKSHEET_GUID,
  RESTRICTIVE_QUERY_GUID, SAVED_SEARCH_GUID, SEARCH_HASH, WORKBOOK, WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import {
  addWorkbookTargets, createWorkbook, deleteWorkbookTarget, duplicateWorkbook, loadProjectWorkbooks, loadWorkbook,
  loadWorkbookPage, loadWorkbooksPage, runWorksheetQuery, updateWorkbook, updateWorksheet, updateWorksheetQuery,
  updateWorksheetQueryResult,
} from './reducers'
import { createTestStore, getRequests, mockApi } from './testHelpers'
import { WorkbookTarget, WorksheetQueryResult } from './types'

const EMPTY_STATE = {
  workbooksByGuid: {},
  workbookTargetsByGuid: {},
  worksheetsByGuid: {},
  worksheetQueriesByGuid: {},
  worksheetQueryResultsByGuid: {},
}

test('loads the workbooks of the project and removes workbooks that no longer exist', async () => {
  const otherProjectWorkbook = { ...OTHER_WORKBOOK, workbookGuid: 'WB0000003_other', projectGuid: 'R0002_other' }
  const store = createTestStore({
    workbooksByGuid: { [WORKBOOK_GUID]: WORKBOOK, WB0000003_other: otherProjectWorkbook },
  })
  mockApi({
    [`/api/project/${PROJECT_GUID}/workbooks`]: { json: { workbooksByGuid: { WB0000002_exomes: OTHER_WORKBOOK } } },
  })

  store.dispatch(loadProjectWorkbooks())
  expect(store.getState().workbooksLoading.isLoading).toBe(true)
  await flushAll()

  expect(store.getState().workbooksLoading).toEqual({ isLoading: false, errorMessage: undefined })
  expect(store.getState().workbooksByGuid).toEqual({
    WB0000002_exomes: OTHER_WORKBOOK, WB0000003_other: otherProjectWorkbook,
  })
})

test('keeps its own loading state and error when loading the workbooks fails', async () => {
  const store = createTestStore()
  mockApi({ [`/api/project/${PROJECT_GUID}/workbooks`]: { status: 403, json: { error: 'Permission Denied' } } })

  store.dispatch(loadProjectWorkbooks())
  store.dispatch({ type: 'RECEIVE_DATA', updatesById: {} })
  expect(store.getState().workbooksLoading.isLoading).toBe(true)
  await flushAll()

  expect(store.getState().workbooksLoading).toEqual({ isLoading: false, errorMessage: 'Permission Denied' })
  expect(store.getState().workbooksByGuid).toEqual({ [WORKBOOK_GUID]: WORKBOOK })
})

test('loads a workbook and removes its entities that no longer exist', async () => {
  const otherTarget = { ...GROUP_TARGET, workbookTargetGuid: 'WBT0000009_other', workbookGuid: 'WB0000002_exomes' }
  const store = createTestStore({
    workbookTargetsByGuid: { ...WORKBOOK_DETAIL.workbookTargetsByGuid, WBT0000009_other: otherTarget },
  })
  const { [RECESSIVE_WORKSHEET_GUID]: recessive, ...worksheetsByGuid } = WORKBOOK_DETAIL.worksheetsByGuid
  const { [RECESSIVE_QUERY_GUID]: recessiveQuery, ...worksheetQueriesByGuid } = WORKBOOK_DETAIL.worksheetQueriesByGuid
  const { [FAMILY_TARGET_GUID]: familyTarget, ...workbookTargetsByGuid } = WORKBOOK_DETAIL.workbookTargetsByGuid
  mockApi({
    [`/api/workbook/${WORKBOOK_GUID}`]: {
      json: {
        ...WORKBOOK_DETAIL,
        worksheetsByGuid,
        worksheetQueriesByGuid,
        workbookTargetsByGuid,
        worksheetQueryResultsByGuid: {},
      },
    },
  })

  store.dispatch(loadWorkbook(WORKBOOK_GUID))
  expect(store.getState().workbookDetailLoading.isLoading).toBe(true)
  await flushAll()

  const state = store.getState()
  expect(state.workbookDetailLoading).toEqual({ isLoading: false, errorMessage: undefined })
  expect(state.workbooksByGuid).toEqual(WORKBOOK_DETAIL.workbooksByGuid)
  expect(state.workbookTargetsByGuid).toEqual({ ...workbookTargetsByGuid, WBT0000009_other: otherTarget })
  expect(state.worksheetsByGuid).toEqual(worksheetsByGuid)
  expect(state.worksheetQueriesByGuid).toEqual(worksheetQueriesByGuid)
  expect(state.worksheetQueryResultsByGuid).toEqual({})
})

test('keeps its own loading state and error when loading a workbook fails', async () => {
  const store = createTestStore(EMPTY_STATE)
  mockApi({
    [`/api/workbook/${WORKBOOK_GUID}`]: { status: 404, json: { error: 'Workbook matching query does not exist.' } },
  })

  store.dispatch(loadWorkbook(WORKBOOK_GUID))
  store.dispatch({ type: 'RECEIVE_DATA', updatesById: {} })
  expect(store.getState().workbookDetailLoading.isLoading).toBe(true)
  await flushAll()

  expect(store.getState().workbookDetailLoading).toEqual(
    { isLoading: false, errorMessage: 'Workbook matching query does not exist.' },
  )
})

test('the page loaders also load the families, analysis groups and saved searches', async () => {
  const store = createTestStore({ savedSearchesByGuid: {} })
  mockApi({})

  store.dispatch(loadWorkbooksPage())
  await flushAll()
  expect(getRequests(`/api/project/${PROJECT_GUID}/workbooks`)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_families`)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_analysis_groups`)).toHaveLength(1)
  expect(getRequests('/api/saved_search/all')).toHaveLength(0)

  store.dispatch(loadWorkbookPage(WORKBOOK_GUID))
  await flushAll()
  expect(getRequests(`/api/workbook/${WORKBOOK_GUID}`)).toHaveLength(1)
  expect(getRequests('/api/saved_search/all')).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_families`)).toHaveLength(1)
})

test('creates, updates, duplicates and deletes workbooks', async () => {
  const store = createTestStore(EMPTY_STATE)
  const created = {
    ...WORKBOOK_DETAIL, worksheetsByGuid: {}, worksheetQueriesByGuid: {}, worksheetQueryResultsByGuid: {},
  }
  const renamed = { ...WORKBOOK, name: 'Renamed' }
  const createUrl = `/api/project/${PROJECT_GUID}/workbooks/create`
  mockApi({
    [createUrl]: { json: created },
    [`/api/workbook/${WORKBOOK_GUID}/update`]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: renamed } } },
    [`/api/workbook/${WORKBOOK_GUID}/duplicate`]: { json: { workbooksByGuid: { WB0000002_exomes: OTHER_WORKBOOK } } },
    [`/api/workbook/${WORKBOOK_GUID}/delete`]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: null } } },
  })

  const values = {
    name: 'Trio analysis', description: 'Review', familyGuids: ['F011652_1'], analysisGroupGuids: ['AG0000183_test_group'],
  }
  await store.dispatch(createWorkbook({ ...values, ignored: true } as never))
  expect(getRequests(createUrl)).toEqual([values])
  expect(store.getState().workbooksByGuid).toEqual(WORKBOOK_DETAIL.workbooksByGuid)
  expect(store.getState().workbookTargetsByGuid).toEqual(WORKBOOK_DETAIL.workbookTargetsByGuid)

  await store.dispatch(updateWorkbook({ ...WORKBOOK, name: 'Renamed', description: null }))
  expect(getRequests(`/api/workbook/${WORKBOOK_GUID}/update`)).toEqual([{ name: 'Renamed', description: null }])
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(renamed)

  await store.dispatch(duplicateWorkbook({ workbookGuid: WORKBOOK_GUID, name: 'Exome review', familyGuids: ['F011652_2'] }))
  expect(getRequests(`/api/workbook/${WORKBOOK_GUID}/duplicate`)).toEqual(
    [{ name: 'Exome review', familyGuids: ['F011652_2'] }],
  )
  expect(Object.keys(store.getState().workbooksByGuid)).toEqual([WORKBOOK_GUID, 'WB0000002_exomes'])

  await store.dispatch(updateWorkbook({ workbookGuid: WORKBOOK_GUID, delete: true }))
  expect(getRequests(`/api/workbook/${WORKBOOK_GUID}/delete`)).toEqual([{}])
  expect(Object.keys(store.getState().workbooksByGuid)).toEqual(['WB0000002_exomes'])
})

test('rejects with the request error and leaves the state unchanged when an update fails', async () => {
  const store = createTestStore()
  mockApi({
    [`/api/workbook/${WORKBOOK_GUID}/update`]: {
      status: 400, json: { errors: ['A workbook named "Exome review" already exists'] },
    },
  })

  await expect(store.dispatch(updateWorkbook({ ...WORKBOOK, name: 'Exome review' }))).rejects.toMatchObject({
    body: { errors: ['A workbook named "Exome review" already exists'] },
  })
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(WORKBOOK)
})

test('adds and removes workbook targets', async () => {
  const store = createTestStore()
  const newTarget: WorkbookTarget = { ...GROUP_TARGET, workbookTargetGuid: 'WBT0000003_2', familyGuid: 'F011652_2', analysisGroupGuid: null }
  const path = `/api/workbook/${WORKBOOK_GUID}/targets`
  mockApi({
    [`${path}/add`]: { json: { workbookTargetsByGuid: { WBT0000003_2: newTarget } } },
    [`${path}/${FAMILY_TARGET_GUID}/delete`]: {
      json: {
        workbookTargetsByGuid: { [FAMILY_TARGET_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  })

  await store.dispatch(addWorkbookTargets(WORKBOOK_GUID, { familyGuids: ['F011652_2'], analysisGroupGuids: [] }))
  expect(getRequests(`${path}/add`)).toEqual([{ familyGuids: ['F011652_2'], analysisGroupGuids: [] }])
  expect(store.getState().workbookTargetsByGuid.WBT0000003_2).toEqual(newTarget)

  await store.dispatch(deleteWorkbookTarget(WORKBOOK_GUID, FAMILY_TARGET_GUID))
  expect(getRequests(`${path}/${FAMILY_TARGET_GUID}/delete`)).toEqual([{}])
  expect(Object.keys(store.getState().workbookTargetsByGuid)).toEqual([GROUP_TARGET_GUID, 'WBT0000003_2'])
  expect(store.getState().worksheetQueryResultsByGuid).toEqual({})
})

test('creates, renames and deletes worksheets', async () => {
  const store = createTestStore()
  const path = `/api/workbook/${WORKBOOK_GUID}/worksheets`
  const dominant = { worksheetGuid: 'WS0000003_dominant', workbookGuid: WORKBOOK_GUID, name: 'Dominant', order: 2 }
  mockApi({
    [`${path}/create`]: { json: { worksheetsByGuid: { WS0000003_dominant: dominant } } },
    [`${path}/WS0000003_dominant/update`]: {
      json: { worksheetsByGuid: { WS0000003_dominant: { ...dominant, name: 'AD' } } },
    },
    [`${path}/${DE_NOVO_WORKSHEET_GUID}/delete`]: {
      json: {
        worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: null },
        worksheetQueriesByGuid: { [RESTRICTIVE_QUERY_GUID]: null, [PERMISSIVE_QUERY_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  })

  await store.dispatch(updateWorksheet(WORKBOOK_GUID, { name: 'Dominant' }))
  expect(getRequests(`${path}/create`)).toEqual([{ name: 'Dominant' }])
  expect(store.getState().worksheetsByGuid.WS0000003_dominant).toEqual(dominant)

  await store.dispatch(updateWorksheet(WORKBOOK_GUID, { ...dominant, name: 'AD' }))
  expect(getRequests(`${path}/WS0000003_dominant/update`)).toEqual([{ name: 'AD' }])
  expect(store.getState().worksheetsByGuid.WS0000003_dominant.name).toEqual('AD')

  await store.dispatch(updateWorksheet(WORKBOOK_GUID, { worksheetGuid: DE_NOVO_WORKSHEET_GUID, delete: true }))
  expect(getRequests(`${path}/${DE_NOVO_WORKSHEET_GUID}/delete`)).toEqual([{}])
  expect(Object.keys(store.getState().worksheetsByGuid)).toEqual([RECESSIVE_WORKSHEET_GUID, 'WS0000003_dominant'])
  expect(Object.keys(store.getState().worksheetQueriesByGuid)).toEqual([RECESSIVE_QUERY_GUID])
  expect(store.getState().worksheetQueryResultsByGuid).toEqual({})
})

test('creates, renames and deletes worksheet queries', async () => {
  const store = createTestStore()
  const path = `/api/workbook/${WORKBOOK_GUID}`
  const query = {
    ...WORKBOOK_DETAIL.worksheetQueriesByGuid[RECESSIVE_QUERY_GUID], worksheetQueryGuid: 'WSQ0000004_new', order: 1,
  }
  mockApi({
    [`${path}/worksheets/${RECESSIVE_WORKSHEET_GUID}/queries/create`]: {
      json: { worksheetQueriesByGuid: { WSQ0000004_new: query } },
    },
    [`${path}/queries/WSQ0000004_new/update`]: {
      json: { worksheetQueriesByGuid: { WSQ0000004_new: { ...query, name: 'Comp het' } } },
    },
    [`${path}/queries/${RESTRICTIVE_QUERY_GUID}/delete`]: {
      json: {
        worksheetQueriesByGuid: { [RESTRICTIVE_QUERY_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  })

  await store.dispatch(updateWorksheetQuery(
    WORKBOOK_GUID, { worksheetGuid: RECESSIVE_WORKSHEET_GUID, savedSearchGuid: SAVED_SEARCH_GUID },
  ))
  expect(getRequests(`${path}/worksheets/${RECESSIVE_WORKSHEET_GUID}/queries/create`)).toEqual(
    [{ savedSearchGuid: SAVED_SEARCH_GUID }],
  )
  expect(store.getState().worksheetQueriesByGuid.WSQ0000004_new).toEqual(query)

  await store.dispatch(updateWorksheetQuery(WORKBOOK_GUID, { ...query, name: 'Comp het' }))
  expect(getRequests(`${path}/queries/WSQ0000004_new/update`)).toEqual([{ name: 'Comp het' }])
  expect(store.getState().worksheetQueriesByGuid.WSQ0000004_new.name).toEqual('Comp het')

  await store.dispatch(
    updateWorksheetQuery(WORKBOOK_GUID, { worksheetQueryGuid: RESTRICTIVE_QUERY_GUID, delete: true }),
  )
  expect(getRequests(`${path}/queries/${RESTRICTIVE_QUERY_GUID}/delete`)).toEqual([{}])
  expect(store.getState().worksheetQueriesByGuid[RESTRICTIVE_QUERY_GUID]).toBeUndefined()
  expect(store.getState().worksheetQueryResultsByGuid).toEqual({})
})

test('updates and runs the result of a query for a target', async () => {
  const store = createTestStore()
  const path = `/api/workbook/${WORKBOOK_GUID}/queries/${RESTRICTIVE_QUERY_GUID}/targets/${FAMILY_TARGET_GUID}`
  const updated: WorksheetQueryResult = { ...QUERY_RESULT, status: 'F', note: 'Candidate' }
  const ran = { ...updated, searchHash: SEARCH_HASH, lastRunDate: '2026-11-22T10:00:00Z', lastRunBy: 'Test User' }
  mockApi({
    [`${path}/update`]: { json: { worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: updated } } },
    [`${path}/run`]: { json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: ran } } },
  })

  await store.dispatch(updateWorksheetQueryResult(
    WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID, { status: 'F', note: 'Candidate' },
  ))
  expect(getRequests(`${path}/update`)).toEqual([{ status: 'F', note: 'Candidate' }])
  expect(store.getState().worksheetQueryResultsByGuid[QUERY_RESULT_GUID]).toEqual(updated)

  await store.dispatch(runWorksheetQuery(WORKBOOK_GUID, RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID))
  expect(getRequests(`${path}/run`)).toEqual([{}])
  expect(store.getState().worksheetQueryResultsByGuid[QUERY_RESULT_GUID]).toEqual(ran)
})
