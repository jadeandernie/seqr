import React from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import NewResultsBadge from './NewResultsBadge'
import { getNumUnreviewed, getQueryStatus, getRollUpStatus, getWorkbookPath } from './selectors'
import StatusIcon from './StatusIcon'
import {
  ByGuid, TargetDisplay, Workbook, WorksheetDisplay, WorksheetQuery, WorksheetQueryResult,
} from './types'
import {
  AddQueryButton, DeleteQueryButton, DeleteWorksheetButton, RenameQueryButton, UpdateWorksheetButton,
} from './WorkbookButtons'

const BORDER = '1px solid #d4d4d5'

const Sidebar = styled.nav`
  flex: 0 0 25%;
  min-width: 0;
  border-right: ${BORDER};
  padding: 1em 0 1em 0;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  border: 1px solid transparent;
`

const WorksheetRow = styled(Row)`
  font-weight: 700;
  font-size: 1.1em;
  padding: 0.5em 0.6em;
  border-left: 3px solid ${(props: { $active: boolean }) => (props.$active ? '#2185d0' : 'transparent')};
`

// The selected query covers the divider between the sidebar and the work pane, like a selected vertical tab
const QueryRow = styled(Row)`
  padding: 0.4em 0.6em 0.4em 1.8em;
  ${(props: { $active: boolean }) => (props.$active ? `
    background-color: white;
    font-weight: 700;
    border-top: ${BORDER};
    border-bottom: ${BORDER};
    border-left: ${BORDER};
    margin-right: -1px;
    border-right: 1px solid white;
  ` : '')}
`

const QueryList = styled.ul`
  list-style: none;
  margin: 0 0 1em 0;
  padding: 0;
`

const RowLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
`

const EmptyText = styled.div`
  color: gray;
  padding: 0.4em 0.6em 0.4em 1.8em;
`

interface WorksheetSidebarProps {
  workbook: Workbook
  worksheets: WorksheetDisplay[]
  resultsByQueryTarget: ByGuid<ByGuid<WorksheetQueryResult>>
  selectedTarget?: TargetDisplay
  selectedQuery?: WorksheetQuery
}

const WorksheetSidebar = React.memo((
  { workbook, worksheets, resultsByQueryTarget, selectedTarget, selectedQuery }: WorksheetSidebarProps,
) => {
  const targetGuid = selectedTarget?.workbookTargetGuid
  const statusLabel = selectedTarget ? `Status for ${selectedTarget.name}` : 'Status'
  const targetContext = `for ${selectedTarget?.name}`
  const getStatus = ({ worksheetQueryGuid }: WorksheetQuery) => getQueryStatus(
    resultsByQueryTarget, worksheetQueryGuid, targetGuid,
  )
  return (
    <Sidebar aria-label="Worksheets">
      {worksheets.map(worksheet => (
        <section key={worksheet.worksheetGuid} aria-label={worksheet.name}>
          <WorksheetRow $active={worksheet.queries.includes(selectedQuery)}>
            <RowLabel>{worksheet.name}</RowLabel>
            {workbook.canEdit && <AddQueryButton workbook={workbook} worksheet={worksheet} />}
            {workbook.canEdit && <UpdateWorksheetButton workbook={workbook} worksheet={worksheet} />}
            {workbook.canEdit && <DeleteWorksheetButton workbook={workbook} worksheet={worksheet} />}
            <NewResultsBadge
              count={getNumUnreviewed(resultsByQueryTarget, worksheet.queries, targetGuid)}
              context={`in this worksheet ${targetContext}`}
            />
            <StatusIcon
              status={getRollUpStatus(worksheet.queries.map(getStatus))}
              label={`Worksheet ${statusLabel.toLowerCase()}`}
            />
          </WorksheetRow>
          {worksheet.queries.length ? (
            <QueryList>
              {worksheet.queries.map((query) => {
                const active = query === selectedQuery
                return (
                  <li key={query.worksheetQueryGuid}>
                    <QueryRow $active={active}>
                      <RowLabel>
                        <Link
                          to={getWorkbookPath(workbook, targetGuid, query.worksheetQueryGuid)}
                          aria-current={active ? 'page' : undefined}
                        >
                          {query.name}
                        </Link>
                      </RowLabel>
                      {workbook.canEdit && <RenameQueryButton workbook={workbook} query={query} />}
                      {workbook.canEdit && <DeleteQueryButton workbook={workbook} query={query} />}
                      <NewResultsBadge
                        count={getNumUnreviewed(resultsByQueryTarget, [query], targetGuid)}
                        context={`of this query ${targetContext}`}
                      />
                      <StatusIcon status={getStatus(query)} label={statusLabel} />
                    </QueryRow>
                  </li>
                )
              })}
            </QueryList>
          ) : <EmptyText>No queries</EmptyText>}
        </section>
      ))}
      {worksheets.length === 0 && <EmptyText>No worksheets</EmptyText>}
      {workbook.canEdit && <EmptyText><UpdateWorksheetButton workbook={workbook} /></EmptyText>}
    </Sidebar>
  )
})

export default WorksheetSidebar
