import {
  getDefaultRequestedFields, getOpenDataRequests, getOpenDataRequestsByIndividual, getRemainingItems, getRequestAge,
  getRequestSummary, getReasonText, isAssignedToUser, HAS_OPEN_DATA_REQUEST_FILTER, DATA_REQUEST_REASON_OPTIONS,
} from './dataRequests'

const NOW = new Date('2026-11-26T12:00:00Z')

const REQUEST = {
  dataRequestGuid: 'DR0000001_na19675',
  individualGuid: 'I021475_na19675_1',
  familyGuid: 'F011652_1',
  projectGuid: 'R0237_1000_genomes_demo',
  individualName: 'NA19675',
  items: [
    { field: 'features', label: 'Observed features (HPO terms)', recorded: false },
    { field: 'onsetAge', label: 'Age of onset', recorded: false },
    { field: 'mondoId', label: 'Family MONDO disease ID', recorded: false },
  ],
  status: 'O',
  createdDate: '2026-11-14T09:00:00Z',
  assignedToUsername: 'clinician',
  canCancel: false,
  canResolve: false,
}

const DATA_REQUESTS_BY_GUID = {
  [REQUEST.dataRequestGuid]: REQUEST,
  DR2: { ...REQUEST, dataRequestGuid: 'DR2', individualGuid: 'I2', projectGuid: 'R2' },
  DR3: { ...REQUEST, dataRequestGuid: 'DR3', individualGuid: 'I3', status: 'F' },
  DR4: { ...REQUEST, dataRequestGuid: 'DR4', individualGuid: 'I4', status: 'D' },
  DR5: { ...REQUEST, dataRequestGuid: 'DR5', individualGuid: 'I5', status: 'C' },
}

const missingItem = (field: string, weight: number) => ({ field, weight, label: field, level: 'individual' })

test('getDefaultRequestedFields ticks the missing items that matter most for analysis', () => {
  expect(getDefaultRequestedFields([
    missingItem('features', 30), missingItem('sex', 8), missingItem('birthYear', 6), missingItem('mondoId', 4),
  ])).toEqual(['features', 'sex'])

  // when only lower value items are missing they are all ticked
  expect(getDefaultRequestedFields([missingItem('birthYear', 6), missingItem('mondoId', 4)])).toEqual(
    ['birthYear', 'mondoId'],
  )
  expect(getDefaultRequestedFields([])).toEqual([])
})

test('getOpenDataRequests returns only open requests, optionally for one project', () => {
  expect(getOpenDataRequests(DATA_REQUESTS_BY_GUID).map(({ dataRequestGuid }) => dataRequestGuid)).toEqual(
    ['DR0000001_na19675', 'DR2'],
  )
  expect(getOpenDataRequests(DATA_REQUESTS_BY_GUID, 'R2').map(({ dataRequestGuid }) => dataRequestGuid)).toEqual(['DR2'])
  expect(getOpenDataRequests(DATA_REQUESTS_BY_GUID, 'R3')).toEqual([])
  expect(getOpenDataRequests(undefined)).toEqual([])
})

test('getOpenDataRequestsByIndividual', () => {
  expect(getOpenDataRequestsByIndividual(DATA_REQUESTS_BY_GUID)).toEqual({
    I021475_na19675_1: REQUEST, I2: DATA_REQUESTS_BY_GUID.DR2,
  })
  expect(getOpenDataRequestsByIndividual(undefined)).toEqual({})
})

test('getRequestAge', () => {
  expect(getRequestAge('2026-11-14T09:00:00Z', NOW)).toEqual('12 days ago')
  expect(getRequestAge('2026-11-25T11:59:00Z', NOW)).toEqual('1 day ago')
  expect(getRequestAge('2026-11-25T12:01:00Z', NOW)).toEqual('today')
  // a request dated after the browser clock is not shown with a negative age
  expect(getRequestAge('2026-11-27T12:00:00Z', NOW)).toEqual('today')
  expect(getRequestAge(new Date().toISOString())).toEqual('today')
})

test('getRequestSummary and getRemainingItems', () => {
  expect(getRequestSummary(REQUEST, NOW)).toEqual('Data requested: 3 items, 12 days ago')
  expect(getRemainingItems(REQUEST)).toEqual(REQUEST.items)

  const partial = { ...REQUEST, items: [{ ...REQUEST.items[0], recorded: true }, ...REQUEST.items.slice(1)] }
  expect(getRequestSummary(partial, NOW)).toEqual('Data requested: 2 of 3 items remaining, 12 days ago')
  expect(getRemainingItems(partial).map(({ field }) => field)).toEqual(['onsetAge', 'mondoId'])

  expect(getRequestSummary({ ...REQUEST, items: REQUEST.items.slice(0, 1) }, NOW)).toEqual(
    'Data requested: 1 item, 12 days ago',
  )
  expect(getRequestSummary(
    { ...REQUEST, items: [{ ...REQUEST.items[0], recorded: true }], createdDate: '2026-11-26T09:00:00Z' }, NOW,
  )).toEqual('Data requested: 0 of 1 item remaining, today')
})

test('getReasonText only describes the fixed list of reasons', () => {
  expect(DATA_REQUEST_REASON_OPTIONS.map(({ value }) => getReasonText(value))).toEqual(
    ['Needed for analysis', 'To confirm inheritance', 'For matchmaking', 'Other'],
  )
  expect(getReasonText('Z')).toBeNull()
  expect(getReasonText(null)).toBeNull()
  expect(getReasonText()).toBeNull()
})

test('isAssignedToUser', () => {
  expect(isAssignedToUser(REQUEST, { username: 'clinician' })).toBe(true)
  expect(isAssignedToUser(REQUEST, { username: 'analyst' })).toBe(false)
  expect(isAssignedToUser({ ...REQUEST, assignedToUsername: null }, { username: 'clinician' })).toBe(false)
  expect(isAssignedToUser({ ...REQUEST, assignedToUsername: undefined }, {})).toBe(false)
})

test('HAS_OPEN_DATA_REQUEST_FILTER', () => {
  expect(HAS_OPEN_DATA_REQUEST_FILTER.createFilter({ hasOpenDataRequest: true })).toBe(true)
  expect(HAS_OPEN_DATA_REQUEST_FILTER.createFilter({ hasOpenDataRequest: false })).toBe(false)
  expect(HAS_OPEN_DATA_REQUEST_FILTER.createFilter({})).toBe(false)
})
