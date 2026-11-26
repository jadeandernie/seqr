import React from 'react'
import { connect } from 'react-redux'
import { Button, Form, Grid, Header, Icon, Message, Modal, Table } from 'semantic-ui-react'

import { ButtonLink } from '../../../../shared/components/StyledComponents'
import { getCurrentProject, getProjectFamiliesByGuid } from '../../selectors'
import ReportPreview from './ReportPreview'
import {
  RenderedReport, ReportTemplate, TemplatesResponse, TemplateValues, deleteTemplate, getErrors, getTemplates,
  loadTemplates, previewReport, saveTemplate,
} from './reportTemplateApi'

export const PREVIEW_DELAY = 500

type Family = { familyGuid: string, displayName: string }

type Draft = TemplateValues & { reportTemplateGuid: string | null, isGlobal: boolean }

type EditorProps = {
  draft: Draft
  templatesResponse: TemplatesResponse
  families: Family[]
  saveErrors: string[]
  onChange: (updates: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
}

const TemplateEditor = ({ draft, templatesResponse, families, saveErrors, onChange, onSave, onCancel }: EditorProps) => {
  const [familyGuid, setFamilyGuid] = React.useState<string | null>(families.length > 0 ? families[0].familyGuid : null)
  const [preview, setPreview] = React.useState<RenderedReport | null>(null)
  const [previewErrors, setPreviewErrors] = React.useState<string[]>([])
  const latestRequest = React.useRef(0)

  React.useEffect(() => {
    if (!familyGuid || !draft.body.trim()) {
      latestRequest.current += 1
      setPreview(null)
      setPreviewErrors([])
      return undefined
    }
    const timeout = setTimeout(() => {
      latestRequest.current += 1
      const requestId = latestRequest.current
      const ifLatest = <T, >(update: (value: T) => void) => (value: T) => {
        if (requestId === latestRequest.current) {
          update(value)
        }
      }
      previewReport(familyGuid, draft.body).then(ifLatest((report: RenderedReport) => {
        setPreview(report)
        setPreviewErrors([])
      }), ifLatest((e) => {
        setPreview(null)
        setPreviewErrors(getErrors(e))
      }))
    }, PREVIEW_DELAY)
    return () => clearTimeout(timeout)
  }, [familyGuid, draft.body])

  const onFieldChange = React.useCallback((e, { name, value }) => onChange({ [name]: value }), [onChange])
  const onGlobalChange = React.useCallback((e, { checked }) => onChange({ isGlobal: checked }), [onChange])
  const onFamilyChange = React.useCallback((e, { value }) => setFamilyGuid(value), [])
  const familyOptions = families.map(family => ({ value: family.familyGuid, text: family.displayName }))

  return (
    <Grid>
      <Grid.Row>
        <Grid.Column width={8}>
          <Form>
            <Form.Group widths="equal">
              <Form.Input label="Name" name="name" value={draft.name} onChange={onFieldChange} />
              <Form.Select
                label="Audience"
                name="audience"
                options={templatesResponse.audiences}
                value={draft.audience}
                onChange={onFieldChange}
              />
            </Form.Group>
            <Form.Input label="Description" name="description" value={draft.description || ''} onChange={onFieldChange} />
            {templatesResponse.canEditGlobalTemplates && !draft.reportTemplateGuid && (
              <Form.Checkbox
                label="Global template, available to all projects"
                name="isGlobal"
                checked={draft.isGlobal}
                onChange={onGlobalChange}
              />
            )}
            <Form.TextArea
              label="Template (Markdown with placeholders)"
              name="body"
              rows={18}
              value={draft.body}
              onChange={onFieldChange}
            />
            {saveErrors.length > 0 && <Message error visible header="Unable to save template" list={saveErrors} />}
            <Button type="button" primary onClick={onSave}>Save</Button>
            <Button type="button" onClick={onCancel}>Cancel</Button>
          </Form>
          <Header size="small" content="Placeholder reference" />
          <Table compact="very" size="small" basic="very">
            <Table.Body>
              {templatesResponse.placeholders.map(({ placeholder, description, block }) => (
                <Table.Row key={placeholder}>
                  <Table.Cell><code>{placeholder}</code></Table.Cell>
                  <Table.Cell>{block ? `${description} (inside {{#${block}}})` : description}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <i className="report-template-limits">
            Free text notes are not available to templates. Every report starts and ends with the
            line &quot;
            {templatesResponse.researchUseLine}
            &quot;, which can not be removed.
          </i>
        </Grid.Column>
        <Grid.Column width={8}>
          <Form>
            <Form.Select
              label="Preview with family"
              name="previewFamily"
              search
              options={familyOptions}
              value={familyGuid}
              onChange={onFamilyChange}
            />
          </Form>
          <ReportPreview report={preview} errors={previewErrors} errorHeader="Template is not valid" />
        </Grid.Column>
      </Grid.Row>
    </Grid>
  )
}

type ManagerProps = { projectGuid: string, families: Family[] }

const NEW_DRAFT: Omit<Draft, 'audience'> = {
  reportTemplateGuid: null, isGlobal: false, name: '', description: '', body: '',
}

export const ReportTemplateManager = ({ projectGuid, families }: ManagerProps) => {
  const [templatesResponse, setTemplatesResponse] = React.useState<TemplatesResponse | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])

  React.useEffect(() => {
    loadTemplates(projectGuid).then(setTemplatesResponse, e => setErrors(getErrors(e)))
  }, [projectGuid])

  const updateTemplates = React.useCallback((response: Pick<TemplatesResponse, 'reportTemplatesByGuid'>) => {
    setTemplatesResponse(prev => ({
      ...prev, reportTemplatesByGuid: { ...prev.reportTemplatesByGuid, ...response.reportTemplatesByGuid },
    }))
    setDraft(null)
    setErrors([])
  }, [])
  const onError = React.useCallback(e => setErrors(getErrors(e)), [])

  const onChange = React.useCallback((updates: Partial<Draft>) => setDraft(prev => ({ ...prev, ...updates })), [])
  const onCancel = React.useCallback(() => {
    setDraft(null)
    setErrors([])
  }, [])
  const onSave = React.useCallback(() => {
    const { reportTemplateGuid, isGlobal, ...values } = draft
    saveTemplate(values, reportTemplateGuid, isGlobal ? null : projectGuid).then(updateTemplates, onError)
  }, [draft, projectGuid, updateTemplates, onError])

  if (!templatesResponse) {
    return <ReportPreview errors={errors} loading={errors.length === 0} errorHeader="Unable to load report templates" />
  }

  if (draft) {
    return (
      <TemplateEditor
        draft={draft}
        templatesResponse={templatesResponse}
        families={families}
        saveErrors={errors}
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
  }

  const { canEditProjectTemplates, canEditGlobalTemplates, audiences } = templatesResponse
  const audienceNames = audiences.reduce(
    (acc, { value, text }) => ({ ...acc, [value]: text }), {} as Record<string, string>,
  )
  const canEdit = (template: ReportTemplate) => (template.projectGuid ? canEditProjectTemplates : canEditGlobalTemplates)
  const edit = (template: ReportTemplate) => () => {
    setErrors([])
    setDraft({
      reportTemplateGuid: template.reportTemplateGuid,
      isGlobal: !template.projectGuid,
      name: template.name,
      description: template.description,
      audience: template.audience,
      body: template.body,
    })
  }
  const remove = (template: ReportTemplate) => () => {
    deleteTemplate(template.reportTemplateGuid).then(updateTemplates, onError)
  }
  const create = () => {
    setErrors([])
    setDraft({ ...NEW_DRAFT, audience: audiences[0].value, isGlobal: !canEditProjectTemplates })
  }

  return (
    <div>
      {errors.length > 0 && <Message error header="Unable to update report templates" list={errors} />}
      <Table compact>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell content="Name" />
            <Table.HeaderCell content="Audience" />
            <Table.HeaderCell content="Available to" />
            <Table.HeaderCell content="Description" />
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {getTemplates(templatesResponse.reportTemplatesByGuid).map(template => (
            <Table.Row key={template.reportTemplateGuid}>
              <Table.Cell content={template.name} />
              <Table.Cell content={audienceNames[template.audience]} />
              <Table.Cell content={template.projectGuid ? 'This project' : 'All projects'} />
              <Table.Cell content={template.description} />
              <Table.Cell textAlign="right">
                {canEdit(template) && (
                  <Button.Group size="mini" basic>
                    <Button type="button" name="edit" content="Edit" onClick={edit(template)} />
                    <Button type="button" name="delete" content="Delete" onClick={remove(template)} />
                  </Button.Group>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {(canEditProjectTemplates || canEditGlobalTemplates) && (
        <Button type="button" primary name="create" content="New template" onClick={create} />
      )}
    </div>
  )
}

type ManagerButtonProps = { project: { projectGuid: string }, familiesByGuid: Record<string, Family> }

const BaseReportTemplateManagerButton = ({ project, familiesByGuid }: ManagerButtonProps) => {
  const [open, setOpen] = React.useState(false)
  const onOpen = React.useCallback(() => setOpen(true), [])
  const onClose = React.useCallback(() => setOpen(false), [])
  const families = React.useMemo(
    () => Object.values(familiesByGuid).sort((a, b) => a.displayName.localeCompare(b.displayName)), [familiesByGuid],
  )
  const trigger = (
    <ButtonLink>
      <Icon name="file alternate outline" />
      &nbsp; Manage Report Templates
    </ButtonLink>
  )
  return (
    <Modal trigger={trigger} open={open} onOpen={onOpen} onClose={onClose} size="fullscreen" closeIcon>
      <Modal.Header>Report Templates</Modal.Header>
      <Modal.Content>
        <ReportTemplateManager projectGuid={project.projectGuid} families={families} />
      </Modal.Content>
    </Modal>
  )
}

const mapStateToProps = (state: unknown) => ({
  project: getCurrentProject(state),
  familiesByGuid: getProjectFamiliesByGuid(state),
})

export default connect(mapStateToProps)(BaseReportTemplateManagerButton)
