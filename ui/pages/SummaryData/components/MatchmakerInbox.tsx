import React from 'react'
import { Button, Checkbox, Form, Header, Label, Loader, Message, Pagination, Table } from 'semantic-ui-react'
import type { SemanticCOLORS } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'

const INBOX_URL = '/api/summary_data/matchmaker_inbox'
const UPDATE_URL = `${INBOX_URL}/update`

interface Gene {
  geneId: string | null
  geneSymbol: string
}

interface Phenotype {
  id: string
  label: string | null
  observed: string
}

export interface InboxResult {
  matchmakerResultGuid: string
  status: string
  source: string
  comments: string | null
  createdDate: string
  matchRemoved: boolean
  weContacted: boolean
  hostContacted: boolean
  assignedTo: string | null
  assignedToMe: boolean
  submission: {
    individualDisplayName: string
    familyGuid: string
    familyDisplayName: string
    projectGuid: string
    projectName: string
    genes: Gene[]
    phenotypes: Phenotype[]
  }
  match: {
    patientId: string | null
    label: string | null
    institution: string | null
    contactName: string | null
    contactHref: string | null
    contactEmail: string | null
    genes: Gene[]
    phenotypes: Phenotype[]
    score: number | null
  }
  geneOverlap: string[]
  hpoOverlap: string[]
}

interface InboxResponse {
  results: InboxResult[]
  totalResults: number
  page: number
  perPage: number
  statusCounts: Record<string, number>
  institutions: string[]
  projects: { projectGuid: string, name: string }[]
}

interface Filters {
  status: string[]
  gene: string
  institution: string
  projectGuid: string
  source: string
  startDate: string
  endDate: string
  assignedToMe: boolean
}

type ResultUpdate = { status: string } | { assignedToMe: boolean }

interface InboxState {
  filters: Filters
  geneInput: string
  page: number
  loading: boolean
  error: string | null
  updateError: string | null
  data: InboxResponse | null
  selected: Record<string, boolean>
}

interface InputData {
  value?: unknown
  checked?: boolean
}

const STATUSES: { value: string, text: string, color: SemanticCOLORS }[] = [
  { value: 'new', text: 'New', color: 'blue' },
  { value: 'reviewing', text: 'Reviewing', color: 'yellow' },
  { value: 'relevant', text: 'Relevant', color: 'green' },
  { value: 'not_relevant', text: 'Not Relevant', color: 'grey' },
  { value: 'responded', text: 'Responded', color: 'teal' },
]
const STATUS_LOOKUP = STATUSES.reduce(
  (acc, status) => ({ ...acc, [status.value]: status }), {} as Record<string, typeof STATUSES[number]>,
)
const DEFAULT_STATUSES = ['new', 'reviewing']

const SOURCE_OPTIONS = [
  { value: 'mme', text: 'Matchmaker Exchange' },
  { value: 'variantmatcher', text: 'VariantMatcher' },
  { value: 'genematcher', text: 'GeneMatcher' },
  { value: 'other', text: 'Other' },
]
const MANUAL_SOURCE_LABELS: Record<string, string> = SOURCE_OPTIONS.slice(1).reduce(
  (acc, { value, text }) => ({ ...acc, [value]: text }), {},
)

const STATUS_ACTIONS: { content: string, update: { status: string } }[] = [
  { content: 'Reviewing', update: { status: 'reviewing' } },
  { content: 'Relevant', update: { status: 'relevant' } },
  { content: 'Not Relevant', update: { status: 'not_relevant' } },
]
const ASSIGN_ACTION = { content: 'Assign to Me', update: { assignedToMe: true } }
const UNASSIGN_ACTION = { content: 'Unassign', update: { assignedToMe: false } }

const SAFE_CONTACT_URL_REGEX = /^(mailto:|https?:\/\/)/i

// Contact details come from external matchmaker nodes and are not validated, so are only linked for safe schemes
export const getSafeContactUrl = (href: unknown): string | null => (
  typeof href === 'string' && SAFE_CONTACT_URL_REGEX.test(href.trim()) ? href.trim() : null
)

const toOptions = (values: string[]) => values.map(value => ({ value, text: value }))

const Contact = ({ match }: { match: InboxResult['match'] }) => {
  const url = getSafeContactUrl(match.contactHref)
  const urlLabel = match.contactName || (url || '').replace(/^mailto:/i, '')
  return (
    <div>
      {match.institution && <div><b>{match.institution}</b></div>}
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{urlLabel}</a> : (
        <span className="unlinked-contact">
          {[match.contactName, match.contactHref].filter(val => val).join(' - ')}
        </span>
      )}
      {match.contactEmail && <div>{match.contactEmail}</div>}
    </div>
  )
}

const Features = (
  { genes, phenotypes, geneOverlap, hpoOverlap }:
  { genes: Gene[], phenotypes: Phenotype[], geneOverlap: string[], hpoOverlap: string[] },
) => (
  <div>
    {genes.map(({ geneId, geneSymbol }) => (
      <Label
        key={geneSymbol}
        size="small"
        content={geneSymbol}
        color={geneId && geneOverlap.includes(geneId) ? 'green' : undefined}
      />
    ))}
    {genes.length === 0 && phenotypes.length === 0 && <i>None</i>}
    {phenotypes.map(({ id, label, observed }) => (
      <Label
        key={id}
        size="small"
        basic={!hpoOverlap.includes(id)}
        color={hpoOverlap.includes(id) ? 'green' : undefined}
        content={`${observed === 'no' ? 'Absent: ' : ''}${label || id}`}
      />
    ))}
  </div>
)

class MatchmakerInbox extends React.PureComponent<Record<string, never>, InboxState> {

  state: InboxState = {
    filters: {
      status: DEFAULT_STATUSES,
      gene: '',
      institution: '',
      projectGuid: '',
      source: '',
      startDate: '',
      endDate: '',
      assignedToMe: false,
    },
    geneInput: '',
    page: 1,
    loading: true,
    error: null,
    updateError: null,
    data: null,
    selected: {},
  }

  componentDidMount() {
    this.load()
  }

  getRequestParams = (): Record<string, string> => {
    const { filters: { status, assignedToMe, ...stringFilters }, page } = this.state
    return Object.entries(stringFilters).reduce(
      (acc, [key, value]) => (value ? { ...acc, [key]: value } : acc),
      { status: status.join(',') || 'all', page: String(page), ...(assignedToMe ? { assignedToMe: 'true' } : {}) },
    )
  }

  load = () => {
    this.setState({ loading: true })
    new HttpRequestHelper(
      INBOX_URL,
      (data: InboxResponse) => this.setState({ data, loading: false, error: null, selected: {} }),
      (e: Error) => this.setState({ loading: false, error: e.message }),
    ).get(this.getRequestParams())
  }

  setFilters = (updates: Partial<Filters>) => this.setState(
    prevState => ({ filters: { ...prevState.filters, ...updates }, page: 1 }), this.load,
  )

  updateFilter = (name: keyof Filters) => (e: unknown, data: InputData) => this.setFilters(
    { [name]: name === 'assignedToMe' ? !!data.checked : (data.value || '') },
  )

  updateGeneInput = (e: unknown, data: InputData) => this.setState({ geneInput: `${data.value}` })

  submitGene = () => {
    const { geneInput } = this.state
    this.setFilters({ gene: geneInput.trim() })
  }

  changePage = (e: unknown, data: { activePage?: number | string }) => this.setState(
    { page: Number(data.activePage) }, this.load,
  )

  updateResults = (resultGuids: string[], update: ResultUpdate) => {
    this.setState({ updateError: null })
    return new HttpRequestHelper(
      UPDATE_URL,
      this.load,
      (e: Error) => this.setState({ updateError: e.message }),
    ).post({ resultGuids, ...update })
  }

  getSelectedGuids = () => {
    const { selected, data } = this.state
    return (data ? data.results : []).map(row => row.matchmakerResultGuid).filter(guid => selected[guid])
  }

  toggleSelected = (guid: string) => () => this.setState(
    prevState => ({ selected: { ...prevState.selected, [guid]: !prevState.selected[guid] } }),
  )

  toggleAllSelected = () => this.setState((prevState) => {
    const guids = (prevState.data ? prevState.data.results : []).map(row => row.matchmakerResultGuid)
    const allSelected = guids.every(guid => prevState.selected[guid])
    return { selected: guids.reduce((acc, guid) => ({ ...acc, [guid]: !allSelected }), {}) }
  })

  renderFilters = () => {
    const { filters, geneInput, data } = this.state
    return (
      <Form onSubmit={this.submitGene}>
        <Form.Group>
          <Form.Dropdown
            label="Status"
            name="status"
            multiple
            selection
            placeholder="All"
            options={STATUSES}
            value={filters.status}
            onChange={this.updateFilter('status')}
          />
          <Form.Input
            label="Gene"
            name="gene"
            placeholder="Symbol or Ensembl ID"
            value={geneInput}
            onChange={this.updateGeneInput}
            action={{ icon: 'search', type: 'submit', 'aria-label': 'Search gene' }}
          />
          <Form.Dropdown
            label="Institution"
            name="institution"
            search
            selection
            clearable
            placeholder="All"
            options={toOptions(data ? data.institutions : [])}
            value={filters.institution}
            onChange={this.updateFilter('institution')}
          />
          <Form.Dropdown
            label="Project"
            name="projectGuid"
            search
            selection
            clearable
            placeholder="All"
            options={(data ? data.projects : []).map(({ projectGuid, name }) => ({ value: projectGuid, text: name }))}
            value={filters.projectGuid}
            onChange={this.updateFilter('projectGuid')}
          />
          <Form.Dropdown
            label="Source"
            name="source"
            selection
            clearable
            placeholder="All"
            options={SOURCE_OPTIONS}
            value={filters.source}
            onChange={this.updateFilter('source')}
          />
          <Form.Input
            label="From"
            name="startDate"
            type="date"
            value={filters.startDate}
            onChange={this.updateFilter('startDate')}
          />
          <Form.Input
            label="To"
            name="endDate"
            type="date"
            value={filters.endDate}
            onChange={this.updateFilter('endDate')}
          />
        </Form.Group>
        <Form.Checkbox
          label="Assigned to me"
          name="assignedToMe"
          checked={filters.assignedToMe}
          onChange={this.updateFilter('assignedToMe')}
        />
      </Form>
    )
  }

  renderRow = (row: InboxResult) => {
    const { selected } = this.state
    const { matchmakerResultGuid: guid, submission, match, status, geneOverlap, hpoOverlap } = row
    const statusConfig = STATUS_LOOKUP[status]
    const rowActions = [...STATUS_ACTIONS, row.assignedToMe ? UNASSIGN_ACTION : ASSIGN_ACTION]
    return (
      <Table.Row key={guid} active={!!selected[guid]} verticalAlign="top">
        <Table.Cell collapsing>
          <Checkbox aria-label="Select match" checked={!!selected[guid]} onChange={this.toggleSelected(guid)} />
        </Table.Cell>
        <Table.Cell>
          <div><b>{submission.individualDisplayName}</b></div>
          <div>{`Family ${submission.familyDisplayName}`}</div>
          <div>{submission.projectName}</div>
          <a
            href={`/project/${submission.projectGuid}/family_page/${submission.familyGuid}/matchmaker_exchange`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View match and contact
          </a>
        </Table.Cell>
        <Table.Cell>
          <Features
            genes={submission.genes}
            phenotypes={submission.phenotypes}
            geneOverlap={geneOverlap}
            hpoOverlap={hpoOverlap}
          />
        </Table.Cell>
        <Table.Cell>
          <Contact match={match} />
          <div>{[match.label, match.patientId].filter(val => val).join(' / ')}</div>
          <div>
            {new Date(row.createdDate).toLocaleDateString()}
            {match.score !== null && ` - Score: ${match.score.toPrecision(3)}`}
          </div>
          {MANUAL_SOURCE_LABELS[row.source] && <Label size="mini" content={MANUAL_SOURCE_LABELS[row.source]} />}
          {row.matchRemoved && <Label size="mini" color="red" content="Removed" />}
        </Table.Cell>
        <Table.Cell>
          <Features genes={match.genes} phenotypes={match.phenotypes} geneOverlap={geneOverlap} hpoOverlap={hpoOverlap} />
        </Table.Cell>
        <Table.Cell>
          <Label
            className="result-status"
            color={statusConfig ? statusConfig.color : undefined}
            content={statusConfig ? statusConfig.text : status}
          />
          {row.weContacted && <Label size="mini" basic content="We contacted" />}
          {row.hostContacted && <Label size="mini" basic content="Host contacted" />}
          <div>{row.assignedTo ? `Assigned to ${row.assignedTo}` : <i>Unassigned</i>}</div>
          {row.comments && <div>{row.comments}</div>}
        </Table.Cell>
        <Table.Cell collapsing>
          <Button.Group vertical basic size="mini">
            {rowActions.map(({ content, update }) => (
              <Button
                key={content}
                content={content}
                disabled={'status' in update && update.status === status}
                onClick={() => this.updateResults([guid], update)}
              />
            ))}
          </Button.Group>
        </Table.Cell>
      </Table.Row>
    )
  }

  render() {
    const { filters, loading, error, updateError, data } = this.state
    const results = data ? data.results : []
    const selectedGuids = this.getSelectedGuids()
    const totalResults = data ? data.totalResults : 0
    const perPage = data ? data.perPage : 1
    const firstRow = data ? ((data.page - 1) * perPage) + 1 : 0
    return (
      <div>
        <Header size="medium" content="Matchmaker Inbox" subheader="Matches for all the projects you can access" />
        <Label.Group>
          {STATUSES.map(({ value, text, color }) => (
            <Label
              as="a"
              key={value}
              name={value}
              color={color}
              basic={!filters.status.includes(value)}
              onClick={() => this.setFilters({ status: [value] })}
            >
              {text}
              <Label.Detail>{data ? data.statusCounts[value] : '-'}</Label.Detail>
            </Label>
          ))}
        </Label.Group>
        {this.renderFilters()}
        {error && <Message error header="Unable to load matches" content={error} />}
        {updateError && <Message error header="Unable to update matches" content={updateError} />}
        <div className="bulk-actions">
          {`${selectedGuids.length} selected: `}
          {[...STATUS_ACTIONS, ASSIGN_ACTION, UNASSIGN_ACTION].map(({ content, update }) => (
            <Button
              key={content}
              size="mini"
              content={content}
              disabled={selectedGuids.length === 0}
              onClick={() => this.updateResults(selectedGuids, update)}
            />
          ))}
        </div>
        <Loader active={loading} inline="centered" />
        <Table celled>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell collapsing>
                <Checkbox
                  aria-label="Select all matches"
                  checked={results.length > 0 && selectedGuids.length === results.length}
                  indeterminate={selectedGuids.length > 0 && selectedGuids.length < results.length}
                  onChange={this.toggleAllSelected}
                />
              </Table.HeaderCell>
              <Table.HeaderCell content="Our Submission" />
              <Table.HeaderCell content="Our Genes and Phenotypes" />
              <Table.HeaderCell content="Match" />
              <Table.HeaderCell content="Match Genes and Phenotypes" />
              <Table.HeaderCell content="Status" />
              <Table.HeaderCell content="Actions" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {results.map(this.renderRow)}
            {results.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7}>{loading ? 'Loading...' : 'No matches found'}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
        {results.length > 0 && (
          <div>
            {`Showing ${firstRow}-${firstRow + results.length - 1} of ${totalResults} matches `}
            {totalResults > perPage && (
              <Pagination
                size="mini"
                activePage={data.page}
                totalPages={Math.ceil(totalResults / perPage)}
                onPageChange={this.changePage}
              />
            )}
          </div>
        )}
      </div>
    )
  }

}

export default MatchmakerInbox
