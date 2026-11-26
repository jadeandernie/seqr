import { getLocusListGuids, getLocusListGuidsValue, getSelectedLocusLists, mergeLocusListItems } from './locusListUtils'

const GENE_LIST_1 = { locusListGuid: 'LL1', items: [{ display: 'NEB' }, { display: 'TTN' }], rawItems: 'NEB, TTN' }
const GENE_LIST_2 = {
  locusListGuid: 'LL2',
  items: [{ display: 'ACTA1' }, { display: 'chr1:100-200' }, { display: 'TTN' }],
  rawItems: 'ACTA1, chr1:100-200, TTN',
}
const PA_LIST = {
  locusListGuid: 'LL3',
  paLocusList: { panelAppId: 3 },
  items: [
    { display: 'DMD', pagene: { confidenceLevel: 2 as const, modeOfInheritance: 'X-LINKED: hemizygous mutation in males, biallelic mutations in females' } },
    { display: 'TTN', pagene: { confidenceLevel: 3 as const, modeOfInheritance: 'BIALLELIC' } },
  ],
  rawItems: 'DMD, TTN',
}

test('getLocusListGuids reads a single saved gene list', () => {
  expect(getLocusListGuids({ locusListGuid: 'LL1' })).toEqual(['LL1'])
  expect(getLocusListGuids({ locusListGuid: 'LL1', rawItems: 'TTN' })).toEqual(['LL1'])
})

test('getLocusListGuids reads multiple gene lists', () => {
  expect(getLocusListGuids({ locusListGuids: ['LL1', 'LL2'] })).toEqual(['LL1', 'LL2'])
  expect(getLocusListGuids({ locusListGuids: ['LL2', 'LL1'], locusListGuid: 'LL3' })).toEqual(['LL2', 'LL1'])
})

test('getLocusListGuids handles searches with no gene list', () => {
  expect(getLocusListGuids(undefined)).toEqual([])
  expect(getLocusListGuids(null)).toEqual([])
  expect(getLocusListGuids({})).toEqual([])
  expect(getLocusListGuids({ locusListGuid: '' })).toEqual([])
  expect(getLocusListGuids({ locusListGuids: [] })).toEqual([])
  expect(getLocusListGuids({ locusListGuids: [], locusListGuid: 'LL1' })).toEqual(['LL1'])
})

test('getLocusListGuidsValue keeps the single gene list format for zero or one list', () => {
  expect(getLocusListGuidsValue([])).toEqual({ locusListGuid: undefined })
  expect(JSON.stringify(getLocusListGuidsValue([]))).toEqual('{}')
  expect(getLocusListGuidsValue(['LL1'])).toEqual({ locusListGuid: 'LL1' })
})

test('getLocusListGuidsValue stores multiple gene lists in order', () => {
  expect(getLocusListGuidsValue(['LL2', 'LL1'])).toEqual({ locusListGuids: ['LL2', 'LL1'] })
  expect(getLocusListGuids(getLocusListGuidsValue(['LL2', 'LL1']))).toEqual(['LL2', 'LL1'])
  expect(getLocusListGuids(getLocusListGuidsValue(['LL1']))).toEqual(['LL1'])
  expect(getLocusListGuids(getLocusListGuidsValue([]))).toEqual([])
})

test('getSelectedLocusLists returns the selected lists in order', () => {
  const locusListsByGuid = { LL1: GENE_LIST_1, LL2: GENE_LIST_2, LL3: PA_LIST }
  expect(getSelectedLocusLists({ locusListGuid: 'LL2' }, locusListsByGuid)).toEqual([GENE_LIST_2])
  expect(getSelectedLocusLists({ locusListGuids: ['LL3', 'LL1'] }, locusListsByGuid)).toEqual([PA_LIST, GENE_LIST_1])
  expect(getSelectedLocusLists({ locusListGuids: ['LL3', 'LL4'] }, locusListsByGuid)).toEqual([PA_LIST, {}])
  expect(getSelectedLocusLists(undefined, locusListsByGuid)).toEqual([])
})

test('mergeLocusListItems returns the unchanged items of a single gene list', () => {
  expect(mergeLocusListItems([GENE_LIST_1])).toEqual({ rawItems: 'NEB, TTN' })
  expect(mergeLocusListItems([{ ...GENE_LIST_1, rawItems: 'TTN, NEB, TTN' }])).toEqual({ rawItems: 'TTN, NEB, TTN' })
  expect(mergeLocusListItems([GENE_LIST_1], ['AD'])).toEqual({ rawItems: 'NEB, TTN' })
})

test('mergeLocusListItems merges the unique sorted items of multiple gene lists', () => {
  expect(mergeLocusListItems([GENE_LIST_1, GENE_LIST_2])).toEqual({ rawItems: 'ACTA1, chr1:100-200, NEB, TTN' })
  expect(mergeLocusListItems([GENE_LIST_2, GENE_LIST_1])).toEqual({ rawItems: 'ACTA1, chr1:100-200, NEB, TTN' })
  expect(mergeLocusListItems([GENE_LIST_1, { locusListGuid: 'LL4', items: [], rawItems: '' }])).toEqual({ rawItems: 'NEB, TTN' })
})

test('mergeLocusListItems groups items by PanelApp confidence when any list is a PanelApp list', () => {
  expect(mergeLocusListItems([PA_LIST])).toEqual({ panelAppItems: { amber: 'DMD', green: 'TTN' }, selectedMOIs: undefined })
  expect(mergeLocusListItems([GENE_LIST_2, PA_LIST, GENE_LIST_1])).toEqual({
    panelAppItems: { amber: 'DMD', green: 'TTN', none: 'ACTA1, chr1:100-200, NEB' }, selectedMOIs: undefined,
  })
  expect(mergeLocusListItems([GENE_LIST_1, PA_LIST], ['XR'])).toEqual({
    panelAppItems: { amber: 'DMD', none: 'NEB, TTN' }, selectedMOIs: ['XR'],
  })
})

test('mergeLocusListItems returns no items when no lists are selected', () => {
  expect(mergeLocusListItems([])).toEqual({ rawItems: undefined })
})
