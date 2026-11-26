/**
 * Top-level page layout that consists of the standard seqr header and footer, with arbitrary
 * content in-between.
 */

import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { Grid } from 'semantic-ui-react'
import { useLocation } from 'react-router-dom'
import { ErrorBoundary } from 'react-error-boundary'

import AcceptCookies from './AcceptCookies'
import { PageError } from './Errors'
import Header from './Header'
import PageHeader from './PageHeader'
import Footer from './Footer'
import WarningMessages from './WarningMessages'

const LayoutContainer = styled.div`
  height: calc(100% - 32px);
`

const ContentGrid = styled(Grid)`
  padding-top: 15px !important;
  min-height: calc(100% - 46px);
  align-content: flex-start;
`

const PageContent = ({ children }) => {
  const { pathname, search } = useLocation()
  const resetKeys = React.useMemo(() => [pathname, search], [pathname, search])
  return <ErrorBoundary FallbackComponent={PageError} resetKeys={resetKeys}>{children}</ErrorBoundary>
}

PageContent.propTypes = {
  children: PropTypes.node,
}

const BaseLayout = ({ children }) => (
  <LayoutContainer>
    <Header />
    <ContentGrid>
      <AcceptCookies />
      <PageHeader />
      <WarningMessages />
      <Grid.Row>
        <Grid.Column width={1} />
        <Grid.Column width={14}>
          <PageContent>{children}</PageContent>
        </Grid.Column>
        <Grid.Column width={1} />
      </Grid.Row>
    </ContentGrid>
    <Footer />
  </LayoutContainer>
)

export { BaseLayout as BaseLayoutComponent }

BaseLayout.propTypes = {
  children: PropTypes.node,
}

export default BaseLayout
