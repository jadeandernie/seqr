import React from 'react'
import { shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { getUser } from 'redux/selectors'
import { EditManualVariantButton } from 'pages/Project/components/CreateVariantButton'
import Variants, { Variant } from './Variants'
import { VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  shallow(<Variants variants={[VARIANT, SV_VARIANT]} />)
})

test('only shows the manual variant edit button for manually added saved variants', () => {
  const hasEditButton = variant => shallow(<Variant variant={variant} />).find(EditManualVariantButton).exists()

  expect(hasEditButton(VARIANT)).toBe(false)
  expect(hasEditButton({ ...VARIANT, variantGuid: 'SV0000001', key: 123 })).toBe(false)
  expect(hasEditButton({ ...VARIANT, variantGuid: 'SV0000001', key: null })).toBe(true)
})
