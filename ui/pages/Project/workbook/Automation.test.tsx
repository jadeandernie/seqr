import { getAutomationSummary } from './AutomationSummary'
import { getRerunIntervalLabel, isAutomatedTrigger } from './constants'
import {
  DE_NOVO_WORKSHEET, DE_NOVO_WORKSHEET_GUID, PROJECT_GUID, QUERY_RESULT, QUERY_RESULT_GUID, RECESSIVE_WORKSHEET_GUID,
  SEARCH_HASH, WORKBOOK, WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import { updateWorkbookAutomation, updateWorksheetAutomation } from './reducers'
import { getEffectiveRerunIntervalDays, getNextRerunDate } from './selectors'
import {
  click, createTestStore, flush, getOpenModal, getRequests, mockApi, renderProjectPage, setDropdown, submitForm,
} from './testHelpers'
import { Workbook, Worksheet, WorksheetQueryResult, WorksheetQueryRun } from './types'

jest.mock('../../../shared/components/panel/variants/Variants', () => () => null)

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const UPDATE_URL = `${API_PATH}/update`
const WORKSHEET_UPDATE_URL = `${API_PATH}/worksheets/${DE_NOVO_WORKSHEET_GUID}/update`
const WEEKLY_WORKBOOK: Workbook = { ...WORKBOOK, rerunIntervalDays: 7, notifyOnNewResults: true }
const DAILY_WORKSHEET: Worksheet = { ...DE_NOVO_WORKSHEET, rerunIntervalDays: 1 }
const RUN: WorksheetQueryRun = {
  runId: 5,
  createdDate: '2026-11-25T10:00:00Z',
  createdBy: 'Test Manager User',
  trigger: 'S',
  status: 'C',
  error: null,
  numResults: 7,
  numNew: 0,
  numRemoved: 0,
  isUnchanged: true,
}
const RAN_RESULT: WorksheetQueryResult = {
  ...QUERY_RESULT,
  searchHash: SEARCH_HASH,
  lastRunDate: '2026-11-25T10:00:00Z',
  lastRunBy: 'Test Manager User',
  numResults: 7,
  lastRun: { ...RUN, trigger: 'M' },
}

const withDetail = (detail: object = {}, responses: Responses = {}): Responses => ({
  [API_PATH]: { json: { ...WORKBOOK_DETAIL, ...detail } }, ...responses,
})

const renderWorkbook = async (responses: Responses = withDetail()) => {
  mockApi(responses)
  const rendered = renderProjectPage(PATH, {
    workbooksByGuid: {},
    workbookTargetsByGuid: {},
    worksheetsByGuid: {},
    worksheetQueriesByGuid: {},
    worksheetQueryResultsByGuid: {},
  })
  await flush(rendered.wrapper)
  await flush(rendered.wrapper)
  return rendered
}

const getSummary = (wrapper: Wrapper) => wrapper.find('div[aria-label="Automatic reruns"]')
const getRunInfo = (wrapper: Wrapper) => wrapper.find('div[role="tabpanel"]').text()
const getFormDropdown = (wrapper: Wrapper) => getOpenModal(wrapper).find('Dropdown').filterWhere(
  (node: Wrapper) => node.prop('name') === 'rerunIntervalDays',
).first()

test('describes the automation of a workbook', () => {
  expect(getAutomationSummary(WORKBOOK)).toEqual('Automatic reruns: off')
  expect(getAutomationSummary({ ...WORKBOOK, rerunIntervalDays: 14 })).toEqual('Automatic reruns: every 2 weeks')
  expect(getAutomationSummary(WEEKLY_WORKBOOK)).toEqual(
    'Automatic reruns: weekly, with a project notification and an email to the creator for new results',
  )
  expect(getAutomationSummary({ ...WORKBOOK, notifyOnNewResults: true })).toEqual('Automatic reruns: off')
  expect(getRerunIntervalLabel(1)).toEqual('Daily')
  expect(getRerunIntervalLabel(30)).toEqual('Monthly')
  expect(getRerunIntervalLabel(3)).toEqual('Every 3 days')
  expect(['M', 'S', 'D'].map(isAutomatedTrigger)).toEqual([false, true, true])
})

test('a worksheet interval overrides the workbook interval, and without either nothing is rerun', () => {
  expect(getEffectiveRerunIntervalDays(WORKBOOK, DE_NOVO_WORKSHEET)).toBeNull()
  expect(getEffectiveRerunIntervalDays(WORKBOOK)).toBeNull()
  expect(getEffectiveRerunIntervalDays(WEEKLY_WORKBOOK, DE_NOVO_WORKSHEET)).toEqual(7)
  expect(getEffectiveRerunIntervalDays(WEEKLY_WORKBOOK)).toEqual(7)
  expect(getEffectiveRerunIntervalDays(WEEKLY_WORKBOOK, DAILY_WORKSHEET)).toEqual(1)
  expect(getEffectiveRerunIntervalDays(WORKBOOK, DAILY_WORKSHEET)).toEqual(1)
})

test('the next rerun of a cell is due one interval after its last run', () => {
  expect(getNextRerunDate(WEEKLY_WORKBOOK, DE_NOVO_WORKSHEET, RAN_RESULT).toISOString()).toEqual(
    '2026-12-02T10:00:00.000Z',
  )
  expect(getNextRerunDate(WEEKLY_WORKBOOK, DAILY_WORKSHEET, RAN_RESULT).toISOString()).toEqual(
    '2026-11-26T10:00:00.000Z',
  )
  expect(getNextRerunDate(WORKBOOK, DAILY_WORKSHEET, RAN_RESULT).toISOString()).toEqual('2026-11-26T10:00:00.000Z')
  expect(getNextRerunDate(WORKBOOK, DE_NOVO_WORKSHEET, RAN_RESULT)).toBeNull()
  expect(getNextRerunDate(WEEKLY_WORKBOOK, DE_NOVO_WORKSHEET, QUERY_RESULT)).toBeNull()
  expect(getNextRerunDate(WEEKLY_WORKBOOK, DE_NOVO_WORKSHEET)).toBeNull()
})

test('saves the automation of a workbook and of a worksheet, without an interval as null', async () => {
  const store = createTestStore()
  mockApi({
    [UPDATE_URL]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: WEEKLY_WORKBOOK } } },
    [WORKSHEET_UPDATE_URL]: { json: { worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: DAILY_WORKSHEET } } },
  })

  await store.dispatch(updateWorkbookAutomation(WORKBOOK_GUID, { rerunIntervalDays: 7, notifyOnNewResults: true }))
  await store.dispatch(updateWorkbookAutomation(WORKBOOK_GUID, { rerunIntervalDays: 0 }))
  expect(getRequests(UPDATE_URL)).toEqual([
    { rerunIntervalDays: 7, notifyOnNewResults: true }, { rerunIntervalDays: null, notifyOnNewResults: false },
  ])
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(WEEKLY_WORKBOOK)

  await store.dispatch(updateWorksheetAutomation(WORKBOOK_GUID, DE_NOVO_WORKSHEET_GUID, { rerunIntervalDays: 1 }))
  await store.dispatch(updateWorksheetAutomation(WORKBOOK_GUID, DE_NOVO_WORKSHEET_GUID, { rerunIntervalDays: 0 }))
  expect(getRequests(WORKSHEET_UPDATE_URL)).toEqual([{ rerunIntervalDays: 1 }, { rerunIntervalDays: null }])
  expect(store.getState().worksheetsByGuid[DE_NOVO_WORKSHEET_GUID]).toEqual(DAILY_WORKSHEET)
})

test('edits the rerun interval and the notification of a workbook', async () => {
  const { wrapper, store } = await renderWorkbook(withDetail({}, {
    [UPDATE_URL]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: WEEKLY_WORKBOOK } } },
  }))
  expect(getSummary(wrapper).text()).toContain('Automatic reruns: off')

  await click(wrapper, 'button[aria-label="Automatic reruns of workbook Trio analysis"]')
  const dropdown = getFormDropdown(wrapper)
  expect(dropdown.prop('value')).toEqual(0)
  expect(dropdown.prop('options').map(({ text }: { text: string }) => text)).toEqual(
    ['Off', 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly'],
  )
  const checkbox = getOpenModal(wrapper).find('Checkbox')
  expect(checkbox.prop('checked')).toBe(false)
  expect(checkbox.prop('label')).toEqual('Send a project notification and email the creator of this workbook when a rerun has new results to review')
  setDropdown(getOpenModal(wrapper), 'rerunIntervalDays', 7 as unknown as string)
  getOpenModal(wrapper).find('input[type="checkbox"]').simulate('change', { target: { checked: true } })
  await submitForm(wrapper)

  expect(getRequests(UPDATE_URL)).toEqual([{ rerunIntervalDays: 7, notifyOnNewResults: true }])
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(WEEKLY_WORKBOOK)
  expect(getSummary(wrapper).text()).toContain(
    'Automatic reruns: weekly, with a project notification and an email to the creator for new results',
  )
  expect(getOpenModal(wrapper).exists()).toBe(false)

  await click(wrapper, 'button[aria-label="Automatic reruns of workbook Trio analysis"]')
  expect(getFormDropdown(wrapper).prop('value')).toEqual(7)
  expect(getOpenModal(wrapper).find('Checkbox').prop('checked')).toBe(true)
})

test('shows the errors returned when saving the automation fails', async () => {
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [UPDATE_URL]: { status: 400, json: { errors: ['The rerun interval must be at least 1 day'] } },
  }))

  await click(wrapper, 'button[aria-label="Automatic reruns of workbook Trio analysis"]')
  await submitForm(wrapper)

  expect(getRequests(UPDATE_URL)).toEqual([{ rerunIntervalDays: null, notifyOnNewResults: false }])
  expect(getOpenModal(wrapper).text()).toContain('The rerun interval must be at least 1 day')
  expect(getSummary(wrapper).text()).toContain('Automatic reruns: off')
})

test('overrides the rerun interval for a worksheet and returns it to the workbook interval', async () => {
  const recessiveUpdateUrl = `${API_PATH}/worksheets/${RECESSIVE_WORKSHEET_GUID}/update`
  const { wrapper, store } = await renderWorkbook(withDetail({
    worksheetsByGuid: {
      ...WORKBOOK_DETAIL.worksheetsByGuid,
      [RECESSIVE_WORKSHEET_GUID]: { ...WORKBOOK_DETAIL.worksheetsByGuid[RECESSIVE_WORKSHEET_GUID], rerunIntervalDays: 30 },
    },
  }, {
    [WORKSHEET_UPDATE_URL]: { json: { worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: DAILY_WORKSHEET } } },
    [recessiveUpdateUrl]: { json: { worksheetsByGuid: { [RECESSIVE_WORKSHEET_GUID]: { rerunIntervalDays: null } } } },
  }))

  await click(wrapper, 'button[aria-label="Automatic reruns of worksheet De Novo"]')
  const dropdown = getFormDropdown(wrapper)
  expect(dropdown.prop('value')).toEqual(0)
  expect(dropdown.prop('options').map(({ text }: { text: string }) => text)).toEqual(
    ['Same as workbook', 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly'],
  )
  expect(getOpenModal(wrapper).find('Checkbox').exists()).toBe(false)
  setDropdown(getOpenModal(wrapper), 'rerunIntervalDays', 1 as unknown as string)
  await submitForm(wrapper)
  expect(getRequests(WORKSHEET_UPDATE_URL)).toEqual([{ rerunIntervalDays: 1 }])
  expect(store.getState().worksheetsByGuid[DE_NOVO_WORKSHEET_GUID].rerunIntervalDays).toEqual(1)

  await click(wrapper, 'button[aria-label="Automatic reruns of worksheet Recessive"]')
  expect(getFormDropdown(wrapper).prop('value')).toEqual(30)
  setDropdown(getOpenModal(wrapper), 'rerunIntervalDays', 0 as unknown as string)
  await submitForm(wrapper)
  expect(getRequests(recessiveUpdateUrl)).toEqual([{ rerunIntervalDays: null }])
  expect(store.getState().worksheetsByGuid[RECESSIVE_WORKSHEET_GUID].rerunIntervalDays).toBeNull()
  expect(getRequests(UPDATE_URL)).toEqual([])
})

test('shows the automation without controls to users who can not edit the workbook', async () => {
  const { wrapper } = await renderWorkbook(withDetail({
    workbooksByGuid: { [WORKBOOK_GUID]: { ...WEEKLY_WORKBOOK, canEdit: false } },
    worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT },
  }))

  expect(getSummary(wrapper).text()).toContain(
    'Automatic reruns: weekly, with a project notification and an email to the creator for new results',
  )
  expect(wrapper.find('button').filterWhere(
    (button: Wrapper) => (button.prop('aria-label') || '').startsWith('Automatic reruns'),
  ).exists()).toBe(false)
  expect(getRunInfo(wrapper)).toContain('Next rerun due at the first scheduled check after 12/2/2026')
})

test('shows when the selected cell is next due and when it was last rerun automatically', async () => {
  const cell = { ...RAN_RESULT, lastScheduledRunDate: '2026-11-24T10:00:00Z' }
  const { wrapper, store } = await renderWorkbook(withDetail({
    workbooksByGuid: { [WORKBOOK_GUID]: WEEKLY_WORKBOOK },
    worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: cell },
  }, {
    [`${API_PATH}/queries/${QUERY_RESULT.worksheetQueryGuid}/targets/${QUERY_RESULT.workbookTargetGuid}/history`]: {
      json: { worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: cell }, runs: [], totalRuns: 0 },
    },
  }))

  expect(getRunInfo(wrapper)).toContain('Last run 11/25/2026 by Test Manager User')
  expect(getRunInfo(wrapper)).not.toContain('(scheduled)')
  expect(getRunInfo(wrapper)).toContain('Last scheduled run 11/24/2026')
  expect(getRunInfo(wrapper)).toContain('Next rerun due at the first scheduled check after 12/2/2026')
  expect(wrapper.find('div[role="tabpanel"] div[title]').filterWhere(
    (node: Wrapper) => node.text().startsWith('Next rerun due'),
  ).prop('title')).toEqual(
    'The query is rerun at the first scheduled check after this date, or sooner after new data is loaded',
  )

  store.dispatch({
    type: 'RECEIVE_DATA',
    updatesById: {
      worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: DAILY_WORKSHEET },
      worksheetQueryResultsByGuid: {
        [QUERY_RESULT_GUID]: { ...cell, lastScheduledRunDate: '2026-11-25T10:00:00Z', lastRun: { ...RUN, trigger: 'D' } },
      },
    },
  })
  await flush(wrapper)
  expect(getRunInfo(wrapper)).toContain('Last run 11/25/2026 by Test Manager User (after data load)')
  expect(getRunInfo(wrapper)).toContain('Last scheduled run 11/25/2026')
  expect(getRunInfo(wrapper)).toContain('Next rerun due at the first scheduled check after 11/26/2026')

  store.dispatch({
    type: 'RECEIVE_DATA',
    updatesById: {
      workbooksByGuid: { [WORKBOOK_GUID]: WORKBOOK },
      worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: DE_NOVO_WORKSHEET },
      worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: { ...cell, lastRun: RUN } },
    },
  })
  await flush(wrapper)
  expect(getRunInfo(wrapper)).toContain('Last run 11/25/2026 by Test Manager User (scheduled)')
  expect(getRunInfo(wrapper)).not.toContain('Next rerun due')
})

test('shows no rerun dates for a cell that was never run', async () => {
  const { wrapper } = await renderWorkbook(withDetail({ workbooksByGuid: { [WORKBOOK_GUID]: WEEKLY_WORKBOOK } }))

  expect(getRunInfo(wrapper)).not.toContain('Next rerun due')
  expect(getRunInfo(wrapper)).not.toContain('Last scheduled run')
  expect(getRunInfo(wrapper)).not.toContain('Last run')
})
