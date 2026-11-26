import React from 'react'
import { act } from 'react-dom/test-utils'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { flushAll } from 'shared/utils/testHelpers'
import DispatchRequestButton from './DispatchRequestButton'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  shallow(<DispatchRequestButton />)
})

const mountButton = (props) => {
  let resolve
  let reject
  const onSubmit = jest.fn(() => new Promise((res, rej) => {
    resolve = res
    reject = rej
  }))
  const wrapper = mount(<DispatchRequestButton onSubmit={onSubmit} {...props} />)
  wrapper.find('button').simulate('click')
  return { wrapper, onSubmit, resolve: value => resolve(value), reject: error => reject(error) }
}

const flush = async (wrapper) => {
  await act(async () => {
    await flushAll()
  })
  wrapper.update()
}

test('shows the request status and calls onSuccess when the request succeeds', async () => {
  const onSuccess = jest.fn()
  const { wrapper, onSubmit, resolve } = mountButton({ onSuccess })

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(wrapper.find('RequestStatus').prop('status')).toEqual('IN_PROGRESS')
  resolve()
  await flush(wrapper)

  expect(wrapper.find('RequestStatus').prop('status')).toEqual('SUCCEEDED')
  expect(onSuccess).toHaveBeenCalledTimes(1)
})

test('shows the error when the request fails', async () => {
  const { wrapper, reject } = mountButton()

  reject(new Error('Permission Denied'))
  await flush(wrapper)

  expect(wrapper.find('RequestStatus').props()).toEqual({ status: 'ERROR', errorMessage: 'Permission Denied' })
})

test('waits for confirmation before submitting when a confirm dialog is configured', () => {
  const { wrapper, onSubmit } = mountButton({ confirmDialog: 'Are you sure?' })

  expect(onSubmit).not.toHaveBeenCalled()
  expect(wrapper.find('Confirm').prop('open')).toBe(true)
  wrapper.find('Confirm').prop('onCancel')()
  wrapper.update()
  expect(wrapper.find('Confirm').prop('open')).toBe(false)
  expect(onSubmit).not.toHaveBeenCalled()
})

test.each([
  ['succeeds', ({ resolve }) => resolve()],
  ['fails', ({ reject }) => reject(new Error('Permission Denied'))],
])('does not update its state when the request %s after the button was removed', async (name, finish) => {
  const consoleError = jest.spyOn(console, 'error')
  const onSuccess = jest.fn()
  const button = mountButton({ onSuccess })

  button.wrapper.unmount()
  finish(button)
  await flushAll()

  expect(consoleError).not.toHaveBeenCalled()
  expect(onSuccess).toHaveBeenCalledTimes(name === 'succeeds' ? 1 : 0)
  consoleError.mockRestore()
})
