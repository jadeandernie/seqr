import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { connect } from 'react-redux'
import {
  Button, DropdownProps, Form, Header, InputOnChangeData, Loader, Message,
} from 'semantic-ui-react'
import styled from 'styled-components'

import { STATUS_NOT_REVIEWED, WORKBOOK_STATUSES } from './constants'
import { runWorksheetQuery, updateWorksheetQueryResult } from './reducers'
import SearchResultsHost from './SearchResultsHost'
import {
  RequestError, TargetDisplay, Workbook, WorkbookReduxState, WorkbookStatus, WorksheetQuery, WorksheetQueryResult,
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

const getErrors = (e: RequestError) => e.body?.errors || [e.message]

interface CellProps {
  workbook: Workbook
  target: TargetDisplay
  query: WorksheetQuery
  queryResult?: WorksheetQueryResult
}

interface WorkPaneProps extends CellProps {
  totalResults?: number
  onUpdate: (values: { status?: WorkbookStatus, note?: string }) => Promise<void>
  onRun: () => Promise<void>
}

const WorkPane = ({ target, query, queryResult, totalResults, onUpdate, onRun }: WorkPaneProps) => {
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
  const saveNoteButton = useMemo(() => ({ content: 'Save Note', disabled: note === savedNote }), [note, savedNote])

  const numResults = totalResults ?? queryResult?.numResults
  const searchHash = queryResult?.searchHash
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
              {`Last run ${new Date(queryResult.lastRunDate).toLocaleDateString()} by ${queryResult.lastRunBy || 'unknown user'}`}
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
      {running && <Loader inline="centered" active />}
      {!running && (searchHash ?
        <SearchResultsHost key={searchHash} searchHash={searchHash} /> :
        <Message content={`This query has not been run for ${target.name} yet`} />)}
    </div>
  )
}

const mapStateToProps = (state: WorkbookReduxState, { queryResult }: CellProps) => ({
  totalResults: state.searchesByHash[queryResult?.searchHash]?.totalResults,
})

type Dispatch = (thunk: ReturnType<typeof runWorksheetQuery>) => Promise<void>

const mapDispatchToProps = (dispatch: Dispatch, { workbook, target, query }: CellProps) => {
  const cell: [string, string, string] = [workbook.workbookGuid, query.worksheetQueryGuid, target.workbookTargetGuid]
  return {
    onUpdate: (values: { status?: WorkbookStatus, note?: string }) => dispatch(
      updateWorksheetQueryResult(...cell, values),
    ),
    onRun: () => dispatch(runWorksheetQuery(...cell)),
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(WorkPane)
