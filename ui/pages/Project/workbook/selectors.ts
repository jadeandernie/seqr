import { createSelector } from 'reselect'

import { EXCLUDED_TAG_NAME } from '../../../shared/utils/constants'
import { genericComparator } from '../../../shared/utils/sortUtils'
import {
  STATUS_FINDINGS, STATUS_IN_PROGRESS, STATUS_NOT_REVIEWED, STATUS_NOTHING_FOUND,
} from './constants'
import {
  ByGuid, CellHistoryState, DisplayVariant, GroupSummaryState, NamedEntity, Option, TargetDisplay, TemplateGroup,
  Workbook, WorkbookReduxState, WorkbookStatus, WorkbookTarget, Worksheet, WorksheetDisplay, WorksheetQuery,
  WorksheetQueryResult, WorksheetTemplate,
} from './types'

interface WorkbookProps {
  workbookGuid: string
}

export const getWorkbooksByGuid = (state: WorkbookReduxState) => state.workbooksByGuid
const getWorkbookTargetsByGuid = (state: WorkbookReduxState) => state.workbookTargetsByGuid
const getWorksheetsByGuid = (state: WorkbookReduxState) => state.worksheetsByGuid
const getWorksheetQueriesByGuid = (state: WorkbookReduxState) => state.worksheetQueriesByGuid
const getWorksheetQueryResultsByGuid = (state: WorkbookReduxState) => state.worksheetQueryResultsByGuid
export const getWorkbooksIsLoading = (state: WorkbookReduxState) => state.workbooksLoading.isLoading
export const getWorkbooksLoadingError = (state: WorkbookReduxState) => state.workbooksLoading.errorMessage
export const getWorkbookDetailIsLoading = (state: WorkbookReduxState) => state.workbookDetailLoading.isLoading
export const getWorkbookDetailLoadingError = (state: WorkbookReduxState) => state.workbookDetailLoading.errorMessage
export const getGroupSummaryIsLoading = (state: WorkbookReduxState) => state.workbookGroupSummaryLoading.isLoading
export const getGenesById = (state: WorkbookReduxState) => state.genesById
const getCurrentProjectGuid = (state: WorkbookReduxState) => state.currentProjectGuid
export const getFamiliesByGuid = (state: WorkbookReduxState) => state.familiesByGuid
const getAnalysisGroupsByGuid = (state: WorkbookReduxState) => state.analysisGroupsByGuid
const getSavedSearchesByGuid = (state: WorkbookReduxState) => state.savedSearchesByGuid
const getWorkbookGuid = (state: WorkbookReduxState, props: WorkbookProps) => props.workbookGuid

const NO_GROUP_SUMMARY: GroupSummaryState = {}

// Only the summary of the given cell, so that the summary of another cell is never shown
export const getCellGroupSummary = (state: WorkbookReduxState, cellKey: string): GroupSummaryState => (
  state.workbookGroupSummary.cellKey === cellKey ? state.workbookGroupSummary : NO_GROUP_SUMMARY
)

const NO_CELL_HISTORY: CellHistoryState = {}

// Only the history of the given cell, so that the history of another cell is never shown
export const getCellHistory = (state: WorkbookReduxState, cellKey: string): CellHistoryState => (
  state.workbookCellHistory.cellKey === cellKey ? state.workbookCellHistory : NO_CELL_HISTORY
)

const sortBy = <T>(entities: T[], field: keyof T): T[] => [...entities].sort(
  (a, b) => genericComparator(a[field], b[field]),
)

export const getProjectWorkbooks = createSelector(
  getWorkbooksByGuid,
  getCurrentProjectGuid,
  (workbooksByGuid, projectGuid): Workbook[] => sortBy(
    Object.values(workbooksByGuid).filter(workbook => workbook.projectGuid === projectGuid), 'name',
  ),
)

export const getWorkbook = createSelector(
  getWorkbooksByGuid,
  getWorkbookGuid,
  (workbooksByGuid, workbookGuid): Workbook | undefined => workbooksByGuid[workbookGuid],
)

const toOptions = (
  entitiesByGuid: ByGuid<NamedEntity>, projectGuid: string | null, nameField: 'name' | 'displayName',
): Option[] => sortBy(
  Object.entries(entitiesByGuid).filter(
    ([, entity]) => entity.projectGuid === projectGuid && !entity.criteria,
  ).map(
    ([value, entity]) => ({ value, text: entity[nameField] || value }),
  ), 'text',
)

export const getProjectFamilyOptions = createSelector(
  getFamiliesByGuid,
  getCurrentProjectGuid,
  (familiesByGuid, projectGuid) => toOptions(familiesByGuid, projectGuid, 'displayName'),
)

export const getProjectAnalysisGroupOptions = createSelector(
  getAnalysisGroupsByGuid,
  getCurrentProjectGuid,
  (analysisGroupsByGuid, projectGuid) => toOptions(analysisGroupsByGuid, projectGuid, 'name'),
)

export const getSavedSearchOptions = createSelector(
  getSavedSearchesByGuid,
  (savedSearchesByGuid): Option[] => sortBy(
    Object.values(savedSearchesByGuid).map(({ savedSearchGuid, name }) => ({ value: savedSearchGuid, text: name })),
    'text',
  ),
)

export const getTargetName = (
  target: WorkbookTarget, familiesByGuid: ByGuid<NamedEntity>, analysisGroupsByGuid: ByGuid<NamedEntity>,
): string => {
  if (target.analysisGroupGuid) {
    return analysisGroupsByGuid[target.analysisGroupGuid]?.name || target.analysisGroupGuid
  }
  return familiesByGuid[target.familyGuid]?.displayName || target.familyGuid
}

export const getWorkbookTargets = createSelector(
  getWorkbookTargetsByGuid,
  getFamiliesByGuid,
  getAnalysisGroupsByGuid,
  getWorkbookGuid,
  (targetsByGuid, familiesByGuid, analysisGroupsByGuid, workbookGuid): TargetDisplay[] => sortBy(
    Object.values(targetsByGuid).filter(target => target.workbookGuid === workbookGuid), 'order',
  ).map(target => ({
    ...target,
    name: getTargetName(target, familiesByGuid, analysisGroupsByGuid),
    isGroup: !!target.analysisGroupGuid,
  })),
)

export const getWorkbookWorksheets = createSelector(
  getWorksheetsByGuid,
  getWorksheetQueriesByGuid,
  getWorkbookGuid,
  (worksheetsByGuid, queriesByGuid, workbookGuid): WorksheetDisplay[] => {
    const queries = sortBy(Object.values(queriesByGuid), 'order')
    return sortBy(
      Object.values(worksheetsByGuid).filter(worksheet => worksheet.workbookGuid === workbookGuid), 'order',
    ).map(worksheet => ({
      ...worksheet,
      queries: queries.filter(query => query.worksheetGuid === worksheet.worksheetGuid),
    }))
  },
)

export const getQueryResultsByQueryTarget = createSelector(
  getWorksheetQueryResultsByGuid,
  (resultsByGuid): ByGuid<ByGuid<WorksheetQueryResult>> => Object.values(resultsByGuid).reduce(
    (acc, result) => ({
      ...acc,
      [result.worksheetQueryGuid]: { ...acc[result.worksheetQueryGuid], [result.workbookTargetGuid]: result },
    }), {} as ByGuid<ByGuid<WorksheetQueryResult>>,
  ),
)

export const getQueryStatus = (
  resultsByQueryTarget: ByGuid<ByGuid<WorksheetQueryResult>>, worksheetQueryGuid: string, workbookTargetGuid?: string,
): WorkbookStatus => resultsByQueryTarget[worksheetQueryGuid]?.[workbookTargetGuid]?.status || STATUS_NOT_REVIEWED

// Findings in any query win, otherwise a worksheet is in progress until every query has been reviewed
export const getRollUpStatus = (statuses: WorkbookStatus[]): WorkbookStatus => {
  if (statuses.includes(STATUS_FINDINGS)) {
    return STATUS_FINDINGS
  }
  if (statuses.length && statuses.every(status => status === STATUS_NOTHING_FOUND)) {
    return STATUS_NOTHING_FOUND
  }
  return statuses.some(status => status !== STATUS_NOT_REVIEWED) ? STATUS_IN_PROGRESS : STATUS_NOT_REVIEWED
}

export interface WorkbookSelection {
  target?: TargetDisplay
  query?: WorksheetQuery
}

export const getWorkbookSelection = (
  targets: TargetDisplay[], worksheets: WorksheetDisplay[], targetGuid?: string, queryGuid?: string,
): WorkbookSelection => {
  const queries = worksheets.reduce((acc, worksheet) => [...acc, ...worksheet.queries], [] as WorksheetQuery[])
  return {
    target: targets.find(target => target.workbookTargetGuid === targetGuid) || targets[0],
    query: queries.find(query => query.worksheetQueryGuid === queryGuid) || queries[0],
  }
}

export const getWorkbookPath = (workbook: Workbook, workbookTargetGuid?: string, worksheetQueryGuid?: string) => {
  const path = `/project/${workbook.projectGuid}/workbook/${workbook.workbookGuid}`
  if (!workbookTargetGuid) {
    return path
  }
  return worksheetQueryGuid ? `${path}/${workbookTargetGuid}/${worksheetQueryGuid}` : `${path}/${workbookTargetGuid}`
}

export interface TargetTabs {
  visible: TargetDisplay[]
  overflow: TargetDisplay[]
}

// The selected target always stays visible, taking the last tab when it would otherwise overflow
export const splitTargetTabs = (
  targets: TargetDisplay[], selectedGuid: string | undefined, max: number,
): TargetTabs => {
  if (targets.length <= max) {
    return { visible: targets, overflow: [] }
  }
  const selected = targets.slice(max).find(target => target.workbookTargetGuid === selectedGuid)
  const visible = selected ? [...targets.slice(0, max - 1), selected] : targets.slice(0, max)
  return { visible, overflow: targets.filter(target => !visible.includes(target)) }
}

export const getNumUnreviewed = (
  resultsByQueryTarget: ByGuid<ByGuid<WorksheetQueryResult>>, queries: WorksheetQuery[], workbookTargetGuid?: string,
): number => queries.reduce(
  (total, query) => total + (resultsByQueryTarget[query.worksheetQueryGuid]?.[workbookTargetGuid]?.numUnreviewed || 0), 0,
)

export const getNumUnreviewedByTarget = createSelector(
  getWorksheetQueryResultsByGuid,
  (resultsByGuid): ByGuid<number> => Object.values(resultsByGuid).reduce((acc, result) => ({
    ...acc, [result.workbookTargetGuid]: (acc[result.workbookTargetGuid] || 0) + (result.numUnreviewed || 0),
  }), {} as ByGuid<number>),
)

export const NO_EXCLUDED_REASON = 'No reason given'

const getFamilyVariantKey = (familyGuid: string, variantId: string) => `${familyGuid}/${variantId}`

// Like "Hide Excluded" for saved variants: a variant is excluded for a family when it has a tag named Excluded
export const getExcludedReasonsByFamilyVariant = createSelector(
  (state: WorkbookReduxState) => state.savedVariantsByGuid,
  (state: WorkbookReduxState) => state.variantTagsByGuid,
  (savedVariantsByGuid, tagsByGuid): ByGuid<string> => Object.values(savedVariantsByGuid).reduce((acc, variant) => {
    const excludedTags = variant.tagGuids.map(tagGuid => tagsByGuid[tagGuid]).filter(
      tag => tag?.name === EXCLUDED_TAG_NAME,
    )
    if (!excludedTags.length) {
      return acc
    }
    const reason = excludedTags.map(tag => tag.metadata).find(metadata => metadata) || NO_EXCLUDED_REASON
    return variant.familyGuids.reduce(
      (familyAcc, familyGuid) => ({ ...familyAcc, [getFamilyVariantKey(familyGuid, variant.variantId)]: reason }), acc,
    )
  }, {} as ByGuid<string>),
)

export interface ExcludedGroup {
  reason: string
  variants: DisplayVariant[]
}

export interface SplitVariants {
  included: DisplayVariant[]
  excludedGroups: ExcludedGroup[]
  numExcluded: number
}

// A compound heterozygous pair is excluded when either of its variants is
export const splitExcludedVariants = (
  displayVariants: DisplayVariant[], excludedReasons: ByGuid<string>,
): SplitVariants => {
  const included: DisplayVariant[] = []
  const excludedByReason: ByGuid<DisplayVariant[]> = {}
  displayVariants.forEach((displayVariant) => {
    const variants = Array.isArray(displayVariant) ? displayVariant : [displayVariant]
    const reason = variants.reduce((acc, { variantId, familyGuids = [] }) => acc || familyGuids.map(
      familyGuid => excludedReasons[getFamilyVariantKey(familyGuid, variantId)],
    ).find(familyReason => familyReason), undefined as string | undefined)
    if (reason) {
      excludedByReason[reason] = [...(excludedByReason[reason] || []), displayVariant]
    } else {
      included.push(displayVariant)
    }
  })
  return {
    included,
    excludedGroups: sortBy(
      Object.entries(excludedByReason).map(([reason, variants]) => ({ reason, variants })), 'reason',
    ),
    numExcluded: displayVariants.length - included.length,
  }
}

// A worksheet without its own interval uses the interval of its workbook, without either its queries are not rerun
export const getEffectiveRerunIntervalDays = (workbook: Workbook, worksheet?: Worksheet): number | null => (
  worksheet?.rerunIntervalDays || workbook.rerunIntervalDays || null
)

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

// Only cells that were run are rerun
export const getNextRerunDate = (
  workbook: Workbook, worksheet?: Worksheet, queryResult?: WorksheetQueryResult,
): Date | null => {
  const intervalDays = getEffectiveRerunIntervalDays(workbook, worksheet)
  if (!intervalDays || !queryResult?.lastRunDate) {
    return null
  }
  return new Date(new Date(queryResult.lastRunDate).getTime() + (intervalDays * DAY_MILLISECONDS))
}

const getWorksheetTemplatesByGuid = (state: WorkbookReduxState) => state.worksheetTemplatesByGuid
export const getWorksheetTemplatesIsLoading = (state: WorkbookReduxState) => state.worksheetTemplatesLoading.isLoading
export const getWorksheetTemplatesLoadingError = (state: WorkbookReduxState) => (
  state.worksheetTemplatesLoading.errorMessage
)

export const getWorksheetTemplates = createSelector(
  getWorksheetTemplatesByGuid,
  (templatesByGuid): WorksheetTemplate[] => sortBy(Object.values(templatesByGuid), 'name'),
)

export const isTemplateInProject = (template: WorksheetTemplate, projectGuid: string | null): boolean => (
  template.projectGuids.includes(projectGuid)
)

// Every template is in at most one group. Templates of other projects are only listed where templates are managed
export const getTemplateGroups = createSelector(
  getWorksheetTemplates,
  getCurrentProjectGuid,
  (templates, projectGuid): TemplateGroup[] => {
    const isMine = (template: WorksheetTemplate) => !template.isPublic && template.isCreator
    return [
      { title: 'Default templates', templates: templates.filter(template => template.isPublic) },
      { title: 'My templates', templates: templates.filter(isMine) },
      {
        title: 'Project templates',
        templates: templates.filter(
          template => !template.isPublic && !template.isCreator && isTemplateInProject(template, projectGuid),
        ),
      },
    ].filter(group => group.templates.length > 0)
  },
)

export const getCanSetTemplatePublic = (state: WorkbookReduxState): boolean => (
  !!(state.user.isAnalyst || state.user.isDataManager)
)

const getCurrentProject = (state: WorkbookReduxState) => state.projectsByGuid[state.currentProjectGuid]

export const getCanEditCurrentProject = (state: WorkbookReduxState): boolean => !!getCurrentProject(state)?.canEdit

export const getCollaboratorsIsLoading = (state: WorkbookReduxState) => (
  !!state.projectCollaboratorsLoading.isLoading
)

export const getEditorName = ({ displayName, email }: { displayName?: string, email?: string }): string => (
  displayName || email
)

// The creator of a workbook can always edit it, so is not offered as an editor
export const getEditorOptions = createSelector(
  getCurrentProject,
  (state: WorkbookReduxState, workbook: Workbook) => workbook,
  (project, workbook): Option[] => sortBy([
    ...(project?.collaborators || []).filter(collaborator => getEditorName(collaborator) !== workbook.createdBy),
    ...(workbook.editors || []),
  ].map(editor => ({ value: editor.username, text: getEditorName(editor) })).filter(
    ({ value }, i, options) => options.findIndex(option => option.value === value) === i,
  ), 'text'),
)
