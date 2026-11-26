import React, { useCallback, useMemo, useState } from 'react'
import { connect } from 'react-redux'
import { Button, Grid, Header } from 'semantic-ui-react'
import styled from 'styled-components'

import { getExcludedReasonsByFamilyVariant, splitExcludedVariants } from './selectors'
import { Variants } from './sharedComponents'
import { ByGuid, DisplayVariant, WorkbookReduxState } from './types'

const ExcludedSection = styled.section`
  margin-top: 2em;
`

const ExcludedGroup = styled.div`
  margin-top: 1em;
`

interface ExcludedVariantsProps {
  displayVariants: DisplayVariant[]
  compoundHetToggle?: unknown
  searchHash?: string
  excludedReasons: ByGuid<string>
}

// Shows the variants of the search results that are tagged as excluded in a collapsed section after the others
const ExcludedVariants = (
  { displayVariants, compoundHetToggle, searchHash, excludedReasons }: ExcludedVariantsProps,
) => {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded(isExpanded => !isExpanded), [])
  const { included, excludedGroups, numExcluded } = useMemo(
    () => splitExcludedVariants(displayVariants, excludedReasons), [displayVariants, excludedReasons],
  )

  return (
    <Grid.Row>
      <Grid.Column width={16}>
        <Variants variants={included} compoundHetToggle={compoundHetToggle} searchHash={searchHash} linkToSavedVariants />
        {numExcluded > 0 && (
          <ExcludedSection aria-label="Excluded variants">
            <Button
              basic
              size="small"
              icon={expanded ? 'caret down' : 'caret right'}
              content={`Excluded (${numExcluded})`}
              aria-expanded={expanded}
              onClick={toggle}
            />
            {expanded && excludedGroups.map(({ reason, variants }) => (
              <ExcludedGroup key={reason} role="group" aria-label={`Excluded: ${reason}`}>
                <Header as="h5" content={`${reason} (${variants.length})`} />
                <Variants
                  variants={variants}
                  compoundHetToggle={compoundHetToggle}
                  searchHash={searchHash}
                  linkToSavedVariants
                />
              </ExcludedGroup>
            ))}
          </ExcludedSection>
        )}
      </Grid.Column>
    </Grid.Row>
  )
}

const mapStateToProps = (state: WorkbookReduxState) => ({
  excludedReasons: getExcludedReasonsByFamilyVariant(state),
})

export default connect(mapStateToProps, {})(ExcludedVariants)
