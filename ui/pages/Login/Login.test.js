import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'

import LoginPage from './Login'

configure({ adapter: new Adapter() })

const GOOGLE = 'google-oauth2'
const AZURE = 'azuread-v2-tenant-oauth2'

const mountPage = (oauthLoginProviders, url) => mount(
  <Provider store={configureStore([thunk])({ meta: { oauthLoginProviders }, user: {} })}>
    <MemoryRouter initialEntries={[url]}>
      <Route path="/login" component={LoginPage} />
    </MemoryRouter>
  </Provider>,
)

const getLinks = wrapper => wrapper.find('a.button').map(node => [node.text(), node.prop('href')])

test('local login when no providers are configured', () => {
  const wrapper = mountPage([], '/login?next=/summary_data')

  expect(wrapper.find('form')).toHaveLength(1)
  expect(wrapper.find('input[name="password"]')).toHaveLength(1)
  expect(wrapper.text()).toContain('Login to seqr')
  expect(getLinks(wrapper)).toEqual([])

  expect(mountPage([], '/login/error/no_account').text()).toContain('Error 404: Page Not Found')
})

test('no login page for a single provider', () => {
  [GOOGLE, AZURE].forEach((provider) => {
    const wrapper = mountPage([provider], '/login?next=/summary_data')
    expect(wrapper.text()).toContain('Error 404: Page Not Found')
    expect(wrapper.find('form')).toHaveLength(0)
    expect(getLinks(wrapper)).toEqual([])

    expect(mountPage([provider], '/login/forgot_password').text()).toContain('Error 404: Page Not Found')
  })
})

test('provider chooser for multiple providers', () => {
  const wrapper = mountPage([GOOGLE, AZURE], '/login/?next=/variant_search/results/abc?page=2%26sort=x y')

  expect(wrapper.text()).toContain('Sign in to seqr')
  expect(wrapper.find('form')).toHaveLength(0)
  expect(getLinks(wrapper)).toEqual([
    ['Sign in with Google', '/login/google-oauth2?next=%2Fvariant_search%2Fresults%2Fabc%3Fpage%3D2%26sort%3Dx%20y'],
    [
      'Sign in with Microsoft',
      '/login/azuread-v2-tenant-oauth2?next=%2Fvariant_search%2Fresults%2Fabc%3Fpage%3D2%26sort%3Dx%20y',
    ],
  ])
  expect(wrapper.find('i.google.icon')).toHaveLength(1)
  expect(wrapper.find('i.microsoft.icon')).toHaveLength(1)

  expect(getLinks(mountPage([GOOGLE, AZURE], '/login'))).toEqual([
    ['Sign in with Google', '/login/google-oauth2'],
    ['Sign in with Microsoft', '/login/azuread-v2-tenant-oauth2'],
  ])

  expect(mountPage([GOOGLE, AZURE], '/login/forgot_password').text()).toContain('Error 404: Page Not Found')
})

test('login errors for a single provider', () => {
  const wrapper = mountPage([GOOGLE], '/login/error/no_account?next=%2Fproject%2FR0001_1kg')
  expect(wrapper.find('.error.message').text()).toEqual('No seqr account found for the selected user identity')
  expect(getLinks(wrapper)).toEqual([['Sign in with Google', '/login/google-oauth2?next=%2Fproject%2FR0001_1kg']])

  const azureWrapper = mountPage([AZURE], '/login/error/no_account')
  expect(azureWrapper.find('.error.message').text()).toEqual('No seqr account found for the selected user identity')
  expect(getLinks(azureWrapper)).toEqual([['Sign in with Microsoft', '/login/azuread-v2-tenant-oauth2']])

  const anvilWrapper = mountPage([GOOGLE], '/login/error/anvil_registration')
  expect(anvilWrapper.find('.error.message').text()).toContain('Unable to authorize the selected Google user.')
  expect(anvilWrapper.find('.error.message').text()).not.toContain('AnVIL registration is only required')
  expect(anvilWrapper.find('a.button').map(node => node.text())).toEqual(['Sign in with Google'])

  const unknownWrapper = mountPage([GOOGLE], '/login/error/other')
  expect(unknownWrapper.find('.error.message').text()).toEqual('Unknown error occured: other')
})

test('login errors for multiple providers', () => {
  const wrapper = mountPage([GOOGLE, AZURE], '/login/error/no_account?next=%2Fproject%2FR0001_1kg')
  expect(wrapper.find('.error.message').text()).toEqual(
    'No seqr account found for the selected user identity' +
    'If your seqr account uses a different sign in provider, select that provider below.',
  )
  expect(getLinks(wrapper)).toEqual([
    ['Sign in with Google', '/login/google-oauth2?next=%2Fproject%2FR0001_1kg'],
    ['Sign in with Microsoft', '/login/azuread-v2-tenant-oauth2?next=%2Fproject%2FR0001_1kg'],
  ])

  const anvilWrapper = mountPage([GOOGLE, AZURE], '/login/error/anvil_registration')
  expect(anvilWrapper.find('.error.message').text()).toContain('Unable to authorize the selected Google user.')
  expect(anvilWrapper.find('.error.message').text()).toContain(
    'AnVIL registration is only required when signing in with Google.',
  )
  expect(anvilWrapper.find('a.button').map(node => node.text())).toEqual(
    ['Sign in with Google', 'Sign in with Microsoft'],
  )

  const unknownWrapper = mountPage([GOOGLE, AZURE], '/login/error/other')
  expect(unknownWrapper.find('.error.message').text()).toEqual('Unknown error occured: other')
})
