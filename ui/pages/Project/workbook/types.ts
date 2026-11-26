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
  rerunIntervalDays?: number | null
  notifyOnNewResults?: boolean
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
  rerunIntervalDays?: number | null
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
  hasUnreviewed?: boolean
  numUnreviewed?: number
  lastRun?: WorksheetQueryRun | null
  lastScheduledRunDate?: string | null
}

export type RunTrigger = 'M' | 'S' | 'D'

export interface WorksheetQueryRun {
  runId: number
  createdDate: string
  createdBy: string | null
  trigger: RunTrigger
  status: 'C' | 'T' | 'E'
  error: string | null
  numResults: number | null
  numNew: number
  numRemoved: number
  isUnchanged: boolean
}

export interface UnreviewedResult {
  familyGuid: string
  variantIds: string[]
  geneIds: string[]
}

export interface CellHistory {
  runs?: WorksheetQueryRun[]
  totalRuns?: number
  unreviewedResults?: UnreviewedResult[]
  totalUnreviewedResults?: number
}

// The run history of the most recently requested cell
export interface CellHistoryState {
  cellKey?: string
  history?: CellHistory
  error?: string
}

export interface SavedVariant {
  variantId: string
  familyGuids: string[]
  tagGuids: string[]
}

export interface VariantTag {
  name: string
  metadata?: string | null
}

export interface SearchedVariant {
  variantId: string
  familyGuids?: string[]
}

export type DisplayVariant = SearchedVariant | SearchedVariant[]

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
  workbookCellHistory: CellHistoryState
  workbookCellHistoryLoading: LoadingState
  savedVariantsByGuid: ByGuid<SavedVariant>
  variantTagsByGuid: ByGuid<VariantTag>
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
  newValue?: GroupSummaryState | CellHistoryState
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

export interface Option<V = string> {
  value: V
  text: string
}

export interface RequestError {
  message: string
  body?: { errors?: string[], error?: string, resultsNotLoaded?: boolean }
}
