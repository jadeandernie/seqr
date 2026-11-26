import React, { useCallback, useState } from 'react'
import { connect } from 'react-redux'
import { Button, Message, Table } from 'semantic-ui-react'
import styled from 'styled-components'

import { RUN_TRIGGER_LABELS } from './constants'
import { getCellKey } from './reducers'
import { getCellHistory, getFamiliesByGuid, getGenesById } from './selectors'
import {
  ByGuid, CellHistoryState, NamedEntity, TargetDisplay, UnreviewedResult, WorkbookReduxState, WorksheetQuery,
  WorksheetQueryResult, WorksheetQueryRun,
} from './types'

const Review = styled.div`
  margin-bottom: 1em;
`

const Banner = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1em;
`

const VariantList = styled.ul`
  margin: 0.5em 0 0 0;
  padding-left: 1.5em;
`

const Detail = styled.span`
  color: #555;
  margin-left: 0.8em;
`

const STATUS_COMPLETED = 'C'
const STATUS_TOO_MANY_RESULTS = 'T'
const TOO_MANY_RESULTS = 'Not completed: the search returned too many results'

const formatDate = (date: string) => new Date(date).toLocaleDateString()

export const getRunChange = (run: WorksheetQueryRun): string => {
  if (run.status === STATUS_TOO_MANY_RESULTS) {
    return TOO_MANY_RESULTS
  }
  if (run.status !== STATUS_COMPLETED) {
    return `Failed: ${run.error}`
  }
  if (run.isUnchanged) {
    return 'No change'
  }
  return run.numNew || run.numRemoved ? `+${run.numNew} new / −${run.numRemoved} removed` : 'First results'
}

interface DisclosureProps {
  label: string
  expanded: boolean
  onToggle: () => void
}

const Disclosure = ({ label, expanded, onToggle }: DisclosureProps) => (
  <Button
    basic
    size="mini"
    icon={expanded ? 'caret down' : 'caret right'}
    content={label}
    aria-expanded={expanded}
    onClick={onToggle}
  />
)

interface UnreviewedListProps {
  results: UnreviewedResult[]
  total: number
  showFamily: boolean
  familiesByGuid: ByGuid<NamedEntity>
  genesById: ByGuid<{ geneSymbol?: string }>
}

const UnreviewedList = ({ results, total, showFamily, familiesByGuid, genesById }: UnreviewedListProps) => (
  <div>
    <VariantList aria-label="New variants">
      {results.map(({ familyGuid, variantIds, geneIds }) => (
        <li key={`${familyGuid}-${variantIds.join()}`}>
          {variantIds.map((variantId, i) => (
            <span key={variantId}>
              {i > 0 && ' + '}
              <a href={`/variant_search/variant/${variantId}/family/${familyGuid}`} target="_blank" rel="noreferrer">
                {variantId}
              </a>
            </span>
          ))}
          {geneIds.length > 0 && <Detail>{geneIds.map(geneId => genesById[geneId]?.geneSymbol || geneId).join(', ')}</Detail>}
          {showFamily && <Detail>{familiesByGuid[familyGuid]?.displayName || familyGuid}</Detail>}
        </li>
      ))}
    </VariantList>
    {total > results.length && <Detail>{`Showing the first ${results.length} of ${total}`}</Detail>}
  </div>
)

const RunTable = ({ runs, total }: { runs: WorksheetQueryRun[], total: number }) => (
  <div>
    <Table compact="very" basic="very" aria-label="Run history">
      <Table.Header>
        <Table.Row>
          {['Date', 'Run by', 'Trigger', 'Results', 'Change'].map(header => <Table.HeaderCell key={header} content={header} />)}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map(run => (
          <Table.Row key={run.runId}>
            <Table.Cell content={formatDate(run.createdDate)} />
            <Table.Cell content={run.createdBy || 'unknown user'} />
            <Table.Cell content={RUN_TRIGGER_LABELS[run.trigger]} />
            <Table.Cell content={run.numResults ?? ''} />
            <Table.Cell content={getRunChange(run)} />
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
    {total > runs.length && <Detail>{`Showing the last ${runs.length} of ${total} runs`}</Detail>}
  </div>
)

interface OwnProps {
  target: TargetDisplay
  query: WorksheetQuery
  queryResult: WorksheetQueryResult
  onMarkReviewed: () => void
}

interface CellReviewProps extends OwnProps {
  cellHistory: CellHistoryState
  familiesByGuid: ByGuid<NamedEntity>
  genesById: ByGuid<{ geneSymbol?: string }>
}

const CellReview = (
  { target, queryResult, cellHistory, familiesByGuid, genesById, onMarkReviewed }: CellReviewProps,
) => {
  const [showNew, setShowNew] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const toggleNew = useCallback(() => setShowNew(show => !show), [])
  const toggleHistory = useCallback(() => setShowHistory(show => !show), [])

  const { lastRun, numUnreviewed = 0 } = queryResult
  const { history = {}, error } = cellHistory
  const { runs = [], totalRuns = 0, unreviewedResults = [], totalUnreviewedResults = 0 } = history
  return (
    <Review>
      {lastRun.status !== STATUS_COMPLETED && (
        <Message warning size="small" role="status">
          {`The last run on ${formatDate(lastRun.createdDate)} did not complete. ${getRunChange(lastRun)}`}
        </Message>
      )}
      {numUnreviewed > 0 && (
        <Message info role="status">
          <Banner>
            <b>{`${numUnreviewed} new since last review`}</b>
            <Button primary size="mini" content="Mark reviewed" onClick={onMarkReviewed} />
            <Disclosure label="New variants" expanded={showNew} onToggle={toggleNew} />
          </Banner>
          {showNew && (
            <UnreviewedList
              results={unreviewedResults}
              total={totalUnreviewedResults}
              showFamily={target.isGroup}
              familiesByGuid={familiesByGuid}
              genesById={genesById}
            />
          )}
        </Message>
      )}
      <Disclosure label="History" expanded={showHistory} onToggle={toggleHistory} />
      {showHistory && error && <Message error content={error} />}
      {showHistory && !error && <RunTable runs={runs} total={totalRuns} />}
    </Review>
  )
}

const mapStateToProps = (state: WorkbookReduxState, { query, target }: OwnProps) => ({
  cellHistory: getCellHistory(state, getCellKey(query.worksheetQueryGuid, target.workbookTargetGuid)),
  familiesByGuid: getFamiliesByGuid(state),
  genesById: getGenesById(state),
})

export default connect(mapStateToProps, {})(CellReview)
