import { HttpRequestHelper } from '../../../../shared/utils/httpRequestHelper'

export type ReportTemplate = {
  reportTemplateGuid: string
  projectGuid: string | null
  name: string
  description: string | null
  audience: string
  body: string
}

export type TemplateValues = Pick<ReportTemplate, 'name' | 'description' | 'audience' | 'body'>

export type Placeholder = { placeholder: string, description: string, block?: string }

export type TemplatesResponse = {
  reportTemplatesByGuid: Record<string, ReportTemplate | null>
  placeholders: Placeholder[]
  audiences: { value: string, text: string }[]
  researchUseLine: string
  canEditProjectTemplates: boolean
  canEditGlobalTemplates: boolean
}

export type RenderedReport = {
  familyGuid: string
  markdown: string
  usedData: string[]
  warnings: string[]
}

type RequestError = { message?: string, body?: { errors?: string[] } }

const request = <T>(url: string, body?: Record<string, unknown>): Promise<T> => new Promise((resolve, reject) => {
  const helper = new HttpRequestHelper(url, response => resolve(response as T), reject)
  if (body) {
    helper.post(body)
  } else {
    helper.get()
  }
})

export const getErrors = (error: RequestError): string[] => {
  const errors = error.body && error.body.errors
  return errors && errors.length > 0 ? errors : [error.message || 'An unknown error occurred']
}

export const loadTemplates = (projectGuid: string) => request<TemplatesResponse>(
  `/api/project/${projectGuid}/report_templates`,
)

export const generateReport = (familyGuid: string, templateGuid: string) => request<RenderedReport>(
  `/api/family/${familyGuid}/report/${templateGuid}`,
)

export const previewReport = (familyGuid: string, body: string) => request<RenderedReport>(
  `/api/family/${familyGuid}/report_template_preview`, { body },
)

export const saveTemplate = (
  values: TemplateValues, templateGuid: string | null, projectGuid: string | null,
) => {
  let url = projectGuid ? `/api/project/${projectGuid}/report_templates/create` : '/api/report_template/create'
  if (templateGuid) {
    url = `/api/report_template/${templateGuid}/update`
  }
  return request<Pick<TemplatesResponse, 'reportTemplatesByGuid'>>(url, values)
}

export const deleteTemplate = (templateGuid: string) => request<Pick<TemplatesResponse, 'reportTemplatesByGuid'>>(
  `/api/report_template/${templateGuid}/delete`, {},
)

export const getTemplates = (
  templatesByGuid: Record<string, ReportTemplate | null>, audience?: string,
): ReportTemplate[] => Object.values(templatesByGuid).filter(
  template => template && (!audience || template.audience === audience),
).sort((a, b) => a.name.localeCompare(b.name))

export const getReportFileName = (familyName: string, templateName: string): string => (
  `${[familyName, templateName].join('_').replace(/[^A-Za-z0-9._-]+/g, '_')}.md`
)

export const downloadMarkdown = (fileName: string, markdown: string): void => {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
