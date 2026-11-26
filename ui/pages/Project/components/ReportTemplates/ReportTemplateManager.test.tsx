import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'

import ReportTemplateManagerButton, { PREVIEW_DELAY } from './ReportTemplateManager'
import { STATE_WITH_2_FAMILIES } from '../../fixtures'
import { REPORT, TEMPLATES_RESPONSE, flush, mockFetch, postedBody } from './testUtils'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

type Wrapper = ReturnType<typeof mount>
type Routes = Parameters<typeof mockFetch>[0]

const TEMPLATES_URL = '/api/project/R0237_1000_genomes_demo/report_templates'
const CREATE_URL = `${TEMPLATES_URL}/create`
const PREVIEW_URL = '/api/family/F011652_1/report_template_preview'
const DATA_MANAGER_RESPONSE = { ...TEMPLATES_RESPONSE, canEditGlobalTemplates: true }
const NEW_TEMPLATE = {
  reportTemplateGuid: 'RT0000004_new',
  projectGuid: 'R0237_1000_genomes_demo',
  name: 'A new template',
  description: 'For testing',
  audience: 'clinician',
  body: 'Hello {{family.displayName}}',
}

const openManager = async (routes: Routes) => {
  const fetchMock = mockFetch(routes)
  const wrapper = mount(
    <Provider store={configureStore(STATE_WITH_2_FAMILIES)}>
      <ReportTemplateManagerButton />
    </Provider>,
  )
  expect(fetchMock).not.toHaveBeenCalled()
  wrapper.find('ButtonLink').first().simulate('click')
  await flush(wrapper)
  return { wrapper, fetchMock }
}

const getRows = (wrapper: Wrapper) => wrapper.find('TableBody').first().find('TableRow').map(
  row => row.find('TableCell').map(cell => cell.text()),
)

const getButton = (wrapper: Wrapper, text: string) => wrapper.find('Button').filterWhere(b => b.text() === text)

const FIELD_COMPONENTS = ['FormInput', 'FormSelect', 'FormTextArea', 'FormCheckbox']

const getField = (wrapper: Wrapper, name: string) => wrapper.findWhere(
  field => FIELD_COMPONENTS.includes(field.name()) && field.prop('name') === name,
)

const setField = (wrapper: Wrapper, name: string, data: Record<string, unknown>) => {
  act(() => {
    getField(wrapper, name).prop('onChange')(null, { name, ...data })
  })
  wrapper.update()
}

const waitForPreview = async (wrapper: Wrapper) => {
  act(() => {
    jest.advanceTimersByTime(PREVIEW_DELAY)
  })
  await flush(wrapper)
  // The first render of the lazily loaded markdown component is scheduled on a timer
  act(() => {
    jest.runOnlyPendingTimers()
  })
  await flush(wrapper)
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  document.body.innerHTML = ''
})

test('lists templates and only offers editing for scopes the user can manage', async () => {
  const { wrapper, fetchMock } = await openManager({ [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE } })

  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`${TEMPLATES_URL}?`])
  expect(getRows(wrapper)).toEqual([
    ['Candidate variants', 'Researcher', 'This project', 'Project specific summary', 'EditDelete'],
    ['Family analysis summary', 'Researcher', 'All projects', 'Research summary of a family', ''],
    ['Findings summary', 'Clinician', 'All projects', '', ''],
  ])
  expect(getButton(wrapper, 'New template').length).toEqual(1)

  // Closing the modal removes the manager
  act(() => {
    wrapper.find('Modal').prop('onClose')()
  })
  wrapper.update()
  expect(wrapper.find('ReportTemplateManager').length).toEqual(0)
  wrapper.unmount()

  const { wrapper: dataManagerWrapper } = await openManager({ [TEMPLATES_URL]: { body: DATA_MANAGER_RESPONSE } })
  expect(getRows(dataManagerWrapper).map(row => row[4])).toEqual(['EditDelete', 'EditDelete', 'EditDelete'])
  dataManagerWrapper.unmount()

  const { wrapper: viewOnlyWrapper } = await openManager({
    [TEMPLATES_URL]: { body: { ...TEMPLATES_RESPONSE, canEditProjectTemplates: false } },
  })
  expect(getRows(viewOnlyWrapper).map(row => row[4])).toEqual(['', '', ''])
  expect(getButton(viewOnlyWrapper, 'New template').length).toEqual(0)
})

test('shows an error when templates can not be loaded', async () => {
  const { wrapper } = await openManager({ [TEMPLATES_URL]: { status: 403, body: { error: 'Permission Denied' } } })
  expect(wrapper.find('Message').text()).toEqual('Unable to load report templatesPermission Denied')
  expect(wrapper.find('Table').length).toEqual(0)
  expect(wrapper.find('Loader').first().prop('active')).toEqual(false)
})

test('creates a template with a live preview and inline validation errors', async () => {
  const routes: Routes = {
    [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE },
    [PREVIEW_URL]: { status: 400, body: { errors: ['Line 1: Unknown placeholder {{family.name}}'] } },
    '/api/family/F011652_2/report_template_preview': { body: { ...REPORT, markdown: 'Preview for family 2' } },
    [CREATE_URL]: { status: 400, body: { errors: ['Name is required'] } },
  }
  const { wrapper, fetchMock } = await openManager(routes)

  getButton(wrapper, 'New template').simulate('click')
  expect(getField(wrapper, 'name').prop('value')).toEqual('')
  expect(getField(wrapper, 'audience').prop('value')).toEqual('researcher')
  expect(getField(wrapper, 'audience').prop('options')).toEqual(TEMPLATES_RESPONSE.audiences)
  expect(getField(wrapper, 'isGlobal').length).toEqual(0)
  expect(getField(wrapper, 'previewFamily').prop('value')).toEqual('F011652_1')
  expect(getField(wrapper, 'previewFamily').prop('options')).toEqual([
    { value: 'F011652_1', text: '1' }, { value: 'F011652_2', text: '2' },
  ])

  // The placeholder reference documents what a template may use
  const reference = wrapper.find('Table').find('TableRow').map(row => row.find('TableCell').map(cell => cell.text()))
  expect(reference).toEqual([
    ['{{family.displayName}}', 'Family display name'],
    ['{{#variants}}...{{/variants}}', 'Repeats its content for each saved variant'],
    ['{{variant.genes}}', 'Gene symbol(s) (inside {{#variants}})'],
  ])
  const limits = wrapper.find('i.report-template-limits').text()
  expect(limits).toContain('Free text notes are not available to templates')
  expect(limits).toContain('"Research use only — not a clinical report", which can not be removed')

  // An empty template is not previewed
  await waitForPreview(wrapper)
  expect(fetchMock).toHaveBeenCalledTimes(1)

  // Typing only requests a preview once the user pauses
  setField(wrapper, 'body', { value: 'Hello {{family.na' })
  act(() => {
    jest.advanceTimersByTime(PREVIEW_DELAY - 1)
  })
  setField(wrapper, 'body', { value: 'Hello {{family.name}}' })
  await waitForPreview(wrapper)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(postedBody(fetchMock, PREVIEW_URL)).toEqual({ body: 'Hello {{family.name}}' })
  expect(wrapper.find('Message').text()).toEqual('Template is not validLine 1: Unknown placeholder {{family.name}}')
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)

  routes[PREVIEW_URL] = { body: REPORT }
  setField(wrapper, 'body', { value: 'Hello {{family.displayName}}' })
  await waitForPreview(wrapper)
  expect(postedBody(fetchMock, PREVIEW_URL)).toEqual({ body: 'Hello {{family.displayName}}' })
  expect(wrapper.find('Message').length).toEqual(0)
  expect(wrapper.find('ReactMarkdown').text()).toEqual(REPORT.markdown)

  setField(wrapper, 'previewFamily', { value: 'F011652_2' })
  await waitForPreview(wrapper)
  expect(postedBody(fetchMock, '/api/family/F011652_2/report_template_preview')).toEqual({
    body: 'Hello {{family.displayName}}',
  })
  expect(wrapper.find('ReactMarkdown').text()).toEqual('Preview for family 2')

  // Server validation errors are shown inline and keep the draft open
  getButton(wrapper, 'Save').simulate('click')
  await flush(wrapper)
  expect(postedBody(fetchMock, CREATE_URL)).toEqual({
    name: '', description: '', audience: 'researcher', body: 'Hello {{family.displayName}}',
  })
  expect(wrapper.find('Message').text()).toEqual('Unable to save templateName is required')
  expect(getField(wrapper, 'body').prop('value')).toEqual('Hello {{family.displayName}}')

  routes[CREATE_URL] = { body: { reportTemplatesByGuid: { [NEW_TEMPLATE.reportTemplateGuid]: NEW_TEMPLATE } } }
  setField(wrapper, 'name', { value: 'A new template' })
  setField(wrapper, 'description', { value: 'For testing' })
  setField(wrapper, 'audience', { value: 'clinician' })
  getButton(wrapper, 'Save').simulate('click')
  await flush(wrapper)
  expect(postedBody(fetchMock, CREATE_URL)).toEqual({
    name: 'A new template', description: 'For testing', audience: 'clinician', body: 'Hello {{family.displayName}}',
  })
  expect(getRows(wrapper).map(row => row.slice(0, 3))).toEqual([
    ['A new template', 'Clinician', 'This project'],
    ['Candidate variants', 'Researcher', 'This project'],
    ['Family analysis summary', 'Researcher', 'All projects'],
    ['Findings summary', 'Clinician', 'All projects'],
  ])
  expect(wrapper.find('Message').length).toEqual(0)
})

test('ignores a preview response which arrives after a newer one', async () => {
  const { wrapper } = await openManager({ [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE } })
  getButton(wrapper, 'New template').simulate('click')

  const resolvers: ((response: unknown) => void)[] = []
  const response = (status: number, body: unknown) => ({ ok: status === 200, status, statusText: '', json: () => Promise.resolve(body) })
  global.fetch = jest.fn(() => new Promise((resolve) => {
    resolvers.push(resolve)
  })) as unknown as typeof fetch

  setField(wrapper, 'body', { value: 'First' })
  await waitForPreview(wrapper)
  setField(wrapper, 'body', { value: 'Second' })
  await waitForPreview(wrapper)
  setField(wrapper, 'body', { value: 'Third' })
  await waitForPreview(wrapper)
  expect(resolvers.length).toEqual(3)

  resolvers[2](response(200, { ...REPORT, markdown: 'Third preview' }))
  await flush(wrapper)
  resolvers[0](response(200, { ...REPORT, markdown: 'First preview' }))
  resolvers[1](response(400, { errors: ['Out of date error'] }))
  await flush(wrapper)
  expect(wrapper.find('ReactMarkdown').text()).toEqual('Third preview')
  expect(wrapper.find('Message').length).toEqual(0)

  // Clearing the template clears the preview, even if a response is still on its way
  setField(wrapper, 'body', { value: 'Fourth' })
  await waitForPreview(wrapper)
  setField(wrapper, 'body', { value: '  ' })
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)
  resolvers[3](response(200, { ...REPORT, markdown: 'Fourth preview' }))
  await flush(wrapper)
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)
})

test('edits, cancels and deletes an existing template', async () => {
  const routes: Routes = {
    [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE },
    [PREVIEW_URL]: { body: REPORT },
    '/api/report_template/RT0000003_candidates/update': {
      body: {
        reportTemplatesByGuid: {
          RT0000003_candidates: { ...TEMPLATES_RESPONSE.reportTemplatesByGuid.RT0000003_candidates, name: 'Renamed' },
        },
      },
    },
    '/api/report_template/RT0000003_candidates/delete': { status: 403, body: { error: 'Permission Denied' } },
  }
  const { wrapper, fetchMock } = await openManager(routes)

  getButton(wrapper, 'Edit').simulate('click')
  expect(getField(wrapper, 'name').prop('value')).toEqual('Candidate variants')
  expect(getField(wrapper, 'description').prop('value')).toEqual('Project specific summary')
  expect(getField(wrapper, 'audience').prop('value')).toEqual('researcher')
  expect(getField(wrapper, 'body').prop('value')).toEqual('{{#variants}}{{variant.genes}}{{/variants}}')
  await waitForPreview(wrapper)
  expect(postedBody(fetchMock, PREVIEW_URL)).toEqual({ body: '{{#variants}}{{variant.genes}}{{/variants}}' })
  expect(wrapper.find('ReactMarkdown').text()).toEqual(REPORT.markdown)

  setField(wrapper, 'name', { value: 'Abandoned edit' })
  getButton(wrapper, 'Cancel').simulate('click')
  expect(getRows(wrapper)[0][0]).toEqual('Candidate variants')
  expect(fetchMock.mock.calls.filter(call => call[0].includes('/update')).length).toEqual(0)

  getButton(wrapper, 'Edit').simulate('click')
  expect(getField(wrapper, 'name').prop('value')).toEqual('Candidate variants')
  setField(wrapper, 'name', { value: 'Renamed' })
  getButton(wrapper, 'Save').simulate('click')
  await flush(wrapper)
  expect(postedBody(fetchMock, '/api/report_template/RT0000003_candidates/update')).toEqual({
    name: 'Renamed', description: 'Project specific summary', audience: 'researcher', body: '{{#variants}}{{variant.genes}}{{/variants}}',
  })
  expect(getRows(wrapper).map(row => row[0])).toEqual(['Family analysis summary', 'Findings summary', 'Renamed'])

  getButton(wrapper, 'Delete').simulate('click')
  await flush(wrapper)
  expect(wrapper.find('Message').text()).toEqual('Unable to update report templatesPermission Denied')
  expect(getRows(wrapper).length).toEqual(3)

  // Opening the editor clears the earlier error
  getButton(wrapper, 'Edit').simulate('click')
  expect(wrapper.find('Message').length).toEqual(0)
  getButton(wrapper, 'Cancel').simulate('click')

  routes['/api/report_template/RT0000003_candidates/delete'] = {
    body: { reportTemplatesByGuid: { RT0000003_candidates: null } },
  }
  getButton(wrapper, 'Delete').simulate('click')
  await flush(wrapper)
  expect(postedBody(fetchMock, '/api/report_template/RT0000003_candidates/delete')).toEqual({})
  expect(getRows(wrapper).map(row => row[0])).toEqual(['Family analysis summary', 'Findings summary'])
  expect(wrapper.find('Message').length).toEqual(0)
})

test('data managers can create and edit global templates', async () => {
  const globalTemplate = { ...NEW_TEMPLATE, projectGuid: null as null }
  const routes: Routes = {
    [TEMPLATES_URL]: { body: DATA_MANAGER_RESPONSE },
    [PREVIEW_URL]: { body: REPORT },
    '/api/report_template/create': {
      body: { reportTemplatesByGuid: { [globalTemplate.reportTemplateGuid]: globalTemplate } },
    },
  }
  const { wrapper, fetchMock } = await openManager(routes)

  getButton(wrapper, 'New template').simulate('click')
  expect(getField(wrapper, 'isGlobal').prop('checked')).toEqual(false)
  setField(wrapper, 'isGlobal', { checked: true })
  expect(getField(wrapper, 'isGlobal').prop('checked')).toEqual(true)
  setField(wrapper, 'name', { value: 'A new template' })
  setField(wrapper, 'body', { value: 'Hello {{family.displayName}}' })
  getButton(wrapper, 'Save').simulate('click')
  await flush(wrapper)
  expect(postedBody(fetchMock, '/api/report_template/create')).toEqual({
    name: 'A new template', description: '', audience: 'researcher', body: 'Hello {{family.displayName}}',
  })
  expect(fetchMock.mock.calls.filter(call => call[0] === CREATE_URL).length).toEqual(0)
  expect(getRows(wrapper)[0].slice(0, 3)).toEqual(['A new template', 'Clinician', 'All projects'])

  // The scope of an existing template can not be changed
  getButton(wrapper, 'Edit').first().simulate('click')
  expect(getField(wrapper, 'isGlobal').length).toEqual(0)
  expect(getField(wrapper, 'description').prop('value')).toEqual('For testing')
  getButton(wrapper, 'Cancel').simulate('click')
  getButton(wrapper, 'Edit').last().simulate('click')
  expect(getField(wrapper, 'name').prop('value')).toEqual('Findings summary')
  expect(getField(wrapper, 'description').prop('value')).toEqual('')
  wrapper.unmount()

  // A data manager without project edit access can only create global templates
  const { wrapper: globalOnlyWrapper } = await openManager({
    [TEMPLATES_URL]: { body: { ...DATA_MANAGER_RESPONSE, canEditProjectTemplates: false } },
  })
  expect(getRows(globalOnlyWrapper).map(row => row[4])).toEqual(['', 'EditDelete', 'EditDelete'])
  getButton(globalOnlyWrapper, 'New template').simulate('click')
  expect(getField(globalOnlyWrapper, 'isGlobal').prop('checked')).toEqual(true)
})

test('has no preview family when the project has no families', async () => {
  mockFetch({ [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE } })
  const wrapper = mount(
    <Provider store={configureStore({ ...STATE_WITH_2_FAMILIES, familiesByGuid: {} })}>
      <ReportTemplateManagerButton />
    </Provider>,
  )
  wrapper.find('ButtonLink').first().simulate('click')
  await flush(wrapper)
  getButton(wrapper, 'New template').simulate('click')
  expect(getField(wrapper, 'previewFamily').prop('value')).toBeNull()
  setField(wrapper, 'body', { value: 'Hello' })
  await waitForPreview(wrapper)
  expect(global.fetch).toHaveBeenCalledTimes(1)
})
