import { toUniqueCsvString } from '../../../shared/utils/stringUtils'
import { INHERITANCE_FILTER_LOOKUP, INHERITANCE_FILTER_JSON_OPTIONS } from '../constants'

export const INHERITANCE_SUGGESTION = 'inheritance'
export const GENE_SUGGESTION = 'gene'
export const GENE_LIST_SUGGESTION = 'gene_list'

export type SearchSuggestion = {
  id: string
  type: string
  value: string
  label: string
  sources: string[]
  why: string
  geneId?: string
  numEntries?: number
}

export type SearchSuggestionsResponse = {
  familyGuid: string
  suggestions: SearchSuggestion[]
  notes: string[]
}

type ProjectFamilies = { projectGuid?: string, familyGuids?: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Search = Record<string, any>

const INHERITANCE_MODES: Record<string, unknown> = INHERITANCE_FILTER_LOOKUP

const INHERITANCE_LABELS: Record<string, string> = INHERITANCE_FILTER_JSON_OPTIONS.reduce(
  (acc: Record<string, string>, { value, text }: { value: string, text: string }) => ({ ...acc, [value]: text }), {},
)

export const suggestionLabel = ({ type, value, label }: SearchSuggestion): string => (
  (type === INHERITANCE_SUGGESTION && INHERITANCE_LABELS[value]) || label
)

export const isSupportedSuggestion = ({ type, value }: SearchSuggestion): boolean => (
  type === GENE_SUGGESTION || type === GENE_LIST_SUGGESTION ||
  (type === INHERITANCE_SUGGESTION && !!INHERITANCE_MODES[value])
)

export const getSingleFamilyGuid = (projectFamilies?: ProjectFamilies[] | null): string | null => (
  (projectFamilies?.length === 1 && projectFamilies[0].familyGuids?.length === 1) ?
    projectFamilies[0].familyGuids[0] : null
)

// The form holds one inheritance mode, and the location filter holds either one gene list or individual genes
const EXCLUSIVE_TYPES: Record<string, string[]> = {
  [INHERITANCE_SUGGESTION]: [INHERITANCE_SUGGESTION],
  [GENE_LIST_SUGGESTION]: [GENE_LIST_SUGGESTION, GENE_SUGGESTION],
  [GENE_SUGGESTION]: [GENE_LIST_SUGGESTION],
}

export const toggleSuggestion = (
  selectedIds: string[], suggestion: SearchSuggestion, suggestions: SearchSuggestion[],
): string[] => {
  if (selectedIds.includes(suggestion.id)) {
    return selectedIds.filter(id => id !== suggestion.id)
  }
  const excludedTypes = EXCLUSIVE_TYPES[suggestion.type] || []
  const excludedIds = suggestions.filter(({ type }) => excludedTypes.includes(type)).map(({ id }) => id)
  return [...selectedIds.filter(id => !excludedIds.includes(id)), suggestion.id]
}

export const applySuggestions = (search: Search | null | undefined, selected: SearchSuggestion[]): Search => {
  const updated: Search = { ...(search || {}) }

  const inheritance = selected.find(({ type }) => type === INHERITANCE_SUGGESTION)
  if (inheritance) {
    updated.inheritance = { mode: inheritance.value, filter: INHERITANCE_MODES[inheritance.value] }
  }

  const geneList = selected.find(({ type }) => type === GENE_LIST_SUGGESTION)
  const genes = selected.filter(({ type }) => type === GENE_SUGGESTION).map(({ value }) => value)
  if (geneList) {
    updated.locus = { locusListGuid: geneList.value }
  } else if (genes.length) {
    const { locusListGuid, panelAppItems, rawItems } = updated.locus || {}
    const currentItems = (locusListGuid || panelAppItems) ? '' : (rawItems || '')
    updated.locus = { rawItems: toUniqueCsvString(currentItems, ...genes).split(',').join(', ') }
  }

  return updated
}

export const describeAppliedSuggestions = (selected: SearchSuggestion[]): string => {
  const descriptions = [
    [INHERITANCE_SUGGESTION, 'Inheritance'],
    [GENE_LIST_SUGGESTION, 'Location gene list'],
    [GENE_SUGGESTION, 'Location genes'],
  ].map(([suggestionType, title]) => {
    const labels = selected.filter(({ type }) => type === suggestionType).map(suggestionLabel)
    return labels.length ? `${title}: ${labels.join(', ')}` : null
  }).filter(description => description)
  return descriptions.join('; ')
}
