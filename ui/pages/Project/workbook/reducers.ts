import { RECEIVE_DATA, RECEIVE_SAVED_SEARCHES } from '../../../redux/utils/reducerUtils'
import {
  createObjectsByIdReducer, createSingleValueReducer, loadingReducer,
} from '../../../redux/utils/reducerFactories'
import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'
import { loadSavedSearches } from '../../Search/reducers'
import { loadCurrentProjectAnalysisGroups, loadFamilies } from '../reducers'
import {
  ByGuid, GroupSummary, RequestError, Workbook, WorkbookResponse, WorkbookStatus, WorkbookTarget, WorkbookThunk,
  Worksheet,
} from './types'

const REQUEST_WORKBOOKS = 'REQUEST_WORKBOOKS'
const RECEIVE_WORKBOOKS = 'RECEIVE_WORKBOOKS'
const REQUEST_WORKBOOK_DETAIL = 'REQUEST_WORKBOOK_DETAIL'
const RECEIVE_WORKBOOK_DETAIL = 'RECEIVE_WORKBOOK_DETAIL'
const REQUEST_WORKBOOK_GROUP_SUMMARY = 'REQUEST_WORKBOOK_GROUP_SUMMARY'
const RECEIVE_WORKBOOK_GROUP_SUMMARY = 'RECEIVE_WORKBOOK_GROUP_SUMMARY'

interface TargetValues {
  familyGuids?: string[]
  analysisGroupGuids?: string[]
}

interface WorkbookValues extends TargetValues {
  workbookGuid?: string
  name?: string
  description?: string | null
  delete?: boolean
}

interface WorksheetValues {
  worksheetGuid?: string
  name?: string
  delete?: boolean
}

interface WorksheetQueryValues {
  worksheetQueryGuid?: string
  worksheetGuid?: string
  name?: string
  savedSearchGuid?: string
  delete?: boolean
}

interface QueryResultValues {
  status?: WorkbookStatus
  note?: string | null
}

// Replaces the loaded entities matching the filter with those in the response, removing any the server no longer has
const replaceEntities = <T>(
  loaded: ByGuid<T>, response: ByGuid<T | null> = {}, isReplaced: (entity: T) => boolean,
): ByGuid<T | null> => ({
    ...Object.entries(loaded).reduce(
      (acc, [guid, entity]) => (isReplaced(entity) ? { ...acc, [guid]: null } : acc), {} as ByGuid<T | null>,
    ),
    ...response,
  })

const postWorkbookData = (url: string, body: object = {}): WorkbookThunk => dispatch => new HttpRequestHelper(
  url, (responseJson: WorkbookResponse) => {
    dispatch({ type: RECEIVE_DATA, updatesById: responseJson })
  },
).post(body as Record<string, unknown>)

export const loadProjectWorkbooks = (): WorkbookThunk => (dispatch, getState) => {
  const projectGuid = getState().currentProjectGuid
  dispatch({ type: REQUEST_WORKBOOKS })
  return new HttpRequestHelper(`/api/project/${projectGuid}/workbooks`,
    (responseJson: WorkbookResponse) => {
      const workbooksByGuid = replaceEntities(
        getState().workbooksByGuid, responseJson.workbooksByGuid, workbook => workbook.projectGuid === projectGuid,
      )
      dispatch({ type: RECEIVE_DATA, updatesById: { workbooksByGuid } })
      dispatch({ type: RECEIVE_WORKBOOKS })
    },
    (e: Error) => {
      dispatch({ type: RECEIVE_WORKBOOKS, error: e.message })
    }).get()
}

export const loadWorkbook = (workbookGuid: string): WorkbookThunk => (dispatch, getState) => {
  dispatch({ type: REQUEST_WORKBOOK_DETAIL })
  return new HttpRequestHelper(`/api/workbook/${workbookGuid}`,
    (responseJson: WorkbookResponse) => {
      const state = getState()
      const inWorkbook = (entity: { workbookGuid: string }) => entity.workbookGuid === workbookGuid
      const worksheetsByGuid = replaceEntities<Worksheet>(
        state.worksheetsByGuid, responseJson.worksheetsByGuid, inWorkbook,
      )
      const workbookTargetsByGuid = replaceEntities<WorkbookTarget>(
        state.workbookTargetsByGuid, responseJson.workbookTargetsByGuid, inWorkbook,
      )
      dispatch({
        type: RECEIVE_DATA,
        updatesById: {
          workbooksByGuid: replaceEntities<Workbook>(state.workbooksByGuid, responseJson.workbooksByGuid, inWorkbook),
          workbookTargetsByGuid,
          worksheetsByGuid,
          worksheetQueriesByGuid: replaceEntities(
            state.worksheetQueriesByGuid, responseJson.worksheetQueriesByGuid,
            query => query.worksheetGuid in worksheetsByGuid,
          ),
          worksheetQueryResultsByGuid: replaceEntities(
            state.worksheetQueryResultsByGuid, responseJson.worksheetQueryResultsByGuid,
            result => result.workbookTargetGuid in workbookTargetsByGuid,
          ),
        },
      })
      dispatch({ type: RECEIVE_WORKBOOK_DETAIL })
    },
    (e: Error) => {
      dispatch({ type: RECEIVE_WORKBOOK_DETAIL, error: e.message })
    }).get()
}

const loadTargetOptions = (): WorkbookThunk<void> => (dispatch, getState) => {
  loadFamilies()(dispatch, getState)
  loadCurrentProjectAnalysisGroups()(dispatch, getState)
}

export const loadWorkbooksPage = (): WorkbookThunk<void> => (dispatch, getState) => {
  loadProjectWorkbooks()(dispatch, getState)
  loadTargetOptions()(dispatch, getState)
}

export const loadWorkbookPage = (workbookGuid: string): WorkbookThunk<void> => (dispatch, getState) => {
  loadWorkbook(workbookGuid)(dispatch, getState)
  loadTargetOptions()(dispatch, getState)
  loadSavedSearches()(dispatch, getState)
}

export const createWorkbook = (
  { name, description, familyGuids, analysisGroupGuids }: WorkbookValues,
): WorkbookThunk => (dispatch, getState) => postWorkbookData(
  `/api/project/${getState().currentProjectGuid}/workbooks/create`,
  { name, description, familyGuids, analysisGroupGuids },
)(dispatch, getState)

export const updateWorkbook = (
  { workbookGuid, name, description, delete: isDelete }: WorkbookValues,
): WorkbookThunk => (isDelete ?
  postWorkbookData(`/api/workbook/${workbookGuid}/delete`) :
  postWorkbookData(`/api/workbook/${workbookGuid}/update`, { name, description: description || null }))

export const duplicateWorkbook = (
  { workbookGuid, name, familyGuids, analysisGroupGuids }: WorkbookValues,
): WorkbookThunk => postWorkbookData(
  `/api/workbook/${workbookGuid}/duplicate`, { name, familyGuids, analysisGroupGuids },
)

export const addWorkbookTargets = (
  workbookGuid: string, { familyGuids, analysisGroupGuids }: TargetValues,
): WorkbookThunk => postWorkbookData(
  `/api/workbook/${workbookGuid}/targets/add`, { familyGuids, analysisGroupGuids },
)

export const deleteWorkbookTarget = (workbookGuid: string, workbookTargetGuid: string): WorkbookThunk => (
  postWorkbookData(`/api/workbook/${workbookGuid}/targets/${workbookTargetGuid}/delete`)
)

export const updateWorksheet = (
  workbookGuid: string, { worksheetGuid, name, delete: isDelete }: WorksheetValues,
): WorkbookThunk => {
  const path = `/api/workbook/${workbookGuid}/worksheets`
  if (!worksheetGuid) {
    return postWorkbookData(`${path}/create`, { name })
  }
  return isDelete ?
    postWorkbookData(`${path}/${worksheetGuid}/delete`) : postWorkbookData(`${path}/${worksheetGuid}/update`, { name })
}

export const updateWorksheetQuery = (
  workbookGuid: string,
  { worksheetQueryGuid, worksheetGuid, name, savedSearchGuid, delete: isDelete }: WorksheetQueryValues,
): WorkbookThunk => {
  const path = `/api/workbook/${workbookGuid}`
  if (!worksheetQueryGuid) {
    return postWorkbookData(`${path}/worksheets/${worksheetGuid}/queries/create`, { name, savedSearchGuid })
  }
  return isDelete ?
    postWorkbookData(`${path}/queries/${worksheetQueryGuid}/delete`) :
    postWorkbookData(`${path}/queries/${worksheetQueryGuid}/update`, { name })
}

const queryTargetPath = (workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string) => (
  `/api/workbook/${workbookGuid}/queries/${worksheetQueryGuid}/targets/${workbookTargetGuid}`
)

export const updateWorksheetQueryResult = (
  workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string, values: QueryResultValues,
): WorkbookThunk => postWorkbookData(
  `${queryTargetPath(workbookGuid, worksheetQueryGuid, workbookTargetGuid)}/update`, values,
)

export const runWorksheetQuery = (
  workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string,
): WorkbookThunk => postWorkbookData(`${queryTargetPath(workbookGuid, worksheetQueryGuid, workbookTargetGuid)}/run`)

// The search of an analysis group is run through the search API so that its results are stored for the summary,
// without loading them into the search results page state
export const runGroupWorksheetQuery = (
  workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string,
): WorkbookThunk => (dispatch) => {
  let searchHash: string
  return new HttpRequestHelper(
    `${queryTargetPath(workbookGuid, worksheetQueryGuid, workbookTargetGuid)}/run`,
    (responseJson: WorkbookResponse) => {
      ({ searchHash } = responseJson)
      dispatch({ type: RECEIVE_DATA, updatesById: responseJson })
    },
  ).post().then(() => new HttpRequestHelper(
    `/api/search/${searchHash}?per_page=1`,
    ({ search }: { search: object }) => {
      dispatch({ type: RECEIVE_SAVED_SEARCHES, updatesById: { searchesByHash: { [searchHash]: search } } })
    },
  ).post())
}

export const getCellKey = (worksheetQueryGuid: string, workbookTargetGuid: string) => (
  `${worksheetQueryGuid}/${workbookTargetGuid}`
)

let currentGroupSummaryRequest = 0

export const loadGroupSummary = (
  workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string, geneId?: string,
): WorkbookThunk => (dispatch) => {
  const cellKey = getCellKey(worksheetQueryGuid, workbookTargetGuid)
  currentGroupSummaryRequest += 1
  const request = currentGroupSummaryRequest
  dispatch({ type: REQUEST_WORKBOOK_GROUP_SUMMARY })
  return new HttpRequestHelper(
    `${queryTargetPath(workbookGuid, worksheetQueryGuid, workbookTargetGuid)}/summary`,
    ({ genesById, ...summary }: GroupSummary & { genesById: object }) => {
      if (request === currentGroupSummaryRequest) {
        dispatch({ type: RECEIVE_DATA, updatesById: { genesById } })
        dispatch({ type: RECEIVE_WORKBOOK_GROUP_SUMMARY, newValue: { cellKey, summary } })
      }
    },
    (e: RequestError) => {
      if (request === currentGroupSummaryRequest) {
        dispatch({
          type: RECEIVE_WORKBOOK_GROUP_SUMMARY,
          newValue: {
            cellKey, error: e.body?.errors?.[0] || e.message, resultsNotLoaded: !!e.body?.resultsNotLoaded,
          },
        })
      }
    },
  ).get(geneId ? { geneId } : {})
}

export const reducers = {
  workbooksByGuid: createObjectsByIdReducer(RECEIVE_DATA, 'workbooksByGuid'),
  workbookTargetsByGuid: createObjectsByIdReducer(RECEIVE_DATA, 'workbookTargetsByGuid'),
  worksheetsByGuid: createObjectsByIdReducer(RECEIVE_DATA, 'worksheetsByGuid'),
  worksheetQueriesByGuid: createObjectsByIdReducer(RECEIVE_DATA, 'worksheetQueriesByGuid'),
  worksheetQueryResultsByGuid: createObjectsByIdReducer(RECEIVE_DATA, 'worksheetQueryResultsByGuid'),
  workbooksLoading: loadingReducer(REQUEST_WORKBOOKS, RECEIVE_WORKBOOKS),
  workbookDetailLoading: loadingReducer(REQUEST_WORKBOOK_DETAIL, RECEIVE_WORKBOOK_DETAIL),
  workbookGroupSummary: createSingleValueReducer(RECEIVE_WORKBOOK_GROUP_SUMMARY, {}),
  workbookGroupSummaryLoading: loadingReducer(REQUEST_WORKBOOK_GROUP_SUMMARY, RECEIVE_WORKBOOK_GROUP_SUMMARY),
}
