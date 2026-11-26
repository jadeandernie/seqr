import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'

import { flushAll, getLastFetchUrl } from 'shared/utils/testHelpers'
import EditFamiliesForm from './EditFamiliesForm'
import { STATE_WITH_2_FAMILIES } from '../../fixtures'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const openDeleteConfirm = (wrapper) => {
  wrapper.find('DispatchRequestButton').find('button').simulate('click')
  return wrapper.find('Confirm')
}

test('renders an editable row for each family in the project', () => {
  const store = configureStore(STATE_WITH_2_FAMILIES)
  const wrapper = mount(
    <Provider store={store}>
      <EditFamiliesForm modalName="editFamilies" />
    </Provider>,
  )

  expect(wrapper.find('input[value="1"]').exists()).toBe(true)
  expect(wrapper.find('input[value="2"]').exists()).toBe(true)
})

test('deletes selected families', async () => {
  const store = configureStore(STATE_WITH_2_FAMILIES)
  const wrapper = mount(
    <Provider store={store}>
      <EditFamiliesForm modalName="editFamilies" />
    </Provider>,
  )

  expect(wrapper.find('DispatchRequestButton').prop('buttonContent')).toEqual('Delete Selected')
  expect(wrapper.find('DispatchRequestButton').prop('disabled')).toEqual(true)

  // Selecting rows re-renders the table and the delete button but must not remount them
  const dataTable = wrapper.find('DataTable').instance()
  const deleteButton = wrapper.find('DispatchRequestButton').instance()
  const getConfirmDialog = wrapper.find('DispatchRequestButton').prop('getConfirmDialog')

  wrapper.find('DataTable').prop('selectRows')({ F011652_1: true })
  wrapper.update()
  expect(wrapper.find('DispatchRequestButton').prop('disabled')).toEqual(false)
  expect(openDeleteConfirm(wrapper).prop('open')).toBe(true)
  expect(wrapper.find('Confirm').find('ModalContent').text()).toEqual(
    'Are you sure you want to delete the following families: 1?',
  )
  wrapper.find('Confirm').prop('onCancel')()
  wrapper.update()
  expect(wrapper.find('Confirm').prop('open')).toBe(false)

  wrapper.find('DataTable').prop('selectRows')({ F011652_1: true, F011652_2: true })
  wrapper.update()
  expect(openDeleteConfirm(wrapper).find('ModalContent').text()).toEqual(
    'Are you sure you want to delete the following 2 families: 1, 2?',
  )

  expect(wrapper.find('DataTable').instance()).toBe(dataTable)
  expect(wrapper.find('DispatchRequestButton').instance()).toBe(deleteButton)
  expect(wrapper.find('DispatchRequestButton').prop('getConfirmDialog')).toBe(getConfirmDialog)

  wrapper.find('Confirm').prop('onConfirm')()
  await flushAll()

  expect(getLastFetchUrl()).toEqual(`/api/project/${STATE_WITH_2_FAMILIES.currentProjectGuid}/delete_families`)
})

test('limits the families named in the delete confirm', () => {
  const familiesByGuid = [...Array(37).keys()].reduce((acc, i) => ({
    ...acc,
    [`F00${i}_fam`]: {
      ...STATE_WITH_2_FAMILIES.familiesByGuid.F011652_1,
      familyGuid: `F00${i}_fam`,
      familyId: `fam${i + 1}`,
      displayName: `fam${i + 1}`,
    },
  }), {})
  const store = configureStore({ ...STATE_WITH_2_FAMILIES, familiesByGuid })
  const wrapper = mount(
    <Provider store={store}>
      <EditFamiliesForm modalName="editFamilies" />
    </Provider>,
  )

  wrapper.find('DataTable').prop('selectRows')(
    Object.keys(familiesByGuid).reduce((acc, familyGuid) => ({ ...acc, [familyGuid]: true }), {}),
  )
  wrapper.update()
  expect(openDeleteConfirm(wrapper).find('ModalContent').text()).toEqual([
    'Are you sure you want to delete the following 37 families:',
    'fam1, fam2, fam3, fam4, fam5, fam6, fam7, fam8, fam9, fam10 and 27 more?',
  ].join(' '))
})
