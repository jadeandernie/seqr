import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'

import { flushAll, mockFetchResponse, getLastFetchUrl } from 'shared/utils/testHelpers'
import { STATE_WITH_2_FAMILIES } from 'pages/Project/fixtures'
import { updateFamily, updateIndividual } from './rootReducer'

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

const INDIVIDUAL_GUID = 'I021475_na19675_1'
const DATA_REQUEST = {
  dataRequestGuid: 'DR0000001_na19675',
  individualGuid: INDIVIDUAL_GUID,
  familyGuid: FAMILY_GUID,
  projectGuid: 'R0237_1000_genomes_demo',
  status: 'O',
}
const DATA_REQUESTS_BY_GUID = {
  [DATA_REQUEST.dataRequestGuid]: DATA_REQUEST,
  DR2: { ...DATA_REQUEST, dataRequestGuid: 'DR2', individualGuid: 'I021476_na19678_1' },
  DR3: { ...DATA_REQUEST, dataRequestGuid: 'DR3', status: 'F' },
  DR4: { ...DATA_REQUEST, dataRequestGuid: 'DR4', individualGuid: 'I_other', familyGuid: 'F_other' },
}
const REQUEST_STATE = { ...STATE, dataRequestsByGuid: DATA_REQUESTS_BY_GUID }
const DATA_REQUESTS_RESPONSE = {
  dataRequestsByGuid: { [DATA_REQUEST.dataRequestGuid]: { ...DATA_REQUEST, status: 'F' } },
}
const DATA_REQUESTS_URL = '/api/project/R0237_1000_genomes_demo/get_data_requests?status=all&dataRequestGuids='

describe('open data requests', () => {
  test('are reloaded after an individual with an open request is updated, as the update can fulfil it', async () => {
    const individualResponse = { [INDIVIDUAL_GUID]: { individualGuid: INDIVIDUAL_GUID, birthYear: 2000 } }
    const store = configureMockStore([thunk])(REQUEST_STATE)
    mockFetchResponse(individualResponse)
    mockFetchResponse(DATA_REQUESTS_RESPONSE)
    store.dispatch(updateIndividual({ individualGuid: INDIVIDUAL_GUID, birthYear: 2000 }))
    await flushAll()
    await flushAll()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/individual/${INDIVIDUAL_GUID}/update`, `${DATA_REQUESTS_URL}DR0000001_na19675`,
    ])
    expect(store.getActions()).toEqual([
      { type: 'RECEIVE_DATA', updatesById: { individualsByGuid: individualResponse } },
      { type: 'RECEIVE_DATA', updatesById: DATA_REQUESTS_RESPONSE },
    ])
  })

  test('are not requested after updating an individual without an open request', async () => {
    const guid = 'I021474_na19679_1'
    const response = { [guid]: { individualGuid: guid, features: [] } }
    const store = configureMockStore([thunk])(REQUEST_STATE)
    mockFetchResponse(response)
    store.dispatch(updateIndividual({ individualGuid: guid, individualField: 'hpo_terms', features: [] }))
    await flushAll()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`/api/individual/${guid}/update_hpo_terms`])
    expect(store.getActions()).toEqual([{ type: 'RECEIVE_DATA', updatesById: { individualsByGuid: response } }])
  })

  test('are reloaded for the whole family after a scored family field is updated', async () => {
    const updatedFamily = { familyGuid: FAMILY_GUID, codedPhenotype: 'myopathy', mondoId: 'MONDO:0044970' }
    const store = configureMockStore([thunk])(REQUEST_STATE)
    mockFetchResponse({ [FAMILY_GUID]: updatedFamily })
    mockFetchResponse(DETAILS_RESPONSE)
    mockFetchResponse(DATA_REQUESTS_RESPONSE)
    store.dispatch(updateFamily({ familyGuid: FAMILY_GUID, mondoId: 'MONDO:0044970' }))
    await flushAll()
    await flushAll()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/family/${FAMILY_GUID}/update`,
      `/api/family/${FAMILY_GUID}/details?`,
      `${DATA_REQUESTS_URL}DR0000001_na19675%2CDR2`,
    ])
    expect(store.getActions()).toContainEqual({ type: 'RECEIVE_DATA', updatesById: DATA_REQUESTS_RESPONSE })

    // other family fields can not fulfil a request
    fetch.mockClear()
    const descriptionStore = configureMockStore([thunk])(REQUEST_STATE)
    mockFetchResponse({ [FAMILY_GUID]: { ...FAMILY, description: 'Updated' } })
    descriptionStore.dispatch(updateFamily({ familyGuid: FAMILY_GUID, description: 'Updated' }))
    await flushAll()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
