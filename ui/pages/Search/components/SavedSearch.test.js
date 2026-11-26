import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'
import { Form, Field, FormSpy } from 'react-final-form'

import rootReducer from 'redux/rootReducer'
import { configuredField } from 'shared/components/form/FormHelpers'
import { flushAll, getLastFetchUrl, getLastFetchBody } from 'shared/utils/testHelpers'
import { SaveSearchButton, SavedSearchDropdown } from './SavedSearch'
import LocusListSelector from './filters/LocusListSelector'

import { STATE } from '../fixtures'

configure({ adapter: new Adapter() })

const ANNOTATIONS = { frameshift: ['frameshift_variant'] }
const SINGLE_LIST_SEARCH = {
  savedSearchGuid: 'VS_single',
  name: 'Single List',
  createdById: 1,
  search: { annotations: ANNOTATIONS, locus: { locusListGuid: 'LL1', rawItems: 'TTN' } },
}
const MULTI_LIST_SEARCH = {
  savedSearchGuid: 'VS_multi',
  name: 'Multiple Lists',
  createdById: 1,
  search: {
    annotations: ANNOTATIONS,
    locus: { locusListGuids: ['LL1', 'LL2'], panelAppItems: { green: 'TTN', none: 'NEB' }, rawItems: 'TTN,NEB' },
  },
}
const LIST_ONLY_SEARCH = {
  savedSearchGuid: 'VS_list_only', name: 'List Only', createdById: 1, search: { locus: { locusListGuid: 'LL1' } },
}
const NO_LIST_SEARCH = {
  savedSearchGuid: 'VS_no_list',
  name: 'No List',
  createdById: 1,
  search: { annotations: ANNOTATIONS, locus: { rawItems: 'TTN' } },
}
const SAVED_SEARCHES = [SINGLE_LIST_SEARCH, MULTI_LIST_SEARCH, LIST_ONLY_SEARCH, NO_LIST_SEARCH].reduce(
  (acc, savedSearch) => ({ ...acc, [savedSearch.savedSearchGuid]: savedSearch }), {},
)

const LOCUS_LISTS = ['LL1', 'LL2', 'LL3'].reduce((acc, locusListGuid) => ({
  ...acc,
  [locusListGuid]: {
    locusListGuid,
    name: `List ${locusListGuid}`,
    numEntries: 1,
    items: [{ geneId: `ENSG_${locusListGuid}` }],
  },
}), {})

const noop = () => {}
const formatSearch = val => val || {}
const renderLocusListSelector = ({ input }) => <LocusListSelector value={input.value} onChange={input.onChange} />
const SAVED_SEARCH_FIELD = configuredField({ name: 'search', component: SavedSearchDropdown, format: formatSearch })

const renderForm = async (search, savedSearchesByGuid = SAVED_SEARCHES) => {
  const store = createStore(rootReducer, {
    user: STATE.user,
    projectsByGuid: STATE.projectsByGuid,
    modal: {},
    savedSearchesByGuid,
    locusListsByGuid: LOCUS_LISTS,
  }, applyMiddleware(thunk))
  let values
  const onChange = (formState) => {
    values = formState.values
  }
  const wrapper = mount(
    <Provider store={store}>
      <Form onSubmit={noop} initialValues={{ search }}>
        {() => (
          <div>
            {SAVED_SEARCH_FIELD}
            <Field name="search.locus" format={formatSearch} render={renderLocusListSelector} />
            <SaveSearchButton />
            <FormSpy subscription={{ values: true }} onChange={onChange} />
          </div>
        )}
      </Form>
    </Provider>,
  )
  const flush = async () => {
    await act(async () => {
      await flushAll()
    })
    wrapper.update()
  }
  await flush()
  return { wrapper, flush, store, getSearch: () => values.search }
}

const getCurrentSavedSearch = wrapper => wrapper.find('Select').prop('value')
const getSaveButton = wrapper => wrapper.find({ modalId: 'saveSearch' }).first()
const getGeneListsValue = wrapper => wrapper.find('FormDropdown[label="Gene Lists"]').prop('value')

test('SaveSearchButton shallow-render without crashing', () => {
  const store = configureStore()(STATE)

  shallow(<SaveSearchButton store={store} />)
})

test('SavedSearchDropdown shallow-render without crashing', () => {
  const store = configureStore()(STATE)

  shallow(<SavedSearchDropdown store={store} />)
})

test('recognizes a saved search with a single gene list whose items have changed', async () => {
  const { wrapper } = await renderForm({ annotations: ANNOTATIONS, locus: { locusListGuid: 'LL1', rawItems: 'TTN, NEB' } })

  expect(getCurrentSavedSearch(wrapper)).toEqual('VS_single')
  expect(getSaveButton(wrapper).prop('buttonText')).toEqual('Edit Saved Search')
  expect(getSaveButton(wrapper).prop('initialValues')).toEqual(SINGLE_LIST_SEARCH)
})

test('recognizes a saved search with multiple gene lists in any order', async () => {
  const locus = { locusListGuids: ['LL2', 'LL1'], rawItems: 'ACTA1' }
  const { wrapper } = await renderForm({ annotations: ANNOTATIONS, locus })

  expect(getCurrentSavedSearch(wrapper)).toEqual('VS_multi')
  expect(getSaveButton(wrapper).prop('buttonText')).toEqual('Edit Saved Search')
})

test('does not match saved searches with different gene lists', async () => {
  const getSavedSearch = async locus => getCurrentSavedSearch((await renderForm({ annotations: ANNOTATIONS, locus })).wrapper)

  expect(await getSavedSearch({ locusListGuid: 'LL2' })).toBeUndefined()
  expect(await getSavedSearch({ locusListGuids: ['LL1', 'LL3'] })).toBeUndefined()
  expect(await getSavedSearch({ locusListGuids: ['LL1', 'LL2', 'LL3'] })).toBeUndefined()
  expect(await getSavedSearch({ rawItems: 'TTN,NEB' })).toBeUndefined()
  expect(await getSavedSearch(undefined)).toBeUndefined()
  expect(await getSavedSearch({ rawItems: 'TTN' })).toEqual('VS_no_list')
})

test('does not match a saved gene list search when the current search has no location filter', async () => {
  const { wrapper } = await renderForm({})

  expect(getCurrentSavedSearch(wrapper)).toBeUndefined()
  expect(getSaveButton(wrapper).prop('buttonText')).toEqual('Save Search')
})

test('selecting a saved search with a single gene list loads that list', async () => {
  const form = await renderForm({ annotations: ANNOTATIONS })

  act(() => {
    form.wrapper.find('Select').prop('onChange')('VS_single')
  })
  await form.flush()

  expect(getGeneListsValue(form.wrapper)).toEqual(['LL1'])
  expect(form.getSearch().locus.locusListGuid).toEqual('LL1')
  expect(form.getSearch().locus.locusListGuids).toBeUndefined()
  expect(getCurrentSavedSearch(form.wrapper)).toEqual('VS_single')
})

test('selecting a saved search with multiple gene lists loads all of its lists', async () => {
  const form = await renderForm({ annotations: ANNOTATIONS })

  act(() => {
    form.wrapper.find('Select').prop('onChange')('VS_multi')
  })
  await form.flush()

  expect(getGeneListsValue(form.wrapper)).toEqual(['LL1', 'LL2'])
  expect(form.getSearch()).toEqual({
    annotations: ANNOTATIONS,
    locus: { locusListGuids: ['LL1', 'LL2'], rawItems: 'ENSG_LL1, ENSG_LL2' },
  })
  expect(getCurrentSavedSearch(form.wrapper)).toEqual('VS_multi')
  expect(getSaveButton(form.wrapper).prop('buttonText')).toEqual('Edit Saved Search')

  act(() => {
    form.wrapper.find('Select').prop('onChange')(null)
  })
  await form.flush()

  expect(getGeneListsValue(form.wrapper)).toEqual([])
  expect(getCurrentSavedSearch(form.wrapper)).toBeUndefined()
})

test('saves a search with multiple gene lists and recognizes it as the current saved search', async () => {
  const search = { annotations: ANNOTATIONS, locus: { locusListGuids: ['LL3', 'LL2'], rawItems: 'TTN' } }
  const form = await renderForm(search, { VS_single: SINGLE_LIST_SEARCH })

  expect(getCurrentSavedSearch(form.wrapper)).toBeUndefined()
  expect(getSaveButton(form.wrapper).prop('buttonText')).toEqual('Save Search')
  expect(getSaveButton(form.wrapper).prop('initialValues')).toEqual(search)

  fetch.mockImplementation((url, { body }) => {
    const { name, ...savedSearch } = JSON.parse(body)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        savedSearchesByGuid: { VS_new: { savedSearchGuid: 'VS_new', name, createdById: 1, search: savedSearch } },
      }),
    })
  })
  act(() => {
    getSaveButton(form.wrapper).prop('onSubmit')({ ...getSaveButton(form.wrapper).prop('initialValues'), name: 'New Search' })
  })
  await form.flush()

  expect(getLastFetchUrl()).toEqual('/api/saved_search/create')
  expect(getLastFetchBody()).toEqual({ ...search, name: 'New Search' })
  expect(form.store.getState().savedSearchesByGuid.VS_new.search.locus.locusListGuids).toEqual(['LL3', 'LL2'])
  expect(getCurrentSavedSearch(form.wrapper)).toEqual('VS_new')
  expect(getSaveButton(form.wrapper).prop('buttonText')).toEqual('Edit Saved Search')
  expect(getGeneListsValue(form.wrapper)).toEqual(['LL3', 'LL2'])
})
