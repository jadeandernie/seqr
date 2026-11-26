import React, { useEffect, useMemo, useState } from 'react'
import { connect } from 'react-redux'
import { Route, RouteComponentProps } from 'react-router-dom'
import { Grid, Loader } from 'semantic-ui-react'

import ExcludedVariants from './ExcludedVariants'
import { VariantSearchResults } from './sharedComponents'
import { WorkbookReduxState } from './types'

interface SearchResultsHostProps {
  searchHash: string
  searchLoading: boolean
  collapseExcluded?: boolean
}

// The search results state holds one search at a time and ignores a load while another is in progress, so the
// results are only mounted once the previous search has finished or been unloaded
const SearchResultsHost = ({ searchHash, searchLoading, collapseExcluded }: SearchResultsHostProps) => {
  const [ready, setReady] = useState(!searchLoading)
  useEffect(() => {
    if (!searchLoading) {
      setReady(true)
    }
  }, [searchLoading])
  const match = useMemo(() => ({ params: { searchHash } }), [searchHash])
  const renderResults = useMemo(() => ({ history, location }: RouteComponentProps) => (
    <VariantSearchResults
      match={match}
      history={history}
      location={location}
      variantsComponent={collapseExcluded ? ExcludedVariants : undefined}
    />
  ), [match, collapseExcluded])

  return ready ? <Grid><Route render={renderResults} /></Grid> : <Loader inline="centered" active />
}

const mapStateToProps = (state: WorkbookReduxState) => ({
  searchLoading: state.searchedVariantsLoading.isLoading,
})

export default connect(mapStateToProps)(SearchResultsHost)
