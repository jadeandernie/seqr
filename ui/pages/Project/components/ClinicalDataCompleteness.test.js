import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import {
  IndividualCompletenessLabel, FamilyCompletenessLabel, ProjectCompletenessSummary,
} from './ClinicalDataCompleteness'

configure({ adapter: new Adapter() })

const MISSING = [
  { field: 'features', label: 'Observed features (HPO terms)', weight: 30, level: 'individual' },
  { field: 'mondoId', label: 'Family MONDO disease ID', weight: 4, level: 'family' },
]

const popupContent = wrapper => mount(wrapper.find('Popup').prop('content'))

describe('IndividualCompletenessLabel', () => {
  test('shows the score in words with an icon, and lists the missing data by label in a popup', () => {
    const wrapper = mount(<IndividualCompletenessLabel completeness={{ score: 66, missing: MISSING }} />)

    expect(wrapper.text()).toEqual('Clinical data 66% partly complete')
    expect(wrapper.find('Icon').prop('name')).toEqual('adjust')
    expect(wrapper.find('Label').prop('color')).toEqual('yellow')

    const content = popupContent(wrapper)
    expect(content.find('b').text()).toEqual('Not yet recorded for this individual:')
    expect(content.find('ListItem').map(item => item.text())).toEqual(
      ['Observed features (HPO terms)', 'Family MONDO disease ID'],
    )
  })

  test('distinguishes each level by wording and icon as well as color', () => {
    const levels = [100, 99, 50, 49, 0].map((score) => {
      const wrapper = mount(<IndividualCompletenessLabel completeness={{ score, missing: [] }} />)
      return [wrapper.text(), wrapper.find('Icon').prop('name'), wrapper.find('Label').prop('color')]
    })
    expect(levels).toEqual([
      ['Clinical data 100% complete', 'check circle', 'green'],
      ['Clinical data 99% partly complete', 'adjust', 'yellow'],
      ['Clinical data 50% partly complete', 'adjust', 'yellow'],
      ['Clinical data 49% mostly missing', 'warning circle', 'orange'],
      ['Clinical data 0% mostly missing', 'warning circle', 'orange'],
    ])
  })

  test('confirms when nothing is missing', () => {
    const wrapper = mount(<IndividualCompletenessLabel completeness={{ score: 100, missing: [] }} />)
    const content = popupContent(wrapper)
    expect(content.text()).toEqual('All of the scored clinical data is recorded for this individual')
    expect(content.find('ListItem')).toHaveLength(0)
  })

  test('renders nothing for individuals who are not scored', () => {
    expect(mount(<IndividualCompletenessLabel completeness={null} />).isEmptyRender()).toBe(true)
    expect(mount(<IndividualCompletenessLabel />).isEmptyRender()).toBe(true)
  })
})

describe('FamilyCompletenessLabel', () => {
  test('shows the family average and explains it in a popup', () => {
    const wrapper = mount(
      <FamilyCompletenessLabel completeness={{ score: 40, numIndividuals: 3, numNoFeatures: 2 }} />,
    )
    expect(wrapper.text()).toEqual('Clinical data 40% mostly missing')
    expect(wrapper.find('Icon').prop('name')).toEqual('warning circle')
    expect(popupContent(wrapper).text()).toEqual(
      'Average for 3 affected individuals in this family2 individuals have no HPO terms',
    )
  })

  test('uses singular wording and omits the HPO terms warning when all individuals have HPO terms', () => {
    const wrapper = mount(
      <FamilyCompletenessLabel completeness={{ score: 100, numIndividuals: 1, numNoFeatures: 0 }} />,
    )
    expect(wrapper.text()).toEqual('Clinical data 100% complete')
    expect(popupContent(wrapper).text()).toEqual('Average for 1 affected individual in this family')

    const noFeaturesWrapper = mount(
      <FamilyCompletenessLabel completeness={{ score: 9, numIndividuals: 1, numNoFeatures: 1 }} />,
    )
    expect(popupContent(noFeaturesWrapper).text()).toEqual(
      'Average for 1 affected individual in this family1 individual has no HPO terms',
    )
  })

  test('renders nothing for families with no affected individuals', () => {
    expect(mount(<FamilyCompletenessLabel completeness={null} />).isEmptyRender()).toBe(true)
  })
})

describe('ProjectCompletenessSummary', () => {
  test('summarizes the score, affected individuals and individuals with no HPO terms', () => {
    const wrapper = mount(
      <ProjectCompletenessSummary completeness={{ score: 64, numIndividuals: 12, numNoFeatures: 3 }} />,
    )
    expect(wrapper.text()).toEqual('64% across 12 affected individuals3 individuals have no HPO terms')

    const singleWrapper = mount(
      <ProjectCompletenessSummary completeness={{ score: 9, numIndividuals: 1, numNoFeatures: 1 }} />,
    )
    expect(singleWrapper.text()).toEqual('9% across 1 affected individual1 individual has no HPO terms')
  })

  test('states when there are no affected individuals', () => {
    expect(mount(<ProjectCompletenessSummary completeness={null} />).text()).toEqual('No affected individuals')
  })
})
