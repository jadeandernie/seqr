import React from 'react'
import { connect } from 'react-redux'
import { Button, Header, Icon, Segment, SemanticICONS } from 'semantic-ui-react'

import { getOauthLoginProviders } from '../../../redux/selectors'
import {
  AZURE_PROVIDER, GOOGLE_PROVIDER, getOauthLoginUrl, getOauthProviderName,
} from '../../../shared/utils/loginUtils'

const PROVIDER_ICONS: Record<string, SemanticICONS> = {
  [GOOGLE_PROVIDER]: 'google',
  [AZURE_PROVIDER]: 'microsoft',
}

type LoginProvidersProps = {
  providers: string[]
  search?: string
}

const BaseLoginProviders = React.memo(({ providers, search }: LoginProvidersProps) => (
  <div>
    {providers.map(provider => (
      <Button key={provider} as="a" href={getOauthLoginUrl(provider, search)} primary>
        <Icon name={PROVIDER_ICONS[provider] || 'cloud'} />
        {`Sign in with ${getOauthProviderName(provider)}`}
      </Button>
    ))}
  </div>
))

const mapStateToProps = (state: unknown) => ({
  providers: getOauthLoginProviders(state) as string[],
})

const LoginProviders = connect(mapStateToProps)(BaseLoginProviders)

type LoginProvidersPageProps = {
  location: { search: string }
}

export const LoginProvidersPage = React.memo(({ location }: LoginProvidersPageProps) => (
  <Segment textAlign="center" padded="very" basic>
    <Header size="medium" content="Sign in to seqr" />
    <LoginProviders search={location.search} />
  </Segment>
))

export default LoginProviders
