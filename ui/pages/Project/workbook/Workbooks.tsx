import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import { Message, Table } from 'semantic-ui-react'

import DataLoader from '../../../shared/components/DataLoader'
import { VerticalSpacer } from '../../../shared/components/Spacers'
import { loadWorkbooksPage } from './reducers'
import { TemplateManager } from './Templates'
import { getProjectWorkbooks, getWorkbookPath, getWorkbooksIsLoading, getWorkbooksLoadingError } from './selectors'
import { Workbook, WorkbookReduxState } from './types'
import {
  CreateWorkbookButton, DeleteWorkbookButton, DuplicateWorkbookButton, EditWorkbookButton,
} from './WorkbookButtons'

const formatDate = (date: string) => new Date(date).toLocaleDateString()

const WorkbookRow = ({ workbook }: { workbook: Workbook }) => (
  <Table.Row>
    <Table.Cell><Link to={getWorkbookPath(workbook)}>{workbook.name}</Link></Table.Cell>
    <Table.Cell>{workbook.description}</Table.Cell>
    <Table.Cell>{`${workbook.createdBy || 'unknown user'} on ${formatDate(workbook.createdDate)}`}</Table.Cell>
    <Table.Cell>{formatDate(workbook.lastModifiedDate)}</Table.Cell>
    <Table.Cell textAlign="right">
      <DuplicateWorkbookButton workbook={workbook} />
      {workbook.canEdit && <EditWorkbookButton workbook={workbook} />}
      {workbook.canEdit && <DeleteWorkbookButton workbook={workbook} />}
    </Table.Cell>
  </Table.Row>
)

interface WorkbooksProps {
  workbooks: Workbook[]
  loading: boolean
  errorMessage?: string | null
  load: () => void
}

const Workbooks = React.memo(({ workbooks, loading, errorMessage, load }: WorkbooksProps) => (
  <React.Fragment>
    <DataLoader
      load={load}
      loading={loading}
      content={workbooks}
      errorMessage={errorMessage && <Message error content={errorMessage} />}
    >
      <VerticalSpacer height={10} />
      {workbooks.length ? (
        <Table basic="very" aria-label="Workbooks">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell content="Name" />
              <Table.HeaderCell content="Description" />
              <Table.HeaderCell content="Created" />
              <Table.HeaderCell content="Last Modified" />
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {workbooks.map(workbook => <WorkbookRow key={workbook.workbookGuid} workbook={workbook} />)}
          </Table.Body>
        </Table>
      ) : <Message content="This project has no workbooks yet" />}
      <VerticalSpacer height={10} />
      <CreateWorkbookButton />
      <VerticalSpacer height={30} />
    </DataLoader>
    <TemplateManager />
  </React.Fragment>
))

const mapStateToProps = (state: WorkbookReduxState) => ({
  workbooks: getProjectWorkbooks(state),
  loading: getWorkbooksIsLoading(state),
  errorMessage: getWorkbooksLoadingError(state),
})

const mapDispatchToProps = { load: loadWorkbooksPage }

export default connect(mapStateToProps, mapDispatchToProps)(Workbooks)
