import { createStore, applyMiddleware, Store } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from '../../redux/rootReducer'
import { flushAll } from '../../shared/utils/testHelpers'
import { loadSearchedVariants, loadSingleSearchedVariant, unloadSearchResults } from './reducers'

const HASH_A = 'aaaa1111'
const HASH_B = 'bbbb2222'
const SEARCH = { projectFamilies: [{ projectGuid: 'P1', familyGuids: ['F1'] }], search: {} }

const getStore = (): Store => createStore(
  rootReducer, { searchesByHash: { [HASH_A]: SEARCH, [HASH_B]: SEARCH } } as never, applyMiddleware(thunk),
)

const deferFetch = () => {
  let respond: (response: unknown) => void
  (fetch as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
  return async (json: Record<string, unknown>, ok = true) => {
    respond({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(json) })
    await flushAll()
  }
}

const searchResponse = (variantId: string) => ({
  searchedVariantIds: [variantId], variantsById: { [variantId]: { variantId } }, search: SEARCH,
})

const loadSearch = (store: Store, searchHash: string) => {
  const respond = deferFetch()
  store.dispatch(loadSearchedVariants(
    { searchHash }, { displayUpdates: null, queryParams: {}, updateQueryParams: jest.fn() },
  ) as never)
  return respond
}

const fetchedUrls = () => (fetch as jest.Mock).mock.calls.map(([url]) => url.split('?')[0])

const LOADING = expect.objectContaining({ isLoading: true })
const LOADED = { isLoading: false, errorMessage: undefined as string }

describe('searched variants loading', () => {
  test('loads the results for a search', async () => {
    const store = getStore()
    const respond = loadSearch(store, HASH_A)
    expect(store.getState().searchedVariantsLoading).toEqual(LOADING)

    await respond(searchResponse('varA'))
    expect(store.getState().searchedVariantIds).toEqual(['varA'])
    expect(store.getState().variantsById.varA).toEqual({ variantId: 'varA' })
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)
    expect(store.getState().variantSearchDisplay).toEqual(expect.objectContaining({ page: 1, sort: 'XPOS' }))
  })

  test('shows an error when the search fails', async () => {
    const store = getStore()
    const respond = loadSearch(store, HASH_A)

    await respond({ error: 'Search failed' }, false)
    expect(store.getState().searchedVariantIds).toEqual([])
    expect(store.getState().searchedVariantsLoading).toEqual({ isLoading: false, errorMessage: 'Search failed' })
  })

  test('does not reload a search that is already loading', () => {
    const store = getStore()
    loadSearch(store, HASH_A)
    loadSearch(store, HASH_A)

    expect(fetchedUrls()).toEqual([`/api/search/${HASH_A}`])
  })

  test('loads a new search while another is loading and ignores the earlier response when it arrives first', async () => {
    const store = getStore()
    const respondB = loadSearch(store, HASH_B)
    const respondA = loadSearch(store, HASH_A)
    expect(fetchedUrls()).toEqual([`/api/search/${HASH_B}`, `/api/search/${HASH_A}`])

    await respondB(searchResponse('varB'))
    expect(store.getState().searchedVariantIds).toEqual([])
    expect(store.getState().searchedVariantsLoading).toEqual(LOADING)

    await respondA(searchResponse('varA'))
    expect(store.getState().searchedVariantIds).toEqual(['varA'])
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)
  })

  test('ignores the response of an earlier search when it arrives after the current one', async () => {
    const store = getStore()
    const respondB = loadSearch(store, HASH_B)
    const respondA = loadSearch(store, HASH_A)

    await respondA(searchResponse('varA'))
    expect(store.getState().searchedVariantIds).toEqual(['varA'])

    await respondB(searchResponse('varB'))
    expect(store.getState().searchedVariantIds).toEqual(['varA'])
    expect(store.getState().variantsById.varB).toBeUndefined()
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)
  })

  test('ignores the error of an earlier search', async () => {
    const store = getStore()
    const respondB = loadSearch(store, HASH_B)
    const respondA = loadSearch(store, HASH_A)

    await respondB({ error: 'Search B failed' }, false)
    expect(store.getState().searchedVariantsLoading).toEqual({ isLoading: true, errorMessage: null })

    await respondA(searchResponse('varA'))
    await respondB({ error: 'Search B failed' }, false)
    expect(store.getState().searchedVariantIds).toEqual(['varA'])
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)
  })

  test('ignores the response of a search that was unloaded while loading', async () => {
    const store = getStore()
    const respond = loadSearch(store, HASH_B)
    store.dispatch(unloadSearchResults() as never)
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)

    await respond(searchResponse('varB'))
    expect(store.getState().searchedVariantIds).toEqual([])
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)
  })

  test('loads a single variant and ignores its response once unloaded', async () => {
    const store = getStore()
    let respond = deferFetch()
    store.dispatch(loadSingleSearchedVariant({ variantId: 'varA', familyGuid: 'F1' }) as never)
    expect(store.getState().searchedVariantsLoading).toEqual(LOADING)
    await respond(searchResponse('varA'))
    expect(store.getState().searchedVariantIds).toEqual(['varA'])
    expect(store.getState().searchedVariantsLoading).toEqual(LOADED)

    store.dispatch(unloadSearchResults() as never)
    respond = deferFetch()
    store.dispatch(loadSingleSearchedVariant({ variantId: 'varB', familyGuid: 'F1' }) as never)
    store.dispatch(unloadSearchResults() as never)
    await respond(searchResponse('varB'))
    expect(store.getState().searchedVariantIds).toEqual([])
  })
})
