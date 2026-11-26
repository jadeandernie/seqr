import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'

import { flushAll, mockFetchResponse, getLastFetchUrl } from 'shared/utils/testHelpers'
import { STATE_WITH_2_FAMILIES } from 'pages/Project/fixtures'
import { updateFamily } from './rootReducer'

const FAMILY_GUID = 'F011652_1'
const FAMILY = { ...STATE_WITH_2_FAMILIES.familiesByGuid[FAMILY_GUID], codedPhenotype: 'myopathy', mondoId: null }
const STATE = {
  ...STATE_WITH_2_FAMILIES,
  familiesByGuid: { ...STATE_WITH_2_FAMILIES.familiesByGuid, [FAMILY_GUID]: FAMILY },
}
const DETAILS_RESPONSE = {
  individualsByGuid: { I021475_na19675_1: { individualGuid: 'I021475_na19675_1', completeness: { score: 100, missing: [] } } },
}

const dispatchUpdate = async (values, updateResponse, state = STATE) => {
  const store = configureMockStore([thunk])(state)
  mockFetchResponse(updateResponse)
  mockFetchResponse(DETAILS_RESPONSE)
  store.dispatch(updateFamily(values))
  await flushAll()
  await flushAll()
  return store
}

describe('updateFamily', () => {
  test('reloads the family individuals when a field scored for clinical data completeness changes', async () => {
    const updatedFamily = { familyGuid: FAMILY_GUID, codedPhenotype: 'myopathy', mondoId: 'MONDO:0044970' }
    const store = await dispatchUpdate(
      { familyGuid: FAMILY_GUID, mondoId: 'MONDO:0044970' }, { [FAMILY_GUID]: updatedFamily },
    )

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      [`/api/family/${FAMILY_GUID}/update`, `/api/family/${FAMILY_GUID}/details?`],
    )
    expect(store.getActions()).toEqual([
      { type: 'RECEIVE_DATA', updatesById: { familiesByGuid: { [FAMILY_GUID]: updatedFamily } } },
      { type: 'RECEIVE_DATA', updatesById: DETAILS_RESPONSE },
    ])
  })

  test('does not reload individuals when no scored field changes', async () => {
    const updatedFamily = { ...FAMILY, description: 'An updated description' }
    const store = await dispatchUpdate(
      { familyGuid: FAMILY_GUID, description: 'An updated description' }, { [FAMILY_GUID]: updatedFamily },
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getLastFetchUrl()).toEqual(`/api/family/${FAMILY_GUID}/update`)
    expect(store.getActions()).toEqual([
      { type: 'RECEIVE_DATA', updatesById: { familiesByGuid: { [FAMILY_GUID]: updatedFamily } } },
    ])
  })

  test('does not reload individuals for raw responses without the family or for families that are not loaded', async () => {
    const rawResponse = { analysisGroupsByGuid: {} }
    const store = await dispatchUpdate(
      { familyGuid: FAMILY_GUID, familyField: 'analysis_groups', rawResponse: true }, rawResponse,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getLastFetchUrl()).toEqual(`/api/family/${FAMILY_GUID}/update_analysis_groups`)
    expect(store.getActions()).toEqual([{ type: 'RECEIVE_DATA', updatesById: rawResponse }])

    fetch.mockClear()
    await dispatchUpdate(
      { familyGuid: 'F_NOT_LOADED', mondoId: 'MONDO:0044970' },
      { F_NOT_LOADED: { familyGuid: 'F_NOT_LOADED', mondoId: 'MONDO:0044970' } },
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
