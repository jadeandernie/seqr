import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'

import { getOauthLoginProviders } from 'redux/selectors'
import { Error404 } from 'shared/components/page/Errors'
import Login from './components/Login'
import LoginError from './components/LoginError'
import { LoginProvidersPage } from './components/LoginProviders'
import ForgotPassword from './components/ForgotPassword'
import SetPassword from './components/SetPassword'

const LoginPage = ({ match, oauthLoginProviders }) => (
  <Switch>
    {oauthLoginProviders.length > 1 && <Route exact path={match.url} component={LoginProvidersPage} />}
    {oauthLoginProviders.length > 0 ?
      <Route path={`${match.url}/error/:error`} component={LoginError} /> :
      [
        <Route key="login" exact path={match.url} component={Login} />,
        <Route key="forgot" path={`${match.url}/forgot_password`} component={ForgotPassword} />,
        <Route key="reset" path={`${match.url}/set_password/:userToken`} component={SetPassword} />,
      ]}
    <Route component={Error404} />
  </Switch>
)

LoginPage.propTypes = {
  match: PropTypes.object,
  oauthLoginProviders: PropTypes.arrayOf(PropTypes.string),
}

const mapStateToProps = state => ({
  oauthLoginProviders: getOauthLoginProviders(state),
})

export default connect(mapStateToProps)(LoginPage)
