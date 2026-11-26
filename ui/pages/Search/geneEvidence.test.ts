import {
  GENE_EVIDENCE_TYPES, geneEvidenceSummary, selectedGeneEvidenceTypes, searchedRnaDataTypes, geneEvidenceFieldNames,
} from './geneEvidence'

const FAMILIES_BY_GUID = {
  F1: { projectGuid: 'P1', rnaDataTypes: ['S', 'E'] },
  F2: { projectGuid: 'P1', rnaDataTypes: [] as string[] },
  F3: { projectGuid: 'P2', rnaDataTypes: ['S'] },
  F4: { projectGuid: 'P3' },
}

test('selectedGeneEvidenceTypes', () => {
  expect(selectedGeneEvidenceTypes(null)).toEqual([])
  expect(selectedGeneEvidenceTypes({ match: 'all' })).toEqual([])
  expect(selectedGeneEvidenceTypes({ rna_expression_outlier: false, rna_splice_outlier: true })).toEqual(
    [GENE_EVIDENCE_TYPES[1]],
  )
  expect(selectedGeneEvidenceTypes({ rna_expression_outlier: true, rna_splice_outlier: true })).toEqual(GENE_EVIDENCE_TYPES)
})

test('geneEvidenceSummary', () => {
  expect(geneEvidenceSummary(undefined)).toEqual(null)
  expect(geneEvidenceSummary({})).toEqual(null)
  expect(geneEvidenceSummary({ rna_expression_outlier: false, match: 'all' })).toEqual(null)
  expect(geneEvidenceSummary({ rna_expression_outlier: true })).toEqual(
    'In genes with RNA Expression Outlier evidence in the family',
  )
  expect(geneEvidenceSummary({ rna_splice_outlier: true, match: 'all' })).toEqual(
    'In genes with RNA Splice Outlier evidence in the family',
  )
  expect(geneEvidenceSummary({ rna_expression_outlier: true, rna_splice_outlier: true })).toEqual(
    'In genes with RNA Expression Outlier or RNA Splice Outlier evidence in the family',
  )
  expect(geneEvidenceSummary({ rna_expression_outlier: true, rna_splice_outlier: true, match: 'any' })).toEqual(
    'In genes with RNA Expression Outlier or RNA Splice Outlier evidence in the family',
  )
  expect(geneEvidenceSummary({ rna_expression_outlier: true, rna_splice_outlier: true, match: 'all' })).toEqual(
    'In genes with RNA Expression Outlier and RNA Splice Outlier evidence in the family',
  )
})

test('searchedRnaDataTypes', () => {
  expect(searchedRnaDataTypes(null, FAMILIES_BY_GUID)).toEqual('')
  expect(searchedRnaDataTypes([], FAMILIES_BY_GUID)).toEqual('')
  expect(searchedRnaDataTypes([{ projectGuid: 'P1', familyGuids: ['F1'] }], FAMILIES_BY_GUID)).toEqual('E,S')
  expect(searchedRnaDataTypes([{ projectGuid: 'P1', familyGuids: ['F2'] }], FAMILIES_BY_GUID)).toEqual('')
  expect(searchedRnaDataTypes([{ projectGuid: 'P1', familyGuids: ['F2', 'not_loaded'] }], FAMILIES_BY_GUID)).toEqual('')
  expect(searchedRnaDataTypes(
    [{ projectGuid: 'P1', familyGuids: ['F2'] }, { projectGuid: 'P2', familyGuids: ['F3'] }], FAMILIES_BY_GUID,
  )).toEqual('S')
  // Without selected families, all loaded families in the project are searched
  expect(searchedRnaDataTypes([{ projectGuid: 'P1', familyGuids: null }], FAMILIES_BY_GUID)).toEqual('E,S')
  expect(searchedRnaDataTypes([{ projectGuid: 'P2' }], FAMILIES_BY_GUID)).toEqual('S')
  expect(searchedRnaDataTypes([{ projectGuid: 'P3' }, { projectGuid: 'P4' }], FAMILIES_BY_GUID)).toEqual('')
})

test('geneEvidenceFieldNames', () => {
  expect(geneEvidenceFieldNames('', null)).toEqual([])
  expect(geneEvidenceFieldNames(undefined, { match: 'all' })).toEqual([])
  expect(geneEvidenceFieldNames('E,S', null)).toEqual(['rna_expression_outlier', 'rna_splice_outlier'])
  expect(geneEvidenceFieldNames('S', {})).toEqual(['rna_splice_outlier'])
  expect(geneEvidenceFieldNames('E', { rna_expression_outlier: true })).toEqual(['rna_expression_outlier'])
  // Evidence already in the search can always be edited, even if the searched families have no data for it
  expect(geneEvidenceFieldNames('', { rna_expression_outlier: true })).toEqual(['rna_expression_outlier'])
  expect(geneEvidenceFieldNames('S', { rna_expression_outlier: true, rna_splice_outlier: false })).toEqual(
    ['rna_expression_outlier', 'rna_splice_outlier'],
  )
})
