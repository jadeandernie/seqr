import React, { useMemo } from 'react'
import { connect } from 'react-redux'
import { Header, Message, Radio, Table } from 'semantic-ui-react'
import styled from 'styled-components'

import DataLoader from '../../../shared/components/DataLoader'
import { BooleanCheckbox } from '../../../shared/components/form/Inputs'
import {
  createWorksheetFromTemplate, loadWorksheetTemplates, saveWorksheetAsTemplate, setWorksheetTemplateAttached,
  updateWorksheetTemplate,
} from './reducers'
import {
  getCanEditCurrentProject, getCanSetTemplatePublic, getTemplateGroups, getWorksheetTemplates,
  getWorksheetTemplatesIsLoading, getWorksheetTemplatesLoadingError, isTemplateInProject,
} from './selectors'
import { DeleteButton, DispatchRequestButton, FormField, UpdateButton } from './sharedComponents'
import { TemplateGroup, Workbook, WorkbookReduxState, Worksheet, WorksheetTemplate } from './types'
import { IconTrigger, NAME_FIELD } from './WorkbookButtons'

export const TEMPLATE_COPY_NOTE = 'A worksheet created from a template is a copy of its queries: editing or deleting the template later does not change the worksheet or its review history.'

const TemplateOption = styled.div`
  margin: 0 0 0.8em 0.5em;
`

const Detail = styled.div`
  color: gray;
  margin-left: 1.9em;
`

const getQueryNames = ({ queries }: WorksheetTemplate) => queries.map(({ name }) => name).join(', ')

interface LoaderProps {
  loading: boolean
  errorMessage?: string | null
  load: () => void
  children?: React.ReactNode
}

const BaseTemplatesLoader = React.memo(({ loading, errorMessage, load, children }: LoaderProps) => (
  <DataLoader
    load={load}
    loading={loading}
    content
    errorMessage={errorMessage && <Message error content={errorMessage} />}
  >
    {children}
  </DataLoader>
))

const TemplatesLoader = connect((state: WorkbookReduxState) => ({
  loading: getWorksheetTemplatesIsLoading(state),
  errorMessage: getWorksheetTemplatesLoadingError(state),
}), { load: loadWorksheetTemplates })(BaseTemplatesLoader)

interface TemplatePickerProps {
  label: string
  value?: string
  onChange: (value: string) => void
  groups: TemplateGroup[]
}

const TemplatePicker = React.memo(({ label, value, onChange, groups }: TemplatePickerProps) => (
  <div>
    <p>{label}</p>
    {groups.map(({ title, templates }) => (
      <div key={title} role="radiogroup" aria-label={title}>
        <Header size="tiny" content={title} />
        {templates.map(template => (
          <TemplateOption key={template.worksheetTemplateGuid}>
            <Radio
              name="worksheetTemplateGuid"
              label={template.name}
              value={template.worksheetTemplateGuid}
              checked={value === template.worksheetTemplateGuid}
              onChange={() => onChange(template.worksheetTemplateGuid)}
            />
            <Detail>{template.description}</Detail>
            <Detail>{`Queries: ${getQueryNames(template)}`}</Detail>
          </TemplateOption>
        ))}
      </div>
    ))}
    {groups.length === 0 && <Message content="No worksheet templates are available" />}
  </div>
))

const validateTemplate = (value?: string) => (value ? undefined : 'A template is required')

interface SubmitProps {
  onSubmit: (values: object) => Promise<void>
}

interface WorkbookProps {
  workbook: Workbook
}

const TEMPLATES_LOADER = <TemplatesLoader />

const BaseNewWorksheetFromTemplateButton = React.memo((
  { workbook, groups, onSubmit }: WorkbookProps & SubmitProps & { groups: TemplateGroup[] },
) => (
  <UpdateButton
    modalId={`createWorksheetFromTemplate-${workbook.workbookGuid}`}
    modalTitle="New Worksheet from Template"
    buttonText="New Worksheet from Template"
    editIconName="copy outline"
    formFields={useMemo(() => [
      { name: 'worksheetTemplateGuid', label: TEMPLATE_COPY_NOTE, component: TemplatePicker, groups, validate: validateTemplate },
      { name: 'name', label: 'Worksheet name (defaults to the name of the template)' },
    ], [groups])}
    formContainer={TEMPLATES_LOADER}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const NewWorksheetFromTemplateButton = connect(
  (state: WorkbookReduxState) => ({ groups: getTemplateGroups(state) }),
  (dispatch, { workbook }: WorkbookProps) => ({
    onSubmit: (values: object) => dispatch(createWorksheetFromTemplate(workbook.workbookGuid, values)),
  }),
)(BaseNewWorksheetFromTemplateButton)

const DESCRIPTION_FIELD: FormField = { name: 'description', label: 'Description' }
const PUBLIC_FIELD: FormField = {
  name: 'isPublic', label: 'Public: a default template for all seqr users', component: BooleanCheckbox,
}
const TEMPLATE_FIELDS = [NAME_FIELD, DESCRIPTION_FIELD]
const PUBLIC_TEMPLATE_FIELDS = [...TEMPLATE_FIELDS, PUBLIC_FIELD]

const getTemplateFields = (canSetPublic: boolean) => (canSetPublic ? PUBLIC_TEMPLATE_FIELDS : TEMPLATE_FIELDS)

interface PublicProps {
  canSetPublic: boolean
}

const mapPublicStateToProps = (state: WorkbookReduxState): PublicProps => ({
  canSetPublic: getCanSetTemplatePublic(state),
})

interface WorksheetProps extends WorkbookProps {
  worksheet: Worksheet
}

const BaseSaveAsTemplateButton = React.memo((
  { worksheet, canSetPublic, onSubmit }: WorksheetProps & PublicProps & SubmitProps,
) => (
  <UpdateButton
    modalId={`saveWorksheetAsTemplate-${worksheet.worksheetGuid}`}
    modalTitle={`Save ${worksheet.name} as a template`}
    trigger={<IconTrigger icon="save outline" label={`Save worksheet ${worksheet.name} as a template`} />}
    formFields={getTemplateFields(canSetPublic)}
    initialValues={useMemo(() => ({ name: worksheet.name }), [worksheet])}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

export const SaveAsTemplateButton = connect(
  mapPublicStateToProps,
  (dispatch, { workbook, worksheet }: WorksheetProps) => ({
    onSubmit: (values: object) => dispatch(
      saveWorksheetAsTemplate(workbook.workbookGuid, worksheet.worksheetGuid, values),
    ),
  }),
)(BaseSaveAsTemplateButton)

interface TemplateProps {
  template: WorksheetTemplate
}

const BaseEditTemplateButton = React.memo(({ template, canSetPublic, onSubmit }: TemplateProps & PublicProps & SubmitProps) => (
  <UpdateButton
    modalId={`editWorksheetTemplate-${template.worksheetTemplateGuid}`}
    modalTitle={`Edit template ${template.name}`}
    trigger={<IconTrigger icon="write" label={`Edit template ${template.name}`} />}
    formFields={getTemplateFields(canSetPublic)}
    initialValues={template}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

const EditTemplateButton = connect(mapPublicStateToProps, { onSubmit: updateWorksheetTemplate })(BaseEditTemplateButton)

interface RequestProps {
  onSubmit: () => Promise<void>
}

const BaseDeleteTemplateButton = React.memo(({ template, onSubmit }: TemplateProps & RequestProps) => (
  <DeleteButton
    onSubmit={onSubmit}
    confirmDialog={`Are you sure you want to delete the template "${template.name}"? Worksheets that were created from it are not changed.`}
    aria-label={`Delete template ${template.name}`}
    title={`Delete template ${template.name}`}
  />
))

const DeleteTemplateButton = connect(null, (dispatch, { template }: TemplateProps) => ({
  onSubmit: () => dispatch(updateWorksheetTemplate({ ...template, delete: true })),
}))(BaseDeleteTemplateButton)

interface AttachProps extends TemplateProps {
  isAttached: boolean
}

const BaseAttachTemplateButton = React.memo(({ isAttached, onSubmit }: AttachProps & RequestProps) => (
  <DispatchRequestButton
    onSubmit={onSubmit}
    buttonContent={isAttached ? 'Remove from this project' : 'Add to this project'}
  />
))

const AttachTemplateButton = connect(null, (dispatch, { template, isAttached }: AttachProps) => ({
  onSubmit: () => dispatch(setWorksheetTemplateAttached(template.worksheetTemplateGuid, !isAttached)),
}))(BaseAttachTemplateButton)

interface TemplateManagerProps {
  templates: WorksheetTemplate[]
  projectGuid: string | null
  canEditProject: boolean
}

const BaseTemplateManager = React.memo(({ templates, projectGuid, canEditProject }: TemplateManagerProps) => (
  <section aria-label="Worksheet templates">
    <Header size="medium" content="Worksheet Templates" subheader={TEMPLATE_COPY_NOTE} />
    <TemplatesLoader>
      {templates.length ? (
        <Table basic="very" aria-label="Worksheet templates">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell content="Name" />
              <Table.HeaderCell content="Description" />
              <Table.HeaderCell content="Queries" />
              <Table.HeaderCell content="Created By" />
              <Table.HeaderCell content="Shared With" />
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {templates.map((template) => {
              const isAttached = isTemplateInProject(template, projectGuid)
              return (
                <Table.Row key={template.worksheetTemplateGuid}>
                  <Table.Cell>{template.name}</Table.Cell>
                  <Table.Cell>{template.description}</Table.Cell>
                  <Table.Cell>{getQueryNames(template)}</Table.Cell>
                  <Table.Cell>{template.createdBy || 'seqr'}</Table.Cell>
                  <Table.Cell>
                    {[
                      template.isPublic ? 'All users (public)' : 'Only its creator',
                      isAttached && 'this project',
                    ].filter(text => text).join(' and ')}
                  </Table.Cell>
                  <Table.Cell textAlign="right">
                    {canEditProject && <AttachTemplateButton template={template} isAttached={isAttached} />}
                    {template.canEdit && <EditTemplateButton template={template} />}
                    {template.canEdit && <DeleteTemplateButton template={template} />}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      ) : <Message content="No worksheet templates are available. Save a worksheet of a workbook as a template to create one" />}
    </TemplatesLoader>
  </section>
))

export const TemplateManager = connect((state: WorkbookReduxState) => ({
  templates: getWorksheetTemplates(state),
  projectGuid: state.currentProjectGuid,
  canEditProject: getCanEditCurrentProject(state),
}))(BaseTemplateManager)
