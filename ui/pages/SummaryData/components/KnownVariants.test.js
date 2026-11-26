import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { act } from 'react-dom/test-utils'

import {
  mockFetch, flushRequests, clickButton, setFormValue, getPosts,
} from 'shared/components/panel/known-variants/testUtils'
import KnownVariants from './KnownVariants'

configure({ adapter: new Adapter() })

const OWN_CHECK = {
  checkGuid: 'KVC0000001_1_248367227_tc_t',
  genomeVersion: '38',
  datasetType: 'SNV_INDEL',
  variantId: '1-248367227-TC-T',
  geneIds: ['ENSG00000240361'],
  geneNames: ['OR4G11P'],
  verdict: 'C',
  pubmedId: '12345678',
  clinvarAccession: null,
  isGlobal: false,
  isActive: true,
  createdDate: '2026-11-26T00:00:00Z',
  createdBy: 'Test Collaborator User',
  sourceProjectGuid: 'R0001_1kg',
  sourceProjectName: '1kg project',
  canEdit: true,
  numMatches: 3,
  numNewMatches: 2,
}
const GLOBAL_CHECK = {
  ...OWN_CHECK,
  checkGuid: 'KVC0000002_m_4429_g_a',
  genomeVersion: '38',
  datasetType: 'MITO',
  variantId: 'M-4429-G-A',
  geneNames: [],
  verdict: 'B',
  pubmedId: null,
  clinvarAccession: 'VCV000012345',
  isGlobal: true,
  isActive: false,
  createdBy: null,
  sourceProjectGuid: null,
  sourceProjectName: null,
  canEdit: false,
  numMatches: 0,
  numNewMatches: 0,
}
const CHECKS = { [OWN_CHECK.checkGuid]: OWN_CHECK, [GLOBAL_CHECK.checkGuid]: GLOBAL_CHECK }

const mockCheckApi = () => mockFetch((url, options) => {
  if (options.method !== 'POST') {
    return { json: { knownVariantChecksByGuid: CHECKS } }
  }
  const body = JSON.parse(options.body)
  const [, , , checkGuid, action] = url.split('/')
  if (checkGuid === 'create') {
    return { json: { knownVariantChecksByGuid: {
      KVC0000003_new: { ...OWN_CHECK, ...body, checkGuid: 'KVC0000003_new', geneNames: [], numMatches: 0, numNewMatches: 0 },
    } } }
  }
  return { json: { knownVariantChecksByGuid: {
    [checkGuid]: action === 'delete' ? null : { ...CHECKS[checkGuid], ...body },
  } } }
})

const mountPage = async (user) => {
  const store = configureMockStore()({ user })
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter>
        <KnownVariants />
      </MemoryRouter>
    </Provider>,
  )
  expect(wrapper.find('Loader').length).toEqual(1)
  await flushRequests(wrapper)
  expect(wrapper.find('Loader').length).toEqual(0)
  return wrapper
}

const rowText = wrapper => wrapper.find('TableBody').find('TableRow').map(row => row.find('TableCell').map(cell => cell.text()))
const buttonContents = wrapper => wrapper.find('Button').map(button => button.prop('content'))

test('lists the known variants a researcher can see, and only lets them change their own', async () => {
  const fetch = mockCheckApi()
  const wrapper = await mountPage({ isAnalyst: false })

  expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/known_variant_checks?'])
  expect(wrapper.find('TableHeaderCell').map(cell => cell.text())).toEqual(
    ['Variant', 'Gene', 'Verdict', 'References', 'Recorded By', 'Matches', 'Status', ''],
  )
  expect(rowText(wrapper)).toEqual([
    ['1-248367227-TC-TGRCh38 SNV / indel', 'OR4G11P', 'Confirmed causal', 'PMID 12345678',
      'Test Collaborator User1kg project', '3 (2 new)', 'Active', 'EditDeactivateDelete'],
    ['M-4429-G-AGRCh38 Mitochondrial', '', 'Benign or artefact (expected noise)', 'ClinVar VCV000012345', '',
      '0 (0 new)', 'InactiveAll projects', ''],
  ])
  expect(wrapper.find('Link').map(link => link.prop('to'))).toEqual(['/project/R0001_1kg/project_page'])
  // Only analysts can add a known variant which is not a saved variant
  expect(buttonContents(wrapper)).toEqual(['Edit', 'Deactivate', 'Delete'])

  // Edit the verdict and references
  await clickButton(wrapper, 'Edit')
  expect(wrapper.find('ModalHeader').text()).toEqual('Edit known variant 1-248367227-TC-T')
  expect(wrapper.find('Modal').find('FormField').map(field => field.prop('name'))).toEqual(
    ['verdict', 'pubmedId', 'clinvarAccession'],
  )
  expect(wrapper.find('Modal').find({ name: 'verdict' }).first().prop('value')).toEqual('C')
  expect(wrapper.find('Modal').find({ name: 'pubmedId' }).first().prop('value')).toEqual('12345678')
  await setFormValue(wrapper, 'verdict', { value: 'R' })
  await setFormValue(wrapper, 'pubmedId', { value: '' })
  await setFormValue(wrapper, 'clinvarAccession', { value: 'RCV000012345' })
  await clickButton(wrapper, 'Save')
  expect(getPosts(fetch)).toEqual([[`/api/known_variant_checks/${OWN_CHECK.checkGuid}/update`, {
    verdict: 'R', pubmedId: '', clinvarAccession: 'RCV000012345',
  }]])
  expect(wrapper.find('Modal').length).toEqual(0)
  expect(rowText(wrapper)[0].slice(2, 4)).toEqual(['Suspected, refuted on follow-up', 'ClinVar RCV000012345'])

  // Deactivate and reactivate
  await clickButton(wrapper, 'Deactivate')
  expect(getPosts(fetch)[1]).toEqual([`/api/known_variant_checks/${OWN_CHECK.checkGuid}/update`, { isActive: false }])
  expect(rowText(wrapper)[0].slice(6)).toEqual(['Inactive', 'EditActivateDelete'])
  expect(wrapper.find('TableBody').find('TableRow').first().prop('disabled')).toBe(true)
  await clickButton(wrapper, 'Activate')
  expect(getPosts(fetch)[2]).toEqual([`/api/known_variant_checks/${OWN_CHECK.checkGuid}/update`, { isActive: true }])
  expect(rowText(wrapper)[0].slice(6)).toEqual(['Active', 'EditDeactivateDelete'])

  // Delete, after confirmation
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
  await clickButton(wrapper, 'Delete')
  expect(wrapper.find('Confirm').prop('open')).toBe(true)
  expect(wrapper.find('Confirm').prop('content')).toEqual('Delete known variant 1-248367227-TC-T and its matches?')
  await act(async () => {
    wrapper.find('Confirm').prop('onCancel')()
  })
  await flushRequests(wrapper)
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
  expect(getPosts(fetch).length).toEqual(3)
  expect(rowText(wrapper).length).toEqual(2)

  await clickButton(wrapper, 'Delete')
  await act(async () => {
    wrapper.find('Confirm').prop('onConfirm')()
  })
  await flushRequests(wrapper)
  expect(getPosts(fetch)[3]).toEqual([`/api/known_variant_checks/${OWN_CHECK.checkGuid}/delete`, {}])
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
  expect(rowText(wrapper).map(row => row[0])).toEqual(['M-4429-G-AGRCh38 Mitochondrial'])
})

test('lets analysts add a known variant and share known variants with all projects', async () => {
  const fetch = mockCheckApi()
  const wrapper = await mountPage({ isAnalyst: true })

  expect(buttonContents(wrapper)).toEqual(['Add Known Variant', 'Edit', 'Deactivate', 'Delete'])

  await clickButton(wrapper, 'Add Known Variant')
  expect(wrapper.find('ModalHeader').text()).toEqual('Add known variant')
  expect(wrapper.find('Modal').find('FormField').map(field => field.prop('name'))).toEqual(
    ['genomeVersion', 'datasetType', 'variantId', 'verdict', 'pubmedId', 'clinvarAccession', 'isGlobal'],
  )
  await setFormValue(wrapper, 'datasetType', { value: 'MITO' })
  await setFormValue(wrapper, 'variantId', { value: 'M-11597-A-G' })
  await setFormValue(wrapper, 'verdict', { value: 'S' })
  await setFormValue(wrapper, 'isGlobal', { checked: true })
  await clickButton(wrapper, 'Save')
  expect(getPosts(fetch)).toEqual([['/api/known_variant_checks/create', {
    genomeVersion: '38', datasetType: 'MITO', variantId: 'M-11597-A-G', verdict: 'S', isGlobal: true,
  }]])
  expect(wrapper.find('Modal').length).toEqual(0)
  expect(rowText(wrapper).map(row => row[0])).toEqual([
    '1-248367227-TC-TGRCh38 SNV / indel', 'M-4429-G-AGRCh38 Mitochondrial', 'M-11597-A-GGRCh38 Mitochondrial',
  ])
  expect(rowText(wrapper)[2].slice(6)).toEqual(['ActiveAll projects', 'EditDeactivateDelete'])

  await clickButton(wrapper, 'Add Known Variant')
  await clickButton(wrapper, 'Cancel')
  expect(wrapper.find('Modal').length).toEqual(0)

  await clickButton(wrapper, 'Edit')
  expect(wrapper.find('Modal').find('FormField').map(field => field.prop('name'))).toEqual(
    ['verdict', 'pubmedId', 'clinvarAccession', 'isGlobal'],
  )
  expect(wrapper.find('Modal').find({ name: 'isGlobal' }).first().prop('checked')).toBe(false)
  await setFormValue(wrapper, 'isGlobal', { checked: true })
  await clickButton(wrapper, 'Save')
  expect(getPosts(fetch)[1]).toEqual([`/api/known_variant_checks/${OWN_CHECK.checkGuid}/update`, {
    verdict: 'C', pubmedId: '12345678', clinvarAccession: '', isGlobal: true,
  }])
  expect(rowText(wrapper)[0][6]).toEqual('ActiveAll projects')
})

test('shows a message when there are no known variants or they can not be loaded', async () => {
  mockFetch(() => ({ json: {} }))
  const emptyWrapper = await mountPage({})
  expect(emptyWrapper.find('Table').length).toEqual(0)
  expect(emptyWrapper.find('Message').text()).toEqual('No known variants have been recorded')
  expect(buttonContents(emptyWrapper)).toEqual([])

  mockFetch(() => ({ status: 500, json: { error: 'Server error' } }))
  const errorWrapper = await mountPage({ isAnalyst: false })
  expect(errorWrapper.find('Message').first().text()).toEqual('Server error')

  const errorStore = configureMockStore()({})
  mockFetch((url, options) => (
    options.method === 'POST' ? { status: 403, json: { error: 'Permission Denied' } } :
      { json: { knownVariantChecksByGuid: CHECKS } }
  ))
  const updateWrapper = mount(
    <Provider store={errorStore}>
      <MemoryRouter>
        <KnownVariants />
      </MemoryRouter>
    </Provider>,
  )
  await flushRequests(updateWrapper)
  expect(buttonContents(updateWrapper)).toEqual(['Edit', 'Deactivate', 'Delete'])
  await clickButton(updateWrapper, 'Deactivate')
  expect(updateWrapper.find('Message').text()).toEqual('Permission Denied')
  expect(rowText(updateWrapper)[0][6]).toEqual('Active')
})
