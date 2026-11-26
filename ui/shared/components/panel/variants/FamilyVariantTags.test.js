import React from 'react'
import { shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import FamilyVariantTags from './FamilyVariantTags'
import ClinvarSubmissionModal from '../clinvar/ClinvarSubmissionModal'

import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<FamilyVariantTags store={store} variant={VARIANT} familyGuid={VARIANT.familyGuids[0]} />)
  shallow(<FamilyVariantTags store={store} variant={SV_VARIANT} familyGuid={SV_VARIANT.familyGuids[0]} />)
})

const clinvarActions = (variant) => {
  const store = configureStore()(STATE1)
  const wrapper = shallow(<FamilyVariantTags store={store} variant={variant} familyGuid={variant.familyGuids[0]} />)
  return wrapper.dive().dive().find(ClinvarSubmissionModal)
}

test('offers the ClinVar action on saved SNVs and indels only', () => {
  const actions = clinvarActions(VARIANT)
  expect(actions).toHaveLength(1)
  expect(actions.props()).toEqual({ variantGuid: VARIANT.variantGuid })

  expect(SV_VARIANT.variantGuid).toBeTruthy()
  expect(clinvarActions(SV_VARIANT)).toHaveLength(0)
  expect(clinvarActions({ ...VARIANT, svType: 'DEL' })).toHaveLength(0)
  expect(clinvarActions({ ...VARIANT, chrom: 'M' })).toHaveLength(0)
})
