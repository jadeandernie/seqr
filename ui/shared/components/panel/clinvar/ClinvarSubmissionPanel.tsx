import React from 'react'
import { Button, Form, Header, Label, List, Loader, Message, Segment } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../utils/httpRequestHelper'
import {
  ClinvarMode, ClinvarResult, ClinvarSubmission, MODE_BANNERS, STATUS_LABELS, NOT_SAVED_LABEL, formatDate,
} from './constants'

type DraftResponse = {
  clinvarSubmission: ClinvarSubmission
  clinvarMode?: ClinvarMode
  options?: Record<string, string[]>
  observation?: { affectedCarriers: number, unaffectedCarriers: number, zygosity: Record<string, number> }
  message?: string
}

type Props = { variantGuid: string, mode: ClinvarMode }

type State = DraftResponse & { loading: boolean, error: string | null, edits: Record<string, string | string[] | null> }

const SELECT_FIELDS = [
  { name: 'conditionId', label: 'Condition', required: true },
  { name: 'modeOfInheritance', label: 'Mode of inheritance', required: false },
  { name: 'collectionMethod', label: 'Collection method', required: true },
  { name: 'affectedStatus', label: 'Affected status', required: true },
  { name: 'alleleOrigin', label: 'Allele origin', required: true },
]

const SUBMIT_STATUSES = ['approved', 'dry_run_passed']

const RESULT_LABELS: Record<string, string> = {
  dryRun: 'Dry run',
  submission: 'Submission',
  deletionDryRun: 'Deletion dry run',
  deletion: 'Deletion',
  status: 'ClinVar status',
}

const parseCitations = (value: string): string[] => value.split(/[\s,;]+/).filter(v => v)

const toOptions = (values: string[], required: boolean) => [
  ...(required ? [] : [{ value: '', text: '(none)' }]),
  ...values.map(value => ({ value, text: value })),
]

class ClinvarSubmissionPanel extends React.PureComponent<Props, State> {

  state: State = { loading: true, error: null, edits: {}, clinvarSubmission: null }

  componentDidMount() {
    const { variantGuid } = this.props
    new HttpRequestHelper(`/api/saved_variant/${variantGuid}/clinvar_submission`, this.onSuccess, this.onError).get()
  }

  onSuccess = (response: unknown) => {
    const { edits } = this.state
    const draftResponse = response as DraftResponse
    this.setState({
      ...draftResponse, loading: false, error: null, message: draftResponse.message, edits: draftResponse.options ? {} : edits,
    })
  }

  onError = (e: Error) => {
    this.setState({ loading: false, error: e.message })
  }

  onChange = (e: unknown, { name, value }: { name: string, value: string }) => {
    this.setState(prevState => ({
      edits: { ...prevState.edits, [name]: name === 'citations' ? parseCitations(value) : (value || null) },
    }))
  }

  post = (url: string, body: Record<string, unknown> = {}) => {
    this.setState({ loading: true })
    return new HttpRequestHelper(url, this.onSuccess, this.onError).post(body)
  }

  saveDraft = () => {
    const { variantGuid } = this.props
    const { edits } = this.state
    return this.post(`/api/saved_variant/${variantGuid}/clinvar_submission`, edits)
  }

  action = (e: unknown, { name }: { name: string }) => {
    const { clinvarSubmission } = this.state
    return this.post(`/api/clinvar_submission/${clinvarSubmission.submissionGuid}/${name}`)
  }

  renderReviewState = (submission: ClinvarSubmission) => (
    <Segment>
      <Label color={submission.status === 'error' ? 'red' : 'grey'} horizontal>
        {STATUS_LABELS[submission.status] || NOT_SAVED_LABEL}
      </Label>
      {submission.recordStatus === 'update' ? `Update of ${submission.scvAccession}` : 'New ClinVar record'}
      <List>
        {submission.createdBy && <List.Item content={`Drafted by ${submission.createdBy}`} />}
        {submission.lastEditedBy && submission.lastEditedBy !== submission.createdBy &&
          <List.Item content={`Last edited by ${submission.lastEditedBy}`} />}
        {submission.status === 'in_review' &&
          <List.Item content="Waiting for approval by a second person: the author cannot approve it" />}
        {submission.reviewedBy &&
          <List.Item content={`Approved by ${submission.reviewedBy} on ${formatDate(submission.reviewedDate)}`} />}
        {submission.submittedBy &&
          <List.Item content={`Submitted by ${submission.submittedBy} on ${formatDate(submission.submittedDate)}`} />}
        {submission.ncbiSubmissionId && <List.Item content={`ClinVar submission ${submission.ncbiSubmissionId}`} />}
        {submission.withdrawalRequestedBy && (
          <List.Item
            content={`Deletion requested by ${submission.withdrawalRequestedBy}: a different user must confirm it`}
          />
        )}
      </List>
    </Segment>
  )

  renderResults = (response: Record<string, ClinvarResult | unknown>) => Object.entries(RESULT_LABELS).filter(
    ([key]) => response[key],
  ).map(([key, label]) => {
    const result = response[key] as ClinvarResult
    return (
      <Message
        key={key}
        className={`clinvar-result-${key}`}
        positive={result.ok}
        negative={!result.ok}
        header={`${label} ${result.ok ? 'passed' : 'failed'}`}
        content={result.message}
        list={result.errors}
      />
    )
  })

  render() {
    const { mode: modeProp } = this.props
    const { loading, error, message, clinvarSubmission, clinvarMode, options, observation, edits } = this.state
    const banner = MODE_BANNERS[clinvarMode || modeProp]
    if (!clinvarSubmission) {
      return (
        <div>
          <Message className="clinvar-mode-banner" color={banner.color} header={banner.header} content={banner.content} />
          {loading ? <Loader active inline="centered" /> : <Message negative className="clinvar-error" content={error} />}
        </div>
      )
    }

    const values: Record<string, unknown> = { ...clinvarSubmission, ...edits }
    const { status, submissionGuid, validationErrors, payload, response } = clinvarSubmission
    const hasEdits = Object.keys(edits).length > 0
    const isReviewed = !!clinvarSubmission.reviewedBy
    const canSubmit = SUBMIT_STATUSES.includes(status) || (status === 'error' && isReviewed)
    return (
      <div>
        <Message className="clinvar-mode-banner" color={banner.color} header={banner.header} content={banner.content} />
        {this.renderReviewState(clinvarSubmission)}
        {error && <Message negative className="clinvar-error" content={error} />}
        {message && <Message info className="clinvar-message" content={message} />}
        <Form loading={loading}>
          <Form.Input
            label="Classification (from the seqr ACMG classification)"
            name="classification"
            value={clinvarSubmission.classification || 'Not classified'}
            readOnly
          />
          <Form.Group widths="equal">
            {SELECT_FIELDS.map(({ name, label, required }) => (
              <Form.Select
                key={name}
                name={name}
                label={label}
                required={required}
                options={toOptions(options[name], required)}
                value={(values[name] as string) || ''}
                onChange={this.onChange}
              />
            ))}
          </Form.Group>
          <Form.Input
            label="Citations (PubMed ids)"
            name="citations"
            value={(values.citations as string[]).join(', ')}
            onChange={this.onChange}
          />
          <p className="clinvar-observation">
            {`${observation.affectedCarriers} affected and ${observation.unaffectedCarriers} unaffected individual(s) in the family carry this variant`}
            {Object.entries(observation.zygosity).map(([zygosity, count]) => ` — ${count} ${zygosity}`).join('')}
            . No free-text comment is sent to ClinVar.
          </p>
        </Form>
        {validationErrors.length > 0 && (
          <Message negative className="clinvar-validation-errors" header="This record cannot be submitted" list={validationErrors} />
        )}
        <Header size="small" content="Exact record that will be sent" />
        <Segment className="clinvar-payload" secondary>
          {payload ? <pre>{JSON.stringify(payload, null, 2)}</pre> : 'No record can be built until the errors above are fixed'}
        </Segment>
        {response && this.renderResults(response)}
        <Button primary content={submissionGuid ? 'Save changes' : 'Save draft'} disabled={loading || (!!submissionGuid && !hasEdits)} onClick={this.saveDraft} />
        {status === 'draft' && (
          <Button content="Request review" name="request_review" disabled={loading || hasEdits || validationErrors.length > 0} onClick={this.action} />
        )}
        {status === 'in_review' && <Button positive content="Approve" name="approve" disabled={loading || hasEdits} onClick={this.action} />}
        {canSubmit && (
          <Button
            positive
            name="submit"
            content={(clinvarMode || modeProp) === 'dry_run' ? 'Run dry run (nothing is sent)' : 'Submit to ClinVar'}
            disabled={loading || hasEdits}
            onClick={this.action}
          />
        )}
        {submissionGuid && status !== 'withdrawn' && status !== 'submitted' && (
          <Button
            negative
            basic
            name="withdraw"
            content={clinvarSubmission.withdrawalRequestedBy ? 'Confirm deletion from ClinVar' : 'Withdraw'}
            disabled={loading}
            onClick={this.action}
          />
        )}
      </div>
    )
  }

}

export default ClinvarSubmissionPanel
