import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Segment, Message } from 'semantic-ui-react'
import { getOauthLoginProviders } from 'redux/selectors'

import { ANVIL_URL } from 'shared/utils/constants'
import LoginProviders from './LoginProviders'

const GOOGLE_SETUP_URL = 'https://support.terra.bio/hc/en-us/articles/360029186611-Setting-up-a-Google-account-with-a-non-Google-email'

const ERROR_MESSAGES = {
  anvil_registration: (
    <span>
      Unable to authorize the selected Google user.
      Please register your account in AnVIL by signing in and registering
      at &nbsp;
      <a href={ANVIL_URL} target="_blank" rel="noreferrer">anvil.terra.bio</a>
      .
      <br />
      If you have already registered your account, please log in to AnVIL and confirm
      you have accepted their latest terms of service.
      <br />
      If the email associated with your account is not managed by Google,
      follow
      <a href={GOOGLE_SETUP_URL} target="_blank" rel="noreferrer">these instructions </a>
      to register the email with Google before registering with AnVIL.
    </span>
  ),
  no_account: 'No seqr account found for the selected user identity',
}

const MULTIPLE_PROVIDER_MESSAGES = {
  anvil_registration: 'AnVIL registration is only required when signing in with Google.',
  no_account: 'If your seqr account uses a different sign in provider, select that provider below.',
}

const LoginError = ({ location, match, hasMultipleProviders }) => (
  <Segment textAlign="center" padded="very" basic>
    <Message error compact>
      {ERROR_MESSAGES[match.params.error] || `Unknown error occured: ${match.params.error}`}
      {hasMultipleProviders && MULTIPLE_PROVIDER_MESSAGES[match.params.error] && (
        <div>{MULTIPLE_PROVIDER_MESSAGES[match.params.error]}</div>
      )}
    </Message>
    <LoginProviders search={location.search} />
  </Segment>
)

LoginError.propTypes = {
  location: PropTypes.object,
  match: PropTypes.object,
  hasMultipleProviders: PropTypes.bool,
}

const mapStateToProps = state => ({
  hasMultipleProviders: getOauthLoginProviders(state).length > 1,
})

export default connect(mapStateToProps)(LoginError)
