import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { MemoryRouter } from 'react-router-dom'

import KnownVariantMatches from './KnownVariantMatches'
import { mockFetch, flushRequests, clickButton, getPosts } from './testUtils'

configure({ adapter: new Adapter() })

const NEW_MATCH = {
  matchGuid: 'KVM0000001_1_1',
  familyGuid: 'F000001_1',
  projectGuid: 'R0001_1kg',
  status: 'N',
  firstSeen: '2026-11-26',
  reviewedBy: null,
  savedVariantGuid: null,
  genomeVersion: '38',
  datasetType: 'SNV_INDEL',
  variantId: '1-248367227-TC-T',
  geneIds: ['ENSG00000240361', 'ENSG00000135953'],
  geneNames: ['OR4G11P', 'MFSD9'],
  verdict: 'C',
  pubmedId: '12345678',
  clinvarAccession: 'VCV000012345',
  createdBy: 'Test Manager User',
  sourceProjectName: 'Non-Analyst Project',
}
const SAVED_MATCH = {
  ...NEW_MATCH,
  matchGuid: 'KVM0000002_2_1',
  savedVariantGuid: 'SV0000001_2103343353_r0390_100',
  variantId: '21-3343353-GAGA-G',
  geneNames: [],
  verdict: 'B',
  pubmedId: 'javascript:alert(1)',
  clinvarAccession: 'https://evil.example.com',
  createdBy: null,
  sourceProjectName: null,
}
const DISMISSED_MATCH = {
  ...NEW_MATCH, matchGuid: 'KVM0000003_3_2', familyGuid: 'F000002_2', status: 'D', reviewedBy: 'Test User', verdict: 'R',
}
const MATCHES = { [NEW_MATCH.matchGuid]: NEW_MATCH, [SAVED_MATCH.matchGuid]: SAVED_MATCH, [DISMISSED_MATCH.matchGuid]: DISMISSED_MATCH }

const mountMatches = async (props) => {
  const wrapper = mount(<MemoryRouter><KnownVariantMatches {...props} /></MemoryRouter>)
  expect(wrapper.find('Loader').length).toEqual(1)
  await flushRequests(wrapper)
  expect(wrapper.find('Loader').length).toEqual(0)
  return wrapper
}

const rowText = wrapper => wrapper.find('TableBody').find('TableRow').map(row => row.find('TableCell').map(cell => cell.text()))

test('lists new matches for a family with the verdict, references and who recorded it', async () => {
  const fetch = mockFetch(() => ({ json: { knownVariantMatchesByGuid: MATCHES } }))
  const wrapper = await mountMatches({ familyGuid: 'F000001_1', hideEmpty: true })

  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toEqual('/api/family/F000001_1/known_variant_matches?')
  expect(wrapper.find('Label').first().text()).toEqual('2 new')
  expect(wrapper.find('TableHeaderCell').map(cell => cell.text())).toEqual(
    ['Variant', 'Gene', 'Verdict', 'References', 'Recorded By', 'First Seen', 'Review'],
  )
  expect(rowText(wrapper)).toEqual([
    ['1-248367227-TC-T', 'OR4G11P, MFSD9', 'Confirmed causal', 'PMID 12345678, ClinVar VCV000012345',
      'Test Manager User', '2026-11-26', 'RelevantDismiss'],
    ['21-3343353-GAGA-G', '', 'Benign or artefact (expected noise)', '', '', '2026-11-26', 'RelevantDismiss'],
  ])

  // Variants link to the saved variant, or to the variant in the family
  expect(wrapper.find('Link').map(link => link.prop('to'))).toEqual([
    '/variant_search/variant/1-248367227-TC-T/family/F000001_1',
    '/project/R0001_1kg/saved_variants/variant/SV0000001_2103343353_r0390_100',
  ])
  // References are only linked to PubMed and ClinVar
  expect(wrapper.find('a[target="_blank"]').map(link => link.prop('href'))).toEqual([
    'https://pubmed.ncbi.nlm.nih.gov/12345678/', 'https://www.ncbi.nlm.nih.gov/clinvar/?term=VCV000012345',
  ])
  expect(wrapper.html()).not.toContain('evil.example.com')
  expect(wrapper.html()).not.toContain('javascript:')
})

test('marks matches as relevant or dismissed, and can undo a review', async () => {
  const fetch = mockFetch((url, options) => {
    if (options.method !== 'POST') {
      return { json: { knownVariantMatchesByGuid: MATCHES } }
    }
    const matchGuid = url.split('/')[3]
    const { status } = JSON.parse(options.body)
    return { json: { knownVariantMatchesByGuid: {
      [matchGuid]: { ...MATCHES[matchGuid], status, reviewedBy: status === 'N' ? null : 'Test Collaborator User' },
    } } }
  })
  const wrapper = await mountMatches({ projectGuid: 'R0001_1kg' })

  expect(fetch.mock.calls[0][0]).toEqual('/api/project/R0001_1kg/known_variant_matches?')
  expect(wrapper.find('TableHeaderCell').first().text()).toEqual('Family')
  expect(wrapper.find('Link').first().prop('to')).toEqual('/project/R0001_1kg/family_page/F000001_1')
  expect(rowText(wrapper).length).toEqual(2)

  await clickButton(wrapper, 'Relevant')
  expect(getPosts(fetch)).toEqual([['/api/known_variant_matches/KVM0000001_1_1/update', { status: 'R' }]])
  expect(wrapper.find('Label').first().text()).toEqual('1 new')
  expect(rowText(wrapper).map(row => row[1])).toEqual(['21-3343353-GAGA-G'])

  await clickButton(wrapper, 'Dismiss')
  expect(getPosts(fetch)[1]).toEqual(['/api/known_variant_matches/KVM0000002_2_1/update', { status: 'D' }])
  expect(wrapper.find('Label').first().text()).toEqual('0 new')
  expect(wrapper.find('Table').length).toEqual(0)

  // Reviewed matches are hidden until requested
  await clickButton(wrapper, 'Show 3 reviewed')
  expect(rowText(wrapper).map(row => row[row.length - 1])).toEqual([
    'Reviewed: relevant (Test Collaborator User) Undo', 'Dismissed (Test Collaborator User) Undo',
    'Dismissed (Test User) Undo',
  ])

  await clickButton(wrapper, 'Undo')
  expect(getPosts(fetch)[2]).toEqual(['/api/known_variant_matches/KVM0000001_1_1/update', { status: 'N' }])
  expect(wrapper.find('Label').first().text()).toEqual('1 new')
  expect(rowText(wrapper)[0][7]).toEqual('RelevantDismiss')

  await clickButton(wrapper, 'Hide reviewed')
  expect(rowText(wrapper).length).toEqual(1)
})

test('shows statuses and verdicts it does not know without failing', async () => {
  mockFetch(() => ({ json: { knownVariantMatchesByGuid: {
    [NEW_MATCH.matchGuid]: { ...NEW_MATCH, status: 'X', verdict: 'Z', reviewedBy: null },
  } } }))
  const wrapper = await mountMatches({ familyGuid: 'F000001_1' })

  await clickButton(wrapper, 'Show 1 reviewed')
  expect(rowText(wrapper)[0][2]).toEqual('Z')
  expect(rowText(wrapper)[0][6]).toEqual('X Undo')
})

test('renders nothing for a family without matches, and an empty summary for a project', async () => {
  mockFetch(() => ({ json: {} }))
  const familyWrapper = await mountMatches({ familyGuid: 'F000001_1', hideEmpty: true })
  expect(familyWrapper.find('KnownVariantMatches').isEmptyRender()).toBe(true)

  const projectWrapper = await mountMatches({ projectGuid: 'R0001_1kg' })
  expect(projectWrapper.text()).toEqual('Known variant matches 0 new')
  expect(projectWrapper.find('Table').length).toEqual(0)
})

test('shows an error when matches can not be loaded or updated', async () => {
  mockFetch(() => ({ status: 403, json: { error: 'Permission Denied' } }))
  const wrapper = await mountMatches({ familyGuid: 'F000001_1', hideEmpty: true })
  expect(wrapper.find('Message').text()).toEqual('Permission Denied')

  mockFetch((url, options) => (
    options.method === 'POST' ? { status: 400, json: { errors: ['Invalid status'] } } :
      { json: { knownVariantMatchesByGuid: MATCHES } }
  ))
  const updateWrapper = await mountMatches({ familyGuid: 'F000001_1' })
  expect(updateWrapper.find('Message').length).toEqual(0)
  await clickButton(updateWrapper, 'Relevant')
  expect(updateWrapper.find('Message').text()).toEqual('Invalid status')
  expect(updateWrapper.find('Label').first().text()).toEqual('2 new')
})

test('reloads matches when the family changes', async () => {
  const fetch = mockFetch(url => ({ json: { knownVariantMatchesByGuid: url.includes('F000002_2') ?
    { [DISMISSED_MATCH.matchGuid]: DISMISSED_MATCH } : MATCHES } }))
  const Wrapper = ({ familyGuid }) => <MemoryRouter><KnownVariantMatches familyGuid={familyGuid} /></MemoryRouter>
  const wrapper = mount(<Wrapper familyGuid="F000001_1" />)
  await flushRequests(wrapper)
  expect(wrapper.find('Label').first().text()).toEqual('2 new')

  wrapper.setProps({ familyGuid: 'F000002_2' })
  await flushRequests(wrapper)
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    '/api/family/F000001_1/known_variant_matches?', '/api/family/F000002_2/known_variant_matches?',
  ])
  expect(wrapper.find('Label').first().text()).toEqual('0 new')
  expect(wrapper.find('Button').first().prop('content')).toEqual('Show 1 reviewed')
})
