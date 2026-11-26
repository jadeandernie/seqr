import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import { flushRequests } from 'shared/components/panel/known-variants/testUtils'
import SummaryData, { SummaryDataPageHeader } from './SummaryData'

configure({ adapter: new Adapter() })

const mountPage = (user, path, component) => mount(
  <Provider store={configureMockStore([thunk])({ user })}>
    <MemoryRouter initialEntries={['/summary_data/known_variants']}>
      <Route path={path} component={component} />
    </MemoryRouter>
  </Provider>,
)

test('shows the known variants page to all users', async () => {
  const users = [{ isAnalyst: false }, { isAnalyst: true }]
  for (let i = 0; i < users.length; i += 1) {
    const wrapper = mountPage(users[i], '/summary_data', SummaryData)
    await flushRequests(wrapper)
    expect(wrapper.find('BaseKnownVariants').length).toEqual(1)
    expect(wrapper.find('BaseKnownVariants').prop('isAnalyst')).toEqual(users[i].isAnalyst)

    const header = mountPage(users[i], '/summary_data/:subPage?', SummaryDataPageHeader)
    expect(header.find('MenuItem').map(item => item.prop('to'))).toContain('/summary_data/known_variants')
  }
})
