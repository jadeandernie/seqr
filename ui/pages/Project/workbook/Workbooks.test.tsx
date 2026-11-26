import {
  OTHER_WORKBOOK, PROJECT_GUID, WORKBOOK, WORKBOOK_DETAIL, WORKBOOK_GUID,
} from './fixtures'
import {
  click, clickButton, confirm, flush, getOpenModal, getRequests, mockApi, renderProjectPage, setDropdown, setInput,
  submitForm,
} from './testHelpers'

const PATH = `/project/${PROJECT_GUID}/workbooks`
const LIST_URL = `/api/project/${PROJECT_GUID}/workbooks`
const WORKBOOKS = { [WORKBOOK_GUID]: WORKBOOK, WB0000002_exomes: OTHER_WORKBOOK }
const LIST_RESPONSE = { [LIST_URL]: { json: { workbooksByGuid: WORKBOOKS } } }

const renderWorkbooks = async (responses: Parameters<typeof mockApi>[0] = LIST_RESPONSE) => {
  mockApi(responses)
  const rendered = renderProjectPage(PATH, { workbooksByGuid: {} })
  await flush(rendered.wrapper)
  return rendered
}

const getRowTexts = (wrapper: ReturnType<typeof renderProjectPage>['wrapper']) => wrapper.find('tbody tr').map(
  (row: typeof wrapper) => row.find('td').map((cell: typeof wrapper) => cell.text()),
)

test('loads and lists the workbooks of the project with links to each workbook', async () => {
  const { wrapper } = await renderWorkbooks()

  expect(getRequests(LIST_URL)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_families`)).toHaveLength(1)
  expect(getRequests(`/api/project/${PROJECT_GUID}/get_analysis_groups`)).toHaveLength(1)
  expect(getRowTexts(wrapper)).toEqual([
    ['Exome review', '', 'unknown user on 11/20/2026', '11/21/2026', ''],
    ['Trio analysis', 'De novo and recessive review', 'Test Manager User on 11/20/2026', '11/21/2026', ''],
  ])
  expect(wrapper.find('tbody a').map((link: typeof wrapper) => link.prop('href'))).toEqual([
    `/project/${PROJECT_GUID}/workbook/WB0000002_exomes`, `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`,
  ])
})

test('only shows the edit and delete controls for workbooks the user can edit', async () => {
  const { wrapper } = await renderWorkbooks()

  const getLabels = (row: number) => wrapper.find('tbody tr').at(row).find('button').map(
    (button: typeof wrapper) => button.prop('aria-label'),
  )
  expect(getLabels(0)).toEqual(['Duplicate workbook Exome review for other families'])
  expect(getLabels(1)).toEqual([
    'Duplicate workbook Trio analysis for other families', 'Edit workbook Trio analysis', 'Delete workbook Trio analysis',
  ])
})

test('shows a message when the project has no workbooks', async () => {
  const { wrapper } = await renderWorkbooks({})

  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).toContain('This project has no workbooks yet')
  expect(wrapper.find('button').map((button: typeof wrapper) => button.text())).toEqual(['Create Workbook'])
})

test('shows the error when the workbooks fail to load', async () => {
  const { wrapper } = await renderWorkbooks({ [LIST_URL]: { status: 403, json: { error: 'Permission Denied' } } })

  expect(wrapper.find('Message').prop('error')).toBe(true)
  expect(wrapper.find('Message').text()).toEqual('Permission Denied')
  expect(wrapper.find('table').exists()).toBe(false)
})

test('creates a workbook with initial families and analysis groups', async () => {
  const created = { ...WORKBOOK, workbookGuid: 'WB0000003_new', name: 'New workbook', description: 'Notes' }
  const createUrl = `${LIST_URL}/create`
  const { wrapper } = await renderWorkbooks({
    ...LIST_RESPONSE, [createUrl]: { json: { ...WORKBOOK_DETAIL, workbooksByGuid: { WB0000003_new: created } } },
  })

  await clickButton(wrapper, 'Create Workbook')
  expect(getOpenModal(wrapper).find('ModalHeader').text()).toEqual('Create Workbook')
  const getOptions = (name: string) => wrapper.find('Dropdown')
    .filterWhere((dropdown: typeof wrapper) => dropdown.prop('name') === name)
    .first()
    .prop('options')
    .map(({ text, value }: { text: string, value: string }) => ({ text, value }))
  expect(getOptions('familyGuids')).toEqual([{ value: 'F011652_1', text: '1' }, { value: 'F011652_2', text: '2' }])
  expect(getOptions('analysisGroupGuids')).toEqual([{ value: 'AG0000183_test_group', text: 'Test Group' }])

  await submitForm(wrapper)
  expect(wrapper.find('.error.message').text()).toEqual('Name is required')
  expect(getRequests(createUrl)).toHaveLength(0)

  setInput(wrapper, 'name', 'New workbook')
  setInput(wrapper, 'description', 'Notes')
  setDropdown(wrapper, 'familyGuids', ['F011652_2'])
  setDropdown(wrapper, 'analysisGroupGuids', ['AG0000183_test_group'])
  await submitForm(wrapper)

  expect(getRequests(createUrl)).toEqual([{
    name: 'New workbook', description: 'Notes', familyGuids: ['F011652_2'], analysisGroupGuids: ['AG0000183_test_group'],
  }])
  expect(getOpenModal(wrapper).exists()).toBe(false)
  expect(getRowTexts(wrapper).map(([name]: string[]) => name)).toEqual(['Exome review', 'New workbook', 'Trio analysis'])
})

test('shows the errors returned when creating a workbook fails', async () => {
  const createUrl = `${LIST_URL}/create`
  const { wrapper } = await renderWorkbooks({
    ...LIST_RESPONSE,
    [createUrl]: { status: 400, json: { errors: ['A workbook named "Trio analysis" already exists'] } },
  })

  await clickButton(wrapper, 'Create Workbook')
  setInput(wrapper, 'name', 'Trio analysis')
  await submitForm(wrapper)

  expect(getRequests(createUrl)).toEqual([{ name: 'Trio analysis' }])
  expect(wrapper.find('.error.message').text()).toEqual('A workbook named "Trio analysis" already exists')
  expect(getOpenModal(wrapper).exists()).toBe(true)
})

test('renames a workbook and edits its description', async () => {
  const updateUrl = `/api/workbook/${WORKBOOK_GUID}/update`
  const { wrapper } = await renderWorkbooks({
    ...LIST_RESPONSE,
    [updateUrl]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: { ...WORKBOOK, name: 'Quad analysis', description: '' } } } },
  })

  await click(wrapper, 'button[aria-label="Edit workbook Trio analysis"]')
  expect(wrapper.find('input[name="name"]').prop('value')).toEqual('Trio analysis')
  setInput(wrapper, 'name', 'Quad analysis')
  setInput(wrapper, 'description', '')
  await submitForm(wrapper)

  expect(getRequests(updateUrl)).toEqual([{ name: 'Quad analysis', description: null }])
  expect(getRowTexts(wrapper).map(([name]: string[]) => name)).toEqual(['Exome review', 'Quad analysis'])
})

test('deletes a workbook after confirmation', async () => {
  const deleteUrl = `/api/workbook/${WORKBOOK_GUID}/delete`
  const { wrapper } = await renderWorkbooks({
    ...LIST_RESPONSE, [deleteUrl]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: null } } },
  })

  await click(wrapper, 'button[aria-label="Delete workbook Trio analysis"]')
  expect(getRequests(deleteUrl)).toHaveLength(0)
  expect(wrapper.find('Confirm').filterWhere((node: typeof wrapper) => node.prop('open')).prop('content')).toEqual(
    'Are you sure you want to delete the workbook "Trio analysis"? Its worksheets, queries, statuses and notes will be deleted.',
  )
  await confirm(wrapper)

  expect(getRequests(deleteUrl)).toEqual([{}])
  expect(getRowTexts(wrapper).map(([name]: string[]) => name)).toEqual(['Exome review'])
})

test('duplicates a workbook for other families', async () => {
  const duplicateUrl = '/api/workbook/WB0000002_exomes/duplicate'
  const copy = { ...OTHER_WORKBOOK, workbookGuid: 'WB0000003_copy', name: 'Exome review (copy)', canEdit: true }
  const { wrapper } = await renderWorkbooks({
    ...LIST_RESPONSE, [duplicateUrl]: { json: { workbooksByGuid: { WB0000003_copy: copy } } },
  })

  await click(wrapper, 'button[aria-label="Duplicate workbook Exome review for other families"]')
  expect(wrapper.find('input[name="name"]').prop('value')).toEqual('Exome review (copy)')
  setDropdown(wrapper, 'familyGuids', ['F011652_1', 'F011652_2'])
  await submitForm(wrapper)

  expect(getRequests(duplicateUrl)).toEqual([{ name: 'Exome review (copy)', familyGuids: ['F011652_1', 'F011652_2'] }])
  expect(getRowTexts(wrapper).map(([name]: string[]) => name)).toEqual(
    ['Exome review', 'Exome review (copy)', 'Trio analysis'],
  )
})
