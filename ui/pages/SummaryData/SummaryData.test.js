import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import SummaryData, { SummaryDataPageHeader } from './SummaryData'

configure({ adapter: new Adapter() })

const mountPage = (user, component) => mount(
  <Provider store={configureMockStore([thunk])({ user })}>
    <MemoryRouter initialEntries={['/summary_data/known_variants']}>
      <Route path="/summary_data/:subPage?" component={component} />
    </MemoryRouter>
  </Provider>,
)

test('shows the known variants page to all users', () => {
  [{ isAnalyst: false }, { isAnalyst: true }].forEach((user) => {
    const wrapper = mountPage(user, SummaryData)
    expect(wrapper.find('BaseKnownVariants').length).toEqual(1)
    expect(wrapper.find('BaseKnownVariants').prop('isAnalyst')).toEqual(user.isAnalyst)

    const header = mountPage(user, SummaryDataPageHeader)
    expect(header.find('MenuItem').map(item => item.prop('to'))).toContain('/summary_data/known_variants')
  })
})
