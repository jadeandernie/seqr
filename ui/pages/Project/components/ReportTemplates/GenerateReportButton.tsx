import React from 'react'
import { connect } from 'react-redux'
import { Button, Form, Icon, Modal } from 'semantic-ui-react'

import { ButtonLink } from '../../../../shared/components/StyledComponents'
import { getCurrentProject } from '../../selectors'
import ReportPreview from './ReportPreview'
import {
  RenderedReport, TemplatesResponse, downloadMarkdown, generateReport, getErrors, getReportFileName, getTemplates,
  loadTemplates,
} from './reportTemplateApi'

type Family = { familyGuid: string, displayName: string }

type GenerateReportProps = { family: Family, projectGuid: string }

const print = () => window.print()

export const GenerateReport = ({ family, projectGuid }: GenerateReportProps) => {
  const [templatesResponse, setTemplatesResponse] = React.useState<TemplatesResponse | null>(null)
  const [audience, setAudience] = React.useState<string | null>(null)
  const [templateGuid, setTemplateGuid] = React.useState<string | null>(null)
  const [report, setReport] = React.useState<RenderedReport | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    loadTemplates(projectGuid).then((response) => {
      const firstAudience = response.audiences.find(
        ({ value }) => getTemplates(response.reportTemplatesByGuid, value).length > 0,
      )
      setTemplatesResponse(response)
      setAudience(firstAudience ? firstAudience.value : null)
    }).catch(e => setErrors(getErrors(e))).then(() => setLoading(false))
  }, [projectGuid])

  const selectAudience = React.useCallback((e, { value }) => {
    setAudience(value)
    setTemplateGuid(null)
    setReport(null)
    setErrors([])
  }, [])

  const selectTemplate = React.useCallback((e, { value }) => {
    setTemplateGuid(value)
    setReport(null)
    setErrors([])
    setLoading(true)
    generateReport(family.familyGuid, value).then(setReport, e => setErrors(getErrors(e))).then(() => setLoading(false))
  }, [family.familyGuid])

  const templates = templatesResponse ? getTemplates(templatesResponse.reportTemplatesByGuid, audience) : []
  const templateOptions = templates.map(({ reportTemplateGuid, name, description, projectGuid: templateProjectGuid }) => ({
    value: reportTemplateGuid, text: name, description: templateProjectGuid ? description : `${description || ''} (all projects)`.trim(),
  }))
  const template = templates.find(({ reportTemplateGuid }) => reportTemplateGuid === templateGuid)

  const download = React.useCallback(
    () => downloadMarkdown(getReportFileName(family.displayName, template.name), report.markdown),
    [family.displayName, template, report],
  )

  return (
    <div>
      {templatesResponse && (
        <Form>
          <Form.Group widths="equal">
            <Form.Select
              label="Audience"
              name="audience"
              options={templatesResponse.audiences}
              value={audience}
              onChange={selectAudience}
            />
            <Form.Select
              label="Template"
              name="template"
              placeholder={templateOptions.length > 0 ? 'Select a template' : 'No templates are available for this audience'}
              disabled={templateOptions.length === 0}
              options={templateOptions}
              value={templateGuid}
              onChange={selectTemplate}
            />
          </Form.Group>
          <Button type="button" primary disabled={!report} onClick={print} icon labelPosition="left">
            <Icon name="print" />
            Print / Save as PDF
          </Button>
          <Button type="button" disabled={!report} onClick={download} icon labelPosition="left">
            <Icon name="download" />
            Download Markdown
          </Button>
        </Form>
      )}
      <ReportPreview report={report} errors={errors} loading={loading} errorHeader="Unable to generate report" />
    </div>
  )
}

type GenerateReportButtonProps = { family: Family, project: { projectGuid: string } }

const BaseGenerateReportButton = ({ family, project }: GenerateReportButtonProps) => {
  const [open, setOpen] = React.useState(false)
  const onOpen = React.useCallback(() => setOpen(true), [])
  const onClose = React.useCallback(() => setOpen(false), [])
  const trigger = (
    <ButtonLink>
      <Icon name="file alternate outline" />
      &nbsp; Generate report
    </ButtonLink>
  )
  return (
    <Modal trigger={trigger} open={open} onOpen={onOpen} onClose={onClose} size="large" closeIcon>
      <Modal.Header>{`Generate report for family ${family.displayName}`}</Modal.Header>
      <Modal.Content>
        <GenerateReport family={family} projectGuid={project.projectGuid} />
      </Modal.Content>
    </Modal>
  )
}

const mapStateToProps = (state: unknown) => ({
  project: getCurrentProject(state),
})

export default connect(mapStateToProps)(BaseGenerateReportButton)
