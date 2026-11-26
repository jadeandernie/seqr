import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import configureStore from 'redux-mock-store'

import LandingPage from './LandingPage'

configure({ adapter: new Adapter() })

const getLoginLinks = oauthLoginProviders => mount(
  <Provider store={configureStore()({ meta: { oauthLoginProviders } })}>
    <MemoryRouter><LandingPage /></MemoryRouter>
  </Provider>,
).find('a').filterWhere(node => node.text().includes('Sign In')).map(node => node.prop('href'))

test('links to the login page or to the only configured provider', () => {
  expect(getLoginLinks([])).toEqual(['/login'])
  expect(getLoginLinks(['google-oauth2'])).toEqual(['/login/google-oauth2'])
  expect(getLoginLinks(['azuread-v2-tenant-oauth2'])).toEqual(['/login/azuread-v2-tenant-oauth2'])
  expect(getLoginLinks(['google-oauth2', 'azuread-v2-tenant-oauth2'])).toEqual(['/login'])
})
