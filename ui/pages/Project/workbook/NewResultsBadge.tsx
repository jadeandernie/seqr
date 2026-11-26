import React from 'react'
import { Icon, Label } from 'semantic-ui-react'

interface NewResultsBadgeProps {
  count: number
  context: string
}

const NewResultsBadge = ({ count, context }: NewResultsBadgeProps) => {
  if (!count) {
    return null
  }
  const title = `${count} new ${count === 1 ? 'result' : 'results'} since the last review ${context}`
  return (
    <Label size="mini" color="blue" horizontal role="img" aria-label={title} title={title}>
      <Icon name="bell" aria-hidden="true" />
      {`${count} new`}
    </Label>
  )
}

export default NewResultsBadge
