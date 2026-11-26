export type WorkbookStatus = 'N' | 'I' | 'F' | 'U'

export interface Workbook {
  workbookGuid: string
  projectGuid: string
  name: string
  description: string | null
  createdDate: string
  createdBy: string | null
  lastModifiedDate: string
  canEdit: boolean
}

export interface WorkbookTarget {
  workbookTargetGuid: string
  workbookGuid: string
  order: number
  familyGuid: string | null
  analysisGroupGuid: string | null
  familyGuids: string[]
}

export interface Worksheet {
  worksheetGuid: string
  workbookGuid: string
  name: string
  order: number
}

export interface WorksheetQuery {
  worksheetQueryGuid: string
  worksheetGuid: string
  name: string
  order: number
  search: Record<string, unknown>
  createdDate: string
  createdBy: string | null
}

export interface WorksheetQueryResult {
  worksheetQueryResultGuid: string
  worksheetQueryGuid: string
  workbookTargetGuid: string
  status: WorkbookStatus
  note: string | null
  searchHash: string | null
  lastRunDate: string | null
  lastRunBy: string | null
  numResults: number | null
  lastModifiedDate: string
}

export type ByGuid<T> = Record<string, T>

export interface PhenotypeCount {
  id: string | null
  name: string | null
  numFamilies: number
  numFamiliesWithResults: number
}

export interface GeneRecurrence {
  geneId: string
  numFamilies: number
  familyGuids: string[]
  numVariants: number
}

export interface VariantRecurrence {
  variantId: string
  geneIds: string[]
  numFamilies: number
  familyGuids: string[]
}

export interface GroupSummary {
  searchHash: string
  numFamilies: number
  numFamiliesWithResults: number
  numFamiliesWithPhenotypes: number
  totalVariants: number
  genes: GeneRecurrence[]
  totalGenes: number
  recurrentVariants: VariantRecurrence[]
  totalRecurrentVariants: number
  phenotypeGeneId: string | null
  phenotypeCategories: PhenotypeCount[]
  phenotypeTerms: PhenotypeCount[]
  totalPhenotypeTerms: number
}

// The summary of the most recently requested analysis group cell
export interface GroupSummaryState {
  cellKey?: string
  summary?: GroupSummary
  error?: string
  resultsNotLoaded?: boolean
}

export interface LoadingState {
  isLoading: boolean
  errorMessage?: string | null
}

export interface NamedEntity {
  name?: string
  displayName?: string
  projectGuid?: string | null
  criteria?: object
}

export interface WorkbookReduxState {
  currentProjectGuid: string | null
  workbooksByGuid: ByGuid<Workbook>
  workbookTargetsByGuid: ByGuid<WorkbookTarget>
  worksheetsByGuid: ByGuid<Worksheet>
  worksheetQueriesByGuid: ByGuid<WorksheetQuery>
  worksheetQueryResultsByGuid: ByGuid<WorksheetQueryResult>
  workbooksLoading: LoadingState
  workbookDetailLoading: LoadingState
  familiesByGuid: ByGuid<NamedEntity>
  analysisGroupsByGuid: ByGuid<NamedEntity>
  savedSearchesByGuid: ByGuid<{ savedSearchGuid: string, name: string }>
  searchesByHash: ByGuid<{ totalResults?: number }>
  searchedVariantsLoading: LoadingState
  genesById: ByGuid<{ geneSymbol?: string }>
  workbookGroupSummary: GroupSummaryState
  workbookGroupSummaryLoading: LoadingState
}

export interface WorkbookResponse {
  workbooksByGuid?: ByGuid<Workbook | null>
  workbookTargetsByGuid?: ByGuid<WorkbookTarget | null>
  worksheetsByGuid?: ByGuid<Worksheet | null>
  worksheetQueriesByGuid?: ByGuid<WorksheetQuery | null>
  worksheetQueryResultsByGuid?: ByGuid<WorksheetQueryResult | null>
  searchHash?: string
}

export interface WorkbookAction {
  type: string
  updatesById?: WorkbookResponse | Record<string, unknown>
  newValue?: GroupSummaryState
  error?: string
}

export type WorkbookDispatch = (action: WorkbookAction) => unknown

export type WorkbookThunk<R = Promise<void>> = (dispatch: WorkbookDispatch, getState: () => WorkbookReduxState) => R

export interface TargetDisplay extends WorkbookTarget {
  name: string
  isGroup: boolean
}

export interface WorksheetDisplay extends Worksheet {
  queries: WorksheetQuery[]
}

export interface Option {
  value: string
  text: string
}

export interface RequestError {
  message: string
  body?: { errors?: string[], error?: string, resultsNotLoaded?: boolean }
}
