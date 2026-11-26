import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'

import GenerateReportButton from './GenerateReportButton'
import { STATE_WITH_2_FAMILIES } from '../../fixtures'
import { REPORT, TEMPLATES_RESPONSE, flush, mockFetch } from './testUtils'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const FAMILY = STATE_WITH_2_FAMILIES.familiesByGuid.F011652_1
const TEMPLATES_URL = '/api/project/R0237_1000_genomes_demo/report_templates'
const REPORT_URL = '/api/family/F011652_1/report'

const openModal = async (routes: Parameters<typeof mockFetch>[0]) => {
  const fetchMock = mockFetch(routes)
  const wrapper = mount(
    <Provider store={configureStore(STATE_WITH_2_FAMILIES)}>
      <GenerateReportButton family={FAMILY} />
    </Provider>,
  )
  expect(fetchMock).not.toHaveBeenCalled()
  expect(wrapper.find('GenerateReport').length).toEqual(0)
  wrapper.find('ButtonLink').first().simulate('click')
  await flush(wrapper)
  return { wrapper, fetchMock }
}

const select = async (wrapper: ReturnType<typeof mount>, name: string, value: string) => {
  act(() => {
    wrapper.find('FormSelect').filterWhere(s => s.prop('name') === name).prop('onChange')(null, { value })
  })
  await flush(wrapper)
}

const getSelect = (wrapper: ReturnType<typeof mount>, name: string) => (
  wrapper.find('FormSelect').filterWhere(s => s.prop('name') === name)
)

const getButton = (wrapper: ReturnType<typeof mount>, text: string) => (
  wrapper.find('Button').filterWhere(b => b.text().includes(text))
)

afterEach(() => {
  document.body.innerHTML = ''
})

test('generates a report from a chosen audience and template, then prints and downloads it', async () => {
  const { wrapper, fetchMock } = await openModal({
    [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE },
    [REPORT_URL]: { body: REPORT },
  })

  expect(wrapper.find('ModalHeader').text()).toEqual('Generate report for family 1')
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([`${TEMPLATES_URL}?`])
  expect(getSelect(wrapper, 'audience').prop('value')).toEqual('researcher')
  expect(getSelect(wrapper, 'audience').prop('options')).toEqual(TEMPLATES_RESPONSE.audiences)
  expect(getSelect(wrapper, 'template').prop('options')).toEqual([
    { value: 'RT0000003_candidates', text: 'Candidate variants', description: 'Project specific summary' },
    {
      value: 'RT0000001_family_analysis_summ',
      text: 'Family analysis summary',
      description: 'Research summary of a family (all projects)',
    },
  ])
  expect(getSelect(wrapper, 'template').prop('value')).toBeNull()
  expect(getButton(wrapper, 'Print / Save as PDF').prop('disabled')).toEqual(true)
  expect(getButton(wrapper, 'Download Markdown').prop('disabled')).toEqual(true)
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)

  await select(wrapper, 'audience', 'clinician')
  expect(getSelect(wrapper, 'template').prop('options')).toEqual([
    { value: 'RT0000002_findings_summary', text: 'Findings summary', description: '(all projects)' },
  ])

  await select(wrapper, 'template', 'RT0000002_findings_summary')
  expect(fetchMock.mock.calls[1][0]).toEqual(`${REPORT_URL}/RT0000002_findings_summary?`)
  expect(wrapper.find('ReactMarkdown').text()).toEqual(REPORT.markdown)
  expect(wrapper.find('.report-print-area style').text()).toContain('@media print')
  expect(wrapper.find('.report-print-area style').text()).toContain('body > *:not(.modals) { display: none !important; }')
  expect(wrapper.find('Message').length).toEqual(0)

  const print = jest.fn()
  window.print = print
  getButton(wrapper, 'Print / Save as PDF').simulate('click')
  expect(print).toHaveBeenCalledTimes(1)

  const downloads: { download: string, blob: Blob }[] = []
  let blob: Blob
  URL.createObjectURL = jest.fn((b: Blob) => {
    blob = b
    return 'blob:report'
  })
  URL.revokeObjectURL = jest.fn()
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function onClick() {
    downloads.push({ download: this.download, blob })
  })
  getButton(wrapper, 'Download Markdown').simulate('click')
  expect(downloads.length).toEqual(1)
  expect(downloads[0].download).toEqual('1_Findings_summary.md')
  expect(downloads[0].blob.size).toEqual(new Blob([REPORT.markdown]).size)
  click.mockRestore()

  // Changing audience clears the report so a stale report can not be printed
  await select(wrapper, 'audience', 'researcher')
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)
  expect(getSelect(wrapper, 'template').prop('value')).toBeNull()
  expect(getButton(wrapper, 'Print / Save as PDF').prop('disabled')).toEqual(true)

  // Closing the modal discards the report: nothing is kept
  act(() => {
    wrapper.find('Modal').prop('onClose')()
  })
  wrapper.update()
  expect(wrapper.find('GenerateReport').length).toEqual(0)
})

test('shows report warnings and generation errors', async () => {
  const routes = {
    [TEMPLATES_URL]: { body: TEMPLATES_RESPONSE },
    [REPORT_URL]: { body: { ...REPORT, warnings: ['Only the first 100 of 120 variants are included'] } } as { status?: number, body: unknown },
  }
  const { wrapper } = await openModal(routes)

  await select(wrapper, 'template', 'RT0000001_family_analysis_summ')
  expect(wrapper.find('Message').prop('warning')).toEqual(true)
  expect(wrapper.find('Message').text()).toEqual('Only the first 100 of 120 variants are included')
  expect(wrapper.find('ReactMarkdown').length).toEqual(1)

  routes[REPORT_URL] = { status: 400, body: { errors: ['Line 1: Unknown placeholder {{family.removedField}}'] } }
  await select(wrapper, 'template', 'RT0000003_candidates')
  expect(wrapper.find('Message').prop('error')).toEqual(true)
  expect(wrapper.find('Message').text()).toEqual(
    'Unable to generate reportLine 1: Unknown placeholder {{family.removedField}}',
  )
  expect(wrapper.find('ReactMarkdown').length).toEqual(0)
  expect(getButton(wrapper, 'Download Markdown').prop('disabled')).toEqual(true)
})

test('disables template selection when an audience has no templates', async () => {
  const { reportTemplatesByGuid } = TEMPLATES_RESPONSE
  const { wrapper } = await openModal({
    [TEMPLATES_URL]: {
      body: {
        ...TEMPLATES_RESPONSE,
        reportTemplatesByGuid: { RT0000002_findings_summary: reportTemplatesByGuid.RT0000002_findings_summary },
      },
    },
  })

  // Defaults to the first audience which has templates
  expect(getSelect(wrapper, 'audience').prop('value')).toEqual('clinician')
  expect(getSelect(wrapper, 'template').prop('disabled')).toEqual(false)
  expect(getSelect(wrapper, 'template').prop('placeholder')).toEqual('Select a template')

  await select(wrapper, 'audience', 'researcher')
  expect(getSelect(wrapper, 'template').prop('disabled')).toEqual(true)
  expect(getSelect(wrapper, 'template').prop('placeholder')).toEqual('No templates are available for this audience')
})

test('shows an error when templates can not be loaded or none exist', async () => {
  const { wrapper } = await openModal({ [TEMPLATES_URL]: { status: 403, body: { error: 'Permission Denied' } } })
  expect(wrapper.find('Message').text()).toEqual('Unable to generate reportPermission Denied')
  expect(wrapper.find('FormSelect').length).toEqual(0)
  wrapper.unmount()

  const { wrapper: malformedWrapper } = await openModal({ [TEMPLATES_URL]: { body: {} } })
  expect(malformedWrapper.find('Message').prop('error')).toEqual(true)
  expect(malformedWrapper.find('Loader').first().prop('active')).toEqual(false)
  malformedWrapper.unmount()

  const { wrapper: emptyWrapper } = await openModal({
    [TEMPLATES_URL]: { body: { ...TEMPLATES_RESPONSE, reportTemplatesByGuid: {} } },
  })
  expect(getSelect(emptyWrapper, 'audience').prop('value')).toBeNull()
  expect(getSelect(emptyWrapper, 'template').prop('disabled')).toEqual(true)
})
