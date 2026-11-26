import { PROJECT_GUID, STATE, WORKBOOK, WORKBOOK_DETAIL, WORKBOOK_GUID } from './fixtures'
import { updateWorkbookEditors } from './reducers'
import { getEditorOptions } from './selectors'
import { getWorkbookUrl } from './Sharing'
import {
  click, clickButton, createTestStore, flush, getOpenModal, getRequests, mockApi, renderProjectPage, setDropdown,
  submitForm,
} from './testHelpers'
import { Workbook } from './types'

jest.mock('../../../shared/components/panel/variants/Variants', () => () => null)

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const EDITORS_URL = `${API_PATH}/editors/update`
const COLLABORATORS_URL = `/api/project/${PROJECT_GUID}/get_collaborators`
const URL = `http://localhost/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const EDITOR = { username: 'test_user2', displayName: 'Test Editor', email: 'test2@broadinstitute.org' }
const FORMER_MEMBER = { username: 'former_member', displayName: '', email: 'former@broadinstitute.org' }
const SHARED_WORKBOOK: Workbook = { ...WORKBOOK, editors: [EDITOR, FORMER_MEMBER] }

const renderWorkbook = async (workbook: Workbook, responses: Responses = {}) => {
  mockApi({
    [API_PATH]: { json: { ...WORKBOOK_DETAIL, workbooksByGuid: { [WORKBOOK_GUID]: workbook } } }, ...responses,
  })
  const rendered = renderProjectPage(PATH, {})
  await flush(rendered.wrapper)
  await flush(rendered.wrapper)
  return rendered
}

const openShare = async (wrapper: Wrapper) => {
  await click(wrapper, 'button[aria-label="Share workbook Trio analysis"]')
  await flush(wrapper)
}

const getSummary = (wrapper: Wrapper) => wrapper.find('div[aria-label="Sharing"]').text()
const getStatus = (wrapper: Wrapper) => getOpenModal(wrapper).find('span[role="status"]').text()

const setClipboard = (clipboard?: object) => {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
}

afterEach(() => {
  setClipboard(undefined)
})

test('offers the project collaborators and the current editors as editors, but not the creator', () => {
  const state = createTestStore().getState()
  expect(getEditorOptions(state, WORKBOOK)).toEqual([
    { value: 'test_user1', text: 'test1@broadinstitute.org' }, { value: 'test_user2', text: 'test2@broadinstitute.org' },
  ])
  expect(getEditorOptions(state, { ...SHARED_WORKBOOK, createdBy: 'test1@broadinstitute.org' })).toEqual([
    { value: 'former_member', text: 'former@broadinstitute.org' }, { value: 'test_user2', text: 'test2@broadinstitute.org' },
  ])
  expect(getEditorOptions(createTestStore({ projectsByGuid: {} }).getState(), WORKBOOK)).toEqual([])
  expect(getEditorOptions(createTestStore({
    projectsByGuid: { [PROJECT_GUID]: { ...STATE.projectsByGuid[PROJECT_GUID], collaborators: undefined } },
  }).getState(), { ...WORKBOOK, editors: undefined })).toEqual([])
  expect(getWorkbookUrl(WORKBOOK)).toEqual(URL)
})

test('saves the editors of a workbook, with no editors as an empty list', async () => {
  const store = createTestStore()
  mockApi({ [EDITORS_URL]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: SHARED_WORKBOOK } } } })

  await store.dispatch(updateWorkbookEditors(WORKBOOK_GUID, { usernames: ['test_user2'] }))
  await store.dispatch(updateWorkbookEditors(WORKBOOK_GUID, {}))

  expect(getRequests(EDITORS_URL)).toEqual([{ usernames: ['test_user2'] }, { usernames: [] }])
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(SHARED_WORKBOOK)
})

test('the creator or a project manager adds and removes editors from the project collaborators', async () => {
  const { wrapper, store } = await renderWorkbook(WORKBOOK, {
    [EDITORS_URL]: { json: { workbooksByGuid: { [WORKBOOK_GUID]: SHARED_WORKBOOK } } },
  })
  expect(getSummary(wrapper)).toContain('Editors: none')
  expect(getRequests(COLLABORATORS_URL)).toHaveLength(0)

  await openShare(wrapper)
  expect(getRequests(COLLABORATORS_URL)).toHaveLength(1)
  const modalText = getOpenModal(wrapper).text()
  expect(modalText).toContain('Everyone with access to this project can open this workbook with its link')
  expect(modalText).toContain('never gives access to the project or its families')
  expect(modalText).toContain('The creator of this workbook (Test Manager User) and the managers of this project')
  expect(getOpenModal(wrapper).find('input[aria-label="Workbook link"]').prop('value')).toEqual(URL)
  const dropdown = getOpenModal(wrapper).find('Dropdown').filterWhere((node: Wrapper) => node.prop('name') === 'usernames').first()
  expect(dropdown.prop('value')).toEqual([])
  expect(dropdown.prop('options').map(({ value }: { value: string }) => value)).toEqual(['test_user1', 'test_user2'])
  setDropdown(getOpenModal(wrapper), 'usernames', ['test_user2'])
  await submitForm(wrapper)

  expect(getRequests(EDITORS_URL)).toEqual([{ usernames: ['test_user2'] }])
  expect(store.getState().workbooksByGuid[WORKBOOK_GUID]).toEqual(SHARED_WORKBOOK)
  expect(getSummary(wrapper)).toContain('Editors: Test Editor, former@broadinstitute.org')
  expect(getOpenModal(wrapper).exists()).toBe(false)

  await openShare(wrapper)
  const reopened = getOpenModal(wrapper).find('Dropdown').filterWhere((node: Wrapper) => node.prop('name') === 'usernames').first()
  expect(reopened.prop('value')).toEqual(['test_user2', 'former_member'])
  setDropdown(getOpenModal(wrapper), 'usernames', [])
  await submitForm(wrapper)
  expect(getRequests(EDITORS_URL)[1]).toEqual({ usernames: [] })
})

test('shows the error when the editors are rejected', async () => {
  const { wrapper } = await renderWorkbook(WORKBOOK, {
    [EDITORS_URL]: { status: 400, json: { errors: ['test_user1 does not have access to this project'] } },
  })

  await openShare(wrapper)
  setDropdown(getOpenModal(wrapper), 'usernames', ['test_user1'])
  await submitForm(wrapper)

  expect(getOpenModal(wrapper).text()).toContain('test_user1 does not have access to this project')
  expect(getSummary(wrapper)).toContain('Editors: none')
})

test('other users see the editors and the link but can not change the editors', async () => {
  const { wrapper } = await renderWorkbook({ ...SHARED_WORKBOOK, canManageEditors: false, createdBy: null })
  expect(getSummary(wrapper)).toContain('Editors: Test Editor, former@broadinstitute.org')

  await openShare(wrapper)
  expect(getOpenModal(wrapper).find('p[aria-label="Editors"]').text()).toEqual('Test Editor, former@broadinstitute.org')
  expect(getOpenModal(wrapper).text()).toContain('The creator of this workbook (unknown user)')
  expect(getOpenModal(wrapper).find('input[aria-label="Workbook link"]').prop('value')).toEqual(URL)
  expect(getOpenModal(wrapper).find('Dropdown').exists()).toBe(false)
  expect(getOpenModal(wrapper).find('form').exists()).toBe(false)
  expect(getRequests(COLLABORATORS_URL)).toHaveLength(0)

  const noEditors = await renderWorkbook({ ...WORKBOOK, canManageEditors: false, editors: undefined })
  await openShare(noEditors.wrapper)
  expect(getOpenModal(noEditors.wrapper).find('p[aria-label="Editors"]').text()).toEqual('This workbook has no editors')
})

test('copies the link of the workbook to the clipboard', async () => {
  const writeText = jest.fn(() => Promise.resolve())
  setClipboard({ writeText })
  const { wrapper } = await renderWorkbook(WORKBOOK)
  await openShare(wrapper)
  expect(getStatus(wrapper)).toEqual('')

  await clickButton(getOpenModal(wrapper), 'Copy link')
  wrapper.update()
  expect(writeText).toHaveBeenCalledWith(URL)
  expect(getStatus(wrapper)).toEqual('Link copied')

  writeText.mockImplementation(() => Promise.reject(new Error('Not allowed')))
  await clickButton(getOpenModal(wrapper), 'Copy link')
  wrapper.update()
  expect(getStatus(wrapper)).toEqual('The link could not be copied, copy it from the box')
})

test('asks to copy the link by hand when the browser has no clipboard access', async () => {
  const { wrapper } = await renderWorkbook(WORKBOOK)
  await openShare(wrapper)

  await clickButton(getOpenModal(wrapper), 'Copy link')
  wrapper.update()

  expect(getStatus(wrapper)).toEqual('The link could not be copied, copy it from the box')
})
