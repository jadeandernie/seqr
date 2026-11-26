import React from 'react'

import {
  DE_NOVO_WORKSHEET_GUID, FAMILY_TARGET, FAMILY_TARGET_GUID, GROUP_TARGET_GUID, PERMISSIVE_QUERY_GUID, PROJECT_GUID,
  QUERY_RESULT, QUERY_RESULT_GUID, RECESSIVE_QUERY, RECESSIVE_QUERY_GUID, RECESSIVE_WORKSHEET_GUID,
  RESTRICTIVE_QUERY_GUID, SAVED_SEARCH_GUID, SEARCH_HASH, WORKBOOK, WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import {
  click, clickButton, clickLink, confirm, flush, getOpenModal, getRequests, mockApi, renderProjectPage, setDropdown,
  setInput, submitForm,
} from './testHelpers'
import { WorksheetQueryResult } from './types'

jest.mock('../../../shared/components/panel/variants/Variants', () => (
  ({ variants }: { variants: { variantId: string }[] }) => (
    <div id="variants">{variants.map(({ variantId }) => variantId).join()}</div>
  )
))

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const CELL_API_PATH = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/targets/${FAMILY_TARGET_GUID}`
const SEARCH_URL = `/api/search/${SEARCH_HASH}`
const RAN_RESULT: WorksheetQueryResult = {
  ...QUERY_RESULT, searchHash: SEARCH_HASH, lastRunDate: '2026-11-22T10:00:00Z', lastRunBy: 'Test User', numResults: 7,
}
const SEARCH_RESPONSE = {
  [SEARCH_URL]: {
    json: {
      searchedVariantIds: ['SV0000001_var', 'SV0000002_var'],
      variantsById: { SV0000001_var: { variantId: 'SV0000001_var' }, SV0000002_var: { variantId: 'SV0000002_var' } },
      search: {
        search: {}, projectFamilies: [{ projectGuid: PROJECT_GUID, familyGuids: ['F011652_1'] }], totalResults: 2,
      },
    },
  },
}

const withDetail = (detail: object = {}, responses: Responses = {}): Responses => ({
  [API_PATH]: { json: { ...WORKBOOK_DETAIL, ...detail } }, ...responses,
})

const renderWorkbook = async (responses: Responses = withDetail(), path = PATH) => {
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

const getTabs = (wrapper: Wrapper) => wrapper.find('a[role="tab"]').map((tab: Wrapper) => ({
  text: tab.text(), selected: tab.prop('aria-selected'), tabIndex: tab.prop('tabIndex'), href: tab.prop('href'),
}))

const getSidebar = (wrapper: Wrapper) => wrapper.find('nav[aria-label="Worksheets"] section').map(
  (section: Wrapper) => ({
    name: section.prop('aria-label'),
    queries: section.find('li a').map((link: Wrapper) => link.text()),
    current: section.find('li a[aria-current="page"]').map((link: Wrapper) => link.text()),
    icons: section.find('i[role="img"]').map((icon: Wrapper) => icon.prop('aria-label')),
  }),
)

const getButtonLabels = (wrapper: Wrapper) => wrapper.find('button').map(
  (button: Wrapper) => button.prop('aria-label') || button.text(),
)

const getDropdownOptions = (wrapper: Wrapper, name: string) => wrapper.find('Dropdown')
  .filterWhere((dropdown: Wrapper) => dropdown.prop('name') === name)
  .first()
  .prop('options')
  .map(({ text }: { text: string }) => text)

const getPaneText = (wrapper: Wrapper) => wrapper.find('div[role="tabpanel"]').text()

test('loads the workbook and selects the first family and query by default', async () => {
  const { wrapper, history } = await renderWorkbook()

  expect(getRequests(API_PATH)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_families`)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_analysis_groups`)).toHaveLength(1)
  expect(history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)

  expect(wrapper.find('[title="De novo and recessive review"]').hostNodes().text()).toEqual('Trio analysis')
  expect(wrapper.find('div[role="tablist"]').prop('aria-label')).toEqual('Families and analysis groups')
  expect(getTabs(wrapper)).toEqual([
    { text: '1', selected: true, tabIndex: 0, href: `${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}` },
    { text: 'Test Group', selected: false, tabIndex: -1, href: `${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}` },
  ])
  expect(wrapper.find('a[role="tab"] i').map((icon: Wrapper) => icon.prop('aria-label'))).toEqual(['Analysis group'])
  expect(getSidebar(wrapper)).toEqual([
    {
      name: 'De Novo',
      queries: ['De novo restrictive', 'De novo permissive'],
      current: ['De novo restrictive'],
      icons: ['Worksheet status for 1: In progress', 'Status for 1: In progress'],
    },
    { name: 'Recessive', queries: ['Recessive'], current: [], icons: [] },
  ])
  const pane = wrapper.find('div[role="tabpanel"]')
  expect(pane.prop('aria-labelledby')).toEqual(wrapper.find('a[role="tab"]').first().prop('id'))
  expect(pane.prop('id')).toEqual(wrapper.find('a[role="tab"]').first().prop('aria-controls'))
  expect(pane.find('h3').text()).toEqual('De novo restrictive1')
})

test('keeps a valid selection from the url and replaces a stale one with the defaults', async () => {
  const selected = await renderWorkbook(withDetail(), `${PATH}/${GROUP_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`)
  expect(selected.history.location.pathname).toEqual(`${PATH}/${GROUP_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`)
  expect(getTabs(selected.wrapper).map(({ selected: isSelected }: { selected: boolean }) => isSelected)).toEqual(
    [false, true],
  )
  expect(getSidebar(selected.wrapper)[1].current).toEqual(['Recessive'])

  const targetOnly = await renderWorkbook(withDetail(), `${PATH}/${GROUP_TARGET_GUID}`)
  expect(targetOnly.history.location.pathname).toEqual(`${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)

  const stale = await renderWorkbook(withDetail(), `${PATH}/WBT_deleted/WSQ_deleted`)
  expect(stale.history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)
})

test('switches the selected cell with the tabs and the sidebar', async () => {
  const { wrapper, history } = await renderWorkbook()

  await clickLink(wrapper, 'Recessive')
  expect(history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`)
  expect(getSidebar(wrapper).map(({ current }: { current: string[] }) => current)).toEqual([[], ['Recessive']])
  expect(wrapper.find('div[role="tabpanel"] h3').text()).toEqual('Recessive1')

  await clickLink(wrapper, 'Test Group')
  expect(history.location.pathname).toEqual(`${PATH}/${GROUP_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`)
  expect(getTabs(wrapper).map(({ selected }: { selected: boolean }) => selected)).toEqual([false, true])
  expect(wrapper.find('div[role="tabpanel"] h3').text()).toEqual('RecessiveTest Group')
  expect(wrapper.find('div[role="tabpanel"]').prop('aria-labelledby')).toEqual(`workbook-tab-${GROUP_TARGET_GUID}`)
})

test('shows a status icon with a text alternative per query and a roll-up per worksheet for the selected target', async () => {
  const result = (guid: string, worksheetQueryGuid: string, workbookTargetGuid: string, status: string) => ({
    [guid]: { ...QUERY_RESULT, worksheetQueryResultGuid: guid, worksheetQueryGuid, workbookTargetGuid, status },
  })
  const { wrapper } = await renderWorkbook(withDetail({
    worksheetQueryResultsByGuid: {
      ...result('WQR1', RESTRICTIVE_QUERY_GUID, FAMILY_TARGET_GUID, 'U'),
      ...result('WQR2', PERMISSIVE_QUERY_GUID, FAMILY_TARGET_GUID, 'U'),
      ...result('WQR3', RECESSIVE_QUERY_GUID, FAMILY_TARGET_GUID, 'F'),
      ...result('WQR4', RESTRICTIVE_QUERY_GUID, GROUP_TARGET_GUID, 'I'),
      ...result('WQR5', PERMISSIVE_QUERY_GUID, GROUP_TARGET_GUID, 'N'),
    },
  }))

  expect(getSidebar(wrapper).map(({ icons }: { icons: string[] }) => icons)).toEqual([
    ['Worksheet status for 1: Nothing found', 'Status for 1: Nothing found', 'Status for 1: Nothing found'],
    ['Worksheet status for 1: Findings', 'Status for 1: Findings'],
  ])
  const sidebarIcons = wrapper.find('nav i[role="img"]')
  expect(sidebarIcons.map((icon: Wrapper) => icon.prop('className'))).toEqual([
    'red times circle outline icon', 'red times circle outline icon', 'red times circle outline icon',
    'green check circle icon', 'green check circle icon',
  ])
  expect(sidebarIcons.first().prop('title')).toEqual('Worksheet status for 1: Nothing found')

  await clickLink(wrapper, 'Test Group')
  expect(getSidebar(wrapper).map(({ icons }: { icons: string[] }) => icons)).toEqual([
    ['Worksheet status for test group: In progress', 'Status for Test Group: In progress'], [],
  ])
  expect(wrapper.find('nav i[role="img"]').first().prop('className')).toEqual('orange circle icon')
})

test('shows the controls to edit the structure of a workbook the user can edit', async () => {
  const { wrapper } = await renderWorkbook()

  expect(getButtonLabels(wrapper)).toEqual([
    'Automatic reruns of workbook Trio analysis',
    'Share workbook Trio analysis',
    'Remove 1',
    'Remove Test Group',
    'Add families or analysis groups',
    'Add a query to worksheet De Novo',
    'Rename worksheet De Novo',
    'Automatic reruns of worksheet De Novo',
    'Save worksheet De Novo as a template',
    'Delete worksheet De Novo',
    'Rename query De novo restrictive',
    'Delete query De novo restrictive',
    'Rename query De novo permissive',
    'Delete query De novo permissive',
    'Add a query to worksheet Recessive',
    'Rename worksheet Recessive',
    'Automatic reruns of worksheet Recessive',
    'Save worksheet Recessive as a template',
    'Delete worksheet Recessive',
    'Rename query Recessive',
    'Delete query Recessive',
    'Add Worksheet',
    'New Worksheet from Template',
    'Save Note',
    'Run',
  ])
})

test('only shows the status, note and run controls for a workbook the user can not edit', async () => {
  const { wrapper } = await renderWorkbook(
    withDetail({ workbooksByGuid: { [WORKBOOK_GUID]: { ...WORKBOOK, canEdit: false } } }),
  )

  expect(getButtonLabels(wrapper)).toEqual([
    'Share workbook Trio analysis', 'Save worksheet De Novo as a template', 'Save worksheet Recessive as a template',
    'Save Note', 'Run',
  ])
  expect(wrapper.find('div[role="tabpanel"] Dropdown').first().prop('aria-label')).toEqual('Status')
  expect(getTabs(wrapper)).toHaveLength(2)
  expect(getSidebar(wrapper)).toHaveLength(2)
})

test('adds families and analysis groups that are not yet in the workbook', async () => {
  const addUrl = `${API_PATH}/targets/add`
  const newTarget = { ...FAMILY_TARGET, workbookTargetGuid: 'WBT0000003_2', order: 2, familyGuid: 'F011652_2' }
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [addUrl]: { json: { workbookTargetsByGuid: { WBT0000003_2: newTarget } } },
  }))

  await click(wrapper, 'button[aria-label="Add families or analysis groups"]')
  expect(getOpenModal(wrapper).find('ModalHeader').text()).toEqual('Add families or analysis groups to Trio analysis')
  expect(getDropdownOptions(wrapper, 'familyGuids')).toEqual(['2'])
  expect(getDropdownOptions(wrapper, 'analysisGroupGuids')).toEqual([])
  setDropdown(wrapper, 'familyGuids', ['F011652_2'])
  await submitForm(wrapper)

  expect(getRequests(addUrl)).toEqual([{ familyGuids: ['F011652_2'] }])
  expect(getTabs(wrapper).map(({ text }: { text: string }) => text)).toEqual(['1', 'Test Group', '2'])
})

test('shows the errors returned when adding targets fails', async () => {
  const addUrl = `${API_PATH}/targets/add`
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [addUrl]: { status: 400, json: { errors: ['Families or analysis groups are required'] } },
  }))

  await click(wrapper, 'button[aria-label="Add families or analysis groups"]')
  await submitForm(wrapper)

  expect(getRequests(addUrl)).toEqual([{}])
  expect(getOpenModal(wrapper).find('.error.message').text()).toEqual('Families or analysis groups are required')
})

test('removes the selected target after confirmation and selects the first remaining target', async () => {
  const deleteUrl = `${API_PATH}/targets/${FAMILY_TARGET_GUID}/delete`
  const { wrapper, history } = await renderWorkbook(withDetail({}, {
    [deleteUrl]: {
      json: {
        workbookTargetsByGuid: { [FAMILY_TARGET_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  }))

  await click(wrapper, 'button[aria-label="Remove 1"]')
  expect(getRequests(deleteUrl)).toHaveLength(0)
  await confirm(wrapper)

  expect(getRequests(deleteUrl)).toEqual([{}])
  expect(getTabs(wrapper).map(({ text }: { text: string }) => text)).toEqual(['Test Group'])
  expect(history.location.pathname).toEqual(`${PATH}/${GROUP_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)
})

test('adds, renames and deletes worksheets', async () => {
  const path = `${API_PATH}/worksheets`
  const dominant = { worksheetGuid: 'WS0000003_dominant', workbookGuid: WORKBOOK_GUID, name: 'Dominant', order: 2 }
  const { wrapper, history } = await renderWorkbook(withDetail({}, {
    [`${path}/create`]: { json: { worksheetsByGuid: { WS0000003_dominant: dominant } } },
    [`${path}/${RECESSIVE_WORKSHEET_GUID}/update`]: {
      json: { worksheetsByGuid: { [RECESSIVE_WORKSHEET_GUID]: { name: 'AR' } } },
    },
    [`${path}/${DE_NOVO_WORKSHEET_GUID}/delete`]: {
      json: {
        worksheetsByGuid: { [DE_NOVO_WORKSHEET_GUID]: null },
        worksheetQueriesByGuid: { [RESTRICTIVE_QUERY_GUID]: null, [PERMISSIVE_QUERY_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  }))

  await clickButton(wrapper, 'Add Worksheet')
  await submitForm(wrapper)
  expect(getOpenModal(wrapper).find('.error.message').text()).toEqual('Name is required')
  setInput(wrapper, 'name', 'Dominant')
  await submitForm(wrapper)
  expect(getRequests(`${path}/create`)).toEqual([{ name: 'Dominant' }])
  expect(getSidebar(wrapper)[2]).toEqual({ name: 'Dominant', queries: [], current: [], icons: [] })
  expect(wrapper.find('section[aria-label="Dominant"]').text()).toContain('No queries')

  await click(wrapper, 'button[aria-label="Rename worksheet Recessive"]')
  expect(wrapper.find('input[name="name"]').prop('value')).toEqual('Recessive')
  setInput(wrapper, 'name', 'AR')
  await submitForm(wrapper)
  expect(getRequests(`${path}/${RECESSIVE_WORKSHEET_GUID}/update`)).toEqual([{ name: 'AR' }])
  expect(getSidebar(wrapper).map(({ name }: { name: string }) => name)).toEqual(['De Novo', 'AR', 'Dominant'])

  await click(wrapper, 'button[aria-label="Delete worksheet De Novo"]')
  await confirm(wrapper)
  expect(getRequests(`${path}/${DE_NOVO_WORKSHEET_GUID}/delete`)).toEqual([{}])
  expect(getSidebar(wrapper).map(({ name }: { name: string }) => name)).toEqual(['AR', 'Dominant'])
  expect(history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${RECESSIVE_QUERY_GUID}`)
})

test('adds a query from a saved search, renames and deletes queries', async () => {
  const createUrl = `${API_PATH}/worksheets/${RECESSIVE_WORKSHEET_GUID}/queries/create`
  const updateUrl = `${API_PATH}/queries/${RECESSIVE_QUERY_GUID}/update`
  const deleteUrl = `${API_PATH}/queries/${RESTRICTIVE_QUERY_GUID}/delete`
  const query = { ...RECESSIVE_QUERY, worksheetQueryGuid: 'WSQ0000004_new', name: 'De Novo/Dominant Restrictive', order: 1 }
  const { wrapper, history } = await renderWorkbook(withDetail({}, {
    [createUrl]: { json: { worksheetQueriesByGuid: { WSQ0000004_new: query } } },
    [updateUrl]: { json: { worksheetQueriesByGuid: { [RECESSIVE_QUERY_GUID]: { name: 'Comp het' } } } },
    [deleteUrl]: {
      json: {
        worksheetQueriesByGuid: { [RESTRICTIVE_QUERY_GUID]: null },
        worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: null },
      },
    },
  }))

  await click(wrapper, 'button[aria-label="Add a query to worksheet Recessive"]')
  expect(getDropdownOptions(wrapper, 'savedSearchGuid')).toEqual(['De Novo/Dominant Restrictive'])
  await submitForm(wrapper)
  expect(getOpenModal(wrapper).find('.error.message').text()).toEqual('A saved search is required')
  setDropdown(wrapper, 'savedSearchGuid', SAVED_SEARCH_GUID)
  await submitForm(wrapper)
  expect(getRequests(createUrl)).toEqual([{ savedSearchGuid: SAVED_SEARCH_GUID }])
  expect(getSidebar(wrapper)[1].queries).toEqual(['Recessive', 'De Novo/Dominant Restrictive'])

  await click(wrapper, 'button[aria-label="Rename query Recessive"]')
  setInput(wrapper, 'name', 'Comp het')
  await submitForm(wrapper)
  expect(getRequests(updateUrl)).toEqual([{ name: 'Comp het' }])
  expect(getSidebar(wrapper)[1].queries).toEqual(['Comp het', 'De Novo/Dominant Restrictive'])

  await click(wrapper, 'button[aria-label="Delete query De novo restrictive"]')
  await confirm(wrapper)
  expect(getRequests(deleteUrl)).toEqual([{}])
  expect(getSidebar(wrapper)[0].queries).toEqual(['De novo permissive'])
  expect(history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${PERMISSIVE_QUERY_GUID}`)
})

test('updates the status and note of the selected cell', async () => {
  const updateUrl = `${CELL_API_PATH}/update`
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [updateUrl]: {
      json: (body: object) => ({ worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: { ...QUERY_RESULT, ...body } } }),
    },
  }))

  const getStatus = () => wrapper.find('div[role="tabpanel"] Dropdown').first()
  const isSaveDisabled = () => wrapper.find('div[role="tabpanel"] form button').getDOMNode().disabled
  expect(getStatus().prop('value')).toEqual('I')
  expect(getStatus().prop('options').map(({ text }: { text: string }) => text)).toEqual(
    ['Not reviewed', 'In progress', 'Nothing found', 'Findings'],
  )
  expect(wrapper.find('input[aria-label="Note"]').prop('value')).toEqual('Reviewing candidates')
  expect(isSaveDisabled()).toBe(true)

  setDropdown(wrapper.find('div[role="tabpanel"]'), undefined, 'F')
  await flush(wrapper)
  expect(getRequests(updateUrl)).toEqual([{ status: 'F' }])
  expect(getStatus().prop('value')).toEqual('F')
  expect(getSidebar(wrapper)[0].icons).toEqual(['Worksheet status for 1: Findings', 'Status for 1: Findings'])

  wrapper.find('input[aria-label="Note"]').simulate('change', { target: { value: 'Candidate' } })
  expect(isSaveDisabled()).toBe(false)
  wrapper.find('div[role="tabpanel"] form').simulate('submit')
  await flush(wrapper)
  expect(getRequests(updateUrl)).toEqual([{ status: 'F' }, { note: 'Candidate' }])
  expect(isSaveDisabled()).toBe(true)
  expect(wrapper.find('div[role="tabpanel"] .error.message').exists()).toBe(false)
})

test('shows the error when updating or running a cell fails and clears it on the next request', async () => {
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [`${CELL_API_PATH}/update`]: { status: 400, json: { errors: ['Invalid status: X', '"note" must be text'] } },
    [`${CELL_API_PATH}/run`]: { status: 403, json: { error: 'Permission Denied' } },
  }))

  setDropdown(wrapper.find('div[role="tabpanel"]'), undefined, 'U')
  await flush(wrapper)
  expect(wrapper.find('div[role="tabpanel"] .error.message li').map((error: Wrapper) => error.text())).toEqual(
    ['Invalid status: X', '"note" must be text'],
  )
  expect(wrapper.find('div[role="tabpanel"] Dropdown').first().prop('value')).toEqual('I')

  await clickButton(wrapper, 'Run')
  expect(wrapper.find('div[role="tabpanel"] .error.message').text()).toEqual('Permission Denied')
  expect(getButtonLabels(wrapper)).toContain('Run')
  expect(wrapper.find('#variants').exists()).toBe(false)
})

test('does not run a search until asked, then shows the results of the run through the search results page', async () => {
  const runUrl = `${CELL_API_PATH}/run`
  const { wrapper, history } = await renderWorkbook(withDetail({}, {
    [runUrl]: { json: { searchHash: SEARCH_HASH, worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: RAN_RESULT } } },
    ...SEARCH_RESPONSE,
  }))

  expect(getPaneText(wrapper)).toContain('This query has not been run for 1 yet')
  expect(getPaneText(wrapper)).not.toContain('Last run')
  expect(getRequests(runUrl)).toHaveLength(0)
  expect(getRequests(SEARCH_URL)).toHaveLength(0)

  await clickButton(wrapper, 'Run')
  await flush(wrapper)

  expect(getRequests(runUrl)).toEqual([{}])
  expect(getRequests(SEARCH_URL)).toEqual([{}])
  expect(getRequests('/api/search_context')).toEqual([{ searchHash: SEARCH_HASH }])
  expect((fetch as jest.Mock).mock.calls.map(([url]) => url)).toContain(
    `${SEARCH_URL}?sort=xpos&page=1&loadFamilyContext=true&loadProjectTagTypes=true`,
  )
  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var,SV0000002_var')
  expect(getPaneText(wrapper)).toContain('Last run 11/22/2026 by Test User')
  expect(getPaneText(wrapper)).toContain('2 results')
  expect(getPaneText(wrapper)).toContain('Found 2')
  expect(getPaneText(wrapper)).not.toContain('has not been run')
  expect(history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)

  await clickButton(wrapper, 'Refresh')
  await flush(wrapper)
  expect(getRequests(runUrl)).toHaveLength(2)
  expect(getRequests(SEARCH_URL)).toHaveLength(2)
  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var,SV0000002_var')
})

test('shows the results of a cell that was already run when it is selected, and of no other cell', async () => {
  const otherHash = 'WBfedcba9876543210fedcba9876543210fedcba9876543210'
  const { wrapper } = await renderWorkbook(withDetail({
    worksheetQueryResultsByGuid: {
      [QUERY_RESULT_GUID]: RAN_RESULT,
      WQR2: {
        ...RAN_RESULT,
        worksheetQueryResultGuid: 'WQR2',
        worksheetQueryGuid: RECESSIVE_QUERY_GUID,
        searchHash: otherHash,
        lastRunBy: null,
      },
    },
  }, {
    ...SEARCH_RESPONSE,
    [`/api/search/${otherHash}`]: {
      json: {
        searchedVariantIds: ['SV0000003_var'],
        variantsById: { SV0000003_var: { variantId: 'SV0000003_var' } },
        search: { search: {}, projectFamilies: [{ projectGuid: PROJECT_GUID, familyGuids: ['F011652_1'] }], totalResults: 1 },
      },
    },
  }))
  await flush(wrapper)

  expect(getRequests(SEARCH_URL)).toHaveLength(1)
  expect(getRequests(`/api/search/${otherHash}`)).toHaveLength(0)
  expect(getRequests(`${CELL_API_PATH}/run`)).toHaveLength(0)
  expect(wrapper.find('#variants').text()).toEqual('SV0000001_var,SV0000002_var')
  expect(getButtonLabels(wrapper)).toContain('Refresh')

  await clickLink(wrapper, 'De novo permissive')
  expect(wrapper.find('#variants').exists()).toBe(false)
  expect(getPaneText(wrapper)).toContain('This query has not been run for 1 yet')

  await clickLink(wrapper, 'Recessive')
  await flush(wrapper)
  expect(getRequests(`/api/search/${otherHash}`)).toHaveLength(1)
  expect(wrapper.find('#variants').text()).toEqual('SV0000003_var')
  expect(getPaneText(wrapper)).toContain('Last run 11/22/2026 by unknown user')
  expect(getPaneText(wrapper)).toContain('1 results')
})

test('never shows the results of a previously selected cell when its search finishes late', async () => {
  let finishFirstSearch: () => void
  const wait = new Promise<void>((resolve) => {
    finishFirstSearch = resolve
  })
  const otherHash = 'WBfedcba9876543210fedcba9876543210fedcba9876543210'
  const otherUrl = `/api/search/${otherHash}`
  const { wrapper } = await renderWorkbook(withDetail({
    worksheetQueryResultsByGuid: {
      [QUERY_RESULT_GUID]: RAN_RESULT,
      WQR2: { ...RAN_RESULT, worksheetQueryResultGuid: 'WQR2', worksheetQueryGuid: RECESSIVE_QUERY_GUID, searchHash: otherHash },
    },
  }, {
    [SEARCH_URL]: { ...SEARCH_RESPONSE[SEARCH_URL], wait },
    [otherUrl]: {
      json: {
        searchedVariantIds: ['SV0000003_var'],
        variantsById: { SV0000003_var: { variantId: 'SV0000003_var' } },
        search: { search: {}, projectFamilies: [{ projectGuid: PROJECT_GUID, familyGuids: ['F011652_1'] }], totalResults: 1 },
      },
    },
  }))
  expect(getRequests(SEARCH_URL)).toHaveLength(1)
  expect(wrapper.find('#variants').exists()).toBe(false)

  await clickLink(wrapper, 'Recessive')
  await flush(wrapper)
  expect(getRequests(otherUrl)).toHaveLength(1)
  expect(wrapper.find('#variants').text()).toEqual('SV0000003_var')

  finishFirstSearch()
  await flush(wrapper)
  expect(wrapper.find('#variants').text()).toEqual('SV0000003_var')
  expect(getPaneText(wrapper)).toContain('Found 1')
})

test('shows the stored result count of a cell before its results are loaded', async () => {
  const { wrapper } = await renderWorkbook(withDetail({
    worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: { ...RAN_RESULT, searchHash: null } },
  }))

  expect(getPaneText(wrapper)).toContain('7 results')
  expect(getButtonLabels(wrapper)).toContain('Run')
})

test('shows the error when the workbook fails to load', async () => {
  const { wrapper, history } = await renderWorkbook({
    [API_PATH]: { status: 404, json: { error: 'Workbook matching query does not exist.' } },
  })

  expect(wrapper.find('Message').prop('error')).toBe(true)
  expect(wrapper.find('Message').text()).toEqual('Workbook matching query does not exist.')
  expect(wrapper.find('div[role="tablist"]').exists()).toBe(false)
  expect(history.location.pathname).toEqual(PATH)
})

test('prompts for targets and queries when the workbook has none', async () => {
  const empty = await renderWorkbook(withDetail({
    workbookTargetsByGuid: {}, worksheetsByGuid: {}, worksheetQueriesByGuid: {}, worksheetQueryResultsByGuid: {},
  }), `${PATH}/${FAMILY_TARGET_GUID}/${RESTRICTIVE_QUERY_GUID}`)
  expect(empty.history.location.pathname).toEqual(PATH)
  expect(getPaneText(empty.wrapper)).toEqual('Add a family or analysis group to this workbook to review it')
  expect(empty.wrapper.find('div[role="tabpanel"]').prop('aria-labelledby')).toBeUndefined()
  expect(empty.wrapper.find('nav[aria-label="Worksheets"]').text()).toContain('No worksheets')
  expect(getButtonLabels(empty.wrapper)).toEqual([
    'Automatic reruns of workbook Trio analysis', 'Share workbook Trio analysis', 'Add families or analysis groups',
    'Add Worksheet', 'New Worksheet from Template',
  ])

  const noQueries = await renderWorkbook(withDetail({ worksheetQueriesByGuid: {}, worksheetQueryResultsByGuid: {} }))
  expect(noQueries.history.location.pathname).toEqual(`${PATH}/${FAMILY_TARGET_GUID}`)
  expect(getPaneText(noQueries.wrapper)).toEqual('Add a worksheet with a query to this workbook to review it')

  const noTargets = await renderWorkbook(withDetail({ workbookTargetsByGuid: {}, worksheetQueryResultsByGuid: {} }))
  expect(noTargets.history.location.pathname).toEqual(PATH)
  expect(getSidebar(noTargets.wrapper)[0]).toEqual({
    name: 'De Novo', queries: ['De novo restrictive', 'De novo permissive'], current: ['De novo restrictive'], icons: [],
  })
  expect(noTargets.wrapper.find('nav li a').first().prop('href')).toEqual(PATH)
})

test('moves the tabs that do not fit into an overflow menu and keeps the selected tab visible', async () => {
  const targets = [1, 2, 3, 4, 5, 6, 7, 8].reduce((acc, order) => ({
    ...acc,
    [`WBT_${order}`]: { ...FAMILY_TARGET, workbookTargetGuid: `WBT_${order}`, familyGuid: `F_${order}`, order },
  }), {})
  const { wrapper, history } = await renderWorkbook(withDetail({ workbookTargetsByGuid: targets }))

  const getTabTexts = () => getTabs(wrapper).map(({ text }: { text: string }) => text)
  const getOverflow = () => wrapper.find('Dropdown[aria-label="More families and analysis groups"]')
  expect(getTabTexts()).toEqual(['F_1', 'F_2', 'F_3', 'F_4', 'F_5', 'F_6'])
  expect(getOverflow().prop('text')).toEqual('2 more')
  expect(getOverflow().find('a').map((link: Wrapper) => [link.text(), link.prop('href')])).toEqual([
    ['F_7', `${PATH}/WBT_7/${RESTRICTIVE_QUERY_GUID}`], ['F_8', `${PATH}/WBT_8/${RESTRICTIVE_QUERY_GUID}`],
  ])

  await clickLink(wrapper, 'F_8')
  expect(history.location.pathname).toEqual(`${PATH}/WBT_8/${RESTRICTIVE_QUERY_GUID}`)
  expect(getTabTexts()).toEqual(['F_1', 'F_2', 'F_3', 'F_4', 'F_5', 'F_8'])
  expect(getTabs(wrapper)[5].selected).toBe(true)
  expect(getOverflow().find('a').map((link: Wrapper) => link.text())).toEqual(['F_6', 'F_7'])
})

test('moves the focus between the tabs with the arrow keys', async () => {
  const { wrapper } = await renderWorkbook()
  const tabs = wrapper.find('a[role="tab"]').map((tab: Wrapper) => tab.getDOMNode())
  const pressKey = (key: string) => {
    const event = { key, preventDefault: jest.fn() }
    wrapper.find('div[role="tablist"]').simulate('keydown', event)
    return event.preventDefault.mock.calls.length
  }

  tabs[0].focus()
  expect(pressKey('ArrowRight')).toEqual(1)
  expect(document.activeElement).toBe(tabs[1])
  pressKey('ArrowRight')
  expect(document.activeElement).toBe(tabs[0])
  pressKey('ArrowLeft')
  expect(document.activeElement).toBe(tabs[1])
  expect(pressKey('Enter')).toEqual(0)
  expect(document.activeElement).toBe(tabs[1])
})

test('ignores the response of a request for a cell that is no longer selected', async () => {
  const consoleError = jest.spyOn(console, 'error')
  const { wrapper } = await renderWorkbook(withDetail({}, {
    [`${CELL_API_PATH}/run`]: { status: 403, json: { error: 'Permission Denied' } },
  }))

  wrapper.find('button').filterWhere((button: Wrapper) => button.text() === 'Run').simulate('click')
  await clickLink(wrapper, 'Recessive')
  await flush(wrapper)

  expect(getRequests(`${CELL_API_PATH}/run`)).toHaveLength(1)
  expect(wrapper.find('div[role="tabpanel"] .error.message').exists()).toBe(false)
  expect(consoleError).not.toHaveBeenCalled()
  consoleError.mockRestore()
})
