import React, { useCallback, useMemo, useState } from 'react'
import { connect } from 'react-redux'
import { Header } from 'semantic-ui-react'
import styled from 'styled-components'

import DataLoader from '../../../shared/components/DataLoader'
import { Multiselect } from '../../../shared/components/form/Inputs'
import { ButtonLink } from '../../../shared/components/StyledComponents'
import { loadProjectAnalysisGroupCollaborators } from '../reducers'
import { updateWorkbookEditors } from './reducers'
import { getCollaboratorsIsLoading, getEditorName, getEditorOptions, getWorkbookPath } from './selectors'
import { FormField, UpdateButton } from './sharedComponents'
import { Option, Workbook, WorkbookReduxState } from './types'
import { formatList, IconTrigger } from './WorkbookButtons'

const Summary = styled.div`
  color: gray;
  margin-bottom: 0.5em;
`

const LinkInput = styled.input`
  width: 70%;
  margin-right: 1em;
`

const NO_FIELDS: FormField[] = []

export const getWorkbookUrl = (workbook: Workbook): string => `${window.location.origin}${getWorkbookPath(workbook)}`

const getEditorNames = ({ editors = [] }: Workbook) => editors.map(getEditorName).join(', ')

const CopyLink = React.memo(({ url }: { url: string }) => {
  const [status, setStatus] = useState('')
  const copy = useCallback(() => {
    const request = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()
    return request.then(
      () => setStatus('Link copied'), () => setStatus('The link could not be copied, copy it from the box'),
    )
  }, [url])
  return (
    <div>
      <LinkInput readOnly aria-label="Workbook link" value={url} />
      <ButtonLink content="Copy link" icon="linkify" labelPosition="right" onClick={copy} />
      <span role="status">{status}</span>
    </div>
  )
})

interface WorkbookProps {
  workbook: Workbook
}

interface ShareContentProps extends WorkbookProps {
  loading: boolean
  load: () => void
  children?: React.ReactNode
}

const BaseShareContent = React.memo(({ workbook, loading, load, children }: ShareContentProps) => (
  <div>
    <p>
      Everyone with access to this project can open this workbook with its link. Sharing the link or adding an editor
      never gives access to the project or its families.
    </p>
    <CopyLink url={getWorkbookUrl(workbook)} />
    <Header size="small" content="Editors" />
    <p>
      {`The creator of this workbook (${workbook.createdBy || 'unknown user'}) and the managers of this project can
      always change its families, worksheets and queries. Editors are other project members who may do the same.`}
    </p>
    {workbook.canManageEditors ? (
      <DataLoader load={load} loading={loading} content>{children}</DataLoader>
    ) : <p aria-label="Editors">{getEditorNames(workbook) || 'This workbook has no editors'}</p>}
  </div>
))

const ShareContent = connect(
  (state: WorkbookReduxState) => ({ loading: getCollaboratorsIsLoading(state) }),
  { load: loadProjectAnalysisGroupCollaborators as () => void },
)(BaseShareContent)

interface ShareButtonProps extends WorkbookProps {
  editorOptions: Option[]
  onSubmit: (values: object) => Promise<void>
}

const BaseShareWorkbookButton = React.memo(({ workbook, editorOptions, onSubmit }: ShareButtonProps) => (
  <UpdateButton
    modalId={`shareWorkbook-${workbook.workbookGuid}`}
    modalTitle={`Share ${workbook.name}`}
    trigger={<IconTrigger icon="share alternate" label={`Share workbook ${workbook.name}`} />}
    formFields={useMemo(() => (workbook.canManageEditors ? [{
      name: 'usernames',
      label: 'Editors (project members, they are notified when they are added)',
      component: Multiselect,
      options: editorOptions,
      color: 'blue',
      format: formatList,
    }] : NO_FIELDS), [workbook, editorOptions])}
    initialValues={useMemo(() => ({ usernames: (workbook.editors || []).map(({ username }) => username) }), [workbook])}
    formContainer={<ShareContent workbook={workbook} />}
    onSubmit={onSubmit}
    showErrorPanel
  />
))

const ShareWorkbookButton = connect(
  (state: WorkbookReduxState, { workbook }: WorkbookProps) => ({ editorOptions: getEditorOptions(state, workbook) }),
  (dispatch, { workbook }: WorkbookProps) => ({
    onSubmit: (values: object) => dispatch(updateWorkbookEditors(workbook.workbookGuid, values)),
  }),
)(BaseShareWorkbookButton)

const WorkbookSharing = React.memo(({ workbook }: WorkbookProps) => (
  <Summary aria-label="Sharing">
    {`Editors: ${getEditorNames(workbook) || 'none'}`}
    &nbsp;
    <ShareWorkbookButton workbook={workbook} />
  </Summary>
))

export default WorkbookSharing
