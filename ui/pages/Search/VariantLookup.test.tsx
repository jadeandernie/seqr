import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import { VARIANT } from 'shared/components/panel/fixtures'
import { mockFetchResponse, flushAll } from 'shared/utils/testHelpers'
import VariantLookup from './VariantLookup'

import { STATE } from './fixtures'

jest.mock('shared/components/panel/variants/Variants', () => ({
  ...jest.requireActual('shared/components/panel/variants/Variants'),
  __esModule: true,
  Variant: (): null => null,
}))

configure({ adapter: new Adapter() })

const OPTED_OUT_FAMILY_GUID = 'F000099_opted_out'
const LIFTED_FAMILY_GUID = 'F000100_lifted'

const lookupIndividual = (individualGuid: string, familyGuid: string) => ({
  [individualGuid]: { individualGuid, familyGuid, displayName: individualGuid, affected: 'A', sex: 'F' },
})

const LOOKUP_STATE = {
  ...STATE,
  mmeSubmissionsByGuid: {},
  modal: {},
  individualsByGuid: {
    ...STATE.individualsByGuid,
    ...lookupIndividual('I000099_opted_out', OPTED_OUT_FAMILY_GUID),
    ...lookupIndividual('I000100_lifted', LIFTED_FAMILY_GUID),
  },
}

const LOOKUP_VARIANT = {
  ...VARIANT,
  genomeVersion: '38',
  familyGuids: [],
  lookupFamilyGuids: [OPTED_OUT_FAMILY_GUID, LIFTED_FAMILY_GUID],
  liftedFamilyGuids: [LIFTED_FAMILY_GUID],
  genotypes: {
    I000099_opted_out: { numAlt: 1, gq: 99, ab: 0.5, dp: 30, sampleType: 'WES' },
    I000100_lifted: { numAlt: 2, gq: 99, ab: 1, dp: 30, sampleType: 'WES' },
  },
}

test('shows the genome build for families which have opted out of contact', async () => {
  mockFetchResponse({ variantsById: { [LOOKUP_VARIANT.variantId]: LOOKUP_VARIANT } })
  const store = configureStore()(LOOKUP_STATE)

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/variant_lookup?variantId=${LOOKUP_VARIANT.variantId}&genomeVersion=38`]}>
        <Route path="/variant_lookup/:gene?" component={VariantLookup} />
      </MemoryRouter>
    </Provider>,
  )
  await flushAll()
  wrapper.update()

  const buildLabels = wrapper.find('Label[basic=true]').map((label: any) => [label.prop('content'), label.prop('color')])
  expect(buildLabels).toEqual([['GRCh38', 'green'], ['GRCh37', 'orange']])
  expect(wrapper.text()).not.toContain('GRChundefined')
})
