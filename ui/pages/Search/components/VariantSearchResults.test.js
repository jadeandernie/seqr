import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { Router, MemoryRouter, Route } from 'react-router-dom'
import { createMemoryHistory } from 'history'
import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from 'redux/rootReducer'
import { flushAll } from 'shared/utils/testHelpers'

import { VARIANT } from 'shared/components/panel/fixtures'
import VariantSearchResults from './VariantSearchResults'

import { STATE } from '../fixtures'

jest.mock('../reducers', () => ({
  ...jest.requireActual('../reducers'),
  loadSingleSearchedVariant: () => ({ type: 'MOCK_LOAD_SINGLE_SEARCHED_VARIANT' }),
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

test('shows the results of the current search when an earlier search responds late', async () => {
  const responders = {}
  const jsonResponse = json => ({ ok: true, status: 200, json: () => Promise.resolve(json) })
  fetch.mockImplementation(url => (url.startsWith('/api/search/') ? new Promise((resolve) => {
    responders[url.split('?')[0]] = variantId => resolve(
      jsonResponse({ searchedVariantIds: [variantId], variantsById: { [variantId]: { variantId } } }),
    )
  }) : Promise.resolve(jsonResponse({}))))
  const store = createStore(rootReducer, STATE, applyMiddleware(thunk))
  const history = createMemoryHistory({ initialEntries: ['/variant_search/results/hashB'] })

  const wrapper = mount(
    <Provider store={store}>
      <Router history={history}>
        <Route path="/variant_search/results/:searchHash" component={VariantSearchResults} />
      </Router>
    </Provider>,
  )
  history.push('/variant_search/results/hashA')
  await flushAll()

  responders['/api/search/hashB']('varB')
  await flushAll()
  wrapper.update()
  expect(wrapper.find('Loader').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('varB')

  responders['/api/search/hashA']('varA')
  await flushAll()
  wrapper.update()
  expect(wrapper.find('Loader').exists()).toBe(false)
  expect(wrapper.text()).toContain('varA')
  expect(wrapper.text()).not.toContain('varB')
})
