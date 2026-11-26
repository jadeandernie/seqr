import React from 'react'
import { shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import DispatchRequestButton from './DispatchRequestButton'


configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  shallow(<DispatchRequestButton />)
})

test('computes the confirm dialog content only when the confirm is shown', () => {
  const getConfirmDialog = jest.fn(() => 'Are you sure you want to delete 2 things?')
  const onSubmit = jest.fn(() => Promise.resolve())
  const wrapper = shallow(
    <DispatchRequestButton buttonContent="Delete" onSubmit={onSubmit} getConfirmDialog={getConfirmDialog} />,
  )

  expect(getConfirmDialog).not.toHaveBeenCalled()
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
  expect(wrapper.find('Confirm').prop('content')).toBeUndefined()
  // the callback is consumed by the component and not passed on to the button
  expect(wrapper.childAt(0).prop('content')).toEqual('Delete')
  expect(wrapper.childAt(0).prop('getConfirmDialog')).toBeUndefined()

  wrapper.childAt(0).simulate('click', { preventDefault: jest.fn() })

  expect(onSubmit).not.toHaveBeenCalled()
  expect(getConfirmDialog).toHaveBeenCalledTimes(1)
  expect(wrapper.find('Confirm').prop('open')).toBe(true)
  expect(wrapper.find('Confirm').prop('content')).toEqual('Are you sure you want to delete 2 things?')

  wrapper.find('Confirm').prop('onConfirm')()

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
})
