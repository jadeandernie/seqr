import { STATE_WITH_2_FAMILIES } from '../fixtures'
import {
  GroupSummary, Workbook, WorkbookTarget, Worksheet, WorksheetQuery, WorksheetQueryResult,
} from './types'

export const PROJECT_GUID = 'R0237_1000_genomes_demo'
export const WORKBOOK_GUID = 'WB0000001_trio_analysis'
export const FAMILY_TARGET_GUID = 'WBT0000001_1'
export const GROUP_TARGET_GUID = 'WBT0000002_test_group'
export const DE_NOVO_WORKSHEET_GUID = 'WS0000001_de_novo'
export const RECESSIVE_WORKSHEET_GUID = 'WS0000002_recessive'
export const RESTRICTIVE_QUERY_GUID = 'WSQ0000001_de_novo_restrictive'
export const PERMISSIVE_QUERY_GUID = 'WSQ0000002_de_novo_permissive'
export const RECESSIVE_QUERY_GUID = 'WSQ0000003_recessive'
export const QUERY_RESULT_GUID = 'WQR0000001_1_1'
export const SAVED_SEARCH_GUID = 'VS0079516_'
export const SEARCH_HASH = 'WB0123456789abcdef0123456789abcdef0123456789abcdef'

export const WORKBOOK: Workbook = {
  workbookGuid: WORKBOOK_GUID,
  projectGuid: PROJECT_GUID,
  name: 'Trio analysis',
  description: 'De novo and recessive review',
  createdDate: '2026-11-20T10:00:00Z',
  createdBy: 'Test Manager User',
  lastModifiedDate: '2026-11-21T10:00:00Z',
  canEdit: true,
}

export const OTHER_WORKBOOK: Workbook = {
  ...WORKBOOK, workbookGuid: 'WB0000002_exomes', name: 'Exome review', description: null, createdBy: null, canEdit: false,
}

export const FAMILY_TARGET: WorkbookTarget = {
  workbookTargetGuid: FAMILY_TARGET_GUID,
  workbookGuid: WORKBOOK_GUID,
  order: 0,
  familyGuid: 'F011652_1',
  analysisGroupGuid: null,
  familyGuids: ['F011652_1'],
}

export const GROUP_TARGET: WorkbookTarget = {
  workbookTargetGuid: GROUP_TARGET_GUID,
  workbookGuid: WORKBOOK_GUID,
  order: 1,
  familyGuid: null,
  analysisGroupGuid: 'AG0000183_test_group',
  familyGuids: ['F011652_1'],
}

export const DE_NOVO_WORKSHEET: Worksheet = {
  worksheetGuid: DE_NOVO_WORKSHEET_GUID, workbookGuid: WORKBOOK_GUID, name: 'De Novo', order: 0,
}

export const RECESSIVE_WORKSHEET: Worksheet = {
  worksheetGuid: RECESSIVE_WORKSHEET_GUID, workbookGuid: WORKBOOK_GUID, name: 'Recessive', order: 1,
}

const QUERY = { createdDate: '2026-11-20T10:03:00Z', createdBy: 'Test Manager User' }

export const RESTRICTIVE_QUERY: WorksheetQuery = {
  ...QUERY,
  worksheetQueryGuid: RESTRICTIVE_QUERY_GUID,
  worksheetGuid: DE_NOVO_WORKSHEET_GUID,
  name: 'De novo restrictive',
  order: 0,
  search: { inheritance: { mode: 'de_novo' }, freqs: { gnomad_genomes: { af: 0.001 } } },
}

export const PERMISSIVE_QUERY: WorksheetQuery = {
  ...QUERY,
  worksheetQueryGuid: PERMISSIVE_QUERY_GUID,
  worksheetGuid: DE_NOVO_WORKSHEET_GUID,
  name: 'De novo permissive',
  order: 1,
  search: { inheritance: { mode: 'de_novo' }, freqs: { gnomad_genomes: { af: 0.01 } } },
}

export const RECESSIVE_QUERY: WorksheetQuery = {
  ...QUERY,
  worksheetQueryGuid: RECESSIVE_QUERY_GUID,
  worksheetGuid: RECESSIVE_WORKSHEET_GUID,
  name: 'Recessive',
  order: 0,
  search: { inheritance: { mode: 'recessive' } },
}

export const QUERY_RESULT: WorksheetQueryResult = {
  worksheetQueryResultGuid: QUERY_RESULT_GUID,
  worksheetQueryGuid: RESTRICTIVE_QUERY_GUID,
  workbookTargetGuid: FAMILY_TARGET_GUID,
  status: 'I',
  note: 'Reviewing candidates',
  searchHash: null,
  lastRunDate: null,
  lastRunBy: null,
  numResults: null,
  lastModifiedDate: '2026-11-20T10:04:00Z',
}

export const GROUP_QUERY_RESULT: WorksheetQueryResult = {
  ...QUERY_RESULT,
  worksheetQueryResultGuid: 'WQR0000002_1_2',
  workbookTargetGuid: GROUP_TARGET_GUID,
  status: 'N',
  note: null,
  searchHash: SEARCH_HASH,
  lastRunDate: '2026-11-22T10:00:00Z',
  lastRunBy: 'Test User',
  numResults: 4,
}

export const MTHFR_GENE_ID = 'ENSG00000177000'
export const CDC7_GENE_ID = 'ENSG00000097046'
export const UNKNOWN_GENE_ID = 'ENSG00000186092'

// 4 families: F011652_1 and F000003_3 have results, 3 have HPO terms for an affected individual
export const GROUP_SUMMARY: GroupSummary = {
  searchHash: SEARCH_HASH,
  numFamilies: 4,
  numFamiliesWithResults: 2,
  numFamiliesWithPhenotypes: 3,
  totalVariants: 4,
  genes: [
    { geneId: MTHFR_GENE_ID, numFamilies: 2, familyGuids: ['F011652_1', 'F000003_3'], numVariants: 2 },
    { geneId: CDC7_GENE_ID, numFamilies: 1, familyGuids: ['F011652_1'], numVariants: 2 },
    { geneId: UNKNOWN_GENE_ID, numFamilies: 1, familyGuids: ['F000003_3'], numVariants: 1 },
  ],
  totalGenes: 3,
  recurrentVariants: [{
    variantId: '1-100-A-T', geneIds: [MTHFR_GENE_ID, UNKNOWN_GENE_ID], numFamilies: 2, familyGuids: ['F011652_1', 'F000003_3'],
  }],
  totalRecurrentVariants: 1,
  phenotypeGeneId: null,
  phenotypeCategories: [
    { id: 'HP:0000707', name: null, numFamilies: 3, numFamiliesWithResults: 2 },
    { id: null, name: null, numFamilies: 1, numFamiliesWithResults: 1 },
    { id: 'HP:0001626', name: null, numFamilies: 1, numFamiliesWithResults: 0 },
    { id: 'HP:9000000', name: null, numFamilies: 1, numFamiliesWithResults: 1 },
  ],
  phenotypeTerms: [
    {
      id: 'HP:0002011', name: 'Morphological abnormality of the central nervous system', numFamilies: 3, numFamiliesWithResults: 2,
    },
    { id: 'HP:9999999', name: null, numFamilies: 1, numFamiliesWithResults: 1 },
  ],
  totalPhenotypeTerms: 7,
}

export const GROUP_SUMMARY_RESPONSE = {
  ...GROUP_SUMMARY,
  genesById: {
    [MTHFR_GENE_ID]: { geneId: MTHFR_GENE_ID, geneSymbol: 'MTHFR' },
    [CDC7_GENE_ID]: { geneId: CDC7_GENE_ID, geneSymbol: 'CDC7' },
  },
}

export const WORKBOOK_DETAIL = {
  workbooksByGuid: { [WORKBOOK_GUID]: WORKBOOK },
  workbookTargetsByGuid: { [FAMILY_TARGET_GUID]: FAMILY_TARGET, [GROUP_TARGET_GUID]: GROUP_TARGET },
  worksheetsByGuid: {
    [DE_NOVO_WORKSHEET_GUID]: DE_NOVO_WORKSHEET, [RECESSIVE_WORKSHEET_GUID]: RECESSIVE_WORKSHEET,
  },
  worksheetQueriesByGuid: {
    [RESTRICTIVE_QUERY_GUID]: RESTRICTIVE_QUERY,
    [PERMISSIVE_QUERY_GUID]: PERMISSIVE_QUERY,
    [RECESSIVE_QUERY_GUID]: RECESSIVE_QUERY,
  },
  worksheetQueryResultsByGuid: { [QUERY_RESULT_GUID]: QUERY_RESULT },
}

export const SAVED_SEARCHES = {
  [SAVED_SEARCH_GUID]: { savedSearchGuid: SAVED_SEARCH_GUID, name: 'De Novo/Dominant Restrictive', search: {} },
}

const { search, igvReadsVisibility, projectSavedVariantsLoading, ...PROJECT_STATE } = STATE_WITH_2_FAMILIES

export const STATE = { ...PROJECT_STATE, ...WORKBOOK_DETAIL, savedSearchesByGuid: SAVED_SEARCHES }
