import React from 'react'

import {
  CDC7_GENE_ID, FAMILY_TARGET_GUID, GROUP_QUERY_RESULT, GROUP_SUMMARY_RESPONSE, GROUP_TARGET_GUID,
  MTHFR_GENE_ID, PROJECT_GUID, QUERY_RESULT, QUERY_RESULT_GUID, RESTRICTIVE_QUERY, RESTRICTIVE_QUERY_GUID, SEARCH_HASH,
  UNKNOWN_GENE_ID, WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import {
  clickButton, clickLink, flush, getRequests, mockApi, renderProjectPage,
} from './testHelpers'

jest.mock('../../../shared/components/panel/variants/Variants', () => (
  ({ variants }: { variants: { variantId: string }[] }) => (
    <div id="variants">{variants.map(({ variantId }) => variantId).join()}</div>
  )
))

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const CELL_API_PATH = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/targets/${GROUP_TARGET_GUID}`
const SUMMARY_URL = `${CELL_API_PATH}/summary`
const RUN_URL = `${CELL_API_PATH}/run`
const SEARCH_URL = `/api/search/${SEARCH_HASH}`
const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const GROUP_PATH = `${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`
const GROUP_QUERY_RESULT_GUID = GROUP_QUERY_RESULT.worksheetQueryResultGuid

const SEARCH_RESPONSE = {
  [SEARCH_URL]: {
    json: {
      searchedVariantIds: ['SV0000001_var'],
      variantsById: { SV0000001_var: { variantId: 'SV0000001_var' } },
      search: {
        search: {}, projectFamilies: [{ projectGuid: PROJECT_GUID, familyGuids: ['F011652_1'] }], totalResults: 4,
      },
    },
  },
}
const RAN_DETAIL = {
  ...WORKBOOK_DETAIL,
  worksheetQueryResultsByGuid: { [GROUP_QUERY_RESULT_GUID]: GROUP_QUERY_RESULT },
}
const NOT_LOADED_ERROR = 'The results of this query for Test Group are no longer stored, run it again to see patterns'
const NOT_LOADED = { status: 409, json: { errors: [NOT_LOADED_ERROR], resultsNotLoaded: true } }
const DESCRIPTIVE_NOTE = 'These counts are descriptive. They are not statistical tests'

const withSummary = (summary: Responses[string], detail: object = RAN_DETAIL): Responses => ({
  [API_PATH]: { json: detail }, [SUMMARY_URL]: summary, ...SEARCH_RESPONSE,
})

const renderGroup = async (responses: Responses = withSummary({ json: GROUP_SUMMARY_RESPONSE }), path = GROUP_PATH) => {
  mockApi(responses)
  const rendered = renderProjectPage(path, {
    workbooksByGuid: {},
    workbookTargetsByGuid: {},
    worksheetsByGuid: {},
    worksheetQueriesByGuid: {},
    worksheetQueryResultsByGuid: {},
  })
  await flush(rendered.wrapper)
  return rendered
}

const getPaneText = (wrapper: Wrapper) => wrapper.find('div[role="tabpanel"]').text()

const getTable = (wrapper: Wrapper, label: string) => wrapper.find(`table[aria-label="${label}"]`).find('tr').map(
  (row: Wrapper) => Array.from(row.getDOMNode().children).map((cell: Element) => cell.textContent),
)

const getBars = (wrapper: Wrapper, label: string) => wrapper.find(`table[aria-label="${label}"] progress`).map(
  (bar: Wrapper) => [bar.prop('aria-label'), bar.prop('value'), bar.prop('max')],
)

const getViews = (wrapper: Wrapper) => wrapper.find('div[aria-label="Results view"] button').map(
  (button: Wrapper) => [button.text(), button.prop('aria-pressed')],
)

const getSummaryUrls = () => (fetch as jest.Mock).mock.calls.map(([url]) => url).filter(
  (url: string) => url.startsWith(SUMMARY_URL),
)

const ALL_RESULTS_HEADER = 'Of those, families with at least one result'
const CATEGORY_ROWS = [
  ['Nervous System', '3', '2 of 3 (67%)'],
  ['Terms without a category', '1', '1 of 1 (100%)'],
  ['Cardiovascular', '1', '0 of 1 (0%)'],
  ['HP:9000000', '1', '1 of 1 (100%)'],
]

test('shows the patterns of an analysis group that was run instead of its variants', async () => {
  const { wrapper } = await renderGroup()

  expect(getSummaryUrls()).toEqual([`${SUMMARY_URL}?`])
  expect(getRequests(SEARCH_URL)).toHaveLength(0)
  expect(getRequests(RUN_URL)).toHaveLength(0)
  expect(wrapper.find('#variants').exists()).toBe(false)
  expect(getViews(wrapper)).toEqual([['Patterns', true], ['All variants', false]])

  expect(wrapper.find('.info.message').text()).toContain(DESCRIPTIVE_NOTE)
  expect(wrapper.find('.info.message').text()).toContain('small groups are easy to over-read')
  expect(wrapper.find('.info.message').text()).toContain('notes and other free text are not used')
  expect(wrapper.find('.statistic').hostNodes().map((statistic: Wrapper) => statistic.text())).toEqual([
    '4Families in the group', '2Families with at least one result', '4Variants found', '3Families with HPO terms',
  ])

  expect(getTable(wrapper, 'Genes')).toEqual([
    ['Gene', 'Families with a result', 'Variants'],
    ['MTHFR', '2 of 4', '2'],
    ['CDC7', '1 of 4', '2'],
    [UNKNOWN_GENE_ID, '1 of 4', '1'],
  ])
  expect(wrapper.find('table[aria-label="Genes"] button').map((button: Wrapper) => button.prop('aria-pressed'))).toEqual(
    [false, false, false],
  )
  expect(wrapper.find('div[aria-label="Selected gene"]').exists()).toBe(false)
  expect(getTable(wrapper, 'Recurrent variants')).toEqual([
    ['Variant', 'Genes', 'Families with the variant'],
    ['1-100-A-T', `MTHFR, ${UNKNOWN_GENE_ID}`, '2 of 4'],
  ])
  expect(getTable(wrapper, 'HPO category')).toEqual([
    ['HPO category', 'Families with the phenotype', ALL_RESULTS_HEADER], ...CATEGORY_ROWS,
  ])
  expect(getBars(wrapper, 'HPO category')).toEqual([
    ['Nervous System: 2 of 3 families', 2, 3],
    ['Terms without a category: 1 of 1 families', 1, 1],
    ['Cardiovascular: 0 of 1 families', 0, 1],
    ['HP:9000000: 1 of 1 families', 1, 1],
  ])
  expect(getTable(wrapper, 'HPO term')).toEqual([
    ['HPO term', 'Families with the phenotype', ALL_RESULTS_HEADER],
    ['Morphological abnormality of the central nervous system (HP:0002011)', '3', '2 of 3 (67%)'],
    ['HP:9999999', '1', '1 of 1 (100%)'],
  ])
  expect(getPaneText(wrapper)).toContain('Showing the 2 with the most families of 7')
  expect(getPaneText(wrapper).match(/Showing the/g)).toHaveLength(1)
  expect(getPaneText(wrapper)).toContain('Last run 11/22/2026 by Test User')
  expect(getPaneText(wrapper)).toContain('4 results')
})

test('restricts the phenotype counts to the selected gene and clears the restriction', async () => {
  const { wrapper } = await renderGroup()

  mockApi(withSummary({
    json: {
      ...GROUP_SUMMARY_RESPONSE,
      phenotypeGeneId: CDC7_GENE_ID,
      phenotypeCategories: [{ id: 'HP:0000707', name: null, numFamilies: 3, numFamiliesWithResults: 1 }],
    },
  }))
  await clickButton(wrapper, 'CDC7')

  expect(getSummaryUrls()).toEqual([`${SUMMARY_URL}?`, `${SUMMARY_URL}?geneId=${CDC7_GENE_ID}`])
  expect(getTable(wrapper, 'HPO category')).toEqual([
    ['HPO category', 'Families with the phenotype', 'Of those, families with a result in CDC7'],
    ['Nervous System', '3', '1 of 3 (33%)'],
  ])
  expect(getTable(wrapper, 'HPO term')[0][2]).toEqual('Of those, families with a result in CDC7')
  expect(wrapper.find('table[aria-label="Genes"] button').map((button: Wrapper) => button.prop('aria-pressed'))).toEqual(
    [false, true, false],
  )
  const selected = wrapper.find('div[aria-label="Selected gene"]')
  expect(selected.find('.header').first().text()).toEqual('CDC7: results in 1 of 4 families1')
  expect(selected.text()).toContain('The variant list can not be filtered to a gene or to families')

  mockApi(withSummary({ json: GROUP_SUMMARY_RESPONSE }))
  await clickButton(wrapper, 'Clear gene')
  expect(getSummaryUrls()).toHaveLength(3)
  expect(getSummaryUrls()[2]).toEqual(`${SUMMARY_URL}?`)
  expect(wrapper.find('div[aria-label="Selected gene"]').exists()).toBe(false)
  expect(getTable(wrapper, 'HPO category')).toEqual([
    ['HPO category', 'Families with the phenotype', ALL_RESULTS_HEADER], ...CATEGORY_ROWS,
  ])
})

test('keeps the counts on screen with a loader while the counts for a gene are loading', async () => {
  const { wrapper } = await renderGroup()
  expect(wrapper.find('div[role="tabpanel"] .loader').exists()).toBe(false)

  let finish: () => void
  const wait = new Promise<void>((resolve) => {
    finish = resolve
  })
  mockApi(withSummary({ json: { ...GROUP_SUMMARY_RESPONSE, phenotypeGeneId: MTHFR_GENE_ID }, wait }))
  await clickButton(wrapper, 'MTHFR')

  expect(wrapper.find('div[role="tabpanel"] .loader').hostNodes()).toHaveLength(1)
  expect(getTable(wrapper, 'HPO category')[0][2]).toEqual(ALL_RESULTS_HEADER)
  expect(wrapper.find('div[aria-label="Selected gene"] .header').first().text()).toEqual(
    'MTHFR: results in 2 of 4 families1, F000003_3',
  )

  finish()
  await flush(wrapper)
  expect(wrapper.find('div[role="tabpanel"] .loader').exists()).toBe(false)
  expect(getTable(wrapper, 'HPO category')[0][2]).toEqual('Of those, families with a result in MTHFR')
})

test('offers the variant list of the group and a search for the selected gene in its families', async () => {
  const open = jest.spyOn(window, 'open').mockImplementation(() => null)
  const { wrapper, store } = await renderGroup()
  await clickButton(wrapper, UNKNOWN_GENE_ID)

  await clickButton(wrapper, `Search ${UNKNOWN_GENE_ID} in these families`)
  await flush(wrapper)
  expect(open).toHaveBeenCalledTimes(1)
  const [url, target] = open.mock.calls[0]
  expect(url).toMatch(/^\/variant_search\/results\/[0-9a-f]{32}$/)
  expect(target).toEqual('_blank')
  const searchHash = (url as string).split('/').pop()
  expect((store.getState().searchesByHash as Record<string, unknown>)[searchHash]).toEqual({
    allGenomeProjectFamilies: false,
    projectFamilies: [{ familyGuids: ['F000003_3'] }],
    search: { ...RESTRICTIVE_QUERY.search, locus: { rawItems: UNKNOWN_GENE_ID } },
  })
  expect(getRequests(SEARCH_URL)).toHaveLength(0)

  await clickButton(wrapper, 'Show all variants')
  await flush(wrapper)
  expect(getViews(wrapper)).toEqual([['Patterns', false], ['All variants', true]])
  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var')
  expect(getRequests(SEARCH_URL)).toHaveLength(1)
  expect(wrapper.find('table[aria-label="Genes"]').exists()).toBe(false)
  open.mockRestore()
})

test('toggles between the patterns and all variants of the group', async () => {
  const { wrapper } = await renderGroup()

  await clickButton(wrapper, 'All variants')
  await flush(wrapper)
  expect(getViews(wrapper)).toEqual([['Patterns', false], ['All variants', true]])
  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var')
  expect(getPaneText(wrapper)).toContain('Showing 1-1 of 4')
  expect(getPaneText(wrapper)).not.toContain(DESCRIPTIVE_NOTE)
  expect(getSummaryUrls()).toHaveLength(1)

  await clickButton(wrapper, 'Patterns')
  expect(getViews(wrapper)).toEqual([['Patterns', true], ['All variants', false]])
  expect(wrapper.find('#variants').exists()).toBe(false)
  expect(getSummaryUrls()).toHaveLength(2)
  expect(getTable(wrapper, 'Genes')).toHaveLength(4)
})

test('runs the search of a group that was not run yet and then shows its patterns', async () => {
  const consoleError = jest.spyOn(console, 'error')
  const { wrapper } = await renderGroup({
    ...withSummary({ json: GROUP_SUMMARY_RESPONSE }, WORKBOOK_DETAIL),
    [RUN_URL]: {
      json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [GROUP_QUERY_RESULT_GUID]: GROUP_QUERY_RESULT } },
    },
  })

  expect(getPaneText(wrapper)).toContain('This query has not been run for Test Group yet')
  expect(wrapper.find('div[aria-label="Results view"]').exists()).toBe(false)
  expect(getSummaryUrls()).toHaveLength(0)

  await clickButton(wrapper, 'Run')
  await flush(wrapper)

  expect(getRequests(RUN_URL)).toEqual([{}])
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url).filter((url: string) => url.startsWith(SEARCH_URL))).toEqual(
    [`${SEARCH_URL}?per_page=1`],
  )
  expect(getSummaryUrls()).toEqual([`${SUMMARY_URL}?`])
  expect(getTable(wrapper, 'Genes')).toHaveLength(4)
  expect(wrapper.find('#variants').exists()).toBe(false)
  expect(getPaneText(wrapper)).toContain('4 results')
  expect(getPaneText(wrapper)).not.toContain('has not been run')
  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})

test('asks to run the query again when its results are no longer stored', async () => {
  const { wrapper } = await renderGroup(withSummary(NOT_LOADED))

  expect(wrapper.find('div[role="tabpanel"] .warning.message p').text()).toEqual(NOT_LOADED_ERROR)
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.find('div[role="tabpanel"] .error.message').exists()).toBe(false)
  expect(getRequests(SEARCH_URL)).toHaveLength(0)

  mockApi({
    ...withSummary({ json: GROUP_SUMMARY_RESPONSE }),
    [RUN_URL]: {
      json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [GROUP_QUERY_RESULT_GUID]: GROUP_QUERY_RESULT } },
    },
  })
  await clickButton(wrapper, 'Run again')
  await flush(wrapper)

  expect(getRequests(RUN_URL)).toEqual([{}])
  expect(getRequests(SEARCH_URL)).toEqual([{}])
  expect(getSummaryUrls()).toHaveLength(2)
  expect(wrapper.find('div[role="tabpanel"] .warning.message').exists()).toBe(false)
  expect(getTable(wrapper, 'Genes')).toHaveLength(4)
})

test('shows the error when the search of a group fails and still asks to run it', async () => {
  const { wrapper } = await renderGroup({
    ...withSummary(NOT_LOADED, WORKBOOK_DETAIL),
    [RUN_URL]: {
      json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [GROUP_QUERY_RESULT_GUID]: GROUP_QUERY_RESULT } },
    },
    [SEARCH_URL]: { status: 400, json: { error: 'This search returned too many variants' } },
  })

  await clickButton(wrapper, 'Run')
  await flush(wrapper)

  expect(wrapper.find('div[role="tabpanel"] .error.message').text()).toEqual('This search returned too many variants')
  expect(wrapper.find('div[role="tabpanel"] .warning.message p').text()).toEqual(NOT_LOADED_ERROR)
})

test('shows the error when the patterns fail to load', async () => {
  const { wrapper } = await renderGroup(withSummary({ status: 500, json: {} }))

  expect(wrapper.find('div[role="tabpanel"] .error.message').text()).toEqual('error (500)')
  expect(wrapper.find('div[role="tabpanel"] .warning.message').exists()).toBe(false)
  expect(wrapper.find('table').exists()).toBe(false)
  expect(getViews(wrapper)).toEqual([['Patterns', true], ['All variants', false]])
})

test('shows a loader until the patterns are loaded', async () => {
  let finish: () => void
  const wait = new Promise<void>((resolve) => {
    finish = resolve
  })
  const { wrapper } = await renderGroup(withSummary({ json: GROUP_SUMMARY_RESPONSE, wait }))

  expect(wrapper.find('div[role="tabpanel"] .loader').hostNodes()).toHaveLength(1)
  expect(wrapper.find('table').exists()).toBe(false)

  finish()
  await flush(wrapper)
  expect(wrapper.find('div[role="tabpanel"] .loader').exists()).toBe(false)
  expect(getTable(wrapper, 'Genes')).toHaveLength(4)
})

test('shows empty patterns for a group without results or HPO terms', async () => {
  const { wrapper } = await renderGroup(withSummary({
    json: {
      ...GROUP_SUMMARY_RESPONSE,
      numFamiliesWithResults: 0,
      numFamiliesWithPhenotypes: 0,
      totalVariants: 0,
      genes: [],
      totalGenes: 0,
      recurrentVariants: [],
      totalRecurrentVariants: 0,
      phenotypeCategories: [],
      phenotypeTerms: [],
      totalPhenotypeTerms: 0,
      genesById: {},
    },
  }))

  expect(getTable(wrapper, 'Genes')[1]).toEqual(['No results in any gene'])
  expect(getTable(wrapper, 'Recurrent variants')[1]).toEqual(['No variant was found in more than one family'])
  const noTerms = ['No HPO terms are recorded for the affected individuals of this group']
  expect(getTable(wrapper, 'HPO category')[1]).toEqual(noTerms)
  expect(getTable(wrapper, 'HPO term')[1]).toEqual(noTerms)
  expect(wrapper.find('progress').exists()).toBe(false)
  expect(getPaneText(wrapper)).not.toContain('Showing the')
})

test('never shows the patterns of another cell', async () => {
  const otherSummaryUrl = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/targets/WBT0000003_other_group/summary`
  const { wrapper } = await renderGroup({
    ...withSummary({ json: GROUP_SUMMARY_RESPONSE }, {
      ...RAN_DETAIL,
      workbookTargetsByGuid: {
        ...WORKBOOK_DETAIL.workbookTargetsByGuid,
        WBT0000003_other_group: {
          ...WORKBOOK_DETAIL.workbookTargetsByGuid[GROUP_TARGET_GUID],
          workbookTargetGuid: 'WBT0000003_other_group',
          analysisGroupGuid: 'AG0000184_other',
          order: 2,
        },
      },
      worksheetQueryResultsByGuid: {
        [GROUP_QUERY_RESULT_GUID]: GROUP_QUERY_RESULT,
        WQR3: { ...GROUP_QUERY_RESULT, worksheetQueryResultGuid: 'WQR3', workbookTargetGuid: 'WBT0000003_other_group' },
      },
    }),
    [otherSummaryUrl]: NOT_LOADED,
  })
  expect(getTable(wrapper, 'Genes')).toHaveLength(4)

  await clickLink(wrapper, 'AG0000184_other')
  expect(getRequests(otherSummaryUrl)).toHaveLength(1)
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.find('div[role="tabpanel"] .warning.message p').text()).toEqual(NOT_LOADED_ERROR)
})

test('family targets show their variants without a patterns view', async () => {
  const { wrapper } = await renderGroup(withSummary({ json: GROUP_SUMMARY_RESPONSE }, {
    ...WORKBOOK_DETAIL,
    worksheetQueryResultsByGuid: {
      [QUERY_RESULT_GUID]: { ...QUERY_RESULT, searchHash: SEARCH_HASH, lastRunDate: GROUP_QUERY_RESULT.lastRunDate },
    },
  }), `${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)
  await flush(wrapper)

  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var')
  expect(wrapper.find('div[aria-label="Results view"]').exists()).toBe(false)
  expect(getPaneText(wrapper)).not.toContain(DESCRIPTIVE_NOTE)
  expect(getSummaryUrls()).toHaveLength(0)
})
