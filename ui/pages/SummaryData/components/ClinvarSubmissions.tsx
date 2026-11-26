import React from 'react'
import { Link } from 'react-router-dom'
import { Menu, Message } from 'semantic-ui-react'

import DataTable from '../../../shared/components/table/DataTable'
import {
  ClinvarMode, ClinvarSubmission, MODE_BANNERS, STATUS_LABELS, formatDate,
} from '../../../shared/components/panel/clinvar/constants'
import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'

type State = {
  loading: boolean
  error: string | null
  status: string | null
  clinvarMode: ClinvarMode | null
  clinvarSubmissions: ClinvarSubmission[]
}

const CLINVAR_URL = 'https://www.ncbi.nlm.nih.gov/clinvar/?term='

const COLUMNS = [
  { name: 'status', content: 'Status', format: (row: ClinvarSubmission) => STATUS_LABELS[row.status] },
  {
    name: 'variantId',
    content: 'Variant',
    format: (row: ClinvarSubmission) => (row.variantGuid ? (
      <Link to={`/project/${row.projectGuid}/saved_variants/variant/${row.variantGuid}`}>{row.variantId}</Link>
    ) : 'Saved variant deleted'),
  },
  { name: 'classification', content: 'Classification' },
  { name: 'conditionId', content: 'Condition' },
  {
    name: 'scvAccession',
    content: 'ClinVar Accession',
    format: (row: ClinvarSubmission) => row.scvAccession && (
      <a href={`${CLINVAR_URL}${row.scvAccession}`} target="_blank" rel="noreferrer">{row.scvAccession}</a>
    ),
  },
  { name: 'createdBy', content: 'Drafted By' },
  { name: 'reviewedBy', content: 'Approved By' },
  { name: 'submittedBy', content: 'Submitted By' },
  { name: 'lastModifiedDate', content: 'Last Updated', format: (row: ClinvarSubmission) => formatDate(row.lastModifiedDate) },
]

class ClinvarSubmissions extends React.PureComponent<Record<string, never>, State> {

  state: State = { loading: true, error: null, status: null, clinvarMode: null, clinvarSubmissions: [] }

  componentDidMount() {
    new HttpRequestHelper(
      '/api/summary_data/clinvar_submissions',
      (response: unknown) => this.setState(prevState => ({ ...prevState, ...(response as Partial<State>), loading: false })),
      (e: Error) => this.setState({ loading: false, error: e.message }),
    ).get()
  }

  selectStatus = (e: unknown, { name }: { name?: string }) => {
    this.setState({ status: name || null })
  }

  render() {
    const { loading, error, status, clinvarMode, clinvarSubmissions } = this.state
    const banner = MODE_BANNERS[clinvarMode]
    const counts = clinvarSubmissions.reduce(
      (acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {} as Record<string, number>,
    )
    return (
      <div>
        {banner && <Message className="clinvar-mode-banner" color={banner.color} header={banner.header} content={banner.content} />}
        {error && <Message negative className="clinvar-error" content={error} />}
        <Menu compact size="small">
          <Menu.Item active={!status} onClick={this.selectStatus} content={`All (${clinvarSubmissions.length})`} />
          {Object.entries(STATUS_LABELS).filter(([key]) => counts[key]).map(([key, label]) => (
            <Menu.Item key={key} name={key} active={status === key} onClick={this.selectStatus} content={`${label} (${counts[key]})`} />
          ))}
        </Menu>
        <DataTable
          striped
          idField="submissionGuid"
          defaultSortColumn="lastModifiedDate"
          defaultSortDescending
          loading={loading}
          emptyContent="No ClinVar submissions"
          data={status ? clinvarSubmissions.filter(row => row.status === status) : clinvarSubmissions}
          columns={COLUMNS}
        />
      </div>
    )
  }

}

export default ClinvarSubmissions
