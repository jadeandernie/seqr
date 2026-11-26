import { saveState, loadState } from './localStorage'

const LABEL = 'seqr-test-state'

let warn: jest.SpyInstance

beforeEach(() => {
  localStorage.clear()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

test('round-trips saved state and keeps labels separate', () => {
  const state = { familyTableState: { familiesSortOrder: 'FAMILY_NAME' }, recordsPerPage: 25, tags: ['Review', null] }
  saveState(LABEL, state)
  saveState('other', false)

  expect(loadState(LABEL)).toEqual(state)
  expect(loadState('other')).toBe(false)
  expect(warn).not.toHaveBeenCalled()
})

test('returns undefined for a label that was never saved', () => {
  expect(loadState(LABEL)).toBeUndefined()
  expect(warn).not.toHaveBeenCalled()
})

test('returns undefined instead of throwing when the stored value is corrupt', () => {
  localStorage.setItem(LABEL, '{"familyTableState":')
  expect(loadState(LABEL)).toBeUndefined()
  expect(warn).toHaveBeenCalledTimes(1)
})

test('clears the previous value when the new state cannot be stored', () => {
  saveState(LABEL, { page: 1 })
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })

  saveState(LABEL, { page: 2 })

  expect(warn).toHaveBeenCalledTimes(1)
  expect(loadState(LABEL)).toBeUndefined()
})

test('clears the previous value when the new state cannot be serialized', () => {
  saveState(LABEL, { page: 1 })
  const circular: Record<string, unknown> = {}
  circular.self = circular

  saveState(LABEL, circular)

  expect(warn).toHaveBeenCalledTimes(1)
  expect(loadState(LABEL)).toBeUndefined()
})
