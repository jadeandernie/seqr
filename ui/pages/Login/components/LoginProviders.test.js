import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import configureStore from 'redux-mock-store'

import LoginProviders from './LoginProviders'

configure({ adapter: new Adapter() })

const mountProviders = (oauthLoginProviders, props) => mount(
  <Provider store={configureStore()({ meta: { oauthLoginProviders } })}><LoginProviders {...props} /></Provider>,
)

const getLinks = wrapper => wrapper.find('a.button').map(node => [node.text(), node.prop('href')])

test('renders a sign in link per configured provider', () => {
  expect(getLinks(mountProviders([]))).toEqual([])
  expect(getLinks(mountProviders(['google-oauth2']))).toEqual([['Sign in with Google', '/login/google-oauth2']])
  expect(getLinks(mountProviders(['azuread-v2-tenant-oauth2', 'google-oauth2'], { search: '?next=/a b' }))).toEqual([
    ['Sign in with Microsoft', '/login/azuread-v2-tenant-oauth2?next=%2Fa%20b'],
    ['Sign in with Google', '/login/google-oauth2?next=%2Fa%20b'],
  ])
})

test('renders unrecognized providers with a default icon', () => {
  const wrapper = mountProviders(['other-oauth2'])
  expect(getLinks(wrapper)).toEqual([['Sign in with other-oauth2', '/login/other-oauth2']])
  expect(wrapper.find('i.cloud.icon')).toHaveLength(1)
})
