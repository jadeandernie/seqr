import React, { useCallback, useState } from 'react'
import { Button } from 'semantic-ui-react'
import styled from 'styled-components'

import GroupPatterns from './GroupPatterns'
import SearchResultsHost from './SearchResultsHost'
import { TargetDisplay, Workbook, WorksheetQuery } from './types'

const ViewToggle = styled.div`
  margin-bottom: 1em;
`

interface GroupResultsProps {
  workbook: Workbook
  target: TargetDisplay
  query: WorksheetQuery
  searchHash: string
  onRun: () => void
}

const GroupResults = ({ workbook, target, query, searchHash, onRun }: GroupResultsProps) => {
  const [showVariants, setShowVariants] = useState(false)
  const showPatterns = useCallback(() => setShowVariants(false), [])
  const showAllVariants = useCallback(() => setShowVariants(true), [])

  return (
    <div>
      <ViewToggle>
        <Button.Group size="small" role="group" aria-label="Results view">
          <Button toggle content="Patterns" active={!showVariants} onClick={showPatterns} />
          <Button toggle content="All variants" active={showVariants} onClick={showAllVariants} />
        </Button.Group>
      </ViewToggle>
      {showVariants ? <SearchResultsHost searchHash={searchHash} /> : (
        <GroupPatterns
          workbook={workbook}
          target={target}
          query={query}
          onRun={onRun}
          onShowVariants={showAllVariants}
        />
      )}
    </div>
  )
}

export default GroupResults
