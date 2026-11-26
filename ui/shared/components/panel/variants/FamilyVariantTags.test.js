import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import FamilyVariantTags from './FamilyVariantTags'

import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<FamilyVariantTags store={store} variant={VARIANT} familyGuid={VARIANT.familyGuids[0]} />)
  shallow(<FamilyVariantTags store={store} variant={SV_VARIANT} familyGuid={SV_VARIANT.familyGuids[0]} />)
})

test('offers to remember saved SNV/indel variants, but not structural or unsaved variants', () => {
  const store = configureStore([thunk])(STATE1)
  const mountTags = variant => mount(
    <Provider store={store}>
      <MemoryRouter>
        <FamilyVariantTags variant={variant} familyGuid={variant.familyGuids[0]} />
      </MemoryRouter>
    </Provider>,
  )

  const buttons = mountTags(VARIANT).find('RememberVariantButton')
  expect(buttons.length).toEqual(1)
  expect(buttons.prop('variantGuid')).toEqual(VARIANT.variantGuid)
  expect(buttons.find('Button').prop('content')).toEqual('Remember this variant')

  expect(mountTags({ ...VARIANT, svType: 'DEL' }).find('RememberVariantButton').length).toEqual(0)
  expect(mountTags({ ...VARIANT, variantGuid: undefined }).find('RememberVariantButton').length).toEqual(0)
})
