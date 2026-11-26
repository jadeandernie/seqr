import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import queryString from 'query-string'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import { VARIANT } from 'shared/components/panel/fixtures'
import { getLastFetchUrl, flushAll } from 'shared/utils/testHelpers'
import rootReducer from 'redux/rootReducer'
import VariantSearchResults from './VariantSearchResults'

import { STATE, SEARCH_HASH, SEARCH } from '../fixtures'

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

describe('sort', () => {
  const SEARCH_RESPONSE = {
    searchedVariantIds: [VARIANT.variantId],
    variantsById: { [VARIANT.variantId]: VARIANT },
    search: SEARCH,
  }

  const searchUrl = sort => (
    `/api/search/${SEARCH_HASH}?sort=${sort}&page=1&loadFamilyContext=true&loadProjectTagTypes=true`
  )

  const renderResults = async (search = '', response = SEARCH_RESPONSE, ok = true) => {
    fetch.mockClear()
    fetch.mockImplementation(() => Promise.resolve({
      ok, status: ok ? 200 : 400, statusText: 'Invalid sort: foo', json: () => Promise.resolve(response),
    }))
    const store = createStore(
      rootReducer, { ...STATE, modal: {}, variantSearchDisplay: undefined }, applyMiddleware(thunk),
    )
    let location
    const wrapper = mount(
      <Provider store={store}>
        <MemoryRouter initialEntries={[`/variant_search/results/${SEARCH_HASH}${search}`]}>
          <Route path="/variant_search/results/:searchHash" component={VariantSearchResults} />
          <Route
            render={(props) => {
              location = props.location
              return null
            }}
          />
        </MemoryRouter>
      </Provider>,
    )
    const flush = async () => {
      await flushAll()
      wrapper.update()
    }
    await flush()
    return { store, wrapper, flush, getLocation: () => location }
  }

  const getSortDropdown = wrapper => wrapper.find('FormDropdown[name="sort"]')

  const selectSorts = async ({ wrapper, flush }, sorts) => {
    fetch.mockClear()
    getSortDropdown(wrapper).prop('onChange')({}, { value: sorts })
    await flush()
  }

  const expectSort = ({ store, wrapper, getLocation }, { state, url, values, labels }) => {
    expect(store.getState().variantSearchDisplay.sort).toEqual(state)
    expect(queryString.parse(getLocation().search).sort).toEqual(url)
    const dropdown = getSortDropdown(wrapper)
    expect(dropdown.prop('value')).toEqual(values)
    expect(dropdown.find('Label').map(label => label.text())).toEqual(labels)
  }

  afterEach(() => {
    fetch.mockReset()
    fetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  })

  test('defaults to the position sort', async () => {
    const results = await renderResults()

    expect(fetch.mock.calls.map(([url]) => url)).toContain(searchUrl('xpos'))
    expectSort(results, { state: 'XPOS', url: 'xpos', values: ['XPOS'], labels: ['Position'] })
    expect(getSortDropdown(results.wrapper).prop('multiple')).toBe(true)
    expect(getSortDropdown(results.wrapper).prop('options').map(({ value }) => value)).not.toContain('TAGGED_DATE')
  })

  test('loads a single sort from the url exactly as before', async () => {
    const results = await renderResults('?sort=cadd&page=2')

    expect(fetch.mock.calls.map(([url]) => url)).toContain(
      `/api/search/${SEARCH_HASH}?sort=cadd&page=2&loadFamilyContext=true&loadProjectTagTypes=true`,
    )
    expectSort(results, { state: 'CADD', url: 'cadd', values: ['CADD'], labels: ['CADD'] })
    expect(results.getLocation().search).toEqual('?page=2&sort=cadd')
  })

  test('loads an ordered list of sorts from the url', async () => {
    const results = await renderResults('?sort=gnomad%2Ccadd')

    expect(fetch.mock.calls.map(([url]) => url)).toContain(searchUrl('gnomad%2Ccadd'))
    expectSort(results, {
      state: 'GNOMAD,CADD', url: 'gnomad,cadd', values: ['GNOMAD', 'CADD'], labels: ['gnomAD Genomes Frequency', 'CADD'],
    })
  })

  test('searches with a single selected sort exactly as before', async () => {
    const results = await renderResults('?sort=gnomad')

    await selectSorts(results, ['CADD'])

    expect(getLastFetchUrl()).toEqual(searchUrl('cadd'))
    expectSort(results, { state: 'CADD', url: 'cadd', values: ['CADD'], labels: ['CADD'] })
  })

  test('searches with the sorts in the order they were selected', async () => {
    const results = await renderResults('?sort=gnomad')

    await selectSorts(results, ['GNOMAD', 'CADD'])

    expect(getLastFetchUrl()).toEqual(searchUrl('gnomad%2Ccadd'))
    expectSort(results, {
      state: 'GNOMAD,CADD', url: 'gnomad,cadd', values: ['GNOMAD', 'CADD'], labels: ['gnomAD Genomes Frequency', 'CADD'],
    })

    await selectSorts(results, ['CADD'])

    expect(getLastFetchUrl()).toEqual(searchUrl('cadd'))
    expectSort(results, { state: 'CADD', url: 'cadd', values: ['CADD'], labels: ['CADD'] })

    await selectSorts(results, ['CADD', 'GNOMAD', 'SIZE'])

    expect(getLastFetchUrl()).toEqual(searchUrl('cadd%2Cgnomad%2Csize'))
    expectSort(results, {
      state: 'CADD,GNOMAD,SIZE',
      url: 'cadd,gnomad,size',
      values: ['CADD', 'GNOMAD', 'SIZE'],
      labels: ['CADD', 'gnomAD Genomes Frequency', 'Size'],
    })
  })

  test('replaces the default position sort when another sort is selected', async () => {
    const results = await renderResults()

    await selectSorts(results, ['XPOS', 'CADD'])

    expect(getLastFetchUrl()).toEqual(searchUrl('cadd'))
    expectSort(results, { state: 'CADD', url: 'cadd', values: ['CADD'], labels: ['CADD'] })
  })

  test('falls back to the position sort when all sorts are removed', async () => {
    const results = await renderResults('?sort=gnomad%2Ccadd')

    await selectSorts(results, [])

    expect(getLastFetchUrl()).toEqual(searchUrl('xpos'))
    expectSort(results, { state: 'XPOS', url: 'xpos', values: ['XPOS'], labels: ['Position'] })
  })

  test('resets to the first page of all pages when the sorts change', async () => {
    const results = await renderResults(
      '?sort=cadd&page=2', { ...SEARCH_RESPONSE, search: { ...SEARCH, totalResults: 250 } },
    )

    const { wrapper } = results
    expect(wrapper.find('Pagination').map(pagination => pagination.prop('totalPages'))).toEqual([3, 3])
    expect(wrapper.find('FormDropdown[name="sort"]').length).toEqual(1)
    expect(results.store.getState().variantSearchDisplay.page).toEqual('2')

    await selectSorts(results, ['CADD', 'GNOMAD'])

    expect(getLastFetchUrl()).toEqual(searchUrl('cadd%2Cgnomad'))
    expect(results.getLocation().search).toEqual('?page=1&sort=cadd%2Cgnomad')
    expect(results.store.getState().variantSearchDisplay.page).toEqual(1)
  })

  test('updates the selected sorts without searching when the search failed', async () => {
    const results = await renderResults('?sort=foo', { error: 'Invalid sort: foo' }, false)

    expect(results.wrapper.find('Message').text()).toEqual('Invalid sort: foo')
    expect(results.wrapper.find('Pagination').exists()).toBe(false)
    expect(getSortDropdown(results.wrapper).prop('multiple')).toBe(true)

    await selectSorts(results, ['GNOMAD', 'CADD'])

    expect(fetch).not.toHaveBeenCalled()
    expect(results.store.getState().variantSearchDisplay.sort).toEqual('GNOMAD,CADD')
    expect(results.getLocation().search).toEqual('?page=1&sort=foo')
  })
})
