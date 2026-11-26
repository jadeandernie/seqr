let unmount

// app.jsx renders into the document on import, so each test loads a fresh copy of it at the given URL
const renderAppAt = async (path) => {
  document.body.innerHTML = '<div id="reactjs-root"></div>'
  const root = document.getElementById('reactjs-root')
  window.history.pushState({}, '', path)
  window.initialJSON = {}
  const { act } = require('react-dom/test-utils')
  const ReactDOM = require('react-dom')
  unmount = () => ReactDOM.unmountComponentAtNode(root)
  await act(async () => {
    require('./app')
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return root
}

beforeEach(() => {
  jest.resetModules()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  unmount()
  jest.restoreAllMocks()
})

test('an unknown path renders the 404 page inside the page layout', async () => {
  const root = await renderAppAt('/no_such_page')

  expect(root.textContent).toContain('Error 404: Page Not Found')
  expect(root.textContent).toContain('Feature Updates')
})

test('a known route does not render the 404 page', async () => {
  const root = await renderAppAt('/login')

  expect(root.textContent).not.toContain('Error 404')
  expect(root.querySelector('form')).not.toBeNull()
})

test('a lazy-loaded public route still renders', async () => {
  const root = await renderAppAt('/privacy_policy')

  expect(root.textContent).not.toContain('Error 404')
  expect(root.textContent).toContain('Privacy Policy')
})
