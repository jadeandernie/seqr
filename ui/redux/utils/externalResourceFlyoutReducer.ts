import { ResourceEntity, ResourceLink } from '../../shared/utils/externalResources'

export const SUMMARY_TAB = 'summary'

export interface FlyoutContext {
  entity: ResourceEntity
  title: string
  geneId?: string
  links: ResourceLink[]
}

export interface FlyoutState extends FlyoutContext {
  activeKey: string
}

const OPEN_EXTERNAL_RESOURCE_FLYOUT = 'OPEN_EXTERNAL_RESOURCE_FLYOUT'
const SET_EXTERNAL_RESOURCE_FLYOUT_TAB = 'SET_EXTERNAL_RESOURCE_FLYOUT_TAB'
const CLOSE_EXTERNAL_RESOURCE_FLYOUT = 'CLOSE_EXTERNAL_RESOURCE_FLYOUT'

type FlyoutAction =
  { type: typeof OPEN_EXTERNAL_RESOURCE_FLYOUT, context: FlyoutContext, activeKey: string } |
  { type: typeof SET_EXTERNAL_RESOURCE_FLYOUT_TAB, activeKey: string } |
  { type: typeof CLOSE_EXTERNAL_RESOURCE_FLYOUT }

export const openExternalResourceFlyout = (context: FlyoutContext, activeKey: string): FlyoutAction => (
  { type: OPEN_EXTERNAL_RESOURCE_FLYOUT, context, activeKey })

export const setExternalResourceFlyoutTab = (activeKey: string): FlyoutAction => (
  { type: SET_EXTERNAL_RESOURCE_FLYOUT_TAB, activeKey })

export const closeExternalResourceFlyout = (): FlyoutAction => ({ type: CLOSE_EXTERNAL_RESOURCE_FLYOUT })

const externalResourceFlyout = (state: FlyoutState | null = null, action: FlyoutAction): FlyoutState | null => {
  switch (action.type) {
    case OPEN_EXTERNAL_RESOURCE_FLYOUT:
      return { ...action.context, activeKey: action.activeKey }
    case SET_EXTERNAL_RESOURCE_FLYOUT_TAB:
      return state && { ...state, activeKey: action.activeKey }
    case CLOSE_EXTERNAL_RESOURCE_FLYOUT:
      return null
    default:
      return state
  }
}

export default { externalResourceFlyout }

export const getExternalResourceFlyout = (
  state: { externalResourceFlyout?: FlyoutState | null },
): FlyoutState | null => state.externalResourceFlyout || null
