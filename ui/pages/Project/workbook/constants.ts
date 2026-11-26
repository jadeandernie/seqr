import { WorkbookStatus } from './types'

export const STATUS_NOT_REVIEWED: WorkbookStatus = 'N'
export const STATUS_IN_PROGRESS: WorkbookStatus = 'I'
export const STATUS_FINDINGS: WorkbookStatus = 'F'
export const STATUS_NOTHING_FOUND: WorkbookStatus = 'U'

export interface StatusConfig {
  value: WorkbookStatus
  text: string
  icon?: string
  color?: 'orange' | 'red' | 'green'
}

export const WORKBOOK_STATUSES: StatusConfig[] = [
  { value: STATUS_NOT_REVIEWED, text: 'Not reviewed' },
  { value: STATUS_IN_PROGRESS, text: 'In progress', icon: 'circle', color: 'orange' },
  { value: STATUS_NOTHING_FOUND, text: 'Nothing found', icon: 'times circle outline', color: 'red' },
  { value: STATUS_FINDINGS, text: 'Findings', icon: 'check circle', color: 'green' },
]

export const WORKBOOK_STATUS_LOOKUP = WORKBOOK_STATUSES.reduce(
  (acc, status) => ({ ...acc, [status.value]: status }), {} as Record<WorkbookStatus, StatusConfig>,
)

export const MAX_VISIBLE_TARGET_TABS = 6

export const WORK_PANE_ID = 'workbook-work-pane'
