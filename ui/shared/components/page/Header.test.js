import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import configureStore from 'redux-mock-store'
import { LOCAL_LOGIN_URL } from 'shared/utils/constants'
import PageHeader, { PageHeaderComponent } from './Header'

configure({ adapter: new Adapter() })

const USER = {
  date_joined: '2015-02-19T20:22:50.633Z',
  email: 'test@broadinstitute.org',
  first_name: '',
  id: 1,
  is_active: true,
  last_login: '2017-03-14T17:44:53.403Z',
  last_name: '',
  username: 'test',
}

test('shallow-render without crashing', () => {
  /*
    user: PropTypes.object.isRequired,
   */

  shallow(<PageHeaderComponent user={USER} />)
})

test('log out is inside the user dropdown rather than a top level menu item', () => {
  const wrapper = shallow(<PageHeaderComponent user={USER} />)

  const logoutLinks = wrapper.findWhere(node => node.prop('href') === '/logout')
  expect(logoutLinks).toHaveLength(1)
  expect(logoutLinks.first().name()).toEqual('DropdownItem')
})

test('logged out users are offered a log in link and no user dropdown', () => {
  const wrapper = shallow(<PageHeaderComponent user={{}} loginUrl={LOCAL_LOGIN_URL} />)

  expect(wrapper.findWhere(node => node.prop('href') === '/logout')).toHaveLength(0)
  expect(wrapper.find('Dropdown')).toHaveLength(0)
  expect(wrapper.findWhere(node => node.prop('href') === LOCAL_LOGIN_URL)).toHaveLength(1)
})

const getLoginLinks = oauthLoginProviders => mount(
  <Provider store={configureStore()({ meta: { oauthLoginProviders }, user: {} })}>
    <MemoryRouter><PageHeader /></MemoryRouter>
  </Provider>,
).find('a').filterWhere(node => node.text() === 'Log in').map(node => node.prop('href'))

test('log in links to the login page or to the only configured provider', () => {
  expect(getLoginLinks([])).toEqual(['/login'])
  expect(getLoginLinks(['google-oauth2'])).toEqual(['/login/google-oauth2'])
  expect(getLoginLinks(['azuread-v2-tenant-oauth2'])).toEqual(['/login/azuread-v2-tenant-oauth2'])
  expect(getLoginLinks(['google-oauth2', 'azuread-v2-tenant-oauth2'])).toEqual(['/login'])
})
