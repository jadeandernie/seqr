import {
  applySuggestions, describeAppliedSuggestions, getSingleFamilyGuid, isSupportedSuggestion, suggestionLabel,
  toggleSuggestion, SearchSuggestion,
} from './searchSuggestions'
import { INHERITANCE_FILTER_LOOKUP } from '../constants'

const suggestion = (type: string, value: string, label?: string): SearchSuggestion => (
  { id: `${type}:${value}`, type, value, label: label || value, sources: ['pedigree'], why: `why ${value}` }
)

const DE_NOVO = suggestion('inheritance', 'de_novo')
const RECESSIVE = suggestion('inheritance', 'recessive')
const GENE_1 = suggestion('gene', 'MTHFR')
const GENE_2 = suggestion('gene', 'OR4F5')
const GENE_LIST_1 = suggestion('gene_list', 'LL001', 'Retina proteome')
const GENE_LIST_2 = suggestion('gene_list', 'LL002', 'PID genes')
const SUGGESTIONS = [DE_NOVO, RECESSIVE, GENE_1, GENE_2, GENE_LIST_1, GENE_LIST_2]

test('getSingleFamilyGuid', () => {
  expect(getSingleFamilyGuid([{ projectGuid: 'P1', familyGuids: ['F1'] }])).toEqual('F1')
  expect(getSingleFamilyGuid([{ projectGuid: 'P1', familyGuids: ['F1', 'F2'] }])).toEqual(null)
  expect(getSingleFamilyGuid([
    { projectGuid: 'P1', familyGuids: ['F1'] }, { projectGuid: 'P2', familyGuids: ['F2'] },
  ])).toEqual(null)
  expect(getSingleFamilyGuid([{ projectGuid: 'P1' }])).toEqual(null)
  expect(getSingleFamilyGuid([{ projectGuid: 'P1', familyGuids: [] }])).toEqual(null)
  expect(getSingleFamilyGuid([])).toEqual(null)
  expect(getSingleFamilyGuid(null)).toEqual(null)
  expect(getSingleFamilyGuid(undefined)).toEqual(null)
})

test('suggestionLabel uses the search form inheritance labels', () => {
  expect(suggestionLabel(DE_NOVO)).toEqual('De Novo/ Dominant')
  expect(suggestionLabel(RECESSIVE)).toEqual('Recessive')
  expect(suggestionLabel(suggestion('inheritance', 'x_linked_recessive'))).toEqual('X-Linked Recessive')
  expect(suggestionLabel(GENE_LIST_1)).toEqual('Retina proteome')
  expect(suggestionLabel(GENE_1)).toEqual('MTHFR')
})

test('isSupportedSuggestion', () => {
  SUGGESTIONS.forEach(s => expect(isSupportedSuggestion(s)).toBe(true))
  expect(isSupportedSuggestion(suggestion('inheritance', 'mitochondrial'))).toBe(false)
  expect(isSupportedSuggestion(suggestion('hpo_panel', 'HP:0001'))).toBe(false)
})

test('toggleSuggestion allows one inheritance mode', () => {
  expect(toggleSuggestion([], DE_NOVO, SUGGESTIONS)).toEqual([DE_NOVO.id])
  expect(toggleSuggestion([DE_NOVO.id, GENE_1.id], RECESSIVE, SUGGESTIONS)).toEqual([GENE_1.id, RECESSIVE.id])
  expect(toggleSuggestion([RECESSIVE.id, GENE_1.id], RECESSIVE, SUGGESTIONS)).toEqual([GENE_1.id])
})

test('toggleSuggestion allows several genes or one gene list', () => {
  expect(toggleSuggestion([GENE_1.id], GENE_2, SUGGESTIONS)).toEqual([GENE_1.id, GENE_2.id])
  expect(toggleSuggestion([DE_NOVO.id, GENE_1.id, GENE_2.id], GENE_LIST_1, SUGGESTIONS)).toEqual(
    [DE_NOVO.id, GENE_LIST_1.id],
  )
  expect(toggleSuggestion([GENE_LIST_1.id], GENE_LIST_2, SUGGESTIONS)).toEqual([GENE_LIST_2.id])
  expect(toggleSuggestion([DE_NOVO.id, GENE_LIST_1.id], GENE_1, SUGGESTIONS)).toEqual([DE_NOVO.id, GENE_1.id])
  const unknown = suggestion('other', 'x')
  expect(toggleSuggestion([GENE_1.id], unknown, [...SUGGESTIONS, unknown])).toEqual([GENE_1.id, unknown.id])
})

test('applySuggestions sets the inheritance filter used by the search form', () => {
  const search = { freqs: { gnomad_genomes: { af: 0.01 } }, locus: { rawItems: 'CFTR' } }
  expect(applySuggestions(search, [RECESSIVE])).toEqual({
    ...search, inheritance: { mode: 'recessive', filter: INHERITANCE_FILTER_LOOKUP.recessive },
  })
  expect(applySuggestions({ inheritance: { mode: 'recessive', filter: {} } }, [DE_NOVO])).toEqual({
    inheritance: { mode: 'de_novo', filter: { A: 'has_alt', N: 'ref_ref' } },
  })
  expect(search).toEqual({ freqs: { gnomad_genomes: { af: 0.01 } }, locus: { rawItems: 'CFTR' } })
})

test('applySuggestions adds genes to the location filter', () => {
  expect(applySuggestions(null, [GENE_1, GENE_2])).toEqual({ locus: { rawItems: 'MTHFR, OR4F5' } })
  expect(applySuggestions(undefined, [GENE_1])).toEqual({ locus: { rawItems: 'MTHFR' } })
  expect(applySuggestions({ locus: { rawItems: 'CFTR, MTHFR' } }, [GENE_1, GENE_2])).toEqual(
    { locus: { rawItems: 'CFTR, MTHFR, OR4F5' } },
  )
  // Items loaded from a selected gene list are replaced, not extended
  expect(applySuggestions({ locus: { locusListGuid: 'LL003', rawItems: 'CFTR' } }, [GENE_1])).toEqual(
    { locus: { rawItems: 'MTHFR' } },
  )
  expect(applySuggestions({ locus: { panelAppItems: { green: 'CFTR' }, rawItems: 'CFTR' } }, [GENE_1])).toEqual(
    { locus: { rawItems: 'MTHFR' } },
  )
})

test('applySuggestions selects a gene list', () => {
  expect(applySuggestions({ locus: { rawItems: 'CFTR' }, pathogenicity: { clinvar: ['pathogenic'] } }, [
    DE_NOVO, GENE_LIST_1,
  ])).toEqual({
    inheritance: { mode: 'de_novo', filter: INHERITANCE_FILTER_LOOKUP.de_novo },
    locus: { locusListGuid: 'LL001' },
    pathogenicity: { clinvar: ['pathogenic'] },
  })
  expect(applySuggestions({}, [GENE_1, GENE_LIST_2])).toEqual({ locus: { locusListGuid: 'LL002' } })
})

test('applySuggestions with nothing selected leaves the search unchanged', () => {
  expect(applySuggestions({ locus: { rawItems: 'CFTR' } }, [])).toEqual({ locus: { rawItems: 'CFTR' } })
})

test('describeAppliedSuggestions', () => {
  expect(describeAppliedSuggestions([GENE_1, RECESSIVE, GENE_2])).toEqual(
    'Inheritance: Recessive; Location genes: MTHFR, OR4F5',
  )
  expect(describeAppliedSuggestions([GENE_LIST_1])).toEqual('Location gene list: Retina proteome')
  expect(describeAppliedSuggestions([])).toEqual('')
})
