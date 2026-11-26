import { Option, RunTrigger, WorkbookStatus } from './types'

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

// The form value for no interval: automatic reruns are off for a workbook, a worksheet uses the workbook interval
export const NO_RERUN_INTERVAL = 0

const RERUN_INTERVALS: Option<number>[] = [
  { value: 1, text: 'Daily' },
  { value: 7, text: 'Weekly' },
  { value: 14, text: 'Every 2 weeks' },
  { value: 30, text: 'Monthly' },
]

export const WORKBOOK_RERUN_INTERVAL_OPTIONS: Option<number>[] = [
  { value: NO_RERUN_INTERVAL, text: 'Off' }, ...RERUN_INTERVALS,
]

export const WORKSHEET_RERUN_INTERVAL_OPTIONS: Option<number>[] = [
  { value: NO_RERUN_INTERVAL, text: 'Same as workbook' }, ...RERUN_INTERVALS,
]

export const getRerunIntervalLabel = (days: number): string => (
  RERUN_INTERVALS.find(({ value }) => value === days)?.text || `Every ${days} days`
)

export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  M: 'Manual',
  S: 'Scheduled',
  D: 'After data load',
}

export const isAutomatedTrigger = (trigger: RunTrigger): boolean => trigger !== 'M'
