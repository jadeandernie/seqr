import React from 'react'
import { mount, configure } from 'enzyme'
import { act } from 'react-dom/test-utils'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'

import { flushAll, mockFetchResponse, getLastFetchUrl, getLastFetchBody } from 'shared/utils/testHelpers'
import UpdateButton from 'shared/components/buttons/UpdateButton'
import { CheckboxGroup } from 'shared/components/form/Inputs'
import { DataRequestIndicator, DataRequestsPanel } from './DataRequests'
import { STATE_WITH_2_FAMILIES } from '../fixtures'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const PROJECT_GUID = 'R0237_1000_genomes_demo'
const INDIVIDUAL_GUID = 'I021475_na19675_1'
const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = days => new Date(Date.now() - (days * DAY_MS) - 60000).toISOString()

const MISSING = [
  { field: 'features', label: 'Observed features (HPO terms)', weight: 30, level: 'individual' },
  { field: 'birthYear', label: 'Year of birth', weight: 6, level: 'individual' },
  { field: 'mondoId', label: 'Family MONDO disease ID', weight: 4, level: 'family' },
]

const INDIVIDUAL = {
  ...STATE_WITH_2_FAMILIES.individualsByGuid[INDIVIDUAL_GUID],
  displayName: 'NA19675',
  completeness: { score: 60, missing: MISSING },
}

const DATA_REQUEST = {
  dataRequestGuid: 'DR0000001_na19675',
  individualGuid: INDIVIDUAL_GUID,
  familyGuid: 'F011652_1',
  projectGuid: PROJECT_GUID,
  individualName: 'NA19675',
  items: [
    { field: 'features', label: 'Observed features (HPO terms)', recorded: false },
    { field: 'birthYear', label: 'Year of birth', recorded: false },
    { field: 'mondoId', label: 'Family MONDO disease ID', recorded: false },
  ],
  reason: 'I',
  status: 'O',
  createdDate: daysAgo(12),
  createdBy: 'Test Analyst',
  assignedTo: 'Test Clinician',
  assignedToUsername: 'clinician',
  resolvedBy: null,
  resolvedDate: null,
  canCancel: false,
  canResolve: false,
}

const OTHER_REQUEST = {
  ...DATA_REQUEST,
  dataRequestGuid: 'DR0000002_na19678',
  individualGuid: 'I021476_na19678_2',
  familyGuid: 'F011652_2',
  individualName: 'NA19678_2',
  items: [
    { field: 'onsetAge', label: 'Age of onset', recorded: true },
    { field: 'sex', label: 'Sex', recorded: false },
  ],
  reason: null,
  createdDate: daysAgo(30),
  createdBy: null,
  assignedTo: null,
  assignedToUsername: null,
}

const USER_OPTIONS = {
  clinician: { username: 'clinician', displayName: 'Test Clinician', email: 'clinician@test.org' },
  analyst: { username: 'analyst', displayName: '', email: 'analyst@test.org' },
}

const stateWithRequests = (requests, extraState = {}) => ({
  ...STATE_WITH_2_FAMILIES,
  dataRequestsByGuid: requests.reduce((acc, request) => ({ ...acc, [request.dataRequestGuid]: request }), {}),
  userOptionsByUsername: USER_OPTIONS,
  userOptionsLoading: { isLoading: false },
  ...extraState,
})

const render = (element, state) => {
  const store = configureStore(state)
  const wrapper = mount(<Provider store={store}><MemoryRouter>{element}</MemoryRouter></Provider>)
  return { store, wrapper }
}

const renderIndicator = (individual, state) => render(<DataRequestIndicator individual={individual} />, state)

const buttonContents = wrapper => wrapper.find('DispatchRequestButton').map(button => button.prop('buttonContent'))

const confirmAction = async (wrapper, content) => {
  const button = wrapper.find('DispatchRequestButton').filterWhere(b => b.prop('buttonContent') === content)
  button.find('ButtonLink').simulate('click')
  wrapper.update()
  const confirm = wrapper.find('DispatchRequestButton').filterWhere(b => b.prop('buttonContent') === content).find('Confirm')
  expect(confirm.prop('open')).toBe(true)
  await act(async () => {
    confirm.prop('onConfirm')()
    await flushAll()
  })
  return confirm.prop('content')
}

describe('DataRequestIndicator', () => {
  test('offers to request data only for scored individuals with missing clinical data', () => {
    const { wrapper } = renderIndicator(INDIVIDUAL, stateWithRequests([]))
    expect(wrapper.find('ButtonLink').prop('content')).toEqual('Request data')
    expect(wrapper.find(UpdateButton).prop('modalTitle')).toEqual('Request clinical data for NA19675')
    expect(wrapper.find('Label')).toHaveLength(0)

    // unaffected individuals are not scored, and complete individuals have nothing to request
    expect(renderIndicator({ ...INDIVIDUAL, completeness: null }, stateWithRequests([])).wrapper.html()).toEqual('')
    expect(renderIndicator(
      { ...INDIVIDUAL, completeness: { score: 100, missing: [] } }, stateWithRequests([]),
    ).wrapper.html()).toEqual('')
    expect(renderIndicator(
      STATE_WITH_2_FAMILIES.individualsByGuid[INDIVIDUAL_GUID], STATE_WITH_2_FAMILIES,
    ).wrapper.html()).toEqual('')

    // requests that are closed or for other individuals do not replace the request action
    const closedRequests = ['F', 'D', 'C'].map(
      status => ({ ...DATA_REQUEST, status, dataRequestGuid: `DR_${status}` }),
    )
    const { wrapper: closedWrapper } = renderIndicator(
      INDIVIDUAL, stateWithRequests([...closedRequests, OTHER_REQUEST]),
    )
    expect(closedWrapper.find('ButtonLink').prop('content')).toEqual('Request data')
    expect(closedWrapper.find('Label')).toHaveLength(0)
  })

  test('requests a checklist of missing items with a coded reason and assignee, and no free text', async () => {
    const { wrapper, store } = renderIndicator(INDIVIDUAL, stateWithRequests([], {
      modal: { [`requestData-${INDIVIDUAL_GUID}`]: { open: true } },
    }))
    await flushAll()
    wrapper.update()

    // the collaborators of the project are loaded as the possible assignees
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`/api/users/get_options/${PROJECT_GUID}?`])

    expect(wrapper.find('ForwardRef(Field)').map(field => field.prop('name'))).toEqual(
      ['requestedFields', 'reason', 'assignedTo'],
    )
    expect(wrapper.find('input[type="text"]')).toHaveLength(0)
    expect(wrapper.find('textarea')).toHaveLength(0)

    // every missing item can be requested, and the items that matter most are ticked to start with
    const checklist = wrapper.find(CheckboxGroup)
    expect(checklist.prop('options')).toEqual([
      { value: 'features', text: 'Observed features (HPO terms)' },
      { value: 'birthYear', text: 'Year of birth' },
      { value: 'mondoId', text: 'Family MONDO disease ID' },
    ])
    expect(checklist.prop('value')).toEqual(['features'])
    const requestedFieldsValidate = wrapper.find('ForwardRef(Field)[name="requestedFields"]').prop('validate')
    expect(requestedFieldsValidate([])).toEqual('Required')
    expect(requestedFieldsValidate(['features'])).toBeUndefined()

    expect(wrapper.find('Select').at(0).prop('options')).toEqual([
      { value: 'A', text: 'Needed for analysis' },
      { value: 'I', text: 'To confirm inheritance' },
      { value: 'M', text: 'For matchmaking' },
      { value: 'O', text: 'Other' },
    ])
    expect(wrapper.find('Select').at(1).prop('options')).toEqual([
      { value: 'clinician', text: 'Test Clinician' },
      { value: 'analyst', text: 'analyst@test.org' },
    ])

    act(() => {
      wrapper.find(CheckboxGroup).prop('onChange')(['features', 'mondoId'])
      wrapper.find('Select').at(0).prop('onChange')('M')
      wrapper.find('Select').at(1).prop('onChange')('clinician')
    })
    wrapper.update()
    expect(wrapper.find(CheckboxGroup).prop('value')).toEqual(['features', 'mondoId'])

    const response = { dataRequestsByGuid: { [DATA_REQUEST.dataRequestGuid]: DATA_REQUEST } }
    mockFetchResponse(response)
    store.clearActions()
    await act(async () => {
      wrapper.find('form').simulate('submit')
      await flushAll()
    })

    // only the coded values are sent
    expect(getLastFetchUrl()).toEqual(`/api/project/${PROJECT_GUID}/data_requests/create`)
    expect(getLastFetchBody()).toEqual({
      individualGuid: INDIVIDUAL_GUID, requestedFields: ['features', 'mondoId'], reason: 'M', assignedTo: 'clinician',
    })
    expect(store.getActions()).toContainEqual({ type: 'RECEIVE_DATA', updatesById: response })
  })

  test('sends a request with only the default checklist when nothing else is chosen', async () => {
    const { wrapper } = renderIndicator(INDIVIDUAL, stateWithRequests([], {
      modal: { [`requestData-${INDIVIDUAL_GUID}`]: { open: true } },
    }))
    await act(async () => {
      wrapper.find('form').simulate('submit')
      await flushAll()
    })
    expect(getLastFetchUrl()).toEqual(`/api/project/${PROJECT_GUID}/data_requests/create`)
    expect(getLastFetchBody()).toEqual({ individualGuid: INDIVIDUAL_GUID, requestedFields: ['features'] })
  })

  test('shows an open request with its age, what remains and who it is assigned to', () => {
    const { wrapper } = renderIndicator(INDIVIDUAL, stateWithRequests([DATA_REQUEST, OTHER_REQUEST]))
    expect(wrapper.find('Label').text()).toEqual('Data requested: 3 items, 12 days ago')
    expect(wrapper.find(UpdateButton)).toHaveLength(0)
    expect(buttonContents(wrapper)).toEqual([])

    const detail = mount(wrapper.find('Popup').prop('content'))
    expect(detail.find('div').first().children().map(child => child.text())).toEqual([
      'Requested by Test Analyst, 12 days ago',
      'Assigned to Test Clinician',
      'Reason: To confirm inheritance',
      'Still needed:Observed features (HPO terms)Year of birthFamily MONDO disease ID',
    ])

    // a partially satisfied request shows which items remain
    const { wrapper: partialWrapper } = renderIndicator(
      { ...INDIVIDUAL, individualGuid: OTHER_REQUEST.individualGuid }, stateWithRequests([DATA_REQUEST, OTHER_REQUEST]),
    )
    expect(partialWrapper.find('Label').text()).toEqual('Data requested: 1 of 2 items remaining, 30 days ago')
    const partialDetail = mount(partialWrapper.find('Popup').prop('content'))
    expect(partialDetail.find('div').first().children().map(child => child.text())).toEqual([
      'Requested by a former user, 30 days ago',
      'Not assigned',
      'Still needed:Sex',
      'Recorded since the request:Age of onset',
    ])

    const recordedRequest = { ...OTHER_REQUEST, items: [OTHER_REQUEST.items[0]] }
    const recordedDetail = mount(renderIndicator(
      { ...INDIVIDUAL, individualGuid: OTHER_REQUEST.individualGuid }, stateWithRequests([recordedRequest]),
    ).wrapper.find('Popup').prop('content'))
    expect(recordedDetail.text()).not.toContain('Still needed')
    expect(recordedDetail.text()).toContain('Recorded since the request:Age of onset')
  })

  test('only offers the actions the user is permitted to take', async () => {
    const requesterView = renderIndicator(INDIVIDUAL, stateWithRequests([{ ...DATA_REQUEST, canCancel: true }]))
    expect(buttonContents(requesterView.wrapper)).toEqual(['Cancel request'])

    const resolverView = renderIndicator(INDIVIDUAL, stateWithRequests([{ ...DATA_REQUEST, canResolve: true }]))
    expect(buttonContents(resolverView.wrapper)).toEqual(['Mark fulfilled', 'Decline'])

    const managerRequesterView = renderIndicator(
      INDIVIDUAL, stateWithRequests([{ ...DATA_REQUEST, canCancel: true, canResolve: true }]),
    )
    expect(buttonContents(managerRequesterView.wrapper)).toEqual(['Mark fulfilled', 'Decline', 'Cancel request'])

    const cancelled = { ...DATA_REQUEST, status: 'C' }
    const cancelResponse = { dataRequestsByGuid: { [DATA_REQUEST.dataRequestGuid]: cancelled } }
    mockFetchResponse(cancelResponse)
    const confirmContent = await confirmAction(requesterView.wrapper, 'Cancel request')
    expect(confirmContent).toEqual('Cancel this data request?')
    expect(getLastFetchUrl()).toEqual(
      `/api/project/${PROJECT_GUID}/data_requests/${DATA_REQUEST.dataRequestGuid}/update_status`,
    )
    expect(getLastFetchBody()).toEqual({ status: 'C' })
    expect(requesterView.store.getActions()).toEqual([{ type: 'RECEIVE_DATA', updatesById: cancelResponse }])

    expect(await confirmAction(resolverView.wrapper, 'Mark fulfilled')).toEqual(
      'Mark this data request as fulfilled? The requester will be notified.',
    )
    expect(getLastFetchBody()).toEqual({ status: 'F' })

    expect(await confirmAction(managerRequesterView.wrapper, 'Decline')).toEqual(
      'Decline this data request? The requester will be notified.',
    )
    expect(getLastFetchBody()).toEqual({ status: 'D' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('DataRequestsPanel', () => {
  const OTHER_PROJECT_REQUEST = { ...DATA_REQUEST, dataRequestGuid: 'DR3', projectGuid: 'R_other', individualName: 'X' }
  const CLOSED_REQUEST = { ...DATA_REQUEST, dataRequestGuid: 'DR4', status: 'F', individualName: 'Y' }
  const PANEL_REQUESTS = [DATA_REQUEST, { ...OTHER_REQUEST, canResolve: true }, OTHER_PROJECT_REQUEST, CLOSED_REQUEST]

  const itemTexts = wrapper => wrapper.find('ListItem').map(
    item => item.find('.description > div').map(div => div.text()),
  )

  test('lists the open requests of the project, oldest first', () => {
    const { wrapper } = render(<DataRequestsPanel />, stateWithRequests(PANEL_REQUESTS))

    expect(wrapper.find('ListHeader').map(header => header.text())).toEqual(['NA19678_2', 'NA19675'])
    expect(wrapper.find('Link').map(link => link.prop('to'))).toEqual([
      `/project/${PROJECT_GUID}/family_page/F011652_2`, `/project/${PROJECT_GUID}/family_page/F011652_1`,
    ])
    expect(itemTexts(wrapper)).toEqual([
      ['Sex', 'Requested by a former user, 30 days ago', 'Not assigned'],
      [
        'Observed features (HPO terms), Year of birth, Family MONDO disease ID',
        'Requested by Test Analyst, 12 days ago',
        'Assigned to Test Clinician',
      ],
    ])
    expect(wrapper.find('ListItem').map(item => buttonContents(item))).toEqual([['Mark fulfilled', 'Decline'], []])
  })

  test('filters to the requests assigned to the current user', () => {
    const state = stateWithRequests(PANEL_REQUESTS, { user: { ...STATE_WITH_2_FAMILIES.user, username: 'clinician' } })
    const { wrapper } = render(<DataRequestsPanel />, state)
    expect(wrapper.find('ListItem')).toHaveLength(2)
    expect(wrapper.find('Checkbox').prop('label')).toEqual('Assigned to me')
    expect(wrapper.find('Checkbox').prop('checked')).toBe(false)

    act(() => {
      wrapper.find('Checkbox').prop('onChange')({}, { checked: true })
    })
    wrapper.update()
    expect(wrapper.find('Checkbox').prop('checked')).toBe(true)
    expect(wrapper.find('ListHeader').map(header => header.text())).toEqual(['NA19675'])

    act(() => {
      wrapper.find('Checkbox').prop('onChange')({}, { checked: false })
    })
    wrapper.update()
    expect(wrapper.find('ListItem')).toHaveLength(2)

    // a user with nothing assigned is told so, and can still see every request again
    const { wrapper: unassignedWrapper } = render(<DataRequestsPanel />, stateWithRequests(PANEL_REQUESTS))
    act(() => {
      unassignedWrapper.find('Checkbox').prop('onChange')({}, { checked: true })
    })
    unassignedWrapper.update()
    expect(unassignedWrapper.find('ListItem')).toHaveLength(0)
    expect(unassignedWrapper.text()).toEqual('Assigned to meNo open data requests are assigned to you')
  })

  test('shows when the project has no open requests', () => {
    const { wrapper } = render(<DataRequestsPanel />, stateWithRequests([OTHER_PROJECT_REQUEST, CLOSED_REQUEST]))
    expect(wrapper.text()).toEqual('No open data requests')
    expect(wrapper.find('Checkbox')).toHaveLength(0)

    expect(render(<DataRequestsPanel />, STATE_WITH_2_FAMILIES).wrapper.text()).toEqual('No open data requests')
  })
})
