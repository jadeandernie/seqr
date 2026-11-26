import { getPastDateString, isOnOrAfterDate } from './dateUtils'

const NOW = new Date('2024-05-31T10:30:00.000Z')

test('getPastDateString subtracts days from a fixed now', () => {
  expect(getPastDateString(NOW, { days: 7 })).toEqual('2024-05-24')
  expect(getPastDateString(new Date('2024-03-03T00:00:00.000Z'), { days: 7 })).toEqual('2024-02-25')
  expect(getPastDateString(NOW, {})).toEqual('2024-05-31')
})

test('getPastDateString subtracts calendar months and clamps to the end of shorter months', () => {
  expect(getPastDateString(new Date('2024-05-15T23:59:59.000Z'), { months: 1 })).toEqual('2024-04-15')
  expect(getPastDateString(NOW, { months: 1 })).toEqual('2024-04-30')
  expect(getPastDateString(NOW, { months: 3 })).toEqual('2024-02-29')
  expect(getPastDateString(new Date('2023-05-31T10:30:00.000Z'), { months: 3 })).toEqual('2023-02-28')
  expect(getPastDateString(new Date('2024-01-31T10:30:00.000Z'), { months: 3 })).toEqual('2023-10-31')
})

test('getPastDateString does not mutate now', () => {
  getPastDateString(NOW, { days: 7, months: 3 })
  expect(NOW.toISOString()).toEqual('2024-05-31T10:30:00.000Z')
})

test('isOnOrAfterDate compares by calendar day for date and datetime strings', () => {
  expect(isOnOrAfterDate('2024-05-24', '2024-05-24')).toBe(true)
  expect(isOnOrAfterDate('2024-05-24T00:00:01.000Z', '2024-05-24')).toBe(true)
  expect(isOnOrAfterDate('2024-05-24T06:25:55.397+00:00', '2024-05-24')).toBe(true)
  expect(isOnOrAfterDate('2024-05-23T23:59:59.999Z', '2024-05-24')).toBe(false)
  expect(isOnOrAfterDate('2025-01-01', '2024-05-24')).toBe(true)
})

test('isOnOrAfterDate is false for a missing date', () => {
  expect(isOnOrAfterDate(undefined, '2024-05-24')).toBe(false)
  expect(isOnOrAfterDate(null, '2024-05-24')).toBe(false)
  expect(isOnOrAfterDate('', '2024-05-24')).toBe(false)
})
