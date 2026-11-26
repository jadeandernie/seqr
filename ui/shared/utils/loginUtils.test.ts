import { getLoginUrl, getOauthLoginUrl, getOauthProviderName } from './loginUtils'

test('getOauthProviderName', () => {
  expect(getOauthProviderName('google-oauth2')).toEqual('Google')
  expect(getOauthProviderName('azuread-v2-tenant-oauth2')).toEqual('Microsoft')
  expect(getOauthProviderName('other-oauth2')).toEqual('other-oauth2')
})

test('getOauthLoginUrl', () => {
  expect(getOauthLoginUrl('google-oauth2')).toEqual('/login/google-oauth2')
  expect(getOauthLoginUrl('google-oauth2', '')).toEqual('/login/google-oauth2')
  expect(getOauthLoginUrl('azuread-v2-tenant-oauth2', '?other=1')).toEqual('/login/azuread-v2-tenant-oauth2')

  expect(getOauthLoginUrl('google-oauth2', '?next=/project/R0001_1kg/project_page')).toEqual(
    '/login/google-oauth2?next=%2Fproject%2FR0001_1kg%2Fproject_page',
  )
  expect(getOauthLoginUrl('azuread-v2-tenant-oauth2', '?next=%2Fvariant_search%3Fa%3D1%26b%3Dx%20y&other=1')).toEqual(
    '/login/azuread-v2-tenant-oauth2?next=%2Fvariant_search%3Fa%3D1%26b%3Dx%20y',
  )
})

test('getLoginUrl', () => {
  expect(getLoginUrl([])).toEqual('/login')
  expect(getLoginUrl(['google-oauth2'])).toEqual('/login/google-oauth2')
  expect(getLoginUrl(['azuread-v2-tenant-oauth2'])).toEqual('/login/azuread-v2-tenant-oauth2')
  expect(getLoginUrl(['google-oauth2', 'azuread-v2-tenant-oauth2'])).toEqual('/login')
})
