import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, Header, Icon, Loader, Message, Modal, SemanticCOLORS, SemanticICONS, Table,
} from 'semantic-ui-react'

import { ButtonLink } from '../../../shared/components/StyledComponents'
import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'
import { Workbook } from './types'

type Outcome = 'exported' | 'approximated' | 'dropped'

export interface TalosReportRow {
  query: string
  queryGuid: string
  worksheet: string
  parameter: string
  value: unknown
  outcome: Outcome
  talosKey?: string
  note: string
}

export interface TalosExportResponse {
  toml: string
  report: TalosReportRow[]
  talosVersion: string
}

interface OutcomeDisplay {
  text: string
  description: string
  icon: SemanticICONS
  color: SemanticCOLORS
}

const OUTCOMES: Record<Outcome, OutcomeDisplay> = {
  exported: {
    text: 'Exported', description: 'written to Talos with the same meaning', icon: 'check circle', color: 'green',
  },
  approximated: {
    text: 'Approximated',
    description: 'written to Talos, but merged across queries or applied by Talos in a different way',
    icon: 'adjust',
    color: 'yellow',
  },
  dropped: { text: 'Dropped', description: 'not in the Talos configuration', icon: 'ban', color: 'red' },
}
const OUTCOME_ORDER = Object.keys(OUTCOMES) as Outcome[]

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(formatValue).join(', ')
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const getFileName = (workbook: Workbook) => `${workbook.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.talos.toml`

interface QueryRows {
  queryGuid: string
  title: string
  rows: TalosReportRow[]
}

const groupByQuery = (report: TalosReportRow[]): QueryRows[] => report.reduce((acc, row) => {
  let group = acc.find(({ queryGuid }) => queryGuid === row.queryGuid)
  if (!group) {
    group = { queryGuid: row.queryGuid, title: `${row.worksheet}: ${row.query}`, rows: [] }
    acc.push(group)
  }
  group.rows.push(row)
  return acc
}, [] as QueryRows[])

const OutcomeLabel = ({ outcome }: { outcome: Outcome }) => (
  <span>
    <Icon name={OUTCOMES[outcome].icon} color={OUTCOMES[outcome].color} aria-hidden="true" />
    {OUTCOMES[outcome].text}
  </span>
)

const QueryReport = ({ title, rows }: QueryRows) => (
  <section aria-label={title}>
    <Header size="small" content={title} />
    <Table compact="very" size="small" celled>
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell content="Search parameter" />
          <Table.HeaderCell content="Value in seqr" />
          <Table.HeaderCell content="Outcome" />
          <Table.HeaderCell content="Talos setting" />
          <Table.HeaderCell content="What Talos does" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Table.Row key={i}>
            <Table.Cell content={row.parameter} />
            <Table.Cell content={formatValue(row.value)} />
            <Table.Cell singleLine><OutcomeLabel outcome={row.outcome} /></Table.Cell>
            <Table.Cell content={row.talosKey || 'None'} />
            <Table.Cell content={row.note} />
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  </section>
)

interface TalosExportReportProps {
  workbook: Workbook
  data: TalosExportResponse
}

const TalosExportReport = ({ workbook, data }: TalosExportReportProps) => (
  <div>
    <Message warning>
      <Message.Header content="A starting configuration, not an equivalent of the worksheets" />
      <p>
        Talos can not re-run seqr queries. This export gives Talos the gene panels, frequency thresholds and other
        settings of this workbook that Talos has a setting for, and the report below states what happens to every
        search parameter. seqr does not start Talos and does not show Talos results in this workbook.
      </p>
      <p>
        {`Written for Talos ${data.talosVersion}. The file is a fragment: merge it into the Talos configuration by hand.`}
      </p>
    </Message>
    <Button
      as="a"
      primary
      icon="download"
      content="Download TOML"
      href={`data:application/toml;charset=utf-8,${encodeURIComponent(data.toml)}`}
      download={getFileName(workbook)}
    />
    <Header size="small" content="Fidelity report" />
    <ul id="talos-outcome-summary">
      {OUTCOME_ORDER.map(outcome => (
        <li key={outcome}>
          <OutcomeLabel outcome={outcome} />
          {`: ${data.report.filter(row => row.outcome === outcome).length} (${OUTCOMES[outcome].description})`}
        </li>
      ))}
    </ul>
    {data.report.length === 0 && <Message content="The queries of this workbook have no search parameters to export" />}
    {groupByQuery(data.report).map(group => <QueryReport key={group.queryGuid} {...group} />)}
  </div>
)

const TalosExportButton = ({ workbook }: { workbook: Workbook }) => {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<TalosExportResponse>(null)
  const [error, setError] = useState<string>(null)
  const request = useRef(0)
  useEffect(() => () => {
    request.current = -1
  }, [])

  const close = useCallback(() => {
    request.current += 1
    setOpen(false)
  }, [])
  const load = useCallback(() => {
    request.current += 1
    const requestId = request.current
    const isCurrent = () => request.current === requestId
    setOpen(true)
    setData(null)
    setError(null)
    new HttpRequestHelper(
      `/api/workbook/${workbook.workbookGuid}/talos_export`,
      (responseJson: TalosExportResponse) => isCurrent() && setData(responseJson),
      (e: Error) => isCurrent() && setError(e.message),
    ).get()
  }, [workbook.workbookGuid])

  const title = `Export ${workbook.name} to Talos`
  return (
    <Modal
      open={open}
      onClose={close}
      size="large"
      trigger={<ButtonLink icon="share square" content="Export to Talos" size="small" onClick={load} />}
    >
      <Modal.Header>
        {title}
        <ButtonLink floated="right" onClick={close} icon="remove" aria-label="Close" title="Close" />
      </Modal.Header>
      <Modal.Content scrolling>
        {error && <Message error content={`The Talos export failed: ${error}`} />}
        {data && <TalosExportReport workbook={workbook} data={data} />}
        {!data && !error && <Loader active inline="centered" content="Preparing the Talos export" />}
      </Modal.Content>
    </Modal>
  )
}

export default TalosExportButton
