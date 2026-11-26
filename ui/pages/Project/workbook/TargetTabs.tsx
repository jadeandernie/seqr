import React from 'react'
import { Link } from 'react-router-dom'
import { Dropdown, Icon } from 'semantic-ui-react'
import styled from 'styled-components'

import { MAX_VISIBLE_TARGET_TABS, WORK_PANE_ID } from './constants'
import { getWorkbookPath, splitTargetTabs } from './selectors'
import TalosExportButton from './TalosExport'
import { TargetDisplay, Workbook } from './types'
import { AddTargetsButton, RemoveTargetButton } from './WorkbookButtons'

const BORDER = '1px solid #d4d4d5'

const TabRow = styled.div`
  display: flex;
  align-items: flex-end;
  border-bottom: ${BORDER};
`

const NameBox = styled.div`
  border: ${BORDER};
  background-color: #f7f7f7;
  font-weight: 700;
  font-size: 1.1em;
  padding: 0.6em 1em;
  margin: 0 1em -1px 0;
`

const TabList = styled.div`
  display: flex;
  align-items: flex-end;
`

const Tab = styled.div`
  border: 1px solid ${(props: { $active: boolean }) => (props.$active ? '#d4d4d5' : 'transparent')};
  border-bottom-color: ${(props: { $active: boolean }) => (props.$active ? 'white' : 'transparent')};
  border-radius: 0.3em 0.3em 0 0;
  background-color: ${(props: { $active: boolean }) => (props.$active ? 'white' : 'transparent')};
  font-weight: ${(props: { $active: boolean }) => (props.$active ? 700 : 400)};
  padding: 0.6em 0.8em;
  margin-bottom: -1px;
  white-space: nowrap;
`

const TabControl = styled.div`
  padding: 0.6em 0.8em;
`

const KEY_OFFSETS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }

const focusSiblingTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
  const offset = KEY_OFFSETS[event.key]
  if (!offset) {
    return
  }
  event.preventDefault()
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
  const index = tabs.indexOf(document.activeElement as HTMLElement)
  tabs[(index + offset + tabs.length) % tabs.length].focus()
}

export const getTargetTabId = (target: TargetDisplay) => `workbook-tab-${target.workbookTargetGuid}`

const TargetLabel = ({ target }: { target: TargetDisplay }) => (
  <span>
    {target.isGroup && <Icon name="users" role="img" aria-label="Analysis group" title="Analysis group" />}
    {target.name}
  </span>
)

interface TargetTabsProps {
  workbook: Workbook
  targets: TargetDisplay[]
  selectedTarget?: TargetDisplay
  queryGuid?: string
}

const TargetTabs = React.memo(({ workbook, targets, selectedTarget, queryGuid }: TargetTabsProps) => {
  const { visible, overflow } = splitTargetTabs(targets, selectedTarget?.workbookTargetGuid, MAX_VISIBLE_TARGET_TABS)
  const getPath = (target: TargetDisplay) => getWorkbookPath(workbook, target.workbookTargetGuid, queryGuid)
  return (
    <TabRow>
      <NameBox title={workbook.description}>{workbook.name}</NameBox>
      <TabList role="tablist" aria-label="Families and analysis groups" onKeyDown={focusSiblingTab}>
        {visible.map((target) => {
          const active = target === selectedTarget
          return (
            <Tab key={target.workbookTargetGuid} $active={active} role="presentation">
              <Link
                id={getTargetTabId(target)}
                to={getPath(target)}
                role="tab"
                aria-selected={active}
                aria-controls={WORK_PANE_ID}
                tabIndex={active ? 0 : -1}
              >
                <TargetLabel target={target} />
              </Link>
              {workbook.canEdit && <RemoveTargetButton workbook={workbook} target={target} />}
            </Tab>
          )
        })}
      </TabList>
      {overflow.length > 0 && (
        <TabControl>
          <Dropdown text={`${overflow.length} more`} aria-label="More families and analysis groups" scrolling>
            <Dropdown.Menu>
              {overflow.map(target => (
                <Dropdown.Item key={target.workbookTargetGuid} as={Link} to={getPath(target)}>
                  <TargetLabel target={target} />
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </TabControl>
      )}
      {workbook.canEdit && <TabControl><AddTargetsButton workbook={workbook} targets={targets} /></TabControl>}
      <TabControl><TalosExportButton workbook={workbook} /></TabControl>
    </TabRow>
  )
})

export default TargetTabs
