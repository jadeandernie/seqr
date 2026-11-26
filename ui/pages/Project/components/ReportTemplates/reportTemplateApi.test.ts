import {
  deleteTemplate, downloadMarkdown, generateReport, getErrors, getReportFileName, getTemplates, loadTemplates,
  previewReport, saveTemplate,
} from './reportTemplateApi'
import { REPORT, TEMPLATES_RESPONSE, mockFetch, postedBody } from './testUtils'

const VALUES = { name: 'New', description: '', audience: 'researcher', body: '{{date}}' }

test('getErrors prefers validation errors and falls back to the error message', () => {
  expect(getErrors({ message: 'bad request (400)', body: { errors: ['Line 1: Unknown placeholder {{x}}'] } }))
    .toEqual(['Line 1: Unknown placeholder {{x}}'])
  expect(getErrors({ message: 'Permission Denied', body: { errors: [] } })).toEqual(['Permission Denied'])
  expect(getErrors({ message: 'Permission Denied', body: {} })).toEqual(['Permission Denied'])
  expect(getErrors({ message: 'Not Found' })).toEqual(['Not Found'])
  expect(getErrors({})).toEqual(['An unknown error occurred'])
})

test('getTemplates filters by audience, skips deleted templates and sorts by name', () => {
  const templatesByGuid = { ...TEMPLATES_RESPONSE.reportTemplatesByGuid, RT_deleted: null as null }
  expect(getTemplates(templatesByGuid).map(t => t.name)).toEqual([
    'Candidate variants', 'Family analysis summary', 'Findings summary',
  ])
  expect(getTemplates(templatesByGuid, 'researcher').map(t => t.name)).toEqual([
    'Candidate variants', 'Family analysis summary',
  ])
  expect(getTemplates(templatesByGuid, 'clinician').map(t => t.name)).toEqual(['Findings summary'])
  expect(getTemplates(templatesByGuid, 'other')).toEqual([])
})

test('getReportFileName builds a safe markdown file name', () => {
  expect(getReportFileName('FAM 1', 'Family analysis summary')).toEqual('FAM_1_Family_analysis_summary.md')
  expect(getReportFileName('../a/b', 'x<y>:"z"')).toEqual('.._a_b_x_y_z_.md')
})

test('downloadMarkdown downloads the markdown as a file', async () => {
  const blobs: Blob[] = []
  URL.createObjectURL = jest.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:report'
  })
  URL.revokeObjectURL = jest.fn()
  const clicked: { href: string, download: string, attached: boolean }[] = []
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function onClick() {
    clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) })
  })

  downloadMarkdown('report.md', '# Report')

  expect(clicked).toEqual([{ href: 'blob:report', download: 'report.md', attached: true }])
  expect(blobs.length).toEqual(1)
  expect(blobs[0].type).toEqual('text/markdown;charset=utf-8')
  expect(blobs[0].size).toEqual(8)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report')
  expect(document.body.querySelector('a')).toBeNull()
  click.mockRestore()
})

test('requests use the report template endpoints', async () => {
  const fetchMock = mockFetch({
    '/api/project/R1/report_templates': { body: TEMPLATES_RESPONSE },
    '/api/family/F1/report': { body: REPORT },
    '/api/': { body: { reportTemplatesByGuid: {} } },
  })

  expect(await loadTemplates('R1')).toEqual(TEMPLATES_RESPONSE)
  expect(fetchMock.mock.calls[0][0]).toEqual('/api/project/R1/report_templates?')

  expect(await generateReport('F1', 'RT1')).toEqual(REPORT)
  expect(fetchMock.mock.calls[1][0]).toEqual('/api/family/F1/report/RT1?')

  expect(await previewReport('F1', '{{date}}')).toEqual(REPORT)
  expect(postedBody(fetchMock, '/api/family/F1/report_template_preview')).toEqual({ body: '{{date}}' })

  await saveTemplate(VALUES, null, 'R1')
  expect(postedBody(fetchMock, '/api/project/R1/report_templates/create')).toEqual(VALUES)
  await saveTemplate(VALUES, null, null)
  expect(postedBody(fetchMock, '/api/report_template/create')).toEqual(VALUES)
  await saveTemplate(VALUES, 'RT1', 'R1')
  expect(postedBody(fetchMock, '/api/report_template/RT1/update')).toEqual(VALUES)
  await saveTemplate(VALUES, 'RT2', null)
  expect(postedBody(fetchMock, '/api/report_template/RT2/update')).toEqual(VALUES)

  expect(await deleteTemplate('RT1')).toEqual({ reportTemplatesByGuid: {} })
  expect(postedBody(fetchMock, '/api/report_template/RT1/delete')).toEqual({})
})

test('failed requests reject with the server errors', async () => {
  mockFetch({ '/api/': { status: 400, body: { errors: ['Line 1: Unknown placeholder {{x}}'] } } })
  const error = await previewReport('F1', '{{x}}').then(() => null, e => e)
  expect(getErrors(error)).toEqual(['Line 1: Unknown placeholder {{x}}'])
})
