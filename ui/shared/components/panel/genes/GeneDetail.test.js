import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import GeneDetail from './GeneDetail'

import { STATE1 } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<GeneDetail store={store} geneId="TTN" />)
})

test('renders external links that open in the flyout when the resource can be framed', () => {
  const gene = {
    geneId: 'ENSG00000155657', geneSymbol: 'TTN', geneNames: 'TTN;CMD1G', mimNumber: 188840, notes: [],
    omimPhenotypes: [{ phenotypeMimNumber: 604145, phenotypeDescription: 'Cardiomyopathy, dilated, 1G' }],
  }
  const store = configureStore([thunk])({
    ...STATE1, genesById: { [gene.geneId]: gene }, genesLoading: { isLoading: false }, modal: {},
  })
  const wrapper = mount(<Provider store={store}><GeneDetail geneId={gene.geneId} /></Provider>)

  const hrefsByLabel = Object.fromEntries(wrapper.find('a').map(a => [a.text(), a.prop('href')]))
  expect(Object.keys(hrefsByLabel).slice(0, 14)).toEqual([
    'OMIM', 'PubMed', 'GeneCards', 'Protein Atlas', 'NCBI Gene', 'GTEx Portal', 'Monarch', 'Decipher', 'UniProt',
    'Geno2MP', 'gnomAD', 'primAD', 'KEGG', 'ClinVar',
  ])
  expect(hrefsByLabel).toEqual(expect.objectContaining({
    OMIM: 'https://www.omim.org/entry/188840',
    PubMed: 'https://www.ncbi.nlm.nih.gov/pubmed/?term=(TTN OR CMD1G)',
    gnomAD: 'https://gnomad.broadinstitute.org/gene/ENSG00000155657?dataset=gnomad_r4',
    'Cardiomyopathy, dilated, 1G': 'https://www.omim.org/entry/604145',
  }))
  expect(wrapper.find('a').everyWhere(a => a.prop('target') === '_blank' && a.prop('rel') === 'noreferrer')).toBe(true)

  const click = label => wrapper.find('a').filterWhere(a => a.text() === label).simulate('click', { button: 0 })
  click('ClinVar')
  expect(store.getActions()).toEqual([])
  click('gnomAD')
  expect(store.getActions()).toEqual([expect.objectContaining({
    type: 'OPEN_EXTERNAL_RESOURCE_FLYOUT',
    activeKey: 'gnomad',
    context: expect.objectContaining({ entity: 'gene', title: 'TTN', geneId: 'ENSG00000155657' }),
  })])
  expect(store.getActions()[0].context.links.map(({ label }) => label)).toEqual(Object.keys(hrefsByLabel).slice(0, 14))

  wrapper.unmount()
})
