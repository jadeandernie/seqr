import React from 'react'
import { connect } from 'react-redux'
import { Redirect, RouteComponentProps } from 'react-router-dom'
import { Message } from 'semantic-ui-react'
import styled from 'styled-components'

import DataLoader from '../../../shared/components/DataLoader'
import { WORK_PANE_ID } from './constants'
import { loadWorkbookPage } from './reducers'
import {
  getNumUnreviewedByTarget, getQueryResultsByQueryTarget, getWorkbook, getWorkbookDetailIsLoading,
  getWorkbookDetailLoadingError,
  getWorkbookPath, getWorkbookSelection, getWorkbookTargets, getWorkbookWorksheets,
} from './selectors'
import TargetTabs, { getTargetTabId } from './TargetTabs'
import {
  ByGuid, TargetDisplay, Workbook, WorkbookReduxState, WorksheetDisplay, WorksheetQueryResult,
} from './types'
import WorkPane from './WorkPane'
import WorksheetSidebar from './WorksheetSidebar'

const WorkArea = styled.div`
  margin-top: 1em;
`

const Body = styled.div`
  display: flex;
  align-items: stretch;
  min-height: 30em;
`

const Pane = styled.div`
  flex: 1 1 75%;
  min-width: 0;
  padding: 1em 0 1em 1.5em;
`

type WorkbookParams = { workbookGuid: string, targetGuid?: string, queryGuid?: string }

interface WorkbookContentProps {
  workbook: Workbook
  targets: TargetDisplay[]
  worksheets: WorksheetDisplay[]
  resultsByQueryTarget: ByGuid<ByGuid<WorksheetQueryResult>>
  numUnreviewedByTarget: ByGuid<number>
  targetGuid?: string
  queryGuid?: string
  pathname: string
}

const WorkbookContent = React.memo(({
  workbook, targets, worksheets, resultsByQueryTarget, numUnreviewedByTarget, targetGuid, queryGuid, pathname,
}: WorkbookContentProps) => {
  const { target, query } = getWorkbookSelection(targets, worksheets, targetGuid, queryGuid)
  const path = getWorkbookPath(workbook, target?.workbookTargetGuid, query?.worksheetQueryGuid)
  if (path !== pathname) {
    return <Redirect to={path} />
  }

  let pane = <Message content="Add a family or analysis group to this workbook to review it" />
  if (target && query) {
    pane = (
      <WorkPane
        key={`${query.worksheetQueryGuid}-${target.workbookTargetGuid}`}
        workbook={workbook}
        target={target}
        query={query}
        queryResult={resultsByQueryTarget[query.worksheetQueryGuid]?.[target.workbookTargetGuid]}
      />
    )
  } else if (target) {
    pane = <Message content="Add a worksheet with a query to this workbook to review it" />
  }

  return (
    <WorkArea>
      <TargetTabs
        workbook={workbook}
        targets={targets}
        selectedTarget={target}
        queryGuid={query?.worksheetQueryGuid}
        numUnreviewedByTarget={numUnreviewedByTarget}
      />
      <Body>
        <WorksheetSidebar
          workbook={workbook}
          worksheets={worksheets}
          resultsByQueryTarget={resultsByQueryTarget}
          selectedTarget={target}
          selectedQuery={query}
        />
        <Pane id={WORK_PANE_ID} role="tabpanel" aria-labelledby={target && getTargetTabId(target)}>{pane}</Pane>
      </Body>
    </WorkArea>
  )
})

interface WorkbookPageProps extends RouteComponentProps<WorkbookParams> {
  workbook?: Workbook
  targets: TargetDisplay[]
  worksheets: WorksheetDisplay[]
  resultsByQueryTarget: ByGuid<ByGuid<WorksheetQueryResult>>
  numUnreviewedByTarget: ByGuid<number>
  loading: boolean
  errorMessage?: string | null
  load: (workbookGuid: string) => void
}

const WorkbookPage = React.memo((
  { match, location, workbook, loading, errorMessage, load, ...props }: WorkbookPageProps,
) => (
  <DataLoader
    contentId={match.params.workbookGuid}
    content={workbook}
    load={load}
    loading={loading}
    reloadOnIdUpdate
    errorMessage={errorMessage && <Message error content={errorMessage} />}
  >
    <WorkbookContent
      workbook={workbook}
      targetGuid={match.params.targetGuid}
      queryGuid={match.params.queryGuid}
      pathname={location.pathname}
      targets={props.targets}
      worksheets={props.worksheets}
      resultsByQueryTarget={props.resultsByQueryTarget}
      numUnreviewedByTarget={props.numUnreviewedByTarget}
    />
  </DataLoader>
))

const mapStateToProps = (state: WorkbookReduxState, { match }: RouteComponentProps<WorkbookParams>) => ({
  workbook: getWorkbook(state, match.params),
  targets: getWorkbookTargets(state, match.params),
  worksheets: getWorkbookWorksheets(state, match.params),
  resultsByQueryTarget: getQueryResultsByQueryTarget(state),
  numUnreviewedByTarget: getNumUnreviewedByTarget(state),
  loading: getWorkbookDetailIsLoading(state),
  errorMessage: getWorkbookDetailLoadingError(state),
})

const mapDispatchToProps = { load: loadWorkbookPage }

export default connect(mapStateToProps, mapDispatchToProps)(WorkbookPage)
