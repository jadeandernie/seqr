import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import Annotations from './Annotations'
import { STATE1, VARIANT, SV_VARIANT, LOCUS_LIST, LOCUS_LIST_GUID } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<Annotations store={store} variant={VARIANT} />)
  shallow(<Annotations store={store} variant={SV_VARIANT} />)
})

const PROJECT_GUID = 'R0237_1000_genomes_demo'
const INTERVAL = {
  locusListGuid: LOCUS_LIST_GUID,
  locusListIntervalGuid: 'LLI0000012_1_248367000_248368000',
  genomeVersion: '37',
  chrom: '1',
  start: 248367000,
  end: 248368000,
}

const mountWithIntervals = (intervals, stateUpdates = {}) => {
  const store = configureStore()({
    ...STATE1,
    projectsByGuid: {
      [PROJECT_GUID]: { ...STATE1.projectsByGuid[PROJECT_GUID], locusListGuids: [LOCUS_LIST_GUID] },
    },
    familiesByGuid: { F011652_1: { ...STATE1.familiesByGuid.F011652_1, projectGuid: PROJECT_GUID } },
    locusListsByGuid: { [LOCUS_LIST_GUID]: { ...LOCUS_LIST, intervals } },
    ...stateUpdates,
  })
  return mount(
    <Provider store={store}>
      <MemoryRouter>
        <Annotations variant={VARIANT} />
      </MemoryRouter>
    </Provider>,
  )
}

const locusListLabels = wrapper => wrapper.find('Label').filterWhere(label => label.text() === LOCUS_LIST.name)

test('labels a variant inside a project gene list interval with the list name', () => {
  expect(locusListLabels(mountWithIntervals([INTERVAL])).length).toEqual(1)
})

test('shows one gene list label when several intervals of the list overlap the variant', () => {
  const wrapper = mountWithIntervals([INTERVAL, { ...INTERVAL, locusListIntervalGuid: 'LLI0000013', end: 248369000 }])
  expect(locusListLabels(wrapper).length).toEqual(1)
})

test('does not label a variant outside the gene list intervals', () => {
  const wrapper = mountWithIntervals([{ ...INTERVAL, start: 248368000, end: 248369000 }])
  expect(locusListLabels(wrapper).length).toEqual(0)
})

test('renders without gene list labels when the variant family is not loaded', () => {
  expect(locusListLabels(mountWithIntervals([INTERVAL], { familiesByGuid: {} })).length).toEqual(0)
})
