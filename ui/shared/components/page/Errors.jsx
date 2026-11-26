import React from 'react'
import PropTypes from 'prop-types'
import { Header } from 'semantic-ui-react'

export const Error404 = () => (<Header size="huge" textAlign="center">Error 404: Page Not Found</Header>)
export const Error401 = () => (<Header size="huge" textAlign="center">Error 401: Unauthorized</Header>)

export const PageError = ({ error }) => (
  <Header size="huge" textAlign="center">
    Something went wrong displaying this page
    <Header.Subheader>{error?.message}</Header.Subheader>
    <Header.Subheader>Try reloading the page or navigating to a different one</Header.Subheader>
  </Header>
)

PageError.propTypes = {
  error: PropTypes.object,
}
