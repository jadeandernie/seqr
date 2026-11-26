import React from 'react'
import { mount, configure } from 'enzyme'
import { act } from 'react-dom/test-utils'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { Dropdown } from 'semantic-ui-react'

import { getLastFetchUrl, getLastFetchBody, flushAll } from 'shared/utils/testHelpers'
import AcmgCriteria, { getNewScoreValue } from './AcmgCriteria'
import ACMG_DROP_DOWN_OPTIONS from './AcmgCriteriaDropDownOptions'
import CATEGORY_CRITERIA_SCORE from './AcmgCategoryCriteriaScore'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const MODAL_NAME = 'acmg-SV0000002-F011652_1'
const VARIANT = { variantGuid: 'SV0000002_1248367227_r0390_100', xpos: 1248367227 }

// Points for each column of the criteria table, in display order:
// Benign Strong, Benign Supporting, Pathogenic Supporting, Moderate, Strong, Very Strong
const COLUMN_POINTS = [-4, -1, 1, 2, 4, 8]
const COLUMNS_PER_ROW = COLUMN_POINTS.length

const ALL_OPTIONS = ACMG_DROP_DOWN_OPTIONS.reduce((acc, group) => [
  ...acc,
  ...group.options.reduce((groupAcc, cell, cellIdx) => [
    ...groupAcc, ...cell.map(option => ({ ...option, column: cellIdx % COLUMNS_PER_ROW })),
  ], []),
], [])
const OPTIONS_BY_KEY = ALL_OPTIONS.reduce((acc, option) => ({ ...acc, [option.key]: option }), {})

const mountCriteria = (variant = VARIANT) => {
  const store = configureStore({ modal: { [MODAL_NAME]: { open: true } } })
  const wrapper = mount(
    <Provider store={store}>
      <AcmgCriteria modalName={MODAL_NAME} variant={variant} familyGuid="F011652_1" />
    </Provider>,
  )
  return { store, wrapper }
}

const answer = (wrapper, criteria, text) => {
  const { values } = OPTIONS_BY_KEY[criteria]
  const dropdown = wrapper.find(Dropdown).filterWhere(d => d.prop('options') === values)
  expect(dropdown.length).toEqual(1)
  act(() => {
    dropdown.prop('onChange')({}, { value: values.find(v => v.text === text).value })
  })
  wrapper.update()
}

const summary = (wrapper) => {
  const cells = wrapper.find('table').first().find('tbody td')
  return { score: cells.at(0).text(), classification: cells.at(1).text(), criteria: cells.at(2).text() }
}

const dropdownText = (wrapper, criteria) => wrapper.find(Dropdown).filterWhere(
  d => d.prop('options') === OPTIONS_BY_KEY[criteria].values,
).prop('text')

const clickButton = (wrapper, text) => {
  const button = wrapper.find('button').filterWhere(b => b.text() === text)
  expect(button.length).toEqual(1)
  button.simulate('click')
  wrapper.update()
}

describe('ACMG criteria tables', () => {
  test('every selectable criterion scores the points of the column it is shown in', () => {
    expect(ALL_OPTIONS.length).toEqual(65)
    expect(new Set(ALL_OPTIONS.map(({ key }) => key)).size).toEqual(ALL_OPTIONS.length)
    ALL_OPTIONS.forEach(({ key, column }) => {
      expect({ key, points: CATEGORY_CRITERIA_SCORE[key] }).toEqual({ key, points: COLUMN_POINTS[column] })
    })
    expect(Object.keys(CATEGORY_CRITERIA_SCORE).sort()).toEqual(ALL_OPTIONS.map(({ key }) => key).sort())
  })

  test('every criterion has a yes and a no answer whose value encodes its own key', () => {
    ALL_OPTIONS.forEach(({ key, values }) => {
      expect(values.map(({ text }) => text)).toEqual(['Y', 'N'])
      expect(values.map(({ value }) => value.split('_').slice(1).join('_'))).toEqual([`${key}_Yes`, `${key}_No`])
    })
  })

  test('getNewScoreValue sums benign and pathogenic points', () => {
    expect(getNewScoreValue([])).toEqual(0)
    expect(getNewScoreValue(['PVS1_VS'])).toEqual(8)
    expect(getNewScoreValue(['PVS1_VS', 'PM2_M', 'BP4_P'])).toEqual(9)
    expect(getNewScoreValue(['BA1_S', 'BS1_S', 'PP3_P'])).toEqual(-7)
  })
})

describe('AcmgCriteria classification', () => {
  test('starts unclassified with no criteria', () => {
    const { wrapper } = mountCriteria()
    expect(summary(wrapper)).toEqual({ score: '0', classification: 'Unknown', criteria: 'No criteria applied' })
    expect(wrapper.find(Dropdown).length).toEqual(65)
    expect(dropdownText(wrapper, 'PVS1_VS')).toEqual('N')
  })

  test('classifies at each score boundary as criteria are added', () => {
    const { wrapper } = mountCriteria()

    answer(wrapper, 'PP3_P', 'Y')
    expect(summary(wrapper)).toEqual({ score: '1', classification: 'Uncertain', criteria: 'PP3_P' })
    expect(dropdownText(wrapper, 'PP3_P')).toEqual('Y')

    answer(wrapper, 'PS3_S', 'Y')
    expect(summary(wrapper)).toEqual({ score: '5', classification: 'Uncertain', criteria: 'PP3_P, PS3_S' })

    answer(wrapper, 'PM2_P', 'Y')
    expect(summary(wrapper)).toEqual(
      { score: '6', classification: 'Likely Pathogenic', criteria: 'PP3_P, PS3_S, PM2_P' },
    )

    answer(wrapper, 'PM1_M', 'Y')
    answer(wrapper, 'PP1_P', 'Y')
    expect(summary(wrapper).score).toEqual('9')
    expect(summary(wrapper).classification).toEqual('Likely Pathogenic')

    answer(wrapper, 'PP4_P', 'Y')
    expect(summary(wrapper).score).toEqual('10')
    expect(summary(wrapper).classification).toEqual('Pathogenic')

    answer(wrapper, 'PVS1_VS', 'Y')
    expect(summary(wrapper).score).toEqual('18')
    expect(summary(wrapper).classification).toEqual('Pathogenic')
  })

  test('classifies benign evidence at each score boundary', () => {
    const { wrapper } = mountCriteria()

    answer(wrapper, 'BP4_P', 'Y')
    expect(summary(wrapper)).toEqual({ score: '-1', classification: 'Likely Benign', criteria: 'BP4_P' })

    answer(wrapper, 'BS1_S', 'Y')
    answer(wrapper, 'BP7_P', 'Y')
    expect(summary(wrapper)).toEqual(
      { score: '-6', classification: 'Likely Benign', criteria: 'BP4_P, BS1_S, BP7_P' },
    )

    answer(wrapper, 'BS2_P', 'Y')
    expect(summary(wrapper).score).toEqual('-7')
    expect(summary(wrapper).classification).toEqual('Benign')
  })

  test('conflicting evidence that nets to zero is uncertain, not unclassified', () => {
    const { wrapper } = mountCriteria()
    answer(wrapper, 'BP4_P', 'Y')
    answer(wrapper, 'PP3_P', 'Y')
    expect(summary(wrapper)).toEqual({ score: '0', classification: 'Uncertain', criteria: 'BP4_P, PP3_P' })
  })

  test('answering yes twice does not double count and answering no removes the criterion', () => {
    const { wrapper } = mountCriteria()
    answer(wrapper, 'PVS1_VS', 'Y')
    answer(wrapper, 'PVS1_VS', 'Y')
    answer(wrapper, 'PM2_M', 'Y')
    expect(summary(wrapper)).toEqual({ score: '10', classification: 'Pathogenic', criteria: 'PVS1_VS, PM2_M' })

    answer(wrapper, 'PS1_S', 'N')
    expect(summary(wrapper).score).toEqual('10')

    answer(wrapper, 'PVS1_VS', 'N')
    expect(summary(wrapper)).toEqual({ score: '2', classification: 'Uncertain', criteria: 'PM2_M' })
    expect(dropdownText(wrapper, 'PVS1_VS')).toEqual('N')

    answer(wrapper, 'PM2_M', 'N')
    expect(summary(wrapper)).toEqual({ score: '0', classification: 'Unknown', criteria: 'No criteria applied' })
  })

  test('restores a saved classification and recomputes its score from the criteria', () => {
    const { wrapper } = mountCriteria({
      ...VARIANT, acmgClassification: { classify: 'Likely Pathogenic', criteria: ['PS3_S', 'PM2_M'], score: 99 },
    })
    expect(summary(wrapper)).toEqual({ score: '6', classification: 'Likely Pathogenic', criteria: 'PS3_S, PM2_M' })
    expect(dropdownText(wrapper, 'PS3_S')).toEqual('Y')
    expect(dropdownText(wrapper, 'PM2_M')).toEqual('Y')
    expect(dropdownText(wrapper, 'PM2_P')).toEqual('N')
  })
})

describe('AcmgCriteria submission', () => {
  test('submits the score, classification and criteria and closes the modal', async () => {
    const { wrapper, store } = mountCriteria()
    answer(wrapper, 'PVS1_VS', 'Y')
    answer(wrapper, 'PM2_M', 'Y')

    clickButton(wrapper, 'Submit')
    await flushAll()

    expect(getLastFetchUrl()).toEqual(`/api/saved_variant/${VARIANT.variantGuid}/update_acmg_classification`)
    expect(getLastFetchBody().variant).toEqual({
      ...VARIANT,
      acmgClassification: { score: 10, classify: 'Pathogenic', criteria: ['PVS1_VS', 'PM2_M'] },
    })
    expect(store.getActions()).toContainEqual({
      type: 'UPDATE_MODAL_STATE',
      updatesById: { [MODAL_NAME]: { open: false, confirming: false, confirmOnClose: null } },
    })
  })

  test('asks for confirmation before clearing a saved classification', async () => {
    const { wrapper, store } = mountCriteria({
      ...VARIANT, acmgClassification: { classify: 'Pathogenic', criteria: ['PVS1_VS', 'PM2_M'], score: 10 },
    })

    clickButton(wrapper, 'Clear Form')
    expect(summary(wrapper)).toEqual({ score: '0', classification: 'Unknown', criteria: 'No criteria applied' })

    clickButton(wrapper, 'Submit')
    expect(fetch).not.toHaveBeenCalled()
    expect(store.getActions()).toEqual([])
    const confirm = wrapper.find('Confirm')
    expect(confirm.prop('open')).toBe(true)
    expect(confirm.prop('content')).toEqual('No criteria is selected. Would you like to clear the classification?')

    act(() => {
      confirm.prop('onCancel')()
    })
    wrapper.update()
    expect(wrapper.find('Confirm').prop('open')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()

    clickButton(wrapper, 'Submit')
    act(() => {
      wrapper.find('Confirm').prop('onConfirm')()
    })
    await flushAll()

    expect(getLastFetchUrl()).toEqual(`/api/saved_variant/${VARIANT.variantGuid}/update_acmg_classification`)
    expect(getLastFetchBody().variant.acmgClassification).toBeNull()
    expect(store.getActions().map(({ type }) => type)).toContain('UPDATE_MODAL_STATE')
  })
})
