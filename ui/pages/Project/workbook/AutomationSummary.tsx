import React from 'react'
import styled from 'styled-components'

import { getRerunIntervalLabel } from './constants'
import { Workbook } from './types'
import { WorkbookAutomationButton } from './WorkbookButtons'

const Summary = styled.div`
  color: gray;
  margin-bottom: 0.5em;
`

export const getAutomationSummary = ({ rerunIntervalDays, notifyOnNewResults }: Workbook): string => {
  if (!rerunIntervalDays) {
    return 'Automatic reruns: off'
  }
  const notification = notifyOnNewResults ? ', the creator of the workbook is notified of new results' : ''
  return `Automatic reruns: ${getRerunIntervalLabel(rerunIntervalDays).toLowerCase()}${notification}`
}

const AutomationSummary = React.memo(({ workbook }: { workbook: Workbook }) => (
  <Summary aria-label="Automatic reruns">
    {getAutomationSummary(workbook)}
    &nbsp;
    {workbook.canEdit && <WorkbookAutomationButton workbook={workbook} />}
  </Summary>
))

export default AutomationSummary
