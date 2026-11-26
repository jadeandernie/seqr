import { PanelAppLocusList, formatMergedPanelAppItems } from './panelAppUtils'

type LocusListValue = {
  locusListGuid?: string
  locusListGuids?: string[]
  [key: string]: unknown
}

type ParsedLocusList = PanelAppLocusList & { rawItems?: string }

type MergedLocusListItems = {
  rawItems?: string
  panelAppItems?: Record<string, string>
  selectedMOIs?: string[] | null
}

export const getLocusListGuids = (locus: LocusListValue | undefined | null): string[] => {
  if (locus?.locusListGuids?.length) {
    return locus.locusListGuids
  }
  return locus?.locusListGuid ? [locus.locusListGuid] : []
}

export const getLocusListGuidsValue = (locusListGuids: string[]): LocusListValue => (
  locusListGuids.length > 1 ? { locusListGuids } : { locusListGuid: locusListGuids[0] }
)

export const getSelectedLocusLists = <T extends object>(
  locus: LocusListValue | undefined | null, locusListsByGuid: Record<string, T>,
): (T | Record<string, never>)[] => getLocusListGuids(locus).map(locusListGuid => locusListsByGuid[locusListGuid] || {})

export const mergeLocusListItems = (
  locusLists: ParsedLocusList[], selectedMOIs?: string[] | null,
): MergedLocusListItems => {
  if (locusLists.some(({ paLocusList }) => paLocusList)) {
    return { panelAppItems: formatMergedPanelAppItems(locusLists, selectedMOIs), selectedMOIs }
  }
  if (locusLists.length < 2) {
    return { rawItems: locusLists[0]?.rawItems }
  }
  return { rawItems: formatMergedPanelAppItems(locusLists).none }
}
