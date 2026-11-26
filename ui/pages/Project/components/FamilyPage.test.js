import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import FamilyPage, { FamilyDetail } from './FamilyPage'
import { STATE_WITH_2_FAMILIES } from '../fixtures'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const INITIAL_ENTRIES = ['/project/R0237_1000_genomes_demo/family_page/F011652_1']

test('renders the family display name and its individuals', () => {
  const store = configureStore(STATE_WITH_2_FAMILIES)

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={INITIAL_ENTRIES}>
        <Route path="/project/:projectGuid/family_page/:familyGuid" component={FamilyPage} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.find('IndividualRow').length).toEqual(3)
})

test('renders discovery genes and disables search when data is not loaded, with no workspace loading message', () => {
  const state = {
    ...STATE_WITH_2_FAMILIES,
    familiesByGuid: {
      ...STATE_WITH_2_FAMILIES.familiesByGuid,
      F011652_1: {
        ...STATE_WITH_2_FAMILIES.familiesByGuid.F011652_1,
        discoveryGeneIds: ['ENSG00000228198', 'ENSG00000164458', 'ENSG00000228198', 'ENSG00000UNKNOWN'],
      },
    },
    projectsByGuid: {
      ...STATE_WITH_2_FAMILIES.projectsByGuid,
      R0237_1000_genomes_demo: {
        ...STATE_WITH_2_FAMILIES.projectsByGuid.R0237_1000_genomes_demo,
        workspaceName: undefined,
      },
    },
    familyTagTypeCounts: {},
  }
  const store = configureStore(state)

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={INITIAL_ENTRIES}>
        <Route path="/project/:projectGuid/family_page/:familyGuid" component={FamilyPage} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.text()).toContain('Discovery Genes:')
  expect(wrapper.text()).toContain('OR2M3, TBXT')
  const popups = wrapper.find('Popup').filterWhere(p => typeof p.prop('content') === 'string')
  expect(popups.at(0).prop('content')).toEqual('Search is disabled until data is loaded')
})

test('renders no discovery genes when none match known genes', () => {
  const state = {
    ...STATE_WITH_2_FAMILIES,
    familiesByGuid: {
      ...STATE_WITH_2_FAMILIES.familiesByGuid,
      F011652_1: {
        ...STATE_WITH_2_FAMILIES.familiesByGuid.F011652_1,
        discoveryGeneIds: ['ENSG00000UNKNOWN'],
      },
    },
  }
  const store = configureStore(state)

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={INITIAL_ENTRIES}>
        <Route path="/project/:projectGuid/family_page/:familyGuid" component={FamilyPage} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.text()).not.toContain('Discovery Genes:')
})

test('renders compact family detail without variant details or expanded content', () => {
  const store = configureStore(STATE_WITH_2_FAMILIES)

  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={INITIAL_ENTRIES}>
        <FamilyDetail familyGuid="F011652_1" compact showVariantDetails={false} fields={[]} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.find('ExpandedFamily').length).toEqual(0)
  expect(wrapper.find('VariantDetail').length).toEqual(0)
})

test('shows the clinical data completeness of the family and of its affected individuals', () => {
  const missing = [{ field: 'onsetAge', label: 'Age of onset', weight: 10, level: 'individual' }]
  const state = {
    ...STATE_WITH_2_FAMILIES,
    individualsByGuid: {
      ...STATE_WITH_2_FAMILIES.individualsByGuid,
      I021476_na19678_1: { ...STATE_WITH_2_FAMILIES.individualsByGuid.I021476_na19678_1, completeness: null },
      I021474_na19679_1: { ...STATE_WITH_2_FAMILIES.individualsByGuid.I021474_na19679_1, completeness: null },
      I021475_na19675_1: {
        ...STATE_WITH_2_FAMILIES.individualsByGuid.I021475_na19675_1, completeness: { score: 90, missing },
      },
    },
  }
  const renderFamily = (familyGuid, props) => mount(
    <Provider store={configureStore(state)}>
      <MemoryRouter>
        <FamilyDetail familyGuid={familyGuid} {...props} />
      </MemoryRouter>
    </Provider>,
  )

  const wrapper = renderFamily('F011652_1', { showVariantDetails: true })
  expect(wrapper.find('FamilyCompletenessLabel').text()).toEqual('Clinical data 90% partly complete')
  expect(wrapper.find('FamilyCompletenessLabel').prop('completeness')).toEqual(
    { score: 90, numIndividuals: 1, numNoFeatures: 0 },
  )
  expect(wrapper.find('IndividualCompletenessLabel').map(label => label.text())).toEqual(
    ['Clinical data 90% partly complete', '', ''],
  )
  expect(wrapper.find('Connect(BaseVariantDetail)').exists()).toBe(true)

  const compactWrapper = renderFamily('F011652_1', { compact: true })
  expect(compactWrapper.find('FamilyCompletenessLabel').text()).toEqual('Clinical data 90% partly complete')
  expect(compactWrapper.find('IndividualCompletenessLabel')).toHaveLength(0)
  expect(compactWrapper.find('Connect(BaseVariantDetail)').exists()).toBe(false)

  // families with no scored individuals have no indicator
  expect(renderFamily('F011652_2', { compact: true }).find('FamilyCompletenessLabel').isEmptyRender()).toBe(true)
})
