import { CompletenessItem } from './completeness'

export type DataRequestItem = { field: string, label: string, recorded: boolean }

export type DataRequest = {
  dataRequestGuid: string,
  individualGuid: string,
  familyGuid: string,
  projectGuid: string,
  individualName: string,
  items: DataRequestItem[],
  reason?: string | null,
  status: string,
  createdDate: string,
  createdBy?: string | null,
  assignedTo?: string | null,
  assignedToUsername?: string | null,
  resolvedBy?: string | null,
  resolvedDate?: string | null,
  canCancel: boolean,
  canResolve: boolean,
}

export type DataRequestsByGuid = { [guid: string]: DataRequest }

export const DATA_REQUEST_STATUS_OPEN = 'O'
export const DATA_REQUEST_STATUS_FULFILLED = 'F'
export const DATA_REQUEST_STATUS_DECLINED = 'D'
export const DATA_REQUEST_STATUS_CANCELLED = 'C'

// Requests never carry free text: the reason is one of the values accepted by the server
export const DATA_REQUEST_REASON_OPTIONS = [
  { value: 'A', text: 'Needed for analysis' },
  { value: 'I', text: 'To confirm inheritance' },
  { value: 'M', text: 'For matchmaking' },
  { value: 'O', text: 'Other' },
]

const REASON_LOOKUP: { [value: string]: string } = DATA_REQUEST_REASON_OPTIONS.reduce(
  (acc, { value, text }) => ({ ...acc, [value]: text }), {},
)

export const getReasonText = (reason?: string | null): string | null => (reason && REASON_LOOKUP[reason]) || null

// Items carrying at least this weight in the completeness score are ticked when the request dialog opens
const PRESELECTED_MIN_WEIGHT = 8

export const getDefaultRequestedFields = (missing: CompletenessItem[]): string[] => {
  const highValueItems = missing.filter(({ weight }) => weight >= PRESELECTED_MIN_WEIGHT)
  return (highValueItems.length ? highValueItems : missing).map(({ field }) => field)
}

export const getOpenDataRequests = (
  dataRequestsByGuid: DataRequestsByGuid = {}, projectGuid?: string,
): DataRequest[] => (
  Object.values(dataRequestsByGuid).filter(request => (
    request.status === DATA_REQUEST_STATUS_OPEN && (!projectGuid || request.projectGuid === projectGuid)
  ))
)

export const getOpenDataRequestsByIndividual = (dataRequestsByGuid?: DataRequestsByGuid): DataRequestsByGuid => (
  getOpenDataRequests(dataRequestsByGuid).reduce((acc, request) => ({ ...acc, [request.individualGuid]: request }), {})
)

export const getRemainingItems = (request: DataRequest): DataRequestItem[] => (
  request.items.filter(({ recorded }) => !recorded)
)

const DAY_MS = 24 * 60 * 60 * 1000

export const getRequestAge = (createdDate: string, now: Date = new Date()): string => {
  const days = Math.max(Math.floor((now.getTime() - new Date(createdDate).getTime()) / DAY_MS), 0)
  if (days === 0) {
    return 'today'
  }
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const pluralizeItems = (count: number) => `${count} item${count === 1 ? '' : 's'}`

export const getRequestSummary = (request: DataRequest, now?: Date): string => {
  const numRemaining = getRemainingItems(request).length
  const numItems = request.items.length
  const itemSummary = numRemaining === numItems ?
    pluralizeItems(numItems) : `${numRemaining} of ${pluralizeItems(numItems)} remaining`
  return `Data requested: ${itemSummary}, ${getRequestAge(request.createdDate, now)}`
}

export const isAssignedToUser = (request: DataRequest, user: { username?: string }): boolean => (
  !!request.assignedToUsername && request.assignedToUsername === user.username
)

export const HAS_OPEN_DATA_REQUEST_FILTER = {
  value: 'SHOW_OPEN_DATA_REQUEST',
  name: 'Has Open Data Request',
  category: 'Clinical Data Requests',
  createFilter: (family: { hasOpenDataRequest?: boolean }): boolean => !!family.hasOpenDataRequest,
}
