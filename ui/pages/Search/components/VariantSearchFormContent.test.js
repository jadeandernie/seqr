import React from 'react'
import { shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'

import VariantSearchFormContent from './VariantSearchFormContent'

import { STATE } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE)

  shallow(<VariantSearchFormContent store={store} />)
})

test('shows the Clear and Autofill controls above the saved searches and filters', () => {
  const wrapper = shallow(<VariantSearchFormContent noEditProjects />)
  const children = wrapper.children().map(child => child.name())
  expect(children[0]).toEqual('SearchAutofill')
  expect(children.indexOf('SearchAutofill')).toBeLessThan(children.indexOf('Header'))
})
