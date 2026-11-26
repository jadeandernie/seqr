import React from 'react'
import { Icon } from 'semantic-ui-react'

import { WORKBOOK_STATUS_LOOKUP } from './constants'
import { WorkbookStatus } from './types'

interface StatusIconProps {
  status: WorkbookStatus
  label: string
}

const StatusIcon = ({ status, label }: StatusIconProps) => {
  const { icon, color, text } = WORKBOOK_STATUS_LOOKUP[status]
  if (!icon) {
    return null
  }
  const title = `${label}: ${text}`
  return <Icon name={icon as 'circle'} color={color} role="img" aria-label={title} title={title} />
}

export default StatusIcon
