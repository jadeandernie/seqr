import { PANEL_APP_CONFIDENCE_LEVELS, AD_MOI, AR_MOI, XD_MOI, XR_MOI, OTHER_MOI } from './constants'
import { genericComparator } from './sortUtils'

/**
 * Converts a Mode of Inheritance (MOI) string to MOI initials.
 *
 * @param {string | undefined | null} rawMoi - The Mode of Inheritance (MOI) string to convert.
 * @param {boolean} [initialsOnly=true] - A flag to indicate whether to return only the initials (default is true).
 * @returns {string[]} An array of MOI initials or an empty array if `rawMoi` is falsy.
 */
export const moiToMoiInitials = (rawMoi: string | undefined | null, initialsOnly: boolean = true): string[] => {
  if (!rawMoi) {
    return []
  }

  const moi = rawMoi.toUpperCase()

  if (moi.startsWith('MONOALLELIC')) {
    if (moi.includes('PATERNALLY IMPRINTED')) {
      return initialsOnly ? [] : [OTHER_MOI]
    }
    if (moi.includes('MATERNALLY IMPRINTED')) {
      return initialsOnly ? [] : [OTHER_MOI]
    }
    return [AD_MOI]
  }
  if (moi.startsWith('X-LINKED') || moi.startsWith('X LINKED')) {
    if (moi.includes('BIALLELIC MUTATIONS')) {
      return [XR_MOI]
    }
    if (moi.includes('MONOALLELIC MUTATIONS')) {
      return [XR_MOI, XD_MOI]
    }
  }
  if (moi.startsWith('BIALLELIC')) {
    return [AR_MOI]
  }
  if (moi.startsWith('BOTH')) {
    return [AD_MOI, AR_MOI]
  }

  return initialsOnly ? [] : [OTHER_MOI]
}

const PANEL_APP_SOURCES: Record<string, string> = {
  AU: 'https://panelapp-aus.org',
  UK: 'https://panelapp.genomicsengland.co.uk',
}

/**
 * Constructs a PanelApp URL based on API URL, panel ID, and gene.
 *
 * @param {string | undefined | null} apiUrl - The API URL.
 * @param {number | undefined | null} panelId - The panel ID.
 * @param {string | undefined | null} gene - The gene.
 * @returns {string} The constructed PanelApp URL, or an empty string if any of the parameters are falsy.
 */
export const panelAppUrl = (
  source: string | undefined | null,
  panelId: number | undefined | null,
  gene: string | undefined | null,
) => {
  if (!source || !panelId || !gene) {
    return ''
  }
  const baseUrl = PANEL_APP_SOURCES[source]

  return `${baseUrl}/panels/${panelId}/gene/${gene}`
}

export type PanelAppItem = {
  pagene?: {
    modeOfInheritance?: string;
    confidenceLevel?: 0 | 1 | 2 | 3 | 4
  }
  display: string
}

const hasSelectedMoi = (item: PanelAppItem, selectedMOIs?: string[] | null): boolean => {
  if (!selectedMOIs || selectedMOIs.length === 0) {
    return true
  }
  const initials = moiToMoiInitials(item.pagene?.modeOfInheritance, false)
  return selectedMOIs.some((moi) => initials.includes(moi))
}

const getConfidenceColor = (confidenceLevel?: number): string => (
  (PANEL_APP_CONFIDENCE_LEVELS as Record<number, string>)[confidenceLevel] || PANEL_APP_CONFIDENCE_LEVELS[0]
)

const addColorItem = (acc: Record<string, string>, color: string, display: string): Record<string, string> => (
  { ...acc, [color]: [acc[color], display].filter(val => val).join(', ') }
)

/**
 * Formats an array of PanelApp items into a record with confidence levels as keys
 * and concatenated item displays as values.
 *
 * @param {PanelAppItem[] | null | undefined} items - The array of PanelApp items to format.
 * @param {string[] | null | undefined} selectedMOIs - Optional array of selected MOIs for filtering.
 * @returns {Record<string, string> | never[]} A record where keys represent confidence levels and values
 * are concatenated item displays, or an empty array if `items` is falsy.
 */
export const formatPanelAppItems = (
  items: PanelAppItem[] | null | undefined,
  selectedMOIs?: string[] | null
): Record<string, string> | never[] => {
  if (!items) {
    return []
  }

  return items.reduce((acc, item) => (
    hasSelectedMoi(item, selectedMOIs) ? addColorItem(acc, getConfidenceColor(item.pagene?.confidenceLevel), item.display) : acc
  ), {} as Record<string, string>)
}

export type PanelAppLocusList = {
  paLocusList?: unknown
  items?: PanelAppItem[] | null
}

/**
 * Formats the items of multiple gene lists into a record with confidence levels as keys
 * and concatenated item displays as values. An item in several PanelApp lists gets its highest confidence level,
 * and items which are only in non-PanelApp lists have no confidence level.
 *
 * @param {PanelAppLocusList[]} locusLists - The gene lists to merge.
 * @param {string[] | null | undefined} selectedMOIs - Optional array of selected MOIs for filtering PanelApp items.
 * @returns {Record<string, string>} A record where keys represent confidence levels and values
 * are concatenated item displays.
 */
export const formatMergedPanelAppItems = (
  locusLists: PanelAppLocusList[],
  selectedMOIs?: string[] | null
): Record<string, string> => {
  const confidenceByDisplay = locusLists.reduce((acc, { paLocusList, items }) => {
    (items || []).filter(item => !paLocusList || hasSelectedMoi(item, selectedMOIs)).forEach((item) => {
      const confidenceLevel = (paLocusList && item.pagene?.confidenceLevel) || 0
      acc.set(item.display, Math.max(acc.get(item.display) || 0, confidenceLevel))
    })
    return acc
  }, new Map<string, number>())

  return [...confidenceByDisplay.keys()].sort(
    (a, b) => genericComparator(a.toLowerCase(), b.toLowerCase()),
  ).reduce(
    (acc, display) => addColorItem(acc, getConfidenceColor(confidenceByDisplay.get(display)), display),
    {} as Record<string, string>,
  )
}
