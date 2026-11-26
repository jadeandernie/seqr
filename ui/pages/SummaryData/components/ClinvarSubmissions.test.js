import React from 'react'
import { BrowserRouter as Router } from 'react-router-dom'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import { mockFetchResponse, flushAll, getLastFetchUrl } from 'shared/utils/testHelpers'
import { DRAFT_SUBMISSION } from 'shared/components/panel/clinvar/fixtures'
import ClinvarSubmissions from './ClinvarSubmissions'

configure({ adapter: new Adapter() })

const SUBMISSIONS = [
  DRAFT_SUBMISSION,
  {
    ...DRAFT_SUBMISSION,
    submissionGuid: 'CS0000002_clinvar',
    status: 'processed',
    variantGuid: 'SV0000006_1248367227_r0003_tes',
    variantId: '1-248367227-TC-T',
    projectGuid: 'R0003_test',
    scvAccession: 'SCV000123456',
    reviewedBy: 'Test PM User',
    submittedBy: 'Test User',
    lastModifiedDate: '2026-11-22T10:00:00.000Z',
  },
  {
    ...DRAFT_SUBMISSION,
    submissionGuid: 'CS0000003_clinvar',
    status: 'draft',
    variantGuid: null,
    variantId: null,
    projectGuid: null,
    lastModifiedDate: '2026-11-18T10:00:00.000Z',
  },
]

const mountPage = async (response, fetchOptions = {}) => {
  mockFetchResponse(response, fetchOptions)
  const wrapper = mount(<Router><ClinvarSubmissions /></Router>)
  await flushAll()
  wrapper.update()
  return wrapper
}

const rowTexts = (wrapper) => wrapper.find('tbody tr').map(row => row.find('td').map(cell => cell.text()))

test('lists submissions by status with links and the mode banner', async () => {
  const wrapper = await mountPage({ clinvarSubmissions: SUBMISSIONS, clinvarMode: 'dry_run' })

  expect(getLastFetchUrl()).toEqual('/api/summary_data/clinvar_submissions?')
  expect(wrapper.find('.clinvar-mode-banner').first().text()).toContain('DRY RUN — nothing is sent to ClinVar')
  expect(wrapper.find('MenuItem').map(item => item.text())).toEqual(['All (3)', 'Draft (2)', 'Processed (1)'])

  const date = value => new Date(value).toLocaleDateString()
  expect(rowTexts(wrapper)).toEqual([
    ['Processed', '1-248367227-TC-T', 'Pathogenic', 'MONDO:0044970', 'SCV000123456', 'Test Manager User', 'Test PM User', 'Test User', date('2026-11-22T10:00:00.000Z')],
    ['Draft', '1-248367227-TC-T', 'Pathogenic', 'MONDO:0044970', '', 'Test Manager User', '', '', date('2026-11-20T10:00:00.000Z')],
    ['Draft', 'Saved variant deleted', 'Pathogenic', 'MONDO:0044970', '', 'Test Manager User', '', '', date('2026-11-18T10:00:00.000Z')],
  ])
  expect(wrapper.find('tbody a').map(link => link.prop('href'))).toEqual([
    '/project/R0003_test/saved_variants/variant/SV0000006_1248367227_r0003_tes',
    'https://www.ncbi.nlm.nih.gov/clinvar/?term=SCV000123456',
    '/project/R0001_1kg/saved_variants/variant/SV0000002_1248367227_r0390_100',
  ])

  wrapper.find('MenuItem[name="processed"]').find('a').simulate('click')
  expect(rowTexts(wrapper).map(row => row[0])).toEqual(['Processed'])
  expect(wrapper.find('MenuItem[name="processed"]').prop('active')).toBe(true)

  wrapper.find('MenuItem').first().find('a').simulate('click')
  expect(rowTexts(wrapper)).toHaveLength(3)
})

test('shows an empty table and the load error', async () => {
  const emptyWrapper = await mountPage({ clinvarSubmissions: [], clinvarMode: 'live' })
  expect(emptyWrapper.find('.clinvar-mode-banner').first().text()).toContain('LIVE — approved records are published in ClinVar')
  expect(emptyWrapper.find('MenuItem').map(item => item.text())).toEqual(['All (0)'])
  expect(emptyWrapper.find('tbody').text()).toEqual('No ClinVar submissions')

  const errorWrapper = await mountPage({ error: 'User has insufficient permission' }, { ok: false, status: 403 })
  expect(errorWrapper.find('.clinvar-error').first().text()).toEqual('User has insufficient permission')
  expect(errorWrapper.find('.clinvar-mode-banner').exists()).toBe(false)
})
