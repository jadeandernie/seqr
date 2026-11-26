import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import GeneDetail from './GeneDetail'

import { STATE1 } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<GeneDetail store={store} geneId="TTN" />)
})

const GENE_ID = 'ENSG00000228198'

const mountGeneDetail = (geneUpdates) => {
  const state = {
    ...STATE1,
    modal: {},
    genesLoading: { isLoading: false },
    genesById: { [GENE_ID]: { ...STATE1.genesById[GENE_ID], ...geneUpdates } },
  }
  return mount(
    <Provider store={configureStore([thunk])(state)}>
      <GeneDetail geneId={GENE_ID} />
    </Provider>,
  )
}

const getRowTitles = wrapper => wrapper.find('GridRow').map(row => row.find('GridColumn').first().text())

test('links to the Reactome pathways of a gene', () => {
  const wrapper = mountGeneDetail({
    reactomePathways: [
      { pathwayId: 'R-HSA-9013148', name: 'CDC42 GTPase cycle' },
      { pathwayId: 'R-HSA-162699', name: 'Synthesis of dolichyl-phosphate mannose' },
    ],
  })

  const titles = getRowTitles(wrapper)
  expect(titles.indexOf('Pathways')).toEqual(titles.indexOf('Gene Type') + 1)
  const pathways = wrapper.find('ReactomePathwayLinks')
  expect(pathways.text()).toEqual('CDC42 GTPase cycle, Synthesis of dolichyl-phosphate mannose')
  expect(pathways.find('a').map(link => [link.prop('href'), link.prop('target')])).toEqual([
    ['https://reactome.org/content/detail/R-HSA-9013148', '_blank'],
    ['https://reactome.org/content/detail/R-HSA-162699', '_blank'],
  ])
})

test('shows no pathways row for a gene without Reactome pathways', () => {
  expect(getRowTitles(mountGeneDetail({ reactomePathways: [] }))).not.toContain('Pathways')
  expect(getRowTitles(mountGeneDetail({}))).not.toContain('Pathways')
  expect(getRowTitles(mountGeneDetail({}))).toContain('Gene Type')
})
