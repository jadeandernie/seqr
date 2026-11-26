import { act } from 'react-dom/test-utils'

import {
  DE_NOVO_WORKSHEET_GUID, DEFAULT_TEMPLATE, DEFAULT_TEMPLATE_GUID, MY_TEMPLATE, MY_TEMPLATE_GUID, OTHER_TEMPLATE,
  OTHER_TEMPLATE_GUID, PROJECT_GUID, PROJECT_TEMPLATE, PROJECT_TEMPLATE_GUID, STATE, TEMPLATES, WORKBOOK,
  WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import { getCanSetTemplatePublic, getTemplateGroups } from './selectors'
import {
  click, clickButton, confirm, createTestStore, flush, getOpenModal, getRequests, mockApi, renderProjectPage, setInput,
  submitForm,
} from './testHelpers'
import { TEMPLATE_COPY_NOTE } from './Templates'
import { TemplateGroup, WorkbookReduxState } from './types'

jest.mock('../../../shared/components/panel/variants/Variants', () => () => null)

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const WORKBOOK_PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const LIST_PATH = `/project/${PROJECT_GUID}/workbooks`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const TEMPLATES_URL = '/api/worksheet_templates'
const CREATE_URL = `${TEMPLATES_URL}/create`
const FROM_TEMPLATE_URL = `${API_PATH}/worksheets/create_from_template`
const TEMPLATES_RESPONSE = { [TEMPLATES_URL]: { json: { worksheetTemplatesByGuid: TEMPLATES } } }
const ANALYST = { user: { ...STATE.user, isAnalyst: true } }

const renderPage = async (path: string, responses: Responses, state: object = {}) => {
  mockApi({
    [API_PATH]: { json: WORKBOOK_DETAIL },
    [`/api/project/${PROJECT_GUID}/workbooks`]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: WORKBOOK } } },
    ...responses,
  })
  const rendered = renderProjectPage(path, state)
  await flush(rendered.wrapper)
  await flush(rendered.wrapper)
  return rendered
}

const getGroupNames = (groups: TemplateGroup[]) => groups.map(
  ({ title, templates }) => [title, ...templates.map(({ name }) => name)],
)

const getPickerGroups = (wrapper: Wrapper) => getOpenModal(wrapper).find('div[role="radiogroup"]').map(
  (group: Wrapper) => [group.prop('aria-label'), ...group.find('Radio').map((radio: Wrapper) => radio.prop('label'))],
)

const selectTemplate = (wrapper: Wrapper, name: string) => {
  const radio = getOpenModal(wrapper).find('Radio').filterWhere((node: Wrapper) => node.prop('label') === name)
  act(() => {
    radio.prop('onChange')()
  })
  wrapper.update()
}

const getTemplateRows = (wrapper: Wrapper) => wrapper.find('table[aria-label="Worksheet templates"] tbody tr').map(
  (row: Wrapper) => ({
    cells: row.find('td').slice(0, 5).map((cell: Wrapper) => cell.text()),
    buttons: row.find('button').map((button: Wrapper) => button.prop('aria-label') || button.text()),
  }),
)

test('groups templates as default, own and project templates, each template in one group', () => {
  const state = createTestStore({ worksheetTemplatesByGuid: TEMPLATES }).getState()
  expect(getGroupNames(getTemplateGroups(state))).toEqual([
    ['Default templates', 'De Novo / Dominant'], ['My templates', 'My trios'], ['Project templates', 'Project panel'],
  ])

  const publicOwnProjectTemplate = { ...MY_TEMPLATE, isPublic: true, projectGuids: [PROJECT_GUID] }
  const ownProjectTemplate = { ...MY_TEMPLATE, name: 'Mine', projectGuids: [PROJECT_GUID] }
  expect(getGroupNames(getTemplateGroups(createTestStore({
    worksheetTemplatesByGuid: { a: publicOwnProjectTemplate, b: ownProjectTemplate, c: OTHER_TEMPLATE },
  }).getState()))).toEqual([['Default templates', 'My trios'], ['My templates', 'Mine']])
  expect(getTemplateGroups(createTestStore().getState())).toEqual([])
})

test('only analysts and data managers can make a template public', () => {
  const getCanSet = (user: object) => getCanSetTemplatePublic({ user } as WorkbookReduxState)
  expect(getCanSet({})).toBe(false)
  expect(getCanSet({ isAnalyst: true })).toBe(true)
  expect(getCanSet({ isDataManager: true })).toBe(true)
})

test('creates a worksheet from a template picked from the default, own and project templates', async () => {
  const worksheet = {
    worksheetGuid: 'WS0000009_trios', workbookGuid: WORKBOOK_GUID, name: 'Trios', order: 2, templateGuid: MY_TEMPLATE_GUID,
  }
  const query = {
    worksheetQueryGuid: 'WSQ0000009_recessive', worksheetGuid: 'WS0000009_trios', name: 'Recessive copy', order: 0,
    search: {}, createdDate: '2026-11-26T10:00:00Z', createdBy: 'Test User',
  }
  const { wrapper, store } = await renderPage(WORKBOOK_PATH, {
    ...TEMPLATES_RESPONSE,
    [FROM_TEMPLATE_URL]: {
      json: {
        worksheetsByGuid: { [worksheet.worksheetGuid]: worksheet },
        worksheetQueriesByGuid: { [query.worksheetQueryGuid]: query },
      },
    },
  }, { worksheetTemplatesByGuid: { WST0000000_removed: { ...MY_TEMPLATE, name: 'Removed' } } })
  expect(getRequests(TEMPLATES_URL)).toHaveLength(0)

  await clickButton(wrapper, 'New Worksheet from Template')
  await flush(wrapper)
  expect(getRequests(TEMPLATES_URL)).toHaveLength(1)
  expect(getPickerGroups(wrapper)).toEqual([
    ['Default templates', 'De Novo / Dominant'], ['My templates', 'My trios'], ['Project templates', 'Project panel'],
  ])
  const modalText = getOpenModal(wrapper).text()
  expect(modalText).toContain(TEMPLATE_COPY_NOTE)
  expect(modalText).toContain('The default de novo and dominant searches')
  expect(modalText).toContain('Queries: De Novo/Dominant Restrictive, De Novo/Dominant Permissive')
  expect(modalText).not.toContain('Another project panel')
  expect(modalText).not.toContain('Removed')
  expect(Object.keys(store.getState().worksheetTemplatesByGuid).sort()).toEqual(Object.keys(TEMPLATES).sort())

  await submitForm(wrapper)
  expect(getOpenModal(wrapper).text()).toContain('A template is required')
  expect(getRequests(FROM_TEMPLATE_URL)).toEqual([])

  selectTemplate(wrapper, 'My trios')
  expect(getOpenModal(wrapper).find('Radio').map((radio: Wrapper) => radio.prop('checked'))).toEqual([false, true, false])
  await submitForm(wrapper)
  expect(getRequests(FROM_TEMPLATE_URL)).toEqual([{ worksheetTemplateGuid: MY_TEMPLATE_GUID }])
  expect(getOpenModal(wrapper).exists()).toBe(false)
  expect(store.getState().worksheetsByGuid[worksheet.worksheetGuid]).toEqual(worksheet)
  expect(store.getState().worksheetQueriesByGuid[query.worksheetQueryGuid]).toEqual(query)
  expect(wrapper.find('section[aria-label="Trios"]').text()).toContain('Recessive copy')

  await clickButton(wrapper, 'New Worksheet from Template')
  await flush(wrapper)
  selectTemplate(wrapper, 'Project panel')
  setInput(wrapper, 'name', 'Panel review')
  await submitForm(wrapper)
  expect(getRequests(FROM_TEMPLATE_URL)[1]).toEqual({ worksheetTemplateGuid: PROJECT_TEMPLATE_GUID, name: 'Panel review' })
})

test('shows a message without templates and the errors of loading templates and creating a worksheet', async () => {
  const { wrapper } = await renderPage(WORKBOOK_PATH, {})
  await clickButton(wrapper, 'New Worksheet from Template')
  await flush(wrapper)
  expect(getOpenModal(wrapper).text()).toContain('No worksheet templates are available')
  expect(getPickerGroups(wrapper)).toEqual([])

  const failed = await renderPage(WORKBOOK_PATH, { [TEMPLATES_URL]: { status: 500, json: {} } })
  await clickButton(failed.wrapper, 'New Worksheet from Template')
  await flush(failed.wrapper)
  expect(getOpenModal(failed.wrapper).find('.error.message').text()).toEqual('error (500)')
  expect(getOpenModal(failed.wrapper).find('form').exists()).toBe(false)

  const rejected = await renderPage(WORKBOOK_PATH, {
    ...TEMPLATES_RESPONSE,
    [FROM_TEMPLATE_URL]: { status: 400, json: { errors: ['A worksheet named "My trios" already exists'] } },
  })
  await clickButton(rejected.wrapper, 'New Worksheet from Template')
  await flush(rejected.wrapper)
  selectTemplate(rejected.wrapper, 'My trios')
  await submitForm(rejected.wrapper)
  expect(getOpenModal(rejected.wrapper).text()).toContain('A worksheet named "My trios" already exists')
})

test('users who can not edit a workbook can save its worksheets as templates but not add worksheets', async () => {
  const created = { ...MY_TEMPLATE, worksheetTemplateGuid: 'WST0000009_de_novo', name: 'My de novo' }
  const { wrapper, store } = await renderPage(WORKBOOK_PATH, {
    [API_PATH]: { json: { ...WORKBOOK_DETAIL, workbooksByGuid: { [WORKBOOK_GUID]: { ...WORKBOOK, canEdit: false } } } },
    [CREATE_URL]: { json: { worksheetTemplatesByGuid: { [created.worksheetTemplateGuid]: created } } },
  })
  expect(wrapper.find('button').filterWhere((button: Wrapper) => button.text() === 'New Worksheet from Template').exists()).toBe(false)

  await click(wrapper, 'button[aria-label="Save worksheet De Novo as a template"]')
  expect(getOpenModal(wrapper).find('input[name="name"]').prop('value')).toEqual('De Novo')
  expect(getOpenModal(wrapper).find('Checkbox').exists()).toBe(false)
  setInput(wrapper, 'name', 'My de novo')
  setInput(wrapper, 'description', 'For trios')
  await submitForm(wrapper)

  expect(getRequests(CREATE_URL)).toEqual([{
    name: 'My de novo', description: 'For trios', workbookGuid: WORKBOOK_GUID, worksheetGuid: DE_NOVO_WORKSHEET_GUID,
  }])
  expect(store.getState().worksheetTemplatesByGuid[created.worksheetTemplateGuid]).toEqual(created)
  expect(getOpenModal(wrapper).exists()).toBe(false)
})

test('analysts can save a worksheet as a public template', async () => {
  const { wrapper } = await renderPage(WORKBOOK_PATH, {
    [CREATE_URL]: { status: 400, json: { errors: ['A template needs at least one query'] } },
  }, ANALYST)

  await click(wrapper, 'button[aria-label="Save worksheet De Novo as a template"]')
  const checkbox = getOpenModal(wrapper).find('Checkbox')
  expect(checkbox.prop('label')).toEqual('Public: a default template for all seqr users')
  expect(checkbox.prop('checked')).toBe(false)
  await submitForm(wrapper)
  getOpenModal(wrapper).find('input[type="checkbox"]').simulate('change', { target: { checked: true } })
  await submitForm(wrapper)

  const request = { name: 'De Novo', description: null as null, workbookGuid: WORKBOOK_GUID, worksheetGuid: DE_NOVO_WORKSHEET_GUID }
  expect(getRequests(CREATE_URL)).toEqual([{ ...request, isPublic: false }, { ...request, isPublic: true }])
  expect(getOpenModal(wrapper).text()).toContain('A template needs at least one query')
})

test('lists every visible template with the controls the user may use', async () => {
  const { wrapper } = await renderPage(LIST_PATH, TEMPLATES_RESPONSE)

  expect(getRequests(TEMPLATES_URL)).toHaveLength(1)
  expect(wrapper.find('section[aria-label="Worksheet templates"]').text()).toContain(TEMPLATE_COPY_NOTE)
  expect(getTemplateRows(wrapper)).toEqual([
    {
      cells: ['Another project panel', '', 'Recessive', 'Test Manager User', 'Only its creator'],
      buttons: ['Add to this project'],
    },
    {
      cells: [
        'De Novo / Dominant', 'The default de novo and dominant searches',
        'De Novo/Dominant Restrictive, De Novo/Dominant Permissive', 'seqr', 'All users (public)',
      ],
      buttons: ['Add to this project'],
    },
    {
      cells: ['My trios', '', 'Recessive', 'Test User', 'Only its creator'],
      buttons: ['Add to this project', 'Edit template My trios', 'Delete template My trios'],
    },
    {
      cells: ['Project panel', 'Shared with this project', 'Recessive', 'Test Manager User', 'Only its creator and this project'],
      buttons: ['Remove from this project'],
    },
  ])

  const viewer = await renderPage(LIST_PATH, TEMPLATES_RESPONSE, {
    projectsByGuid: { [PROJECT_GUID]: { ...STATE.projectsByGuid[PROJECT_GUID], canEdit: false } },
  })
  expect(getTemplateRows(viewer.wrapper).map(({ buttons }: { buttons: string[] }) => buttons)).toEqual([
    [], [], ['Edit template My trios', 'Delete template My trios'], [],
  ])

  const empty = await renderPage(LIST_PATH, {})
  expect(empty.wrapper.find('table[aria-label="Worksheet templates"]').exists()).toBe(false)
  expect(empty.wrapper.find('section[aria-label="Worksheet templates"]').text()).toContain(
    'No worksheet templates are available',
  )

  const failed = await renderPage(LIST_PATH, { [TEMPLATES_URL]: { status: 500, json: {} } })
  expect(failed.wrapper.find('section[aria-label="Worksheet templates"] .error.message').text()).toEqual('error (500)')
})

test('edits and deletes a template the user may edit', async () => {
  const updateUrl = `${TEMPLATES_URL}/${MY_TEMPLATE_GUID}/update`
  const deleteUrl = `${TEMPLATES_URL}/${MY_TEMPLATE_GUID}/delete`
  const renamed = { ...MY_TEMPLATE, name: 'Trio searches', description: 'Recessive only' }
  const { wrapper, store } = await renderPage(LIST_PATH, {
    ...TEMPLATES_RESPONSE,
    [updateUrl]: { json: { worksheetTemplatesByGuid: { [MY_TEMPLATE_GUID]: renamed } } },
    [deleteUrl]: { json: { worksheetTemplatesByGuid: { [MY_TEMPLATE_GUID]: null } } },
  })

  await click(wrapper, 'button[aria-label="Edit template My trios"]')
  expect(getOpenModal(wrapper).find('input[name="name"]').prop('value')).toEqual('My trios')
  expect(getOpenModal(wrapper).find('Checkbox').exists()).toBe(false)
  setInput(wrapper, 'name', 'Trio searches')
  setInput(wrapper, 'description', 'Recessive only')
  await submitForm(wrapper)
  expect(getRequests(updateUrl)).toEqual([{ name: 'Trio searches', description: 'Recessive only' }])
  expect(getTemplateRows(wrapper)[3].cells.slice(0, 2)).toEqual(['Trio searches', 'Recessive only'])

  await click(wrapper, 'button[aria-label="Delete template Trio searches"]')
  expect(getRequests(deleteUrl)).toHaveLength(0)
  expect(wrapper.find('Confirm').filterWhere((node: Wrapper) => node.prop('open')).prop('content')).toEqual(
    'Are you sure you want to delete the template "Trio searches"? Worksheets that were created from it are not changed.',
  )
  await confirm(wrapper)
  expect(getRequests(deleteUrl)).toEqual([{}])
  expect(store.getState().worksheetTemplatesByGuid[MY_TEMPLATE_GUID]).toBeUndefined()
  expect(getTemplateRows(wrapper)).toHaveLength(3)
})

test('analysts change whether a template is public, and see the error when an edit is rejected', async () => {
  const updateUrl = `${TEMPLATES_URL}/${DEFAULT_TEMPLATE_GUID}/update`
  const editable = { ...DEFAULT_TEMPLATE, canEdit: true }
  const { wrapper } = await renderPage(LIST_PATH, {
    [TEMPLATES_URL]: { json: { worksheetTemplatesByGuid: { [DEFAULT_TEMPLATE_GUID]: editable } } },
    [updateUrl]: { status: 400, json: { errors: ['"Name" is required'] } },
  }, ANALYST)

  await click(wrapper, 'button[aria-label="Edit template De Novo / Dominant"]')
  expect(getOpenModal(wrapper).find('Checkbox').prop('checked')).toBe(true)
  getOpenModal(wrapper).find('input[type="checkbox"]').simulate('change', { target: { checked: false } })
  await submitForm(wrapper)

  expect(getRequests(updateUrl)).toEqual([{
    name: 'De Novo / Dominant', description: 'The default de novo and dominant searches', isPublic: false,
  }])
  expect(getOpenModal(wrapper).text()).toContain('"Name" is required')
})

test('adds a template to the project and removes it', async () => {
  const attachUrl = `/api/project/${PROJECT_GUID}/worksheet_templates/${OTHER_TEMPLATE_GUID}/attach`
  const detachUrl = `/api/project/${PROJECT_GUID}/worksheet_templates/${PROJECT_TEMPLATE_GUID}/detach`
  const attached = { ...OTHER_TEMPLATE, projectGuids: ['R0002_other', PROJECT_GUID] }
  const { wrapper, store } = await renderPage(LIST_PATH, {
    ...TEMPLATES_RESPONSE,
    [attachUrl]: { json: { worksheetTemplatesByGuid: { [OTHER_TEMPLATE_GUID]: attached } } },
    [detachUrl]: { json: { worksheetTemplatesByGuid: { [PROJECT_TEMPLATE_GUID]: { projectGuids: [] } } } },
  })

  wrapper.find('table[aria-label="Worksheet templates"] tbody tr').at(0).find('button').simulate('click')
  await flush(wrapper)
  expect(getRequests(attachUrl)).toEqual([{}])
  expect(store.getState().worksheetTemplatesByGuid[OTHER_TEMPLATE_GUID]).toEqual(attached)
  expect(getTemplateRows(wrapper)[0]).toEqual({
    cells: ['Another project panel', '', 'Recessive', 'Test Manager User', 'Only its creator and this project'],
    buttons: ['Remove from this project'],
  })

  wrapper.find('table[aria-label="Worksheet templates"] tbody tr').at(3).find('button').simulate('click')
  await flush(wrapper)
  expect(getRequests(detachUrl)).toEqual([{}])
  expect(getTemplateRows(wrapper)[3]).toEqual({
    cells: ['Project panel', 'Shared with this project', 'Recessive', 'Test Manager User', 'Only its creator'],
    buttons: ['Add to this project'],
  })
})
