import { applyMiddleware, createStore } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from '../../redux/rootReducer'
import { flushAll } from '../../shared/utils/testHelpers'
import { loadSearchedVariants, unloadSearchResults } from './reducers'

interface SearchState {
  searchedVariantIds: string[]
  searchedVariantsLoading: { isLoading: boolean, errorMessage?: string }
  searchesByHash: Record<string, { totalResults: number }>
}

const createSearchStore = () => {
  const store = createStore(rootReducer, {}, applyMiddleware(thunk))
  return {
    dispatch: store.dispatch as (action: unknown) => void,
    getState: store.getState as unknown as () => SearchState,
  }
}

const mockSearches = () => {
  const finish: Record<string, (ok?: boolean) => void> = {};
  (fetch as jest.Mock).mockImplementation((url: string) => new Promise((resolve) => {
    const searchHash = url.split('?')[0].split('/').pop()
    finish[searchHash] = (ok = true) => resolve({
      ok,
      status: ok ? 200 : 400,
      json: () => Promise.resolve(ok ? {
        searchedVariantIds: [`variant_${searchHash}`], search: { totalResults: 1 },
      } : { error: `Error in ${searchHash}` }),
    })
  }))
  return finish
}

const load = (searchHash: string) => loadSearchedVariants(
  { searchHash }, { displayUpdates: undefined, queryParams: {}, updateQueryParams: jest.fn() },
)

test('loads the variants of a search', async () => {
  const finish = mockSearches()
  const { dispatch, getState } = createSearchStore()

  dispatch(load('first'))
  expect(getState().searchedVariantsLoading.isLoading).toBe(true)
  expect((fetch as jest.Mock).mock.calls[0][0]).toEqual(
    '/api/search/first?sort=xpos&page=1&loadFamilyContext=true&loadProjectTagTypes=true',
  )
  finish.first()
  await flushAll()

  expect(getState().searchedVariantsLoading).toEqual({ isLoading: false, errorMessage: undefined })
  expect(getState().searchedVariantIds).toEqual(['variant_first'])
  expect(getState().searchesByHash).toEqual({ first: { totalResults: 1 } })
})

test('shows the error of a failed search', async () => {
  const finish = mockSearches()
  const { dispatch, getState } = createSearchStore()

  dispatch(load('first'))
  finish.first(false)
  await flushAll()

  expect(getState().searchedVariantsLoading).toEqual({ isLoading: false, errorMessage: 'Error in first' })
  expect(getState().searchedVariantIds).toEqual([])
})

test.each([
  ['results', true], ['error', false],
])('ignores the %s of a search that was unloaded and replaced while it was loading', async (name, ok) => {
  const finish = mockSearches()
  const { dispatch, getState } = createSearchStore()

  dispatch(load('first'))
  dispatch(load('ignored'))
  expect(fetch).toHaveBeenCalledTimes(1)

  dispatch(unloadSearchResults())
  expect(getState().searchedVariantsLoading.isLoading).toBe(false)
  dispatch(load('second'))
  finish.first(ok)
  await flushAll()

  expect(getState().searchedVariantsLoading.isLoading).toBe(true)
  expect(getState().searchedVariantIds).toEqual([])

  finish.second()
  await flushAll()

  expect(getState().searchedVariantsLoading).toEqual({ isLoading: false, errorMessage: undefined })
  expect(getState().searchedVariantIds).toEqual(['variant_second'])
})

test('ignores the results of a search that finishes after it was unloaded', async () => {
  const finish = mockSearches()
  const { dispatch, getState } = createSearchStore()

  dispatch(load('first'))
  dispatch(unloadSearchResults())
  finish.first()
  await flushAll()

  expect(getState().searchedVariantIds).toEqual([])
  expect(getState().searchedVariantsLoading.isLoading).toBe(false)
})
