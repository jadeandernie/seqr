import React from 'react'
import { act } from 'react-dom/test-utils'
import { configure, mount } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { createMemoryHistory } from 'history'
import { Provider } from 'react-redux'
import { Route, Router } from 'react-router-dom'
import { applyMiddleware, createStore } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from '../../../redux/rootReducer'
import { flushAll } from '../../../shared/utils/testHelpers'
import Project from '../Project'
import { STATE } from './fixtures'
import { WorkbookAction, WorkbookReduxState, WorkbookThunk } from './types'

configure({ adapter: new Adapter() })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wrapper = any

interface MockResponse {
  status?: number
  json: object | ((body: object) => object)
  wait?: Promise<void>
}

interface TestStore {
  getState: () => WorkbookReduxState
  dispatch: <R>(action: WorkbookAction | WorkbookThunk<R>) => R
}

export const createTestStore = (state: object = {}) => {
  const store = createStore(rootReducer, { ...STATE, ...state }, applyMiddleware(thunk))
  return store as TestStore & typeof store
}

// Responds to requests by path, any other request gets an empty successful response
export const mockApi = (responses: Record<string, MockResponse>) => {
  (fetch as jest.Mock).mockImplementation((url: string, { body }: { body?: string }) => {
    const { status = 200, json, wait } = responses[url.split('?')[0]] || { json: {} }
    const responseJson = typeof json === 'function' ? json(JSON.parse(body)) : json
    return Promise.resolve(wait).then(
      () => ({ ok: status === 200, status, statusText: 'Error', json: () => Promise.resolve(responseJson) }),
    )
  })
}

export const getRequests = (path: string): unknown[] => (fetch as jest.Mock).mock.calls.filter(
  ([url]) => url.split('?')[0] === path,
).map(([, options]) => (options.body ? JSON.parse(options.body) : null))

const mounted: Wrapper[] = []

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => {
    const container = wrapper.getDOMNode().parentNode
    wrapper.unmount()
    container.remove()
  })
})

// Mounted in the document so that focus can be tested
export const renderProjectPage = (path: string, state: object) => {
  const store = createTestStore(state)
  const history = createMemoryHistory({ initialEntries: [path] })
  const wrapper = mount(
    <Provider store={store}>
      <Router history={history}>
        <Route path="/project/:projectGuid" component={Project} />
      </Router>
    </Provider>,
    { attachTo: document.body.appendChild(document.createElement('div')) },
  )
  mounted.push(wrapper)
  return { store, history, wrapper }
}

export const flush = async (wrapper: Wrapper) => {
  await act(async () => {
    await flushAll()
  })
  wrapper.update()
}

export const click = async (wrapper: Wrapper, selector: string) => {
  wrapper.find(selector).hostNodes().simulate('click')
  await flush(wrapper)
}

export const clickLink = async (wrapper: Wrapper, text: string) => {
  wrapper.find('a').filterWhere((link: Wrapper) => link.text() === text).simulate('click', { button: 0 })
  await flush(wrapper)
}

export const clickButton = async (wrapper: Wrapper, text: string) => {
  wrapper.find('button').filterWhere((button: Wrapper) => button.text() === text).simulate('click')
  await flush(wrapper)
}

export const getOpenModal = (wrapper: Wrapper) => wrapper.find('Modal').filterWhere(
  (modal: Wrapper) => modal.prop('open'),
)

export const setInput = (wrapper: Wrapper, name: string, value: string) => {
  wrapper.find(`input[name="${name}"]`).simulate('change', { target: { value } })
}

export const setDropdown = (wrapper: Wrapper, name: string | undefined, value: string | string[]) => {
  const dropdown = wrapper.find('Dropdown').filterWhere((node: Wrapper) => node.prop('name') === name).first()
  act(() => {
    dropdown.prop('onChange')(null, { value })
  })
  wrapper.root().update()
}

export const submitForm = async (wrapper: Wrapper) => {
  getOpenModal(wrapper).find('form').simulate('submit')
  await flush(wrapper)
}

export const confirm = async (wrapper: Wrapper) => {
  wrapper.find('Confirm').filterWhere((node: Wrapper) => node.prop('open')).find('button.primary').simulate('click')
  await flush(wrapper)
}
