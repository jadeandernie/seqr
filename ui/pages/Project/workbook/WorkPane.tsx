import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connect } from 'react-redux'
import {
  Button, DropdownProps, Form, Header, InputOnChangeData, Loader, Message,
} from 'semantic-ui-react'
import styled from 'styled-components'

import CellReview from './CellReview'
import { isAutomatedTrigger, RUN_TRIGGER_LABELS, STATUS_NOT_REVIEWED, WORKBOOK_STATUSES } from './constants'
import GroupResults from './GroupResults'
import {
  loadCellHistory, markWorksheetQueryResultReviewed, runGroupWorksheetQuery, runWorksheetQuery,
  updateWorksheetQueryResult,
} from './reducers'
import SearchResultsHost from './SearchResultsHost'
import { getNextRerunDate } from './selectors'
import {
  RequestError, TargetDisplay, Workbook, WorkbookReduxState, WorkbookStatus, Worksheet, WorksheetQuery,
  WorksheetQueryResult,
} from './types'

const PaneHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1em;
  margin-bottom: 1em;

  .ui.header {
    margin: 0 1em 0 0;
  }

  .ui.form {
    flex: 1 1 20em;
  }

  .fields {
    margin: 0 !important;
  }
`

const RunInfo = styled.div`
  text-align: right;
  color: gray;
`

const STATUS_OPTIONS = WORKBOOK_STATUSES.map(({ value, text, icon, color }) => ({
  value, text, icon: icon && { name: icon, color },
}))

const formatDate = (date: string | Date) => new Date(date).toLocaleDateString()

const NEXT_RERUN_TITLE = 'The query is rerun at the first scheduled check after this date, or sooner after new data is loaded'

const getErrors = (e: RequestError) => e.body?.errors || [e.message]

interface CellProps {
  workbook: Workbook
  target: TargetDisplay
  query: WorksheetQuery
  queryResult?: WorksheetQueryResult
}

interface WorkPaneProps extends CellProps {
  worksheet?: Worksheet
  totalResults?: number
  searchLoading: boolean
  onUpdate: (values: { status?: WorkbookStatus, note?: string }) => Promise<void>
  onRun: () => Promise<void>
  onLoadHistory: () => Promise<void>
  onMarkReviewed: () => Promise<void>
}

const WorkPane = ({
  workbook, worksheet, target, query, queryResult, totalResults, searchLoading, onUpdate, onRun, onLoadHistory,
  onMarkReviewed,
}: WorkPaneProps) => {
  const savedNote = queryResult?.note || ''
  const [note, setNote] = useState(savedNote)
  const [errors, setErrors] = useState<string[]>(null)
  const [running, setRunning] = useState(false)
  const mounted = useRef(true)
  useEffect(() => () => {
    mounted.current = false
  }, [])

  const handleRequest = useCallback((request: Promise<void>) => {
    setErrors(null)
    return request.catch((e: RequestError) => {
      if (mounted.current) {
        setErrors(getErrors(e))
      }
    })
  }, [])
  const updateStatus = useCallback((e: React.SyntheticEvent, { value }: DropdownProps) => {
    handleRequest(onUpdate({ status: value as WorkbookStatus }))
  }, [handleRequest, onUpdate])
  const updateNote = useCallback((e: React.ChangeEvent, { value }: InputOnChangeData) => setNote(value), [])
  const saveNote = useCallback(() => {
    handleRequest(onUpdate({ note }))
  }, [handleRequest, onUpdate, note])
  const run = useCallback(() => {
    setRunning(true)
    handleRequest(onRun()).then(() => mounted.current && setRunning(false))
  }, [handleRequest, onRun])
  const markReviewed = useCallback(() => {
    handleRequest(onMarkReviewed())
  }, [handleRequest, onMarkReviewed])
  const saveNoteButton = useMemo(() => ({ content: 'Save Note', disabled: note === savedNote }), [note, savedNote])

  const numResults = totalResults ?? queryResult?.numResults
  const searchHash = queryResult?.searchHash
  const lastRunTrigger = queryResult?.lastRun?.trigger
  const nextRerunDate = getNextRerunDate(workbook, worksheet, queryResult)

  // A run is recorded when the results are loaded, so the alert and history of the cell are loaded after that
  const loadHistory = useRef(onLoadHistory)
  loadHistory.current = onLoadHistory
  useEffect(() => {
    if (searchHash && !running && !searchLoading) {
      loadHistory.current()
    }
  }, [searchHash, running, searchLoading])

  return (
    <div>
      <PaneHeader>
        <Header as="h3" content={query.name} subheader={target.name} />
        <Form onSubmit={saveNote}>
          <Form.Group>
            <Form.Dropdown
              label="Status"
              aria-label="Status"
              selection
              options={STATUS_OPTIONS}
              value={queryResult?.status || STATUS_NOT_REVIEWED}
              onChange={updateStatus}
            />
            <Form.Input
              label="Note"
              aria-label="Note"
              width={10}
              value={note}
              onChange={updateNote}
              action={saveNoteButton}
            />
          </Form.Group>
        </Form>
        <RunInfo>
          {queryResult?.lastRunDate && (
            <div>
              {`Last run ${formatDate(queryResult.lastRunDate)} by ${queryResult.lastRunBy || 'unknown user'}`}
              {lastRunTrigger && isAutomatedTrigger(lastRunTrigger) && ` (${RUN_TRIGGER_LABELS[lastRunTrigger].toLowerCase()})`}
            </div>
          )}
          {queryResult?.lastScheduledRunDate && (
            <div>{`Last scheduled run ${formatDate(queryResult.lastScheduledRunDate)}`}</div>
          )}
          {nextRerunDate && (
            <div title={NEXT_RERUN_TITLE}>
              {`Next rerun due at the first scheduled check after ${formatDate(nextRerunDate)}`}
            </div>
          )}
          {numResults != null && <div>{`${numResults} results`}</div>}
          <Button
            primary
            size="small"
            icon={searchHash ? 'refresh' : 'play'}
            content={searchHash ? 'Refresh' : 'Run'}
            loading={running}
            disabled={running}
            onClick={run}
          />
        </RunInfo>
      </PaneHeader>
      {errors && <Message error list={errors} />}
      {queryResult?.lastRun && (
        <CellReview target={target} query={query} queryResult={queryResult} onMarkReviewed={markReviewed} />
      )}
      {running && <Loader inline="centered" active />}
      {!running && !searchHash && <Message content={`This query has not been run for ${target.name} yet`} />}
      {!running && searchHash && (target.isGroup ?
        <GroupResults key={searchHash} workbook={workbook} target={target} query={query} searchHash={searchHash} onRun={run} /> :
        <SearchResultsHost key={searchHash} searchHash={searchHash} collapseExcluded />)}
    </div>
  )
}

const mapStateToProps = (state: WorkbookReduxState, { query, queryResult }: CellProps) => ({
  worksheet: state.worksheetsByGuid[query.worksheetGuid],
  totalResults: state.searchesByHash[queryResult?.searchHash]?.totalResults,
  searchLoading: state.searchedVariantsLoading.isLoading,
})

type Dispatch = (thunk: ReturnType<typeof runWorksheetQuery>) => Promise<void>

const mapDispatchToProps = (dispatch: Dispatch, { workbook, target, query }: CellProps) => {
  const cell: [string, string, string] = [workbook.workbookGuid, query.worksheetQueryGuid, target.workbookTargetGuid]
  return {
    onUpdate: (values: { status?: WorkbookStatus, note?: string }) => dispatch(
      updateWorksheetQueryResult(...cell, values),
    ),
    onRun: () => dispatch((target.isGroup ? runGroupWorksheetQuery : runWorksheetQuery)(...cell)),
    onLoadHistory: () => dispatch(loadCellHistory(...cell)),
    onMarkReviewed: () => dispatch(markWorksheetQueryResultReviewed(...cell)),
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(WorkPane)
