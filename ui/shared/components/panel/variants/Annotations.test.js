import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import Annotations from './Annotations'
import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<Annotations store={store} variant={VARIANT} />)
  shallow(<Annotations store={store} variant={SV_VARIANT} />)
})

const mountLinks = (variant, state) => {
  const store = configureStore([thunk])({ ...STATE1, transcriptsById: {}, modal: {}, ...state })
  const wrapper = mount(
    <Provider store={store}><MemoryRouter><Annotations variant={variant} /></MemoryRouter></Provider>,
  )
  const showAll = wrapper.find('button.ui.button').filterWhere(b => b.find('i.ellipsis').length > 0)
  if (showAll.length) {
    showAll.simulate('click')
  }
  const externalLinks = () => wrapper.find('a').filterWhere(a => (a.prop('href') || '').startsWith('https://'))
  return { store, wrapper, externalLinks }
}

test('SNV search links keep their order and open frameable resources in the flyout', () => {
  const genesById = { ENSG00000228198: { geneId: 'ENSG00000228198', geneSymbol: 'OR2M3', geneNames: 'OR2M3' } }
  const transcripts = { ENSG00000228198: [{ ...VARIANT.transcripts.ENSG00000228198[0], geneId: 'ENSG00000228198' }] }
  const { store, wrapper, externalLinks } = mountLinks(
    { ...VARIANT, transcripts }, { genesById, user: { ...STATE1.user, isAnalyst: true } },
  )

  expect(Object.fromEntries(externalLinks().map(a => [a.text(), a.prop('href')]))).toEqual(expect.objectContaining({
    Google: 'https://scholar.google.com/scholar?q=(OR2M3) AND (c.862delC OR 862delC OR c.862delC OR 862delC OR p.Leu288SerfsTer10 OR Leu288SerfsTer10 OR 248367227TC/T OR 248367227TC>T OR g.248367227TC>T)',
    pubmed: 'https://www.ncbi.nlm.nih.gov/pubmed?term=(OR2M3) AND (c.862delC OR 862delC OR c.862delC OR 862delC OR p.Leu288SerfsTer10 OR Leu288SerfsTer10 OR 248367227TC/T OR 248367227TC>T OR g.248367227TC>T)',
    AoU: 'https://databrowser.researchallofus.org/variants/1-248367227-TC-T',
    Iranome: 'https://www.iranome.com/variant/1-248367227-TC-T',
    Geno2MP: 'https://geno2mp.gs.washington.edu/Geno2MP/#/gene/1:248367227/chrLoc/248367227/248367227/1',
    Mastermind: 'https://mastermind.genomenon.com/detail?gene=OR2M3&mutation=OR2M3:862delC',
    BCH: 'https://aggregator.bchresearch.org/variant.html?variant=1:248367227:TC:T',
  }))
  const labels = externalLinks().map(a => a.text())
  expect(labels.slice(labels.indexOf('Google'))).toEqual(
    ['Google', 'pubmed', 'AoU', 'Iranome', 'Geno2MP', 'Mastermind', 'BCH'],
  )

  const click = label => externalLinks().filterWhere(a => a.text() === label).simulate('click', { button: 0 })
  click('pubmed')
  expect(store.getActions()).toEqual([])
  click('Geno2MP')
  expect(store.getActions()).toEqual([{
    type: 'OPEN_EXTERNAL_RESOURCE_FLYOUT',
    activeKey: 'geno2mp',
    context: {
      entity: 'variant',
      title: 'OR2M3 1:248367227 TC > T',
      links: expect.arrayContaining([expect.objectContaining({ key: 'geno2mp', frameable: true })]),
    },
  }])
  wrapper.unmount()
})

test('SV search links', () => {
  const { store, wrapper, externalLinks } = mountLinks({ ...SV_VARIANT, svType: 'DEL', ref: undefined })
  const gnomad = externalLinks().filterWhere(a => a.text() === 'gnomAD')
  expect(gnomad.prop('href')).toEqual(
    'https://gnomad.broadinstitute.org/region/1-248367227-248369100?dataset=gnomad_sv_r4',
  )
  gnomad.simulate('click', { button: 0 })
  expect(store.getActions()[0].context.title).toEqual('DEL 1:248367227-248369100')
  wrapper.unmount()
})
