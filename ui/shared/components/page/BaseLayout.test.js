import React from 'react'
import { mount, shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { createStore } from 'redux'
import { Provider } from 'react-redux'
import { Router } from 'react-router-dom'
import { createMemoryHistory } from 'history'
import { act } from 'react-dom/test-utils'
import rootReducer from 'redux/rootReducer'
import BaseLayout, { BaseLayoutComponent } from './BaseLayout'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  /*
    user: PropTypes.object.isRequired,
    children: PropTypes.node,
   */

  const props = {
    user: {
      date_joined: '2015-02-19T20:22:50.633Z',
      email: 'test@broadinstitute.org',
      first_name: '',
      id: 1,
      is_active: true,
      last_login: '2017-03-14T17:44:53.403Z',
      last_name: '',
      username: 'test',
    },
    children: [],
  }

  shallow(<BaseLayoutComponent {...props} />)
})

const BrokenPage = () => {
  throw new Error('Cannot read properties of undefined')
}

const mountAt = (history, children) => mount(
  <Provider store={createStore(rootReducer, {})}>
    <Router history={history}>
      <BaseLayout>{children()}</BaseLayout>
    </Router>
  </Provider>,
)

describe('page content error boundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('a page that throws while rendering shows an error message inside the layout', () => {
    const wrapper = mountAt(createMemoryHistory({ initialEntries: ['/broken'] }), () => <BrokenPage />)

    expect(wrapper.text()).toContain('Something went wrong displaying this page')
    expect(wrapper.text()).toContain('Cannot read properties of undefined')
    expect(wrapper.text()).toContain('Feature Updates')
    expect(wrapper.text()).toContain('Cite seqr')
  })

  test('navigating away from a page that threw renders the new page', () => {
    const history = createMemoryHistory({ initialEntries: ['/broken'] })
    const Page = () => (history.location.pathname === '/broken' ? <BrokenPage /> : <div id="working-page">Works</div>)
    const wrapper = mountAt(history, () => <Page />)
    expect(wrapper.find('#working-page').exists()).toBe(false)

    act(() => { history.push('/working') })
    wrapper.update()

    expect(wrapper.find('#working-page').text()).toEqual('Works')
    expect(wrapper.text()).not.toContain('Something went wrong')
  })

  test('renders page content unchanged when nothing throws', () => {
    const wrapper = mountAt(createMemoryHistory(), () => <div id="working-page">Works</div>)

    expect(wrapper.find('#working-page').text()).toEqual('Works')
    expect(wrapper.text()).not.toContain('Something went wrong')
  })
})
