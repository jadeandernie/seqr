import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'
import { createStore } from 'redux'

import rootReducer from 'redux/rootReducer'
import { VARIANT } from 'shared/components/panel/fixtures'
import VariantSearchResults from './VariantSearchResults'

import { STATE, SEARCH_HASH } from '../fixtures'

jest.mock('../reducers', () => ({
  ...jest.requireActual('../reducers'),
  loadSingleSearchedVariant: () => ({ type: 'MOCK_LOAD_SINGLE_SEARCHED_VARIANT' }),
  loadSearchedVariants: () => ({ type: 'MOCK_LOAD_SEARCHED_VARIANTS' }),
  loadProjectFamiliesContext: () => ({ type: 'MOCK_LOAD_PROJECT_FAMILIES_CONTEXT' }),
}))

// Like VariantLayout, spread unhandled props onto a Grid.Row DOM element
jest.mock('shared/components/panel/variants/Variants', () => {
  const { Grid } = jest.requireActual('semantic-ui-react')
  return ({ variants, ...props }) => (
    <Grid.Row {...props}>{variants.map(({ variantId }) => variantId).join()}</Grid.Row>
  )
})

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE)

  shallow(<VariantSearchResults store={store} match={{ params: {}}} />)
})

test('renders the single variant page', () => {
  const store = configureStore()({
    ...STATE,
    searchedVariantIds: [VARIANT.variantId],
    variantsById: { [VARIANT.variantId]: VARIANT },
  })

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/variant_search/variant/${VARIANT.variantId}/family/F011652_1`]}>
        <Route path="/variant_search/variant/:variantId/family/:familyGuid" component={VariantSearchResults} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.text()).toEqual(VARIANT.variantId)
})

const EXCLUDED_STATE = {
  searchesByHash: { [SEARCH_HASH]: { ...STATE.searchesByHash[SEARCH_HASH], totalResults: 2 } },
  searchedVariantIds: ['1-100-A-T', '1-200-C-G'],
  variantsById: {
    '1-100-A-T': { variantId: '1-100-A-T', familyGuids: ['F011652_1'] },
    '1-200-C-G': { variantId: '1-200-C-G', familyGuids: ['F011652_1'] },
  },
  savedVariantsByGuid: {
    SV1: { variantGuid: 'SV1', variantId: '1-200-C-G', familyGuids: ['F011652_1'], tagGuids: ['VT1'] },
  },
  variantTagsByGuid: { VT1: { tagGuid: 'VT1', name: 'Excluded', metadata: 'Benign', variantGuids: ['SV1'] } },
}

const mountSearchResults = (props) => {
  const store = createStore(rootReducer, EXCLUDED_STATE)
  return mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/variant_search/results/${SEARCH_HASH}`]}>
        <Route
          path="/variant_search/results/:searchHash"
          render={routeProps => <VariantSearchResults {...routeProps} {...props} />}
        />
      </MemoryRouter>
    </Provider>,
  )
}

const getVariantLists = wrapper => wrapper.find('GridRow').filterWhere(row => row.prop('linkToSavedVariants'))

test('shows excluded variants in the list of results of the search page', () => {
  const wrapper = mountSearchResults()

  const variants = getVariantLists(wrapper)
  expect(variants).toHaveLength(1)
  expect(variants.text()).toEqual('1-100-A-T,1-200-C-G')
  expect(variants.prop('searchHash')).toEqual(SEARCH_HASH)
  expect(wrapper.text()).toContain('Found 2')
  expect(wrapper.text()).not.toContain('Excluded')
})

test('shows the results with the given variants component instead of the list of results', () => {
  const VariantCount = jest.fn(({ displayVariants }) => <div id="variant-count">{displayVariants.length}</div>)
  const wrapper = mountSearchResults({ variantsComponent: VariantCount })

  expect(wrapper.find('#variant-count').text()).toEqual('2')
  expect(getVariantLists(wrapper)).toHaveLength(0)
  expect(wrapper.text()).toContain('Found 2')
  expect(VariantCount.mock.calls[0][0]).toEqual({
    displayVariants: [EXCLUDED_STATE.variantsById['1-100-A-T'], EXCLUDED_STATE.variantsById['1-200-C-G']],
    compoundHetToggle: false,
    searchHash: SEARCH_HASH,
  })
})
