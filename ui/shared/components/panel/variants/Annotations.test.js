import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import Annotations from './Annotations'
import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<Annotations store={store} variant={VARIANT} />)
  shallow(<Annotations store={store} variant={SV_VARIANT} />)
})

const getLinkHrefs = (variant) => {
  const store = configureStore()({
    ...STATE1, transcriptsById: {}, modal: {}, user: { ...STATE1.user, isAnalyst: true },
  })
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter>
        <Annotations variant={variant} />
      </MemoryRouter>
    </Provider>,
  )
  const showAll = wrapper.find('ButtonLink').filterWhere(button => button.prop('icon') === 'ellipsis horizontal')
  if (showAll.exists()) {
    showAll.simulate('click')
  }
  return wrapper.find('a').reduce((acc, link) => ({ ...acc, [link.text()]: link.prop('href') }), {})
}

const SNV_37 = { ...VARIANT, liftedOverGenomeVersion: '38', liftedOverChrom: '1', liftedOverPos: 248203925 }
const SNV_38 = {
  ...VARIANT, genomeVersion: '38', pos: 248203925, liftedOverGenomeVersion: '37', liftedOverChrom: '1', liftedOverPos: 248367227,
}
const NO_LIFTOVER = { liftedOverGenomeVersion: null, liftedOverChrom: null, liftedOverPos: null }

const AOU_HREF = 'https://databrowser.researchallofus.org/variants/1-248203925-TC-T'
const GRCH37_HREFS = {
  Iranome: 'https://www.iranome.com/variant/1-248367227-TC-T',
  Geno2MP: 'https://geno2mp.gs.washington.edu/Geno2MP/#/gene/1:248367227/chrLoc/248367227/248367227/1',
  BCH: 'https://aggregator.bchresearch.org/variant.html?variant=1:248367227:TC:T',
}

test('external variant links use GRCh38 coordinates for All of Us and GRCh37 for Iranome, Geno2MP and BCH', () => {
  expect(getLinkHrefs(SNV_37)).toEqual(expect.objectContaining({ AoU: AOU_HREF, ...GRCH37_HREFS }))
  expect(getLinkHrefs(SNV_38)).toEqual(expect.objectContaining({ AoU: AOU_HREF, ...GRCH37_HREFS }))
})

test('external variant links are hidden when the variant has no coordinates on the build the site expects', () => {
  const grch37Links = getLinkHrefs({ ...SNV_37, ...NO_LIFTOVER })
  expect(grch37Links).toEqual(expect.objectContaining(GRCH37_HREFS))
  expect(grch37Links).not.toHaveProperty('AoU')

  const grch38Links = getLinkHrefs({ ...SNV_38, ...NO_LIFTOVER })
  expect(grch38Links.AoU).toEqual(AOU_HREF)
  Object.keys(GRCH37_HREFS).forEach(name => expect(grch38Links).not.toHaveProperty(name))
})

test('gnomAD structural variant link uses the dataset matching the variant genome build', () => {
  const sv = { ...SV_VARIANT, svType: 'DEL', ref: null }
  expect(getLinkHrefs(sv).gnomAD).toEqual(
    'https://gnomad.broadinstitute.org/region/1-248367227-248369100?dataset=gnomad_sv_r2_1',
  )
  expect(getLinkHrefs({ ...sv, genomeVersion: '38' }).gnomAD).toEqual(
    'https://gnomad.broadinstitute.org/region/1-248367227-248369100?dataset=gnomad_sv_r4',
  )
})
