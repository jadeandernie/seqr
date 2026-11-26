import {
  PERMISSIVE_QUERY_GUID, PROJECT_GUID, RECESSIVE_QUERY_GUID, RESTRICTIVE_QUERY_GUID, WORKBOOK, WORKBOOK_DETAIL,
  WORKBOOK_GUID,
} from './fixtures'
import {
  clickButton, flush, getOpenModal, getRequests, mockApi, renderProjectPage,
} from './testHelpers'
import { TalosExportResponse } from './TalosExport'

type Wrapper = ReturnType<typeof renderProjectPage>['wrapper']
type Responses = Parameters<typeof mockApi>[0]

const PATH = `/project/${PROJECT_GUID}/workbook/${WORKBOOK_GUID}`
const API_PATH = `/api/workbook/${WORKBOOK_GUID}`
const EXPORT_PATH = `${API_PATH}/talos_export`

const TOML = '# Talos configuration fragment\n\n[ValidateMOI]\ngnomad_max_af = 0.01\n'
const EXPORT: TalosExportResponse = {
  toml: TOML,
  talosVersion: '12.3.2 (commit d279709d4c)',
  report: [
    {
      query: 'De novo restrictive',
      queryGuid: RESTRICTIVE_QUERY_GUID,
      worksheet: 'De Novo',
      parameter: 'inheritance.mode',
      value: 'de_novo',
      outcome: 'dropped',
      note: 'Talos does not take an inheritance mode',
    },
    {
      query: 'De novo restrictive',
      queryGuid: RESTRICTIVE_QUERY_GUID,
      worksheet: 'De Novo',
      parameter: 'freqs.gnomad_genomes.af',
      value: 0.001,
      outcome: 'approximated',
      talosKey: 'ValidateMOI.gnomad_max_af',
      note: 'Merged: Talos gets 0.01',
    },
    {
      query: 'De novo permissive',
      queryGuid: PERMISSIVE_QUERY_GUID,
      worksheet: 'De Novo',
      parameter: 'locus.locusListGuid',
      value: 'Kidneyome (PanelApp AU panel 275)',
      outcome: 'exported',
      talosKey: 'GeneratePanelData.forced_panels',
      note: 'Talos applies the current version of this panel',
    },
    {
      query: 'Recessive',
      queryGuid: RECESSIVE_QUERY_GUID,
      worksheet: 'Recessive',
      parameter: 'locus.rawItems',
      value: ['PKD1', 'PKD2', ['nested', 3]],
      outcome: 'dropped',
      note: 'Not exported as manual overrides',
    },
    {
      query: 'Recessive',
      queryGuid: RECESSIVE_QUERY_GUID,
      worksheet: 'Recessive',
      parameter: 'locus.panelAppItems',
      value: { green: 'PKD1' },
      outcome: 'dropped',
      note: 'The genes selected within the panel are not exported',
    },
  ],
}

const renderWorkbook = async (exportResponse: Responses[string], detail: object = {}) => {
  mockApi({ [API_PATH]: { json: { ...WORKBOOK_DETAIL, ...detail } }, [EXPORT_PATH]: exportResponse })
  const rendered = renderProjectPage(PATH, {
    workbooksByGuid: {},
    workbookTargetsByGuid: {},
    worksheetsByGuid: {},
    worksheetQueriesByGuid: {},
    worksheetQueryResultsByGuid: {},
  })
  await flush(rendered.wrapper)
  return rendered
}

const getReport = (wrapper: Wrapper) => getOpenModal(wrapper).find('section').map((section: Wrapper) => ({
  query: section.prop('aria-label'),
  rows: section.find('tbody tr').map((row: Wrapper) => row.find('td').map((cell: Wrapper) => cell.text())),
}))

const deferred = () => {
  let resolve: () => void
  const wait = new Promise<void>((r) => {
    resolve = r
  })
  return { wait, resolve }
}

test('shows the fidelity report grouped by query and downloads the TOML', async () => {
  const { wait, resolve } = deferred()
  const { wrapper } = await renderWorkbook({ json: EXPORT, wait })
  expect(getOpenModal(wrapper)).toHaveLength(0)
  expect(getRequests(EXPORT_PATH)).toHaveLength(0)

  await clickButton(wrapper, 'Export to Talos')
  const loadingModal = getOpenModal(wrapper)
  expect(loadingModal.find('ModalHeader').text()).toEqual('Export Trio analysis to Talos')
  expect(loadingModal.find('Loader').text()).toEqual('Preparing the Talos export')
  expect(loadingModal.find('a[download]')).toHaveLength(0)
  expect(getRequests(EXPORT_PATH)).toHaveLength(1)

  resolve()
  await flush(wrapper)
  const modal = getOpenModal(wrapper)
  expect(modal.find('Loader')).toHaveLength(0)
  expect(modal.find('.warning.message .header').text()).toEqual(
    'A starting configuration, not an equivalent of the worksheets',
  )
  expect(modal.find('.warning.message').text()).toContain('Talos can not re-run seqr queries.')
  expect(modal.find('.warning.message').text()).toContain(
    'seqr does not start Talos and does not show Talos results in this workbook.',
  )
  expect(modal.find('.warning.message').text()).toContain('Written for Talos 12.3.2 (commit d279709d4c).')

  expect(modal.find('thead').first().find('th').map((cell: Wrapper) => cell.text())).toEqual([
    'Search parameter', 'Value in seqr', 'Outcome', 'Talos setting', 'What Talos does',
  ])
  // Outcomes are stated in words, the icons are decoration
  expect(getReport(wrapper)).toEqual([
    {
      query: 'De Novo: De novo restrictive',
      rows: [
        ['inheritance.mode', 'de_novo', 'Dropped', 'None', 'Talos does not take an inheritance mode'],
        ['freqs.gnomad_genomes.af', '0.001', 'Approximated', 'ValidateMOI.gnomad_max_af', 'Merged: Talos gets 0.01'],
      ],
    },
    {
      query: 'De Novo: De novo permissive',
      rows: [[
        'locus.locusListGuid', 'Kidneyome (PanelApp AU panel 275)', 'Exported', 'GeneratePanelData.forced_panels',
        'Talos applies the current version of this panel',
      ]],
    },
    {
      query: 'Recessive: Recessive',
      rows: [
        ['locus.rawItems', 'PKD1, PKD2, nested, 3', 'Dropped', 'None', 'Not exported as manual overrides'],
        [
          'locus.panelAppItems', '{"green":"PKD1"}', 'Dropped', 'None',
          'The genes selected within the panel are not exported',
        ],
      ],
    },
  ])
  expect(modal.find('section i').everyWhere((icon: Wrapper) => icon.prop('aria-hidden') === 'true')).toBe(true)
  expect(modal.find('#talos-outcome-summary li').map((item: Wrapper) => item.text())).toEqual([
    'Exported: 1 (written to Talos with the same meaning)',
    'Approximated: 1 (written to Talos, but merged across queries or applied by Talos in a different way)',
    'Dropped: 3 (not in the Talos configuration)',
  ])

  const download = modal.find('a[download]')
  expect(download.text()).toEqual('Download TOML')
  expect(download.prop('download')).toEqual('Trio_analysis.talos.toml')
  expect(download.prop('href').startsWith('data:application/toml;charset=utf-8,')).toBe(true)
  expect(decodeURIComponent(download.prop('href').split(',')[1])).toEqual(TOML)

  // The export is requested again every time it is opened, as the queries of the workbook change
  modal.find('button[aria-label="Close"]').simulate('click')
  await flush(wrapper)
  expect(getOpenModal(wrapper)).toHaveLength(0)
  await clickButton(wrapper, 'Export to Talos')
  expect(getRequests(EXPORT_PATH)).toHaveLength(2)
  expect(getReport(wrapper)).toHaveLength(3)
})

test('is available to users who can not edit the workbook', async () => {
  const { wrapper } = await renderWorkbook(
    { json: { ...EXPORT, report: [] } },
    { workbooksByGuid: { [WORKBOOK_GUID]: { ...WORKBOOK, name: 'Kidney / 2026 (v2)', canEdit: false } } },
  )
  expect(wrapper.find('button[aria-label="Add families or analysis groups"]')).toHaveLength(0)

  await clickButton(wrapper, 'Export to Talos')
  const modal = getOpenModal(wrapper)
  expect(getReport(wrapper)).toEqual([])
  expect(modal.find('.message').last().text()).toEqual('The queries of this workbook have no search parameters to export')
  expect(modal.find('#talos-outcome-summary li').map((item: Wrapper) => item.text().split(' (')[0])).toEqual([
    'Exported: 0', 'Approximated: 0', 'Dropped: 0',
  ])
  expect(modal.find('a[download]').prop('download')).toEqual('Kidney_2026_v2_.talos.toml')
})

test('shows a failed export', async () => {
  const { wrapper } = await renderWorkbook({ status: 403, json: { error: 'Permission denied' } })

  await clickButton(wrapper, 'Export to Talos')
  const modal = getOpenModal(wrapper)
  expect(modal.find('.error.message').text()).toEqual('The Talos export failed: Permission denied')
  expect(modal.find('Loader')).toHaveLength(0)
  expect(modal.find('a[download]')).toHaveLength(0)
})

test('ignores the response of an export that was closed', async () => {
  const first = deferred()
  const { wrapper } = await renderWorkbook({ json: EXPORT, wait: first.wait })
  await clickButton(wrapper, 'Export to Talos')
  getOpenModal(wrapper).find('button[aria-label="Close"]').simulate('click')
  await flush(wrapper)

  const second = deferred()
  mockApi({ [EXPORT_PATH]: { status: 400, json: { error: 'Second failed' }, wait: second.wait } })
  await clickButton(wrapper, 'Export to Talos')
  first.resolve()
  await flush(wrapper)
  expect(getOpenModal(wrapper).find('Loader')).toHaveLength(1)
  expect(getReport(wrapper)).toEqual([])

  getOpenModal(wrapper).find('button[aria-label="Close"]').simulate('click')
  await flush(wrapper)
  mockApi({ [EXPORT_PATH]: { json: { ...EXPORT, report: EXPORT.report.slice(0, 1) } } })
  await clickButton(wrapper, 'Export to Talos')
  second.resolve()
  await flush(wrapper)
  expect(getOpenModal(wrapper).find('.error.message')).toHaveLength(0)
  expect(getReport(wrapper)).toHaveLength(1)
})

test('ignores the response of an export after the page was left', async () => {
  const { wait, resolve } = deferred()
  const { wrapper, history } = await renderWorkbook({ json: EXPORT, wait })
  await clickButton(wrapper, 'Export to Talos')
  const error = jest.spyOn(console, 'error')

  history.push(`/project/${PROJECT_GUID}/workbooks`)
  await flush(wrapper)
  resolve()
  await flush(wrapper)
  expect(wrapper.find('TalosExportButton')).toHaveLength(0)
  expect(error).not.toHaveBeenCalled()
  error.mockRestore()
})
