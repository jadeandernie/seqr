import { splitSorts, joinSorts } from './multiSortUtils'

test('splitSorts returns the ordered list of sorts', () => {
  expect(splitSorts('XPOS')).toEqual(['XPOS'])
  expect(splitSorts('GNOMAD,CADD')).toEqual(['GNOMAD', 'CADD'])
  expect(splitSorts('CADD,GNOMAD')).toEqual(['CADD', 'GNOMAD'])
})

test('splitSorts handles missing and empty values', () => {
  expect(splitSorts(undefined)).toEqual([])
  expect(splitSorts(null)).toEqual([])
  expect(splitSorts('')).toEqual([])
  expect(splitSorts(',CADD,')).toEqual(['CADD'])
})

test('joinSorts keeps a single sort unchanged', () => {
  expect(joinSorts(['CADD'], 'XPOS')).toEqual('CADD')
  expect(joinSorts(['XPOS'], 'XPOS')).toEqual('XPOS')
})

test('joinSorts keeps the selection order', () => {
  expect(joinSorts(['GNOMAD', 'CADD'], 'XPOS')).toEqual('GNOMAD,CADD')
  expect(joinSorts(['CADD', 'GNOMAD'], 'XPOS')).toEqual('CADD,GNOMAD')
})

test('joinSorts drops the default sort when other sorts are selected', () => {
  expect(joinSorts(['XPOS', 'GNOMAD'], 'XPOS')).toEqual('GNOMAD')
  expect(joinSorts(['GNOMAD', 'XPOS', 'CADD'], 'XPOS')).toEqual('GNOMAD,CADD')
})

test('joinSorts falls back to the default sort when nothing is selected', () => {
  expect(joinSorts([], 'XPOS')).toEqual('XPOS')
  expect(joinSorts(undefined, 'XPOS')).toEqual('XPOS')
  expect(joinSorts(null, 'XPOS')).toEqual('XPOS')
})

test('joinSorts and splitSorts round trip', () => {
  expect(splitSorts(joinSorts(['GNOMAD', 'CADD'], 'XPOS'))).toEqual(['GNOMAD', 'CADD'])
  expect(joinSorts(splitSorts('IN_OMIM,SIZE'), 'XPOS')).toEqual('IN_OMIM,SIZE')
})
