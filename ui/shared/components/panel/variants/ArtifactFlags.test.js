import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { Label, Popup } from 'semantic-ui-react'

import ArtifactFlags from './ArtifactFlags'

configure({ adapter: new Adapter() })

const STATE = {
  individualsByGuid: {
    I_CHILD: { individualGuid: 'I_CHILD', displayName: 'NA19675', sex: 'F', maternalGuid: 'I_MOM', paternalGuid: 'I_DAD' },
    I_MOM: { individualGuid: 'I_MOM', displayName: 'NA19678', sex: 'F' },
    I_DAD: { individualGuid: 'I_DAD', displayName: '', individualId: 'NA19679', sex: 'M' },
  },
}

const CLEAN_VARIANT = {
  chrom: '1',
  pos: 248367227,
  genomeVersion: '38',
  genotypes: {
    I_CHILD: { numAlt: 1, gq: 99, ab: 0.48, dp: 60, filters: [] },
    I_MOM: { numAlt: 1, gq: 99, ab: 0.51, dp: 55, filters: [] },
    I_DAD: { numAlt: 0, gq: 99, ab: 0, dp: 48, filters: [] },
  },
}

const FLAGGED_VARIANT = {
  ...CLEAN_VARIANT,
  genotypes: {
    I_CHILD: { numAlt: 1, gq: 99, ab: 0.15, dp: 60, filters: ['VQSRTrancheSNP99.90to99.95'] },
    I_MOM: { numAlt: 0, gq: 99, ab: 0.06, dp: 50, filters: ['VQSRTrancheSNP99.90to99.95'] },
    I_DAD: { numAlt: 0, gq: 12, ab: 0, dp: 7, filters: ['VQSRTrancheSNP99.90to99.95'] },
  },
}

const render = variant => mount(
  <Provider store={configureStore()(STATE)}><ArtifactFlags variant={variant} /></Provider>,
)

test('renders nothing for a variant with clean calls', () => {
  expect(render(CLEAN_VARIANT).html()).toEqual('')
  expect(render({ chrom: '1', pos: 1 }).html()).toEqual('')
})

test('renders a single "Possible artifact" label with the reasons per individual for a flagged variant', () => {
  const wrapper = render(FLAGGED_VARIANT)

  expect(wrapper.find(Label).length).toEqual(1)
  expect(wrapper.find(Label).text()).toEqual('Possible artifact')
  expect(wrapper.find(Label).prop('color')).toEqual('orange')

  const sections = mount(<div>{wrapper.find(Popup).prop('content')}</div>).find('.artifact-flag-group')
  expect(sections.map(section => section.find('b').first().text())).toEqual(['Variant', 'NA19675', 'NA19679'])
  expect(sections.map(section => section.find('li').map(item => item.text()))).toEqual([
    ['Failed site filters: VQSRTrancheSNP99.90to99.95'],
    [
      'Apparent de novo with alt reads in a parent: Mother (NA19678) has 3 alt reads (allele balance 0.060, DP 50)',
      'Apparent de novo with low parental coverage: Father DP 7 is below 10',
      'Unbalanced het call: Allele balance 0.15 is outside 0.25-0.75',
    ],
    ['Low genotype quality: GQ 12 is below 20', 'Low read depth: DP 7 is below 10'],
  ])
})
