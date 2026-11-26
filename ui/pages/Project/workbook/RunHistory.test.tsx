import React from 'react'

import { getRunChange } from './CellReview'
import {
  CDC7_GENE_ID, FAMILY_TARGET, FAMILY_TARGET_GUID, GROUP_QUERY_RESULT, GROUP_TARGET_GUID, MTHFR_GENE_ID, PROJECT_GUID,
  QUERY_RESULT, QUERY_RESULT_GUID, RECESSIVE_QUERY_GUID, RESTRICTIVE_QUERY_GUID, SEARCH_HASH, WORKBOOK_DETAIL,
  WORKBOOK_GUID,
} from './fixtures'
import {
  clickButton, clickLink, flush, getRequests, mockApi, renderProjectPage,
} from './testHelpers'
import { WorksheetQueryResult, WorksheetQueryRun } from './types'

jest.mock('../../../shared/components/panel/variants/Variants', () => (
  ({ variants }: { variants: ({ variantId: string } | { variantId: string }[])[] }) => (
    <div className="variants">
      {variants.map(variant => (Array.isArray(variant) ? variant : [variant]).map(v => v.variantId).join('+')).join()}
    </div>
  )
))

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const CELL_API_PATH = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/targets/${FAMILY_TARGET_GUID}`
const GROUP_CELL_API_PATH = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/targets/${GROUP_TARGET_GUID}`
const HISTORY_URL = `${CELL_API_PATH}/history`
const REVIEW_URL = `${CELL_API_PATH}/mark_reviewed`
const SEARCH_URL = `/api/search/${SEARCH_HASH}`
const GROUP_QUERY_RESULT_GUID = GROUP_QUERY_RESULT.worksheetQueryResultGuid

const RUN: WorksheetQueryRun = {
  runId: 5,
  createdDate: '2026-11-25T10:00:00Z',
  createdBy: 'Test User',
  trigger: 'M',
  status: 'C',
  error: null,
  numResults: 7,
  numNew: 2,
  numRemoved: 1,
  isUnchanged: false,
}
const RUNS: WorksheetQueryRun[] = [
  RUN,
  {
    ...RUN, runId: 4, createdDate: '2026-11-24T10:00:00Z', status: 'E', error: 'Invalid search', numResults: null, numNew: 0, numRemoved: 0,
  },
  {
    ...RUN, runId: 3, createdDate: '2026-11-23T10:00:00Z', status: 'T', error: 'This search returned too many results', numResults: null, numNew: 0, numRemoved: 0,
  },
  {
    ...RUN, runId: 2, createdDate: '2026-11-22T10:00:00Z', createdBy: null, numResults: 6, numNew: 0, numRemoved: 0, isUnchanged: true,
  },
  {
    ...RUN, runId: 1, createdDate: '2026-11-21T10:00:00Z', numResults: 6, numNew: 0, numRemoved: 0,
  },
]
const RAN_RESULT: WorksheetQueryResult = {
  ...QUERY_RESULT,
  searchHash: SEARCH_HASH,
  lastRunDate: '2026-11-25T10:00:00Z',
  lastRunBy: 'Test User',
  numResults: 7,
  hasUnreviewed: false,
  numUnreviewed: 0,
  lastRun: RUN,
}
const UNREVIEWED_RESULT: WorksheetQueryResult = { ...RAN_RESULT, hasUnreviewed: true, numUnreviewed: 2 }
const UNREVIEWED_GROUP_RESULT: WorksheetQueryResult = {
  ...GROUP_QUERY_RESULT, hasUnreviewed: true, numUnreviewed: 3, lastRun: RUN,
}
const HISTORY = {
  worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: UNREVIEWED_RESULT },
  runs: RUNS,
  totalRuns: 5,
  unreviewedResults: [
    { familyGuid: 'F011652_1', variantIds: ['1-100-A-T'], geneIds: [MTHFR_GENE_ID] },
    { familyGuid: 'F011652_1', variantIds: ['1-200-C-G', '1-300-G-A'], geneIds: [CDC7_GENE_ID, 'ENSG00000000001'] },
    { familyGuid: 'F000003_3', variantIds: ['DEL:chr1:600-700'], geneIds: [] as string[] },
  ],
  totalUnreviewedResults: 3,
  genesById: {
    [MTHFR_GENE_ID]: { geneId: MTHFR_GENE_ID, geneSymbol: 'MTHFR' },
    [CDC7_GENE_ID]: { geneId: CDC7_GENE_ID, geneSymbol: 'CDC7' },
  },
}

const SAVED_VARIANT = { familyGuids: ['F011652_1'], tagGuids: [] as string[] }
const SEARCH_JSON = {
  searchedVariantIds: ['1-100-A-T', '1-150-A-T', ['1-200-C-G', '1-300-G-A'], '1-400-A-T', '1-500-A-T', '1-600-A-T'],
  variantsById: ['1-100-A-T', '1-150-A-T', '1-200-C-G', '1-300-G-A', '1-400-A-T', '1-500-A-T', '1-600-A-T'].reduce(
    (acc, variantId) => ({ ...acc, [variantId]: { variantId, familyGuids: ['F011652_1'] } }), {},
  ),
  search: { search: {}, projectFamilies: [{ projectGuid: PROJECT_GUID, familyGuids: ['F011652_1'] }], totalResults: 6 },
}
// 1-150-A-T is excluded for another family, 1-600-A-T is saved with another tag and 1-100-A-T is not saved
const EXCLUDED_SEARCH_JSON = {
  ...SEARCH_JSON,
  savedVariantsByGuid: {
    SV1: { ...SAVED_VARIANT, variantGuid: 'SV1', variantId: '1-150-A-T', familyGuids: ['F000003_3'], tagGuids: ['VT1'] },
    SV2: { ...SAVED_VARIANT, variantGuid: 'SV2', variantId: '1-300-G-A', tagGuids: ['VT2', 'VT5'] },
    SV3: { ...SAVED_VARIANT, variantGuid: 'SV3', variantId: '1-400-A-T', tagGuids: ['VT3'] },
    SV4: { ...SAVED_VARIANT, variantGuid: 'SV4', variantId: '1-500-A-T', tagGuids: ['VT4'] },
    SV5: { ...SAVED_VARIANT, variantGuid: 'SV5', variantId: '1-600-A-T', tagGuids: ['VT5', 'VT_not_loaded'] },
    SV6: { ...SAVED_VARIANT, variantGuid: 'SV6', variantId: '1-200-C-G' },
  },
  variantTagsByGuid: {
    VT1: { tagGuid: 'VT1', name: 'Excluded', metadata: 'Benign', variantGuids: ['SV1'] },
    VT2: { tagGuid: 'VT2', name: 'Excluded', metadata: 'Benign', variantGuids: ['SV2'] },
    VT3: { tagGuid: 'VT3', name: 'Excluded', metadata: null as string, variantGuids: ['SV3'] },
    VT4: { tagGuid: 'VT4', name: 'Excluded', metadata: 'Benign', variantGuids: ['SV4'] },
    VT5: { tagGuid: 'VT5', name: 'Review', metadata: 'A note', variantGuids: ['SV2', 'SV5'] },
  },
}

const withCells = (cells: WorksheetQueryResult[], responses: Responses = {}): Responses => ({
  [API_PATH]: {
    json: {
      ...WORKBOOK_DETAIL,
      worksheetQueryResultsByGuid: cells.reduce((acc, cell) => ({ ...acc, [cell.worksheetQueryResultGuid]: cell }), {}),
    },
  },
  [SEARCH_URL]: { json: SEARCH_JSON },
  ...responses,
})

const renderWorkbook = async (responses: Responses, path = PATH) => {
  mockApi(responses)
  const rendered = renderProjectPage(path, {
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

const getBadges = (wrapper: Wrapper) => wrapper.find('div.label[role="img"]').map(
  (badge: Wrapper) => [badge.text(), badge.prop('aria-label'), badge.prop('title')],
)

const getPane = (wrapper: Wrapper) => wrapper.find('div[role="tabpanel"]')

const getDisclosure = (wrapper: Wrapper, label: string) => getPane(wrapper).find('button').filterWhere(
  (button: Wrapper) => button.text() === label,
)

const getVariantLists = (wrapper: Wrapper) => wrapper.find('div.variants').map((list: Wrapper) => list.text())

test('shows no alerts for a workbook without unreviewed results', async () => {
  const { wrapper } = await renderWorkbook(withCells([RAN_RESULT]))

  expect(getBadges(wrapper)).toEqual([])
  expect(getPane(wrapper).text()).not.toContain('since last review')
  expect(getPane(wrapper).find('.message').exists()).toBe(false)
  expect(getDisclosure(wrapper, 'History').prop('aria-expanded')).toBe(false)
  expect(getDisclosure(wrapper, 'New variants').exists()).toBe(false)
})

test('shows alert badges with text alternatives for the query, worksheet, target and workbook', async () => {
  const { wrapper } = await renderWorkbook(withCells([
    UNREVIEWED_RESULT,
    {
      ...UNREVIEWED_RESULT, worksheetQueryResultGuid: 'WQR2', worksheetQueryGuid: RECESSIVE_QUERY_GUID, searchHash: null, numUnreviewed: 1,
    },
    UNREVIEWED_GROUP_RESULT,
  ], {
    [HISTORY_URL]: { json: { ...HISTORY, worksheetQueryResultsByGuid: {} } },
  }))

  const getContexts = (selector: string) => wrapper.find(selector).find('div.label[role="img"]').map(
    (badge: Wrapper) => badge.prop('aria-label'),
  )
  expect(getContexts('[title="De novo and recessive review"]')).toEqual([
    '6 new results since the last review in this workbook',
  ])
  expect(getContexts('a[role="tab"]')).toEqual([
    '3 new results since the last review for 1', '3 new results since the last review for Test Group',
  ])
  expect(getContexts('nav section[aria-label="De Novo"]')).toEqual([
    '2 new results since the last review in this worksheet for 1',
    '2 new results since the last review of this query for 1',
  ])
  expect(getContexts('nav section[aria-label="Recessive"]')).toEqual([
    '1 new result since the last review in this worksheet for 1',
    '1 new result since the last review of this query for 1',
  ])
  expect(getBadges(wrapper)[0]).toEqual([
    '6 new', '6 new results since the last review in this workbook', '6 new results since the last review in this workbook',
  ])
  expect(wrapper.find('div.label[role="img"] i').map((icon: Wrapper) => icon.prop('aria-hidden'))).toEqual(
    ['true', 'true', 'true', 'true', 'true', 'true', 'true'],
  )

  // The sidebar shows the alerts of the selected target
  await clickLink(wrapper, 'Test Group3 new')
  expect(getContexts('nav section')).toEqual([
    '3 new results since the last review in this worksheet for Test Group',
    '3 new results since the last review of this query for Test Group',
  ])
})

test('shows the alerts of targets in the overflow menu', async () => {
  const targets = [1, 2, 3, 4, 5, 6, 7, 8].reduce((acc, order) => ({
    ...acc,
    [`WBT_${order}`]: { ...FAMILY_TARGET, workbookTargetGuid: `WBT_${order}`, familyGuid: `F_${order}`, order },
  }), {})
  const responses = withCells([{ ...UNREVIEWED_RESULT, workbookTargetGuid: 'WBT_8', searchHash: null }])
  responses[API_PATH] = { json: { ...(responses[API_PATH].json as object), workbookTargetsByGuid: targets } }
  const { wrapper } = await renderWorkbook(responses)

  expect(wrapper.find('Dropdown[aria-label="More families and analysis groups"] a').map((link: Wrapper) => link.text())).toEqual(
    ['F_7', 'F_82 new'],
  )
  expect(getBadges(wrapper).map(([, label]: string[]) => label)).toEqual([
    '2 new results since the last review in this workbook', '2 new results since the last review for F_8',
  ])
})

test('shows the new results since the last review and marks them as reviewed', async () => {
  const { wrapper } = await renderWorkbook(withCells([UNREVIEWED_RESULT], {
    [HISTORY_URL]: { json: HISTORY },
    [REVIEW_URL]: { json: { worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT } } },
  }))

  // The history is loaded for the selected cell and again once its results have been loaded
  expect(getRequests(HISTORY_URL)).toHaveLength(2)
  const banner = getPane(wrapper).find('.info.message')
  expect(banner.prop('role')).toEqual('status')
  expect(banner.find('b').text()).toEqual('2 new since last review')
  expect(getDisclosure(wrapper, 'New variants').prop('aria-expanded')).toBe(false)
  expect(getPane(wrapper).find('ul[aria-label="New variants"]').exists()).toBe(false)

  await clickButton(wrapper, 'New variants')
  expect(getDisclosure(wrapper, 'New variants').prop('aria-expanded')).toBe(true)
  const items = getPane(wrapper).find('ul[aria-label="New variants"] li')
  expect(items.map((item: Wrapper) => item.text())).toEqual([
    '1-100-A-TMTHFR', '1-200-C-G + 1-300-G-ACDC7, ENSG00000000001', 'DEL:chr1:600-700',
  ])
  expect(items.find('a').map((link: Wrapper) => [link.prop('href'), link.prop('target')])).toEqual([
    ['/variant_search/variant/1-100-A-T/family/F011652_1', '_blank'],
    ['/variant_search/variant/1-200-C-G/family/F011652_1', '_blank'],
    ['/variant_search/variant/1-300-G-A/family/F011652_1', '_blank'],
    ['/variant_search/variant/DEL:chr1:600-700/family/F000003_3', '_blank'],
  ])
  expect(getPane(wrapper).text()).not.toContain('Showing the first')

  await clickButton(wrapper, 'New variants')
  expect(getPane(wrapper).find('ul[aria-label="New variants"]').exists()).toBe(false)

  mockApi(withCells([RAN_RESULT], {
    [HISTORY_URL]: {
      json: {
        ...HISTORY, worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT }, unreviewedResults: [], totalUnreviewedResults: 0,
      },
    },
    [REVIEW_URL]: { json: { worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT } } },
  }))
  await clickButton(wrapper, 'Mark reviewed')
  expect(getRequests(REVIEW_URL)).toEqual([{}])
  expect(getRequests(HISTORY_URL)).toHaveLength(3)
  expect(getPane(wrapper).find('.info.message').exists()).toBe(false)
  expect(getBadges(wrapper)).toEqual([])
  expect(getVariantLists(wrapper)).toHaveLength(1)
})

test('shows the families of new results for an analysis group, and how many are listed', async () => {
  const { wrapper } = await renderWorkbook(withCells([UNREVIEWED_GROUP_RESULT], {
    [`${GROUP_CELL_API_PATH}/history`]: {
      json: {
        ...HISTORY, worksheetQueryResultsByGuid: { [GROUP_QUERY_RESULT_GUID]: UNREVIEWED_GROUP_RESULT }, totalUnreviewedResults: 40,
      },
    },
  }), `${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)

  // The search of a group is not run to show its patterns, so the history is loaded once
  expect(getRequests(`${GROUP_CELL_API_PATH}/history`)).toHaveLength(1)
  expect(getRequests(SEARCH_URL)).toHaveLength(0)
  expect(getPane(wrapper).find('.info.message b').text()).toEqual('3 new since last review')

  await clickButton(wrapper, 'New variants')
  expect(getPane(wrapper).find('ul[aria-label="New variants"] li').map((item: Wrapper) => item.text())).toEqual([
    '1-100-A-TMTHFR1', '1-200-C-G + 1-300-G-ACDC7, ENSG000000000011', 'DEL:chr1:600-700F000003_3',
  ])
  expect(getPane(wrapper).text()).toContain('Showing the first 3 of 40')
})

test('shows the error when marking as reviewed fails', async () => {
  const { wrapper } = await renderWorkbook(withCells([UNREVIEWED_RESULT], {
    [HISTORY_URL]: { json: HISTORY },
    [REVIEW_URL]: { status: 400, json: { errors: ['This query has no results for 1 to mark as reviewed'] } },
  }))

  await clickButton(wrapper, 'Mark reviewed')
  expect(getPane(wrapper).find('.error.message').text()).toEqual('This query has no results for 1 to mark as reviewed')
  expect(getPane(wrapper).find('.info.message b').text()).toEqual('2 new since last review')
  expect(getRequests(HISTORY_URL)).toHaveLength(2)
})

test('lists the runs of a cell in the history', async () => {
  const { wrapper } = await renderWorkbook(withCells([RAN_RESULT], {
    [HISTORY_URL]: { json: { ...HISTORY, worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT }, totalRuns: 60 } },
  }))

  expect(getPane(wrapper).find('table[aria-label="Run history"]').exists()).toBe(false)
  await clickButton(wrapper, 'History')

  expect(getDisclosure(wrapper, 'History').prop('aria-expanded')).toBe(true)
  const table = getPane(wrapper).find('table[aria-label="Run history"]')
  expect(table.find('th').map((header: Wrapper) => header.text())).toEqual(['Date', 'Run by', 'Results', 'Change'])
  expect(table.find('tbody tr').map((row: Wrapper) => row.find('td').map((cell: Wrapper) => cell.text()))).toEqual([
    ['11/25/2026', 'Test User', '7', '+2 new / −1 removed'],
    ['11/24/2026', 'Test User', '', 'Failed: Invalid search'],
    ['11/23/2026', 'Test User', '', 'Not completed: the search returned too many results'],
    ['11/22/2026', 'unknown user', '6', 'No change'],
    ['11/21/2026', 'Test User', '6', 'First results'],
  ])
  expect(getPane(wrapper).text()).toContain('Showing the last 5 of 60 runs')
  expect(getPane(wrapper).find('.warning.message').exists()).toBe(false)

  await clickButton(wrapper, 'History')
  expect(getPane(wrapper).find('table[aria-label="Run history"]').exists()).toBe(false)
})

test('describes the change of a run with only new or only removed results', () => {
  expect(getRunChange({ ...RUN, numNew: 3, numRemoved: 0 })).toEqual('+3 new / −0 removed')
  expect(getRunChange({ ...RUN, numNew: 0, numRemoved: 4 })).toEqual('+0 new / −4 removed')
})

test('warns when the last run did not complete and shows the error when the history fails to load', async () => {
  const failedResult = { ...UNREVIEWED_RESULT, lastRun: RUNS[2] }
  const { wrapper } = await renderWorkbook(withCells([failedResult], {
    [HISTORY_URL]: { status: 403, json: { error: 'Permission Denied' } },
  }))

  const warning = getPane(wrapper).find('.warning.message')
  expect(warning.prop('role')).toEqual('status')
  expect(warning.text()).toEqual(
    'The last run on 11/23/2026 did not complete. Not completed: the search returned too many results',
  )
  expect(getPane(wrapper).find('.info.message b').text()).toEqual('2 new since last review')
  expect(getPane(wrapper).find('.error.message').exists()).toBe(false)

  await clickButton(wrapper, 'New variants')
  expect(getPane(wrapper).find('ul[aria-label="New variants"] li')).toHaveLength(0)

  await clickButton(wrapper, 'History')
  expect(getPane(wrapper).find('.error.message').text()).toEqual('Permission Denied')
  expect(getPane(wrapper).find('table[aria-label="Run history"]').exists()).toBe(false)
})

test('shows the alert of a cell once its run has been recorded with its loaded results', async () => {
  const runUrl = `${CELL_API_PATH}/run`
  const ranResult = { ...RAN_RESULT, lastRun: null as WorksheetQueryRun }
  const { wrapper } = await renderWorkbook(withCells([QUERY_RESULT], {
    [runUrl]: { json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: ranResult } } },
    [HISTORY_URL]: { json: HISTORY },
  }))

  expect(getRequests(HISTORY_URL)).toHaveLength(0)
  expect(getDisclosure(wrapper, 'History').exists()).toBe(false)

  await clickButton(wrapper, 'Run')
  await flush(wrapper)
  await flush(wrapper)

  expect(getRequests(SEARCH_URL)).toHaveLength(1)
  expect(getRequests(HISTORY_URL).length).toBeGreaterThan(0)
  expect(getPane(wrapper).find('.info.message b').text()).toEqual('2 new since last review')
  expect(getBadges(wrapper).map(([text]: string[]) => text)).toEqual(['2 new', '2 new', '2 new', '2 new'])
  expect(getDisclosure(wrapper, 'History').exists()).toBe(true)
})

test('never shows the history of another cell', async () => {
  const otherResult = {
    ...RAN_RESULT, worksheetQueryResultGuid: 'WQR2', worksheetQueryGuid: RECESSIVE_QUERY_GUID, searchHash: null as string,
  }
  let finishHistory: () => void
  const wait = new Promise<void>((resolve) => {
    finishHistory = resolve
  })
  const { wrapper } = await renderWorkbook(withCells([{ ...RAN_RESULT, searchHash: null }, otherResult], {
    [HISTORY_URL]: { json: HISTORY },
  }))
  await clickButton(wrapper, 'History')
  expect(getRequests(HISTORY_URL)).toHaveLength(0)
  expect(getPane(wrapper).find('table[aria-label="Run history"] tbody tr')).toHaveLength(0)

  // A cell with results loads its history, which is not shown for the cell that is selected when it arrives
  const { wrapper: lateWrapper, store } = await renderWorkbook(
    withCells([RAN_RESULT, otherResult], { [HISTORY_URL]: { json: HISTORY, wait } }),
  )
  await clickLink(lateWrapper, 'Recessive')
  finishHistory()
  await flush(lateWrapper)
  expect(store.getState().workbookCellHistory.cellKey).toEqual(`${RESTRICTIVE_QUERY_GUID}/${FAMILY_TARGET_GUID}`)
  await clickButton(lateWrapper, 'History')
  expect(getPane(lateWrapper).find('h3').text()).toEqual('Recessive1')
  expect(getPane(lateWrapper).find('table[aria-label="Run history"] tbody tr')).toHaveLength(0)
  expect(getPane(lateWrapper).text()).not.toContain('Showing the last')
})

test('moves the excluded variants of a family into a collapsed section grouped by reason', async () => {
  const { wrapper } = await renderWorkbook(withCells([RAN_RESULT], { [SEARCH_URL]: { json: EXCLUDED_SEARCH_JSON } }))

  expect(getPane(wrapper).text()).toContain('Found 6')
  expect(getVariantLists(wrapper)).toEqual(['1-100-A-T,1-150-A-T,1-600-A-T'])
  const section = () => getPane(wrapper).find('section[aria-label="Excluded variants"]')
  expect(section().find('button').text()).toEqual('Excluded (3)')
  expect(section().find('button').prop('aria-expanded')).toBe(false)
  expect(section().find('h5').exists()).toBe(false)

  await clickButton(wrapper, 'Excluded (3)')
  expect(section().find('button').prop('aria-expanded')).toBe(true)
  expect(section().find('div[role="group"]').map((group: Wrapper) => [
    group.prop('aria-label'), group.find('h5').text(), group.find('div.variants').text(),
  ])).toEqual([
    ['Excluded: Benign', 'Benign (2)', '1-200-C-G+1-300-G-A,1-500-A-T'],
    ['Excluded: No reason given', 'No reason given (1)', '1-400-A-T'],
  ])
  expect(getVariantLists(wrapper)[0]).toEqual('1-100-A-T,1-150-A-T,1-600-A-T')

  await clickButton(wrapper, 'Excluded (3)')
  expect(section().find('button').prop('aria-expanded')).toBe(false)
  expect(getVariantLists(wrapper)).toEqual(['1-100-A-T,1-150-A-T,1-600-A-T'])
})

test('shows no excluded section without excluded variants, or for the variants of an analysis group', async () => {
  const { wrapper } = await renderWorkbook(withCells([RAN_RESULT]))
  expect(getVariantLists(wrapper)).toEqual(['1-100-A-T,1-150-A-T,1-200-C-G+1-300-G-A,1-400-A-T,1-500-A-T,1-600-A-T'])
  expect(getPane(wrapper).find('section[aria-label="Excluded variants"]').exists()).toBe(false)

  const group = await renderWorkbook(
    withCells([GROUP_QUERY_RESULT], { [SEARCH_URL]: { json: EXCLUDED_SEARCH_JSON } }),
    `${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`,
  )
  await clickButton(group.wrapper, 'All variants')
  await flush(group.wrapper)
  expect(getVariantLists(group.wrapper)).toEqual(
    ['1-100-A-T,1-150-A-T,1-200-C-G+1-300-G-A,1-400-A-T,1-500-A-T,1-600-A-T'],
  )
  expect(getPane(group.wrapper).find('section[aria-label="Excluded variants"]').exists()).toBe(false)
})
