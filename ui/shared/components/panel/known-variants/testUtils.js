import { act } from 'react-dom/test-utils'

export const mockFetch = (getResponse) => {
  global.fetch = jest.fn((url, options) => {
    const { status = 200, json = {} } = getResponse(url, options) || {}
    return Promise.resolve({
      ok: status === 200,
      status,
      statusText: 'Bad Request',
      json: () => Promise.resolve(json),
    })
  })
  return global.fetch
}

export const flushRequests = async (wrapper) => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  wrapper.update()
}

export const clickButton = async (wrapper, content) => {
  const button = wrapper.find('Button').filterWhere(b => b.prop('content') === content).first()
  await act(async () => {
    button.prop('onClick')()
  })
  await flushRequests(wrapper)
}

export const setFormValue = async (wrapper, name, data) => {
  const field = wrapper.find('Modal').find({ name }).first()
  await act(async () => {
    field.prop('onChange')({}, data)
  })
  wrapper.update()
}

export const getPosts = fetch => fetch.mock.calls.filter(([, options]) => options.method === 'POST').map(
  ([url, options]) => [url, JSON.parse(options.body)],
)
