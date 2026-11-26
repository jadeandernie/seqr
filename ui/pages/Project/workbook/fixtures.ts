import { STATE_WITH_2_FAMILIES } from '../fixtures'
import {
  GroupSummary, Workbook, WorkbookTarget, Worksheet, WorksheetQuery, WorksheetQueryResult, WorksheetTemplate,
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
  rerunIntervalDays: null,
  notifyOnNewResults: false,
  editors: [],
  canManageEditors: true,
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
  worksheetGuid: DE_NOVO_WORKSHEET_GUID, workbookGuid: WORKBOOK_GUID, name: 'De Novo', order: 0, rerunIntervalDays: null,
  templateGuid: null,
}

export const RECESSIVE_WORKSHEET: Worksheet = {
  worksheetGuid: RECESSIVE_WORKSHEET_GUID, workbookGuid: WORKBOOK_GUID, name: 'Recessive', order: 1, rerunIntervalDays: null,
  templateGuid: null,
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
  lastScheduledRunDate: null,
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

export const DEFAULT_TEMPLATE_GUID = 'WST0000001_de_novo_dominant'
export const MY_TEMPLATE_GUID = 'WST0000002_my_trios'
export const PROJECT_TEMPLATE_GUID = 'WST0000003_project_panel'
export const OTHER_TEMPLATE_GUID = 'WST0000004_other_project'

export const DEFAULT_TEMPLATE: WorksheetTemplate = {
  worksheetTemplateGuid: DEFAULT_TEMPLATE_GUID,
  name: 'De Novo / Dominant',
  description: 'The default de novo and dominant searches',
  queries: [
    { name: 'De Novo/Dominant Restrictive', search: { inheritance: { mode: 'de_novo' } } },
    { name: 'De Novo/Dominant Permissive', search: { inheritance: { mode: 'de_novo' } } },
  ],
  isPublic: true,
  createdDate: '2026-11-20T10:00:00Z',
  createdBy: null,
  lastModifiedDate: '2026-11-20T10:00:00Z',
  projectGuids: [],
  isCreator: false,
  canEdit: false,
}

export const MY_TEMPLATE: WorksheetTemplate = {
  ...DEFAULT_TEMPLATE,
  worksheetTemplateGuid: MY_TEMPLATE_GUID,
  name: 'My trios',
  description: null,
  queries: [{ name: 'Recessive', search: { inheritance: { mode: 'recessive' } } }],
  isPublic: false,
  createdBy: 'Test User',
  isCreator: true,
  canEdit: true,
}

export const PROJECT_TEMPLATE: WorksheetTemplate = {
  ...MY_TEMPLATE,
  worksheetTemplateGuid: PROJECT_TEMPLATE_GUID,
  name: 'Project panel',
  description: 'Shared with this project',
  createdBy: 'Test Manager User',
  projectGuids: [PROJECT_GUID],
  isCreator: false,
  canEdit: false,
}

// Visible through another project of the user, so only listed where templates are managed
export const OTHER_TEMPLATE: WorksheetTemplate = {
  ...PROJECT_TEMPLATE,
  worksheetTemplateGuid: OTHER_TEMPLATE_GUID,
  name: 'Another project panel',
  description: null,
  projectGuids: ['R0002_other'],
}

export const TEMPLATES = {
  [DEFAULT_TEMPLATE_GUID]: DEFAULT_TEMPLATE,
  [MY_TEMPLATE_GUID]: MY_TEMPLATE,
  [PROJECT_TEMPLATE_GUID]: PROJECT_TEMPLATE,
  [OTHER_TEMPLATE_GUID]: OTHER_TEMPLATE,
}

export const SAVED_SEARCHES = {
  [SAVED_SEARCH_GUID]: { savedSearchGuid: SAVED_SEARCH_GUID, name: 'De Novo/Dominant Restrictive', search: {} },
}

const { search, igvReadsVisibility, projectSavedVariantsLoading, ...PROJECT_STATE } = STATE_WITH_2_FAMILIES

export const STATE = { ...PROJECT_STATE, ...WORKBOOK_DETAIL, savedSearchesByGuid: SAVED_SEARCHES }
