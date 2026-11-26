import { LOCAL_LOGIN_URL } from './constants'

export const GOOGLE_PROVIDER = 'google-oauth2'
export const AZURE_PROVIDER = 'azuread-v2-tenant-oauth2'

const OAUTH_PROVIDER_NAMES: Record<string, string> = {
  [GOOGLE_PROVIDER]: 'Google',
  [AZURE_PROVIDER]: 'Microsoft',
}

export const getOauthProviderName = (provider: string): string => OAUTH_PROVIDER_NAMES[provider] || provider

export const getOauthLoginUrl = (provider: string, search = ''): string => {
  const next = new URLSearchParams(search).get('next')
  return `/login/${provider}${next ? `?next=${encodeURIComponent(next)}` : ''}`
}

// A single provider is redirected to directly, otherwise the login page handles local or multiple provider login
export const getLoginUrl = (providers: string[]): string => (
  providers.length === 1 ? getOauthLoginUrl(providers[0]) : LOCAL_LOGIN_URL
)
