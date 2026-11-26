import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { mockFetchResponse, flushAll, getLastFetchUrl, getLastFetchBody } from 'shared/utils/testHelpers'

import MatchmakerInbox, { getSafeContactUrl } from './MatchmakerInbox'

configure({ adapter: new Adapter() })

const OVERLAP_RESULT = {
  matchmakerResultGuid: 'MR_overlap',
  status: 'new',
  source: 'mme',
  comments: null,
  createdDate: '2024-01-10T12:00:00Z',
  lastModifiedDate: '2024-01-11T12:00:00Z',
  matchRemoved: false,
  weContacted: false,
  hostContacted: true,
  assignedTo: null,
  assignedToMe: false,
  submission: {
    submissionGuid: 'MS000001_na19675',
    individualGuid: 'I000001_na19675',
    individualDisplayName: 'NA19675_1',
    familyGuid: 'F000001_1',
    familyDisplayName: '1',
    projectGuid: 'R0001_1kg',
    projectName: '1kg project',
    genes: [{ geneId: 'ENSG00000135953', geneSymbol: 'MFSD9' }],
    phenotypes: [
      { id: 'HP:0001252', label: 'Muscular hypotonia', observed: 'yes' },
      { id: 'HP:0001263', label: 'Global developmental delay', observed: 'no' },
    ],
  },
  match: {
    patientId: 'P-1',
    label: 'Patient 1',
    institution: 'Test Institute',
    contactName: 'Dr Test',
    contactHref: 'mailto:dr.test@test.org',
    contactEmail: null,
    genes: [{ geneId: 'ENSG00000135953', geneSymbol: 'MFSD9' }, { geneId: null, geneSymbol: 'NOT_A_GENE' }],
    phenotypes: [
      { id: 'HP:0001252', label: 'Muscular hypotonia', observed: 'yes' },
      { id: 'HP:0009999', label: null, observed: 'yes' },
    ],
    score: 0.57067,
  },
  geneOverlap: ['ENSG00000135953'],
  hpoOverlap: ['HP:0001252'],
}

const MALFORMED_RESULT = {
  ...OVERLAP_RESULT,
  matchmakerResultGuid: 'MR_malformed',
  status: 'relevant',
  source: 'variantmatcher',
  comments: 'A triage comment',
  matchRemoved: true,
  weContacted: true,
  hostContacted: false,
  assignedTo: 'Test User',
  assignedToMe: true,
  submission: { ...OVERLAP_RESULT.submission, genes: [], phenotypes: [] },
  match: {
    patientId: null,
    label: null,
    institution: null,
    contactName: 'Mallory',
    // eslint-disable-next-line no-script-url
    contactHref: 'javascript:alert(document.cookie)',
    contactEmail: '<img src=x onerror=alert(1)>',
    genes: [],
    phenotypes: [],
    score: null,
  },
  geneOverlap: [],
  hpoOverlap: [],
}

const EMPTY_CONTACT_RESULT = {
  ...MALFORMED_RESULT,
  matchmakerResultGuid: 'MR_empty',
  status: 'archived',
  source: 'mme',
  comments: null,
  matchRemoved: false,
  weContacted: false,
  assignedTo: null,
  assignedToMe: false,
  match: { ...MALFORMED_RESULT.match, contactName: null, contactHref: null, contactEmail: null },
}

const HTTP_CONTACT_RESULT = {
  ...EMPTY_CONTACT_RESULT,
  matchmakerResultGuid: 'MR_http',
  status: 'responded',
  match: { ...EMPTY_CONTACT_RESULT.match, contactHref: ' https://node.org/contact?id=1 ' },
}

const RESPONSE = {
  results: [OVERLAP_RESULT, MALFORMED_RESULT, EMPTY_CONTACT_RESULT, HTTP_CONTACT_RESULT],
  totalResults: 4,
  page: 1,
  perPage: 50,
  statusCounts: { new: 1, reviewing: 0, relevant: 12, not_relevant: 3, responded: 1 },
  institutions: ['Test Institute', 'Other Institute'],
  projects: [{ projectGuid: 'R0001_1kg', name: '1kg project' }, { projectGuid: 'R0002_empty', name: 'Empty' }],
}

const INBOX_URL = '/api/summary_data/matchmaker_inbox'

const mountInbox = async (response = RESPONSE) => {
  mockFetchResponse(response)
  const wrapper = mount(<MatchmakerInbox />)
  await flushAll()
  wrapper.update()
  return wrapper
}

const flush = async (wrapper) => {
  await flushAll()
  wrapper.update()
}

const getRow = (wrapper, index) => wrapper.find('TableBody').find('TableRow').at(index)

const labelContents = wrapper => wrapper.find('Label').map(label => [label.prop('content'), label.prop('color')])

const clickButton = (wrapper, content) => wrapper.find(`Button[content="${content}"]`).first().simulate('click')

const queueUpdateAndReload = (response = RESPONSE) => {
  mockFetchResponse({})
  mockFetchResponse(response)
}

test('getSafeContactUrl only allows mailto and http(s) urls', () => {
  expect(getSafeContactUrl('mailto:test@test.org')).toEqual('mailto:test@test.org')
  expect(getSafeContactUrl('MAILTO:test@test.org,other@test.org')).toEqual('MAILTO:test@test.org,other@test.org')
  expect(getSafeContactUrl('http://node.org')).toEqual('http://node.org')
  expect(getSafeContactUrl(' https://node.org/contact ')).toEqual('https://node.org/contact')
  // eslint-disable-next-line no-script-url
  expect(getSafeContactUrl('javascript:alert(1)')).toBeNull()
  expect(getSafeContactUrl(' JavaScript:alert(1)')).toBeNull()
  expect(getSafeContactUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  expect(getSafeContactUrl('//node.org')).toBeNull()
  expect(getSafeContactUrl('test@test.org')).toBeNull()
  expect(getSafeContactUrl('')).toBeNull()
  expect(getSafeContactUrl(null)).toBeNull()
  expect(getSafeContactUrl(undefined)).toBeNull()
  expect(getSafeContactUrl({ href: 'mailto:test@test.org' })).toBeNull()
})

test('loads new and reviewing matches and shows them in context', async () => {
  mockFetchResponse(RESPONSE)
  const wrapper = mount(<MatchmakerInbox />)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=new%2Creviewing&page=1`)
  expect(wrapper.find('Loader').prop('active')).toBe(true)
  expect(getRow(wrapper, 0).text()).toEqual('Loading...')
  expect(wrapper.find('LabelDetail').map(detail => detail.text())).toEqual(['-', '-', '-', '-', '-'])
  wrapper.find('Checkbox[aria-label="Select all matches"]').prop('onChange')()
  wrapper.update()
  expect(wrapper.find('.bulk-actions').text()).toContain('0 selected')

  await flush(wrapper)
  expect(wrapper.find('Loader').prop('active')).toBe(false)
  expect(wrapper.find('TableBody').find('TableRow')).toHaveLength(4)

  const statusCounts = wrapper.find('LabelGroup').find('Label')
  expect(statusCounts.map(label => label.text())).toEqual([
    'New1', 'Reviewing0', 'Relevant12', 'Not Relevant3', 'Responded1',
  ])
  expect(statusCounts.map(label => label.prop('basic'))).toEqual([false, false, true, true, true])

  const row = getRow(wrapper, 0)
  const cells = row.find('TableCell')
  expect(cells.at(1).text()).toEqual('NA19675_1Family 11kg projectView match and contact')
  const pageLink = cells.at(1).find('a')
  expect(pageLink.prop('href')).toEqual('/project/R0001_1kg/family_page/F000001_1/matchmaker_exchange')
  expect(pageLink.prop('target')).toEqual('_blank')

  // Overlapping genes and phenotypes are highlighted for both our submission and the match
  expect(labelContents(cells.at(2))).toEqual([
    ['MFSD9', 'green'], ['Muscular hypotonia', 'green'], ['Absent: Global developmental delay', undefined],
  ])
  expect(labelContents(cells.at(4))).toEqual([
    ['MFSD9', 'green'], ['NOT_A_GENE', undefined], ['Muscular hypotonia', 'green'], ['HP:0009999', undefined],
  ])

  expect(cells.at(3).text()).toEqual('Test InstituteDr TestPatient 1 / P-11/10/2024 - Score: 0.571')
  const contactLink = cells.at(3).find('a')
  expect(contactLink.prop('href')).toEqual('mailto:dr.test@test.org')
  expect(contactLink.prop('rel')).toEqual('noopener noreferrer')

  expect(labelContents(cells.at(5))).toEqual([['New', 'blue'], ['Host contacted', undefined]])
  expect(cells.at(5).text()).toEqual('NewHost contactedUnassigned')

  expect(wrapper.text()).toContain('Showing 1-4 of 4 matches')
  expect(wrapper.find('Pagination').exists()).toBe(false)
  expect(wrapper.find('Message').exists()).toBe(false)

  expect(wrapper.find('FormDropdown[name="institution"]').prop('options')).toEqual([
    { value: 'Test Institute', text: 'Test Institute' }, { value: 'Other Institute', text: 'Other Institute' },
  ])
  expect(wrapper.find('FormDropdown[name="projectGuid"]').prop('options')).toEqual([
    { value: 'R0001_1kg', text: '1kg project' }, { value: 'R0002_empty', text: 'Empty' },
  ])
})

test('renders malformed and missing contact details from external nodes as text', async () => {
  const wrapper = await mountInbox()

  const malformedCells = getRow(wrapper, 1).find('TableCell')
  expect(malformedCells.at(3).find('a').exists()).toBe(false)
  expect(malformedCells.at(3).find('.unlinked-contact').text()).toEqual(
    'Mallory - javascript:alert(document.cookie)',
  )
  expect(malformedCells.at(3).text()).toEqual(
    'Mallory - javascript:alert(document.cookie)<img src=x onerror=alert(1)>1/10/2024VariantMatcherRemoved',
  )
  expect(malformedCells.at(3).find('img').exists()).toBe(false)
  expect(malformedCells.at(2).text()).toEqual('None')
  expect(malformedCells.at(4).text()).toEqual('None')
  expect(labelContents(malformedCells.at(5))).toEqual([['Relevant', 'green'], ['We contacted', undefined]])
  expect(malformedCells.at(5).text()).toEqual('RelevantWe contactedAssigned to Test UserA triage comment')

  const emptyCells = getRow(wrapper, 2).find('TableCell')
  expect(emptyCells.at(3).find('a').exists()).toBe(false)
  expect(emptyCells.at(3).text()).toEqual('1/10/2024')
  // An unknown status is shown as is
  expect(labelContents(emptyCells.at(5))).toEqual([['archived', undefined]])

  const httpCells = getRow(wrapper, 3).find('TableCell')
  expect(httpCells.at(3).find('a').prop('href')).toEqual('https://node.org/contact?id=1')
  expect(httpCells.at(3).find('a').text()).toEqual('https://node.org/contact?id=1')

  expect(wrapper.find('a').map(link => link.prop('href')).filter(href => href && href.includes('script'))).toEqual([])
})

test('filters matches on the server', async () => {
  const wrapper = await mountInbox()

  const setFilter = async (selector, data) => {
    mockFetchResponse(RESPONSE)
    wrapper.find(selector).prop('onChange')({}, data)
    await flush(wrapper)
    return getLastFetchUrl()
  }

  mockFetchResponse(RESPONSE)
  wrapper.find('LabelGroup').find('Label[name="relevant"]').find('a').simulate('click')
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=relevant&page=1`)
  expect(wrapper.find('LabelGroup').find('Label').map(label => label.prop('basic'))).toEqual(
    [true, true, false, true, true],
  )
  expect(wrapper.find('FormDropdown[name="status"]').prop('value')).toEqual(['relevant'])

  expect(await setFilter('FormDropdown[name="status"]', { value: ['relevant', 'responded'] })).toEqual(
    `${INBOX_URL}?status=relevant%2Cresponded&page=1`,
  )
  expect(await setFilter('FormDropdown[name="status"]', { value: [] })).toEqual(`${INBOX_URL}?status=all&page=1`)

  expect(await setFilter('FormDropdown[name="institution"]', { value: 'Test Institute' })).toEqual(
    `${INBOX_URL}?status=all&page=1&institution=Test%20Institute`,
  )
  expect(await setFilter('FormDropdown[name="institution"]', { value: '' })).toEqual(`${INBOX_URL}?status=all&page=1`)
  expect(await setFilter('FormDropdown[name="projectGuid"]', { value: 'R0001_1kg' })).toEqual(
    `${INBOX_URL}?status=all&page=1&projectGuid=R0001_1kg`,
  )
  expect(await setFilter('FormDropdown[name="source"]', { value: 'variantmatcher' })).toEqual(
    `${INBOX_URL}?status=all&page=1&projectGuid=R0001_1kg&source=variantmatcher`,
  )
  await setFilter('FormDropdown[name="projectGuid"]', {})
  expect(await setFilter('FormDropdown[name="source"]', { value: undefined })).toEqual(`${INBOX_URL}?status=all&page=1`)

  expect(await setFilter('FormInput[name="startDate"]', { value: '2024-01-01' })).toEqual(
    `${INBOX_URL}?status=all&page=1&startDate=2024-01-01`,
  )
  expect(await setFilter('FormInput[name="endDate"]', { value: '2024-02-01' })).toEqual(
    `${INBOX_URL}?status=all&page=1&startDate=2024-01-01&endDate=2024-02-01`,
  )
  await setFilter('FormInput[name="startDate"]', { value: '' })
  await setFilter('FormInput[name="endDate"]', { value: '' })

  expect(await setFilter('FormCheckbox[name="assignedToMe"]', { checked: true })).toEqual(
    `${INBOX_URL}?status=all&page=1&assignedToMe=true`,
  )
  expect(wrapper.find('FormCheckbox[name="assignedToMe"]').prop('checked')).toBe(true)
  expect(await setFilter('FormCheckbox[name="assignedToMe"]', { checked: false })).toEqual(
    `${INBOX_URL}?status=all&page=1`,
  )

  // The gene filter is only applied when it is submitted
  const fetchCount = fetch.mock.calls.length
  wrapper.find('FormInput[name="gene"]').prop('onChange')({}, { value: ' mfsd9 ' })
  await flush(wrapper)
  expect(fetch).toHaveBeenCalledTimes(fetchCount)
  expect(wrapper.find('FormInput[name="gene"]').prop('value')).toEqual(' mfsd9 ')
  mockFetchResponse(RESPONSE)
  wrapper.find('form').simulate('submit')
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=all&page=1&gene=mfsd9`)
})

test('pages through matches on the server', async () => {
  const pagedResponse = { ...RESPONSE, totalResults: 120, perPage: 4 }
  const wrapper = await mountInbox(pagedResponse)
  expect(wrapper.text()).toContain('Showing 1-4 of 120 matches')
  const pagination = wrapper.find('Pagination')
  expect(pagination.prop('totalPages')).toEqual(30)
  expect(pagination.prop('activePage')).toEqual(1)

  mockFetchResponse({ ...pagedResponse, page: 3, results: [OVERLAP_RESULT] })
  pagination.prop('onPageChange')({}, { activePage: 3 })
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=new%2Creviewing&page=3`)
  expect(wrapper.text()).toContain('Showing 9-9 of 120 matches')
  expect(wrapper.find('Pagination').prop('activePage')).toEqual(3)

  // Changing a filter returns to the first page
  mockFetchResponse(pagedResponse)
  wrapper.find('FormCheckbox[name="assignedToMe"]').prop('onChange')({}, { checked: true })
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=new%2Creviewing&page=1&assignedToMe=true`)
})

test('shows an empty inbox and loading errors', async () => {
  const wrapper = await mountInbox({ ...RESPONSE, results: [], totalResults: 0, institutions: [], projects: [] })
  expect(wrapper.find('TableBody').find('TableRow')).toHaveLength(1)
  expect(getRow(wrapper, 0).text()).toEqual('No matches found')
  expect(wrapper.text()).not.toContain('Showing')
  expect(wrapper.find('Checkbox[aria-label="Select all matches"]').prop('checked')).toBe(false)
  wrapper.find('Checkbox[aria-label="Select all matches"]').prop('onChange')()
  wrapper.update()
  expect(wrapper.find('.bulk-actions').text()).toContain('0 selected')

  mockFetchResponse({ error: 'Something went wrong' }, { ok: false, status: 500 })
  wrapper.find('FormCheckbox[name="assignedToMe"]').prop('onChange')({}, { checked: true })
  await flush(wrapper)
  const message = wrapper.find('Message')
  expect(message.prop('header')).toEqual('Unable to load matches')
  expect(message.prop('content')).toEqual('Something went wrong')
  expect(wrapper.find('Loader').prop('active')).toBe(false)

  mockFetchResponse(RESPONSE)
  wrapper.find('FormCheckbox[name="assignedToMe"]').prop('onChange')({}, { checked: false })
  await flush(wrapper)
  expect(wrapper.find('Message').exists()).toBe(false)
  expect(wrapper.find('TableBody').find('TableRow')).toHaveLength(4)
})

test('updates a match with the quick actions and reloads', async () => {
  const wrapper = await mountInbox()

  const newRowButtons = getRow(wrapper, 0).find('Button')
  expect(newRowButtons.map(button => [button.prop('content'), button.prop('disabled')])).toEqual([
    ['Reviewing', false], ['Relevant', false], ['Not Relevant', false], ['Assign to Me', false],
  ])
  expect(getRow(wrapper, 1).find('Button').map(button => [button.prop('content'), button.prop('disabled')])).toEqual([
    ['Reviewing', false], ['Relevant', true], ['Not Relevant', false], ['Unassign', false],
  ])

  const updatedResponse = {
    ...RESPONSE,
    results: [{ ...OVERLAP_RESULT, status: 'relevant' }, MALFORMED_RESULT],
    statusCounts: { ...RESPONSE.statusCounts, new: 0, relevant: 13 },
  }
  queueUpdateAndReload(updatedResponse)
  clickButton(getRow(wrapper, 0), 'Relevant')
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}/update`)
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_overlap'], status: 'relevant' })
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=new%2Creviewing&page=1`)
  expect(wrapper.find('TableBody').find('TableRow')).toHaveLength(2)
  expect(getRow(wrapper, 0).find('Label.result-status').prop('content')).toEqual('Relevant')
  expect(wrapper.find('LabelGroup').find('Label').map(label => label.text())).toEqual([
    'New0', 'Reviewing0', 'Relevant13', 'Not Relevant3', 'Responded1',
  ])

  queueUpdateAndReload(updatedResponse)
  clickButton(getRow(wrapper, 0), 'Not Relevant')
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_overlap'], status: 'not_relevant' })
  await flush(wrapper)
  queueUpdateAndReload(updatedResponse)
  clickButton(getRow(wrapper, 0), 'Reviewing')
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_overlap'], status: 'reviewing' })
  await flush(wrapper)

  queueUpdateAndReload()
  clickButton(getRow(wrapper, 0), 'Assign to Me')
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_overlap'], assignedToMe: true })
  await flush(wrapper)
  queueUpdateAndReload()
  clickButton(getRow(wrapper, 1), 'Unassign')
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_malformed'], assignedToMe: false })
  await flush(wrapper)
  expect(wrapper.find('TableBody').find('TableRow')).toHaveLength(4)
})

test('updates the selected matches with the bulk actions', async () => {
  const wrapper = await mountInbox()

  const bulkButtons = () => wrapper.find('.bulk-actions').find('Button')
  const selectAll = () => wrapper.find('Checkbox[aria-label="Select all matches"]')
  const toggleRow = (index) => {
    getRow(wrapper, index).find('Checkbox').prop('onChange')()
    wrapper.update()
  }

  expect(bulkButtons().map(button => button.prop('content'))).toEqual([
    'Reviewing', 'Relevant', 'Not Relevant', 'Assign to Me', 'Unassign',
  ])
  expect(bulkButtons().map(button => button.prop('disabled'))).toEqual([true, true, true, true, true])
  expect(wrapper.find('.bulk-actions').text()).toContain('0 selected')

  toggleRow(0)
  toggleRow(2)
  expect(wrapper.find('.bulk-actions').text()).toContain('2 selected')
  expect(bulkButtons().map(button => button.prop('disabled'))).toEqual([false, false, false, false, false])
  expect(getRow(wrapper, 0).prop('active')).toBe(true)
  expect(getRow(wrapper, 1).prop('active')).toBe(false)
  expect(selectAll().prop('checked')).toBe(false)
  expect(selectAll().prop('indeterminate')).toBe(true)

  toggleRow(2)
  expect(wrapper.find('.bulk-actions').text()).toContain('1 selected')
  toggleRow(2)

  queueUpdateAndReload()
  clickButton(wrapper.find('.bulk-actions'), 'Not Relevant')
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}/update`)
  expect(getLastFetchBody()).toEqual({ resultGuids: ['MR_overlap', 'MR_empty'], status: 'not_relevant' })
  await flush(wrapper)
  expect(getLastFetchUrl()).toEqual(`${INBOX_URL}?status=new%2Creviewing&page=1`)

  // The selection is cleared once the matches are reloaded
  expect(wrapper.find('.bulk-actions').text()).toContain('0 selected')
  expect(getRow(wrapper, 0).prop('active')).toBe(false)

  selectAll().prop('onChange')()
  wrapper.update()
  expect(wrapper.find('.bulk-actions').text()).toContain('4 selected')
  expect(selectAll().prop('checked')).toBe(true)
  expect(selectAll().prop('indeterminate')).toBe(false)

  queueUpdateAndReload()
  clickButton(wrapper.find('.bulk-actions'), 'Assign to Me')
  expect(getLastFetchBody()).toEqual({
    resultGuids: ['MR_overlap', 'MR_malformed', 'MR_empty', 'MR_http'], assignedToMe: true,
  })
  await flush(wrapper)

  selectAll().prop('onChange')()
  selectAll().prop('onChange')()
  wrapper.update()
  expect(wrapper.find('.bulk-actions').text()).toContain('0 selected')

  const bulkUpdate = async (content) => {
    toggleRow(3)
    queueUpdateAndReload()
    clickButton(wrapper.find('.bulk-actions'), content)
    const body = getLastFetchBody()
    await flush(wrapper)
    return body
  }
  expect(await bulkUpdate('Unassign')).toEqual({ resultGuids: ['MR_http'], assignedToMe: false })
  expect(await bulkUpdate('Reviewing')).toEqual({ resultGuids: ['MR_http'], status: 'reviewing' })
  expect(await bulkUpdate('Relevant')).toEqual({ resultGuids: ['MR_http'], status: 'relevant' })
})

test('reports an update the user is not permitted to make and keeps the matches unchanged', async () => {
  const wrapper = await mountInbox()

  getRow(wrapper, 0).find('Checkbox').prop('onChange')()
  wrapper.update()

  mockFetchResponse({ error: 'Permission Denied' }, { ok: false, status: 403 })
  const fetchCount = fetch.mock.calls.length
  clickButton(getRow(wrapper, 0), 'Relevant')
  await flush(wrapper)

  // The matches are not reloaded
  expect(fetch).toHaveBeenCalledTimes(fetchCount + 1)
  const message = wrapper.find('Message')
  expect(message.prop('header')).toEqual('Unable to update matches')
  expect(message.prop('content')).toEqual('Permission Denied')
  expect(getRow(wrapper, 0).find('Label.result-status').prop('content')).toEqual('New')
  expect(wrapper.find('.bulk-actions').text()).toContain('1 selected')

  // The error is cleared by the next update
  queueUpdateAndReload()
  clickButton(wrapper.find('.bulk-actions'), 'Reviewing')
  wrapper.update()
  expect(wrapper.find('Message').exists()).toBe(false)
  await flush(wrapper)
  expect(wrapper.find('Message').exists()).toBe(false)
})
