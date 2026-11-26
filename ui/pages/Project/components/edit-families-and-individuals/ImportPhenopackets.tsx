import React from 'react'
import Cookies from 'js-cookie'
import { connect } from 'react-redux'
import { Button, Checkbox, CheckboxProps, Header, Icon, Label, List, Message, Segment, Table } from 'semantic-ui-react'

import { RECEIVE_DATA } from '../../../../redux/utils/reducerUtils'
import { HttpRequestHelper } from '../../../../shared/utils/httpRequestHelper'

export type ImportMode = 'merge' | 'replace'

export interface PhenopacketChange {
  field: string
  label: string
  isList: boolean
  current: string | string[] | null
  proposed: string | string[]
  added?: string[]
  removed?: string[]
  conflicts?: string[]
  canMerge: boolean
  canReplace: boolean
  conflict: boolean
}

export interface PhenopacketIndividual {
  individualGuid: string
  individualId: string
  familyId: string
  unknownHpoTerms: string[]
  warnings: string[]
  changes: PhenopacketChange[]
}

export interface PhenopacketPreview {
  uploadedFileId: string
  info: string[]
  individuals: PhenopacketIndividual[]
  unmatchedSubjects: string[]
  unchangedIndividuals: string[]
  warnings: string[]
  ignoredFields: string[]
}

export type PhenopacketSelections = Record<string, Record<string, ImportMode>>

type Dispatch = (action: unknown) => unknown

interface RequestError {
  message?: string
  body?: { errors?: string[] }
}

const ACCEPTED_FILES = '.json,.jsonl,.ndjson,application/json'
const HIDDEN_STYLE = { display: 'none' }
const SELECTION_SEPARATOR = '|'
const MERGE: ImportMode = 'merge'
const REPLACE: ImportMode = 'replace'

export const getDefaultSelections = (preview: PhenopacketPreview): PhenopacketSelections => (
  preview.individuals.reduce((acc, { individualGuid, changes }) => ({
    ...acc,
    [individualGuid]: changes.filter(({ canMerge }) => canMerge).reduce(
      (fields, { field }) => ({ ...fields, [field]: MERGE }), {},
    ),
  }), {})
)

const getSelectedIndividuals = (selections: PhenopacketSelections): PhenopacketSelections => (
  Object.entries(selections).reduce(
    (acc, [guid, fields]) => (Object.keys(fields).length ? { ...acc, [guid]: fields } : acc), {},
  )
)

const countSelections = (selections: PhenopacketSelections): number => (
  Object.values(selections).reduce((total, fields) => total + Object.keys(fields).length, 0)
)

// Files are sent as multipart form data, never as a JSON body, and under generic names:
// request bodies are logged by the server and file names often identify a patient
export const uploadPhenopackets = (projectGuid: string, files: File[]): Promise<PhenopacketPreview> => {
  const formData = new FormData()
  files.forEach((file, i) => formData.append(`file_${i}`, file, `phenopacket_${i + 1}.json`))
  return fetch(`/api/project/${projectGuid}/upload_phenopackets`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
    headers: { 'X-CSRFToken': Cookies.get('csrf_token') },
  }).then(response => response.json().catch(() => ({})).then((responseJson) => {
    if (!response.ok) {
      const error: RequestError = {
        body: {
          errors: responseJson.errors?.length ? responseJson.errors :
            [responseJson.error || `Upload failed (${response.status})`],
        },
      }
      throw error
    }
    return responseJson
  }))
}

export const applyPhenopackets = (uploadedFileId: string, individuals: PhenopacketSelections) => (
  (dispatch: Dispatch, getState: () => { currentProjectGuid: string }) => new HttpRequestHelper(
    `/api/project/${getState().currentProjectGuid}/save_phenopackets/${uploadedFileId}`,
    (responseJson) => {
      dispatch({ type: RECEIVE_DATA, updatesById: responseJson })
    },
  ).post({ individuals })
)

const joinItems = (items: string | string[] | null | undefined): string => (
  Array.isArray(items) ? items.join('; ') : (items || 'not set')
)

const ChangeDescription = React.memo(({ change }: { change: PhenopacketChange }) => {
  if (!change.isList) {
    return (
      <span>
        {`${joinItems(change.current)} → ${joinItems(change.proposed)}`}
        {change.conflict && <Label color="red" basic size="tiny" content="Conflict: existing value is kept unless replaced" />}
      </span>
    )
  }
  return (
    <div>
      <div>{change.added?.length ? `Add: ${joinItems(change.added)}` : 'Nothing new to add'}</div>
      {change.canReplace && (
        <div>
          <i>{`Replace would set: ${joinItems(change.proposed)}`}</i>
          {change.removed?.length ? <i>{` (removing ${joinItems(change.removed)})`}</i> : null}
        </div>
      )}
      {change.conflicts?.length ? (
        <Label
          color="red"
          basic
          size="tiny"
          content={`Conflict: recorded the opposite way in seqr and kept unless replaced: ${joinItems(change.conflicts)}`}
        />
      ) : null}
    </div>
  )
})

interface IndividualReviewProps {
  individual: PhenopacketIndividual
  selections: Record<string, ImportMode>
  onChange: (e: React.FormEvent<HTMLInputElement>, data: CheckboxProps) => void
}

const IndividualReview = React.memo(({ individual, selections, onChange }: IndividualReviewProps) => (
  <Segment className="phenopacket-individual">
    <Header size="small" content={`${individual.individualId} (family ${individual.familyId})`} />
    {individual.unknownHpoTerms.length > 0 && (
      <Message
        warning
        size="small"
        content={`HPO terms not in seqr's HPO data, which will not be added: ${individual.unknownHpoTerms.join(', ')}`}
      />
    )}
    {individual.warnings.length > 0 && <Message warning size="small" list={individual.warnings} />}
    {individual.changes.length > 0 ? (
      <Table compact="very" basic="very">
        <Table.Body>
          {individual.changes.map((change) => {
            const name = [individual.individualGuid, change.field].join(SELECTION_SEPARATOR)
            const mode = selections[change.field]
            return (
              <Table.Row key={change.field} negative={change.conflict}>
                <Table.Cell collapsing>
                  {change.canMerge && (
                    <Checkbox name={name} value={MERGE} checked={!!mode} onChange={onChange} label={change.label} />
                  )}
                  {!change.canMerge && <b>{change.label}</b>}
                </Table.Cell>
                <Table.Cell><ChangeDescription change={change} /></Table.Cell>
                <Table.Cell collapsing>
                  {change.canReplace && (
                    <Checkbox
                      name={name}
                      value={REPLACE}
                      checked={mode === REPLACE}
                      onChange={onChange}
                      label="Replace existing"
                    />
                  )}
                </Table.Cell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table>
    ) : <i>No changes to apply</i>}
  </Segment>
))

interface ImportPhenopacketsProps {
  projectGuid: string
  onApply: (uploadedFileId: string, individuals: PhenopacketSelections) => Promise<unknown>
}

interface ImportPhenopacketsState {
  loading: boolean
  fileNames: string[]
  errors: string[] | null
  preview: PhenopacketPreview | null
  selections: PhenopacketSelections
  appliedCount: number | null
}

const INITIAL_STATE: ImportPhenopacketsState = {
  loading: false, fileNames: [], errors: null, preview: null, selections: {}, appliedCount: null,
}

const getErrors = (error: RequestError): string[] => (
  error.body?.errors?.length ? error.body.errors : [error.message || 'Request failed']
)

export class BaseImportPhenopackets extends React.PureComponent<ImportPhenopacketsProps, ImportPhenopacketsState> {

  fileInput = React.createRef<HTMLInputElement>()

  constructor(props: ImportPhenopacketsProps) {
    super(props)
    this.state = INITIAL_STATE
  }

  upload = (fileList: FileList | File[] | null) => {
    const { projectGuid } = this.props
    const files = Array.from(fileList || [])
    if (!files.length) {
      return Promise.resolve()
    }
    this.setState({ ...INITIAL_STATE, loading: true, fileNames: files.map(({ name }) => name) })
    return uploadPhenopackets(projectGuid, files).then((preview) => {
      this.setState({ loading: false, preview, selections: getDefaultSelections(preview) })
    }, (error: RequestError) => {
      this.setState({ loading: false, errors: getErrors(error) })
    })
  }

  onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target
    this.upload(files)
    e.target.value = ''
  }

  onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    this.upload(e.dataTransfer.files)
  }

  onDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
  }

  openFileBrowser = () => {
    this.fileInput.current.click()
  }

  onSelectionChange = (e: React.FormEvent<HTMLInputElement>, { name, value, checked }: CheckboxProps) => {
    const [individualGuid, field] = (name as string).split(SELECTION_SEPARATOR)
    this.setState(({ preview, selections }) => {
      const { [field]: previousMode, ...otherFields } = selections[individualGuid]
      const change = preview?.individuals.find(
        individual => individual.individualGuid === individualGuid,
      )?.changes.find(individualChange => individualChange.field === field)
      let mode: ImportMode | null = null
      if (checked) {
        mode = value as ImportMode
      } else if (value === REPLACE && previousMode === REPLACE && change?.canMerge) {
        mode = MERGE
      }
      return {
        appliedCount: null,
        selections: { ...selections, [individualGuid]: mode ? { ...otherFields, [field]: mode } : otherFields },
      }
    })
  }

  apply = () => {
    const { onApply } = this.props
    const { preview, selections } = this.state
    const selected = getSelectedIndividuals(selections)
    this.setState({ loading: true, errors: null })
    return onApply((preview as PhenopacketPreview).uploadedFileId, selected).then(() => {
      this.setState({ ...INITIAL_STATE, appliedCount: Object.keys(selected).length })
    }, (error: RequestError) => {
      this.setState({ loading: false, errors: getErrors(error) })
    })
  }

  render() {
    const { loading, fileNames, errors, preview, selections, appliedCount } = this.state
    const numSelected = countSelections(selections)
    return (
      <div>
        <Message info>
          <Message.Header>Import clinical data from GA4GH Phenopackets (v2) JSON files</Message.Header>
          <p>
            Phenopacket, Family and Cohort messages are supported. REDCap, PhenoTips, FHIR and other sources must first
            be exported or converted to Phenopackets. Each subject id must match the Individual ID of an individual
            already in this project: no individuals are created. HPO terms, sex, birth year, OMIM and MONDO diagnoses,
            age of onset, candidate genes and pedigree details are read. Names, alternate ids, full dates, free-text
            descriptions, files and authorship are ignored and are not stored.
          </p>
        </Message>
        <Segment placeholder loading={loading} onDrop={this.onDrop} onDragOver={this.onDragOver} className="phenopacket-drop">
          <Header icon>
            <Icon name="file alternate outline" />
            Drop one or more Phenopacket .json files here
          </Header>
          <Button primary content="Choose files" onClick={this.openFileBrowser} />
          <input
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            style={HIDDEN_STYLE}
            ref={this.fileInput}
            onChange={this.onFilesSelected}
          />
        </Segment>
        {fileNames.length > 0 && <List ordered size="small" items={fileNames} className="phenopacket-files" />}
        {errors && <Message error header="Unable to import" list={errors} />}
        {appliedCount !== null && (
          <Message success content={`Clinical data applied to ${appliedCount} individual(s)`} />
        )}
        {preview && (
          <div>
            <Message info size="small" list={preview.info} />
            {preview.ignoredFields.length > 0 && (
              <Message
                size="small"
                header="Fields present in the files that are ignored and not stored"
                content={preview.ignoredFields.join(', ')}
              />
            )}
            {preview.warnings.length > 0 && <Message warning size="small" list={preview.warnings} />}
            {preview.unmatchedSubjects.length > 0 && (
              <Message
                warning
                size="small"
                header="Subjects with no matching Individual ID in this project, which will not be imported"
                content={preview.unmatchedSubjects.join(', ')}
              />
            )}
            {preview.unchangedIndividuals.length > 0 && (
              <Message
                size="small"
                header="Individuals with nothing new to import"
                content={preview.unchangedIndividuals.join(', ')}
              />
            )}
            {preview.individuals.map(individual => (
              <IndividualReview
                key={individual.individualGuid}
                individual={individual}
                selections={selections[individual.individualGuid]}
                onChange={this.onSelectionChange}
              />
            ))}
            <Button
              primary
              disabled={loading || numSelected === 0}
              content={`Apply ${numSelected} selected change(s)`}
              onClick={this.apply}
            />
          </div>
        )}
      </div>
    )
  }

}

const mapStateToProps = (state: { currentProjectGuid: string }) => ({
  projectGuid: state.currentProjectGuid,
})

const mapDispatchToProps = {
  onApply: applyPhenopackets,
}

export default connect(mapStateToProps, mapDispatchToProps)(BaseImportPhenopackets)
