import React from 'react'
import { shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import FamilyVariantTags from './FamilyVariantTags'
import RememberVariantButton from '../known-variants/RememberVariantButton'

import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<FamilyVariantTags store={store} variant={VARIANT} familyGuid={VARIANT.familyGuids[0]} />)
  shallow(<FamilyVariantTags store={store} variant={SV_VARIANT} familyGuid={SV_VARIANT.familyGuids[0]} />)
})

test('offers to remember saved SNV/indel variants, but not structural or unsaved variants', () => {
  const store = configureStore()(STATE1)
  const findButtons = variant => shallow(
    <FamilyVariantTags store={store} variant={variant} familyGuid={variant.familyGuids[0]} />,
  ).dive().dive().find(RememberVariantButton)

  const buttons = findButtons(VARIANT)
  expect(buttons.length).toEqual(1)
  expect(buttons.prop('variantGuid')).toEqual(VARIANT.variantGuid)

  expect(findButtons({ ...VARIANT, svType: 'DEL' }).length).toEqual(0)
  expect(findButtons({ ...VARIANT, variantGuid: undefined }).length).toEqual(0)
})
