import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import configureStore from 'redux-mock-store'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import { SummaryDataPageHeader } from './SummaryData'

configure({ adapter: new Adapter() })

const MATCH = { params: { subPage: 'gene_info' } }

const menuItems = (isAnalyst, clinvarSubmissionMode) => {
  const store = configureStore()({ user: { isAnalyst }, meta: { clinvarSubmissionMode } })
  const wrapper = mount(
    <Provider store={store}><MemoryRouter><SummaryDataPageHeader match={MATCH} /></MemoryRouter></Provider>,
  )
  return wrapper.find('NavLink').map(link => link.text())
}

test('only links the ClinVar submissions page for analysts when the feature is enabled', () => {
  const basePages = ['Gene Info', 'Gene Lists', 'Saved Variants', 'Individual Metadata', 'Hpo Terms', 'Matchmaker']
  const analystPages = [...basePages, 'Success Story', 'External Analysis']

  expect(menuItems(false, null)).toEqual(basePages)
  expect(menuItems(false, 'dry_run')).toEqual(basePages)
  expect(menuItems(true, null)).toEqual(analystPages)
  expect(menuItems(true, 'dry_run')).toEqual([...analystPages, 'Clinvar Submissions'])
  expect(menuItems(true, 'live')).toEqual([...analystPages, 'Clinvar Submissions'])
})
