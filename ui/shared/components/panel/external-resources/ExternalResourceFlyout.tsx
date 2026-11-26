import React from 'react'
import ReactDOM from 'react-dom'
import { connect } from 'react-redux'
import { Button, Icon, Menu } from 'semantic-ui-react'

import {
  FlyoutState, SUMMARY_TAB, getExternalResourceFlyout, setExternalResourceFlyoutTab, closeExternalResourceFlyout,
} from '../../../../redux/utils/externalResourceFlyoutReducer'
import GeneDetail from '../genes/GeneDetail'

export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

const DEFAULT_WIDTH = '45vw'
const EXPANDED_WIDTH = '90vw'

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: DEFAULT_WIDTH,
  minWidth: '360px',
  maxWidth: '100vw',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  background: 'white',
  borderLeft: '1px solid #d4d4d5',
  boxShadow: '-4px 0 12px rgba(34, 36, 38, 0.2)',
  outline: 'none',
}
const EXPANDED_PANEL_STYLE: React.CSSProperties = { ...PANEL_STYLE, width: EXPANDED_WIDTH }
const HEADER_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '10px 15px 0 15px' }
const TITLE_STYLE: React.CSSProperties = { flex: 1, margin: 0, fontSize: '1.3em' }
const TABS_STYLE: React.CSSProperties = { margin: '5px 15px 0 15px', flexWrap: 'wrap', flexShrink: 0 }
const CONTENT_STYLE: React.CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
const SUMMARY_STYLE: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '15px', position: 'relative' }
const HINT_STYLE: React.CSSProperties = { padding: '5px 15px', color: 'grey', fontSize: '0.9em' }
const IFRAME_STYLE: React.CSSProperties = { flex: 1, width: '100%', border: 'none' }
const FOOTER_STYLE: React.CSSProperties = { padding: '8px 15px', borderTop: '1px solid #d4d4d5', lineHeight: '1.8em' }
const FOOTER_LINK_STYLE: React.CSSProperties = { marginLeft: '12px', whiteSpace: 'nowrap' }

interface StateProps {
  flyout: FlyoutState | null
}

interface DispatchProps {
  setTab: (activeKey: string) => void
  close: () => void
}

interface PanelProps extends DispatchProps {
  flyout: FlyoutState
}

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation()

const FlyoutPanel = ({ flyout, setTab, close }: PanelProps) => {
  const [expanded, setExpanded] = React.useState(false)
  const panelRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    panelRef.current.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      const inModal = e.target instanceof Element && e.target.closest('.ui.modal')
      if (e.key === 'Escape' && !inModal) {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus()
      }
    }
  }, [close])

  const toggleExpanded = React.useCallback(() => setExpanded(isExpanded => !isExpanded), [])
  const selectTab = React.useCallback((e: React.MouseEvent, { name }: { name?: string }) => setTab(name), [setTab])

  const { title, entity, geneId, links, activeKey } = flyout
  const frameableLinks = links.filter(({ frameable }) => frameable)
  const otherLinks = links.filter(({ frameable }) => !frameable)
  const hasSummary = entity === 'gene' && !!geneId
  const activeLink = frameableLinks.find(({ key }) => key === activeKey) || (hasSummary ? null : frameableLinks[0])

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={`${title} resources`}
      style={expanded ? EXPANDED_PANEL_STYLE : PANEL_STYLE}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
    >
      <div style={HEADER_STYLE}>
        <h3 style={TITLE_STYLE}>{title}</h3>
        {activeLink && (
          <Button
            as="a"
            basic
            compact
            size="tiny"
            href={activeLink.url}
            target="_blank"
            rel="noreferrer"
            icon="external"
            content="Open in new tab"
          />
        )}
        <Button
          basic
          compact
          size="tiny"
          icon={expanded ? 'compress' : 'expand'}
          aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
          title={expanded ? 'Collapse panel' : 'Expand panel'}
          onClick={toggleExpanded}
        />
        <Button basic compact size="tiny" icon="close" aria-label="Close panel" title="Close panel" onClick={close} />
      </div>
      <Menu pointing secondary size="small" style={TABS_STYLE}>
        {hasSummary && <Menu.Item name={SUMMARY_TAB} content="Summary" active={!activeLink} onClick={selectTab} />}
        {frameableLinks.map(({ key, label }) => (
          <Menu.Item key={key} name={key} content={label} active={activeLink?.key === key} onClick={selectTab} />
        ))}
      </Menu>
      <div style={CONTENT_STYLE}>
        {activeLink ? (
          <>
            <div style={HINT_STYLE}>
              {`${activeLink.label} is shown from its own site. If it does not load here, use "Open in new tab".`}
            </div>
            <iframe
              key={activeLink.key}
              src={activeLink.url}
              title={`${activeLink.label}: ${title}`}
              sandbox={IFRAME_SANDBOX}
              referrerPolicy="no-referrer"
              style={IFRAME_STYLE}
            />
          </>
        ) : (
          <div style={SUMMARY_STYLE}>
            {hasSummary && <GeneDetail key={geneId} geneId={geneId} />}
          </div>
        )}
      </div>
      {otherLinks.length > 0 && (
        <div style={FOOTER_STYLE}>
          <Icon name="external" color="grey" />
          Open in new tab:
          {otherLinks.map(({ key, label, url }) => (
            <a key={key} href={url} target="_blank" rel="noreferrer" style={FOOTER_LINK_STYLE}>{label}</a>
          ))}
        </div>
      )}
    </aside>
  )
}

export const BaseExternalResourceFlyout = ({ flyout, setTab, close }: StateProps & DispatchProps) => (
  flyout ? ReactDOM.createPortal(<FlyoutPanel flyout={flyout} setTab={setTab} close={close} />, document.body) : null
)

const mapStateToProps = (state: Parameters<typeof getExternalResourceFlyout>[0]): StateProps => ({
  flyout: getExternalResourceFlyout(state),
})

const mapDispatchToProps: DispatchProps = {
  setTab: setExternalResourceFlyoutTab,
  close: closeExternalResourceFlyout,
}

export default connect(mapStateToProps, mapDispatchToProps)(BaseExternalResourceFlyout)
