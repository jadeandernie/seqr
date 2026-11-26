import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import { Checkbox, Icon, Label, List, Popup, SemanticICONS } from 'semantic-ui-react'

import { loadUserOptions } from '../../../redux/rootReducer'
import { getUser, getUserOptionsByUsername, getUserOptionsIsLoading } from '../../../redux/selectors'
import DataLoader from '../../../shared/components/DataLoader'
import DispatchRequestButton from '../../../shared/components/buttons/DispatchRequestButton'
import UpdateButton from '../../../shared/components/buttons/UpdateButton'
import { validators } from '../../../shared/components/form/FormHelpers'
import { CheckboxGroup, Select } from '../../../shared/components/form/Inputs'
import { IndividualCompleteness } from '../../../shared/utils/completeness'
import {
  DataRequest,
  DATA_REQUEST_REASON_OPTIONS,
  DATA_REQUEST_STATUS_CANCELLED,
  DATA_REQUEST_STATUS_DECLINED,
  DATA_REQUEST_STATUS_FULFILLED,
  getDefaultRequestedFields,
  getReasonText,
  getRemainingItems,
  getRequestAge,
  getRequestSummary,
  isAssignedToUser,
} from '../../../shared/utils/dataRequests'
import { updateDataRequest } from '../reducers'
import { getOpenDataRequestsByIndividualGuid, getProjectOpenDataRequests } from '../selectors'

type Individual = {
  individualGuid: string,
  familyGuid: string,
  projectGuid: string,
  displayName: string,
  completeness?: IndividualCompleteness | null,
}

type User = { username?: string }

type UserOption = { username: string, displayName?: string, email?: string }

type RequestValues = {
  projectGuid: string,
  dataRequestGuid?: string,
  individualGuid?: string,
  requestedFields?: string[],
  reason?: string,
  assignedTo?: string,
  status?: string,
}

type UpdateRequest = (values: RequestValues) => Promise<unknown>

type StatusAction = {
  status: string,
  permission: 'canCancel' | 'canResolve',
  content: string,
  icon: SemanticICONS,
  confirmDialog: string,
}

const STATUS_ACTIONS: StatusAction[] = [
  {
    status: DATA_REQUEST_STATUS_FULFILLED,
    permission: 'canResolve',
    content: 'Mark fulfilled',
    icon: 'check',
    confirmDialog: 'Mark this data request as fulfilled? The requester will be notified.',
  },
  {
    status: DATA_REQUEST_STATUS_DECLINED,
    permission: 'canResolve',
    content: 'Decline',
    icon: 'ban',
    confirmDialog: 'Decline this data request? The requester will be notified.',
  },
  {
    status: DATA_REQUEST_STATUS_CANCELLED,
    permission: 'canCancel',
    content: 'Cancel request',
    icon: 'trash',
    confirmDialog: 'Cancel this data request?',
  },
]

const mapDispatchToProps = { onSubmit: updateDataRequest }

type StatusButtonProps = { request: DataRequest, action: StatusAction, onSubmit: UpdateRequest }

const BaseStatusButton = ({ request, action, onSubmit }: StatusButtonProps) => {
  const { dataRequestGuid, projectGuid } = request
  const { status, content, icon, confirmDialog } = action
  const submit = React.useCallback(
    () => onSubmit({ projectGuid, dataRequestGuid, status }), [onSubmit, projectGuid, dataRequestGuid, status],
  )
  return (
    <DispatchRequestButton
      onSubmit={submit}
      buttonContent={content}
      icon={icon}
      size="small"
      confirmDialog={confirmDialog}
      hideNoRequestStatus
    />
  )
}

const StatusButton = connect(null, mapDispatchToProps)(BaseStatusButton)

// The server sets which actions are available to the user: the requester can cancel,
// project editors and the assignee can fulfil or decline
export const DataRequestActions = ({ request }: { request: DataRequest }) => (
  <span>
    {STATUS_ACTIONS.filter(({ permission }) => request[permission]).map(action => (
      <StatusButton key={action.status} request={request} action={action} />
    ))}
  </span>
)

const itemLabels = (items: { field: string, label: string }[]) => (
  <List bulleted>
    {items.map(({ field, label }) => <List.Item key={field}>{label}</List.Item>)}
  </List>
)

export const DataRequestDetail = ({ request }: { request: DataRequest }) => {
  const remaining = getRemainingItems(request)
  const recorded = request.items.filter(item => item.recorded)
  const reason = getReasonText(request.reason)
  return (
    <div>
      <div>{`Requested by ${request.createdBy || 'a former user'}, ${getRequestAge(request.createdDate)}`}</div>
      <div>{request.assignedTo ? `Assigned to ${request.assignedTo}` : 'Not assigned'}</div>
      {reason && <div>{`Reason: ${reason}`}</div>}
      {remaining.length > 0 && (
        <div>
          <b>Still needed:</b>
          {itemLabels(remaining)}
        </div>
      )}
      {recorded.length > 0 && (
        <div>
          <b>Recorded since the request:</b>
          {itemLabels(recorded)}
        </div>
      )}
    </div>
  )
}

const OpenDataRequest = ({ request }: { request: DataRequest }) => (
  <div>
    <Popup
      hoverable
      trigger={
        <span>
          <Label basic size="small" color="blue">
            <Icon name="mail outline" />
            {getRequestSummary(request)}
          </Label>
        </span>
      }
      content={<DataRequestDetail request={request} />}
    />
    <DataRequestActions request={request} />
  </div>
)

type AssigneeSelectProps = { load: (familyGuid: string) => void, familyGuid: string }

const BaseAssigneeSelect = ({ load, familyGuid, ...props }: AssigneeSelectProps) => (
  <DataLoader load={load} contentId={familyGuid} loading={false} content>
    <Select {...props} />
  </DataLoader>
)

const mapAssigneeStateToProps = (state: unknown) => ({
  loading: getUserOptionsIsLoading(state),
  options: (Object.values(getUserOptionsByUsername(state)) as UserOption[]).map(
    ({ username, displayName, email }) => ({ value: username, text: displayName || email }),
  ),
})

const mapAssigneeDispatchToProps = { load: loadUserOptions }

const AssigneeSelect = connect(mapAssigneeStateToProps, mapAssigneeDispatchToProps)(BaseAssigneeSelect)

const getRequestFormFields = ({ familyGuid, completeness }: Individual) => [
  {
    name: 'requestedFields',
    label: 'Clinical data to request',
    component: CheckboxGroup,
    options: completeness.missing.map(({ field, label }) => ({ value: field, text: label })),
    validate: validators.requiredList,
  },
  {
    name: 'reason',
    label: 'Reason (optional)',
    component: Select,
    options: DATA_REQUEST_REASON_OPTIONS,
    clearable: true,
  },
  {
    name: 'assignedTo',
    label: 'Assign to a project collaborator (optional)',
    component: AssigneeSelect,
    clearable: true,
    familyGuid,
  },
]

type RequestDataButtonProps = { individual: Individual, onSubmit: UpdateRequest }

const RequestDataButton = ({ individual, onSubmit }: RequestDataButtonProps) => {
  const { individualGuid, projectGuid, displayName, completeness } = individual
  const buttonProps = React.useMemo(() => ({
    modalId: `requestData-${individualGuid}`,
    modalTitle: `Request clinical data for ${displayName}`,
    buttonText: 'Request data',
    editIconName: 'mail outline',
    submitButtonText: 'Send request',
    formFields: getRequestFormFields(individual),
    initialValues: { projectGuid, individualGuid, requestedFields: getDefaultRequestedFields(completeness.missing) },
    showErrorPanel: true,
    onSubmit,
  }), [individual, individualGuid, projectGuid, displayName, completeness, onSubmit])
  return <UpdateButton {...buttonProps} />
}

type IndicatorProps = { individual: Individual, dataRequest?: DataRequest, onSubmit: UpdateRequest }

// Data can only be requested for affected individuals who are missing scored clinical data
const BaseDataRequestIndicator = ({ individual, dataRequest, onSubmit }: IndicatorProps) => {
  if (dataRequest) {
    return <OpenDataRequest request={dataRequest} />
  }
  return individual.completeness && individual.completeness.missing.length > 0 ?
    <RequestDataButton individual={individual} onSubmit={onSubmit} /> : null
}

const mapIndicatorStateToProps = (state: unknown, ownProps: { individual: Individual }) => ({
  dataRequest: getOpenDataRequestsByIndividualGuid(state)[ownProps.individual.individualGuid],
})

export const DataRequestIndicator = connect(mapIndicatorStateToProps, mapDispatchToProps)(BaseDataRequestIndicator)

type PanelProps = { dataRequests: DataRequest[], user: User }

const BaseDataRequestsPanel = ({ dataRequests, user }: PanelProps) => {
  const [assignedToMe, setAssignedToMe] = React.useState(false)
  const toggleAssignedToMe = React.useCallback((e, { checked }) => setAssignedToMe(checked), [])
  if (!dataRequests.length) {
    return <i>No open data requests</i>
  }

  const shownRequests = assignedToMe ? dataRequests.filter(request => isAssignedToUser(request, user)) : dataRequests
  return (
    <div>
      <Checkbox label="Assigned to me" checked={assignedToMe} onChange={toggleAssignedToMe} />
      {shownRequests.length > 0 ? (
        <List divided relaxed>
          {shownRequests.map(request => (
            <List.Item key={request.dataRequestGuid}>
              <List.Header>
                <Link to={`/project/${request.projectGuid}/family_page/${request.familyGuid}`}>
                  {request.individualName}
                </Link>
              </List.Header>
              <List.Description>
                <div>{getRemainingItems(request).map(({ label }) => label).join(', ')}</div>
                <div>{`Requested by ${request.createdBy || 'a former user'}, ${getRequestAge(request.createdDate)}`}</div>
                <div>{request.assignedTo ? `Assigned to ${request.assignedTo}` : 'Not assigned'}</div>
                <DataRequestActions request={request} />
              </List.Description>
            </List.Item>
          ))}
        </List>
      ) : <div><i>No open data requests are assigned to you</i></div>}
    </div>
  )
}

const mapPanelStateToProps = (state: unknown) => ({
  dataRequests: getProjectOpenDataRequests(state),
  user: getUser(state),
})

export const DataRequestsPanel = connect(mapPanelStateToProps)(BaseDataRequestsPanel)
