import React, { useMemo } from 'react'
import { connect } from 'react-redux'

import { BooleanCheckbox, Multiselect, Select } from '../../../shared/components/form/Inputs'
import { ButtonLink } from '../../../shared/components/StyledComponents'
import { NO_RERUN_INTERVAL, WORKBOOK_RERUN_INTERVAL_OPTIONS, WORKSHEET_RERUN_INTERVAL_OPTIONS } from './constants'
import {
  addWorkbookTargets, createWorkbook, deleteWorkbookTarget, duplicateWorkbook, updateWorkbook, updateWorkbookAutomation,
  updateWorksheet, updateWorksheetAutomation, updateWorksheetQuery,
} from './reducers'
import { getProjectAnalysisGroupOptions, getProjectFamilyOptions, getSavedSearchOptions } from './selectors'
import { DeleteButton, FormField, UpdateButton } from './sharedComponents'
import { Option, TargetDisplay, Workbook, WorkbookReduxState, Worksheet, WorksheetQuery } from './types'

const validateName = (value?: string) => (value && value.trim() ? undefined : 'Name is required')
const formatList = (value?: string[]) => value || []

const NAME_FIELD: FormField = { name: 'name', label: 'Name', validate: validateName }
const NAME_FIELDS = [NAME_FIELD]
const WORKBOOK_FIELDS: FormField[] = [NAME_FIELD, { name: 'description', label: 'Description' }]

interface TargetOptionProps {
  familyOptions: Option[]
  analysisGroupOptions: Option[]
}

const targetFields = ({ familyOptions, analysisGroupOptions }: TargetOptionProps): FormField[] => [
  { name: 'familyGuids', label: 'Families', options: familyOptions },
  { name: 'analysisGroupGuids', label: 'Analysis Groups', options: analysisGroupOptions },
].map(field => ({ ...field, component: Multiselect, color: 'blue', format: formatList }))

const mapTargetOptionsStateToProps = (state: WorkbookReduxState): TargetOptionProps => ({
  familyOptions: getProjectFamilyOptions(state),
  analysisGroupOptions: getProjectAnalysisGroupOptions(state),
})

interface IconTriggerProps {
  icon: string
  label: string
  onClick?: () => void
}

const IconTrigger = ({ icon, label, onClick }: IconTriggerProps) => (
  <ButtonLink icon={icon} size="small" aria-label={label} title={label} onClick={onClick} />
)

interface SubmitProps<V> {
  onSubmit: (values: V) => Promise<void>
}

interface WorkbookProps {
  workbook: Workbook
}

const useTargetFields = (
  fields: FormField[], { familyOptions, analysisGroupOptions }: TargetOptionProps,
): FormField[] => useMemo(
  () => [...fields, ...targetFields({ familyOptions, analysisGroupOptions })],
  [fields, familyOptions, analysisGroupOptions],
)

const BaseCreateWorkbookButton = React.memo(({ onSubmit, ...options }: TargetOptionProps & SubmitProps<object>) => (
  <UpdateButton
    modalId="createWorkbook"
    modalTitle="Create Workbook"
    buttonText="Create Workbook"
    editIconName="plus"
    formFields={useTargetFields(WORKBOOK_FIELDS, options)}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const CreateWorkbookButton = connect(
  mapTargetOptionsStateToProps, { onSubmit: createWorkbook },
)(BaseCreateWorkbookButton)

const BaseEditWorkbookButton = React.memo(({ workbook, onSubmit }: WorkbookProps & SubmitProps<Workbook>) => (
  <UpdateButton
    modalId={`editWorkbook-${workbook.workbookGuid}`}
    modalTitle={`Edit ${workbook.name}`}
    trigger={<IconTrigger icon="write" label={`Edit workbook ${workbook.name}`} />}
    formFields={WORKBOOK_FIELDS}
    initialValues={workbook}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const EditWorkbookButton = connect(null, { onSubmit: updateWorkbook })(BaseEditWorkbookButton)

const BaseDuplicateWorkbookButton = React.memo((
  { workbook, onSubmit, ...options }: WorkbookProps & TargetOptionProps & SubmitProps<object>,
) => (
  <UpdateButton
    modalId={`duplicateWorkbook-${workbook.workbookGuid}`}
    modalTitle={`Duplicate ${workbook.name} for other families`}
    trigger={<IconTrigger icon="copy outline" label={`Duplicate workbook ${workbook.name} for other families`} />}
    formFields={useTargetFields(NAME_FIELDS, options)}
    initialValues={useMemo(() => ({ workbookGuid: workbook.workbookGuid, name: `${workbook.name} (copy)` }), [workbook])}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const DuplicateWorkbookButton = connect(
  mapTargetOptionsStateToProps, { onSubmit: duplicateWorkbook },
)(BaseDuplicateWorkbookButton)

interface DeleteProps {
  onSubmit: () => Promise<void>
}

const BaseDeleteWorkbookButton = React.memo(({ workbook, onSubmit }: WorkbookProps & DeleteProps) => (
  <DeleteButton
    onSubmit={onSubmit}
    confirmDialog={`Are you sure you want to delete the workbook "${workbook.name}"? Its worksheets, queries, statuses and notes will be deleted.`}
    aria-label={`Delete workbook ${workbook.name}`}
    title={`Delete workbook ${workbook.name}`}
  />
))

export const DeleteWorkbookButton = connect(null, (dispatch, { workbook }: WorkbookProps) => ({
  onSubmit: () => dispatch(updateWorkbook({ workbookGuid: workbook.workbookGuid, delete: true })),
}))(BaseDeleteWorkbookButton)

interface TargetsProps extends WorkbookProps {
  targets: TargetDisplay[]
}

const NO_FIELDS: FormField[] = []

const BaseAddTargetsButton = React.memo((
  { workbook, targets, onSubmit, familyOptions, analysisGroupOptions }: TargetsProps & TargetOptionProps &
  SubmitProps<object>,
) => {
  const availableOptions = useMemo(() => {
    const isAvailable = ({ value }: Option) => !targets.some(
      ({ familyGuid, analysisGroupGuid }) => value === familyGuid || value === analysisGroupGuid,
    )
    return {
      familyOptions: familyOptions.filter(isAvailable),
      analysisGroupOptions: analysisGroupOptions.filter(isAvailable),
    }
  }, [targets, familyOptions, analysisGroupOptions])
  return (
    <UpdateButton
      modalId={`addWorkbookTargets-${workbook.workbookGuid}`}
      modalTitle={`Add families or analysis groups to ${workbook.name}`}
      trigger={<IconTrigger icon="plus" label="Add families or analysis groups" />}
      formFields={useTargetFields(NO_FIELDS, availableOptions)}
      onSubmit={onSubmit}
      showErrorPanel
    />
  )
})

export const AddTargetsButton = connect(mapTargetOptionsStateToProps, (dispatch, { workbook }: TargetsProps) => ({
  onSubmit: (values: object) => dispatch(addWorkbookTargets(workbook.workbookGuid, values)),
}))(BaseAddTargetsButton)

interface TargetProps extends WorkbookProps {
  target: TargetDisplay
}

const BaseRemoveTargetButton = React.memo(({ target, onSubmit }: TargetProps & DeleteProps) => (
  <DeleteButton
    onSubmit={onSubmit}
    confirmDialog={`Are you sure you want to remove "${target.name}" from this workbook? Its statuses and notes will be deleted.`}
    size="mini"
    aria-label={`Remove ${target.name}`}
    title={`Remove ${target.name}`}
  />
))

export const RemoveTargetButton = connect(null, (dispatch, { workbook, target }: TargetProps) => ({
  onSubmit: () => dispatch(deleteWorkbookTarget(workbook.workbookGuid, target.workbookTargetGuid)),
}))(BaseRemoveTargetButton)

interface WorksheetProps extends WorkbookProps {
  worksheet?: Worksheet
}

const BaseUpdateWorksheetButton = React.memo((
  { workbook, worksheet, onSubmit }: WorksheetProps & SubmitProps<object>,
) => (
  <UpdateButton
    modalId={worksheet ? `editWorksheet-${worksheet.worksheetGuid}` : `createWorksheet-${workbook.workbookGuid}`}
    modalTitle={worksheet ? `Rename ${worksheet.name}` : 'Add Worksheet'}
    buttonText={worksheet ? undefined : 'Add Worksheet'}
    editIconName={worksheet ? undefined : 'plus'}
    trigger={worksheet ? <IconTrigger icon="write" label={`Rename worksheet ${worksheet.name}`} /> : undefined}
    formFields={NAME_FIELDS}
    initialValues={worksheet}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const UpdateWorksheetButton = connect(null, (dispatch, { workbook }: WorksheetProps) => ({
  onSubmit: (values: object) => dispatch(updateWorksheet(workbook.workbookGuid, values)),
}))(BaseUpdateWorksheetButton)

interface ExistingWorksheetProps extends WorkbookProps {
  worksheet: Worksheet
}

const BaseDeleteWorksheetButton = React.memo(({ worksheet, onSubmit }: ExistingWorksheetProps & DeleteProps) => (
  <DeleteButton
    onSubmit={onSubmit}
    confirmDialog={`Are you sure you want to delete the worksheet "${worksheet.name}"? Its queries, statuses and notes will be deleted.`}
    aria-label={`Delete worksheet ${worksheet.name}`}
    title={`Delete worksheet ${worksheet.name}`}
  />
))

export const DeleteWorksheetButton = connect(null, (dispatch, { workbook, worksheet }: ExistingWorksheetProps) => ({
  onSubmit: () => dispatch(updateWorksheet(workbook.workbookGuid, { ...worksheet, delete: true })),
}))(BaseDeleteWorksheetButton)

const RERUN_INTERVAL_FIELD = { name: 'rerunIntervalDays', label: 'Rerun queries that were run', component: Select }
const WORKBOOK_AUTOMATION_FIELDS: FormField[] = [
  { ...RERUN_INTERVAL_FIELD, options: WORKBOOK_RERUN_INTERVAL_OPTIONS },
  {
    name: 'notifyOnNewResults',
    label: 'Send a project notification and email the creator of this workbook when a rerun has new results to review',
    component: BooleanCheckbox,
  },
]
const WORKSHEET_AUTOMATION_FIELDS: FormField[] = [
  { ...RERUN_INTERVAL_FIELD, options: WORKSHEET_RERUN_INTERVAL_OPTIONS },
]

const BaseWorkbookAutomationButton = React.memo(({ workbook, onSubmit }: WorkbookProps & SubmitProps<object>) => (
  <UpdateButton
    modalId={`workbookAutomation-${workbook.workbookGuid}`}
    modalTitle={`Automatic reruns of ${workbook.name}`}
    trigger={<IconTrigger icon="clock outline" label={`Automatic reruns of workbook ${workbook.name}`} />}
    formFields={WORKBOOK_AUTOMATION_FIELDS}
    initialValues={useMemo(() => ({
      rerunIntervalDays: workbook.rerunIntervalDays || NO_RERUN_INTERVAL,
      notifyOnNewResults: !!workbook.notifyOnNewResults,
    }), [workbook])}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const WorkbookAutomationButton = connect(null, (dispatch, { workbook }: WorkbookProps) => ({
  onSubmit: (values: object) => dispatch(updateWorkbookAutomation(workbook.workbookGuid, values)),
}))(BaseWorkbookAutomationButton)

const BaseWorksheetAutomationButton = React.memo((
  { worksheet, onSubmit }: ExistingWorksheetProps & SubmitProps<object>,
) => (
  <UpdateButton
    modalId={`worksheetAutomation-${worksheet.worksheetGuid}`}
    modalTitle={`Automatic reruns of ${worksheet.name}`}
    trigger={<IconTrigger icon="clock outline" label={`Automatic reruns of worksheet ${worksheet.name}`} />}
    formFields={WORKSHEET_AUTOMATION_FIELDS}
    initialValues={useMemo(
      () => ({ rerunIntervalDays: worksheet.rerunIntervalDays || NO_RERUN_INTERVAL }), [worksheet],
    )}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const WorksheetAutomationButton = connect(null, (dispatch, { workbook, worksheet }: ExistingWorksheetProps) => ({
  onSubmit: (values: object) => dispatch(
    updateWorksheetAutomation(workbook.workbookGuid, worksheet.worksheetGuid, values),
  ),
}))(BaseWorksheetAutomationButton)

const validateSavedSearch = (value?: string) => (value ? undefined : 'A saved search is required')

interface AddQueryProps extends ExistingWorksheetProps, SubmitProps<object> {
  savedSearchOptions: Option[]
}

const BaseAddQueryButton = React.memo(({ worksheet, savedSearchOptions, onSubmit }: AddQueryProps) => (
  <UpdateButton
    modalId={`addWorksheetQuery-${worksheet.worksheetGuid}`}
    modalTitle={`Add a query to ${worksheet.name}`}
    trigger={<IconTrigger icon="plus" label={`Add a query to worksheet ${worksheet.name}`} />}
    formFields={useMemo(() => [
      {
        name: 'savedSearchGuid',
        label: 'Saved Search',
        component: Select,
        options: savedSearchOptions,
        validate: validateSavedSearch,
      },
      { name: 'name', label: 'Name (defaults to the name of the saved search)' },
    ], [savedSearchOptions])}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const AddQueryButton = connect(
  (state: WorkbookReduxState) => ({ savedSearchOptions: getSavedSearchOptions(state) }),
  (dispatch, { workbook, worksheet }: ExistingWorksheetProps) => ({
    onSubmit: (values: object) => dispatch(
      updateWorksheetQuery(workbook.workbookGuid, { ...values, worksheetGuid: worksheet.worksheetGuid }),
    ),
  }),
)(BaseAddQueryButton)

interface QueryProps extends WorkbookProps {
  query: WorksheetQuery
}

const BaseRenameQueryButton = React.memo(({ query, onSubmit }: QueryProps & SubmitProps<object>) => (
  <UpdateButton
    modalId={`editWorksheetQuery-${query.worksheetQueryGuid}`}
    modalTitle={`Rename ${query.name}`}
    trigger={<IconTrigger icon="write" label={`Rename query ${query.name}`} />}
    formFields={NAME_FIELDS}
    initialValues={query}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const RenameQueryButton = connect(null, (dispatch, { workbook }: QueryProps) => ({
  onSubmit: (values: object) => dispatch(updateWorksheetQuery(workbook.workbookGuid, values)),
}))(BaseRenameQueryButton)

const BaseDeleteQueryButton = React.memo(({ query, onSubmit }: QueryProps & DeleteProps) => (
  <DeleteButton
    onSubmit={onSubmit}
    confirmDialog={`Are you sure you want to delete the query "${query.name}"? Its statuses and notes will be deleted.`}
    aria-label={`Delete query ${query.name}`}
    title={`Delete query ${query.name}`}
  />
))

export const DeleteQueryButton = connect(null, (dispatch, { workbook, query }: QueryProps) => ({
  onSubmit: () => dispatch(updateWorksheetQuery(workbook.workbookGuid, { ...query, delete: true })),
}))(BaseDeleteQueryButton)
