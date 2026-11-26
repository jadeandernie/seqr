import { createStore, applyMiddleware, AnyAction, Store } from 'redux'
import thunk from 'redux-thunk'

import rootReducer from '../rootReducer'
import { mockFetchResponse, mockFetchPending, flushAll } from '../../shared/utils/testHelpers'

export type LoaderCase = {
  loader: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  load: () => any
  response: Record<string, unknown>
  dataKey: string
  stateKey?: string
  state?: Record<string, unknown>
}

const BASE_STATE = {
  currentProjectGuid: 'P1',
  projectsByGuid: { P1: { projectGuid: 'P1' } },
  familiesByGuid: { F1: { familyGuid: 'F1', projectGuid: 'P1' } },
  individualsByGuid: { I1: { individualGuid: 'I1', familyGuid: 'F1' } },
}

const PENDING = { isLoading: true, errorMessage: null as string }
const UNRELATED_ACTIONS: AnyAction[] = [
  { type: 'RECEIVE_DATA', updatesById: { genesById: { ENSG0: { geneId: 'ENSG0' } } } },
  { type: 'RECEIVE_DATA', error: 'Unrelated request failed', updatesById: {} },
]

const getStore = (state = {}): Store => createStore(
  rootReducer, { ...BASE_STATE, ...state } as never, applyMiddleware(thunk),
)

const loadingState = (store: Store) => Object.entries(store.getState()).reduce(
  (acc, [key, value]) => (key.endsWith('Loading') ? { ...acc, [key]: value } : acc), {} as Record<string, unknown>,
)

export const testLoader = ({
  loader, load, response, dataKey, stateKey = dataKey, state,
}: LoaderCase) => {
  test(`${loader} stays pending when unrelated data is received`, () => {
    const store = getStore(state)
    mockFetchPending()
    store.dispatch(load())
    expect(store.getState()[loader]).toEqual(PENDING)

    UNRELATED_ACTIONS.forEach((action) => {
      store.dispatch(action)
      expect(store.getState()[loader]).toEqual(PENDING)
    })
    expect(store.getState().genesById.ENSG0).toEqual({ geneId: 'ENSG0' })
  })

  test(`${loader} finishes loading and stores the response data`, async () => {
    const store = getStore(state)
    mockFetchResponse(response)
    store.dispatch(load())
    await flushAll()

    expect(store.getState()[loader]).toEqual({ isLoading: false, errorMessage: undefined })
    expect(store.getState()[stateKey]).toMatchObject(response[dataKey])
  })

  test(`${loader} keeps its own error and does not leak it to other loaders`, async () => {
    const store = getStore(state)
    const otherLoaders = { ...loadingState(store), [loader]: null as unknown }
    mockFetchResponse({ error: `${loader} failed` }, { ok: false })
    store.dispatch(load())
    await flushAll()

    const failed = { isLoading: false, errorMessage: `${loader} failed` }
    expect(store.getState()[loader]).toEqual(failed)
    expect({ ...loadingState(store), [loader]: null }).toEqual(otherLoaders)

    store.dispatch(UNRELATED_ACTIONS[0])
    expect(store.getState()[loader]).toEqual(failed)
  })
}
