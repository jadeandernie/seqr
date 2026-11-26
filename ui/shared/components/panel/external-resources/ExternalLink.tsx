import React from 'react'
import { connect } from 'react-redux'

import { FlyoutContext, openExternalResourceFlyout } from '../../../../redux/utils/externalResourceFlyoutReducer'
import { ResourceLink } from '../../../utils/externalResources'

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

interface OwnProps extends AnchorProps {
  link: ResourceLink
  context?: FlyoutContext
}

interface DispatchProps {
  openFlyout: (context: FlyoutContext, activeKey: string) => void
}

const isPlainClick = (e: React.MouseEvent) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)

export const BaseExternalLink = React.memo((
  { link, context, openFlyout, onClick, children, ...anchorProps }: OwnProps & DispatchProps,
) => {
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) {
      onClick(e)
    }
    if (link.frameable && context && isPlainClick(e)) {
      e.preventDefault()
      openFlyout(context, link.key)
    }
  }, [link, context, openFlyout, onClick])

  return (
    <a target="_blank" rel="noreferrer" {...anchorProps} href={link.url} onClick={handleClick}>
      {children || link.label}
    </a>
  )
})

const mapDispatchToProps: DispatchProps = {
  openFlyout: openExternalResourceFlyout,
}

export default connect<unknown, DispatchProps, OwnProps>(null, mapDispatchToProps)(BaseExternalLink)
