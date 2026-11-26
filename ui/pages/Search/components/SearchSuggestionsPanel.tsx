import React from 'react'
import { Button, Checkbox, Header, List, Loader, Message, Segment } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'
import {
  SearchSuggestion, SearchSuggestionsResponse, INHERITANCE_SUGGESTION, GENE_SUGGESTION, GENE_LIST_SUGGESTION,
  isSupportedSuggestion, suggestionLabel, toggleSuggestion,
} from './searchSuggestions'

const SUGGESTION_GROUPS = [
  {
    type: INHERITANCE_SUGGESTION,
    title: 'Inheritance',
    description: 'Listed in suggested order. A search uses one inheritance mode, so choose one and run the others as separate searches.',
  },
  {
    type: GENE_SUGGESTION,
    title: 'Genes',
    description: 'Selected genes are added to the Location filter, which restricts the search to those genes. Variants in any other gene will not be returned.',
  },
  {
    type: GENE_LIST_SUGGESTION,
    title: 'Project gene lists',
    description: 'Choosing a gene list replaces the Location filter and restricts the search to the genes in that list.',
  },
]

type SearchSuggestionsPanelProps = {
  familyGuid: string
  onApply: (selected: SearchSuggestion[]) => void
  onClose: () => void
}

type PanelState = {
  loading: boolean
  error?: string
  suggestions: SearchSuggestion[]
  notes: string[]
}

const INITIAL_STATE: PanelState = { loading: true, suggestions: [], notes: [] }

const SearchSuggestionsPanel = ({ familyGuid, onApply, onClose }: SearchSuggestionsPanelProps) => {
  const [state, setState] = React.useState(INITIAL_STATE)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])

  React.useEffect(() => {
    let active = true
    setState(INITIAL_STATE)
    setSelectedIds([])
    new HttpRequestHelper(
      `/api/family/${familyGuid}/search_suggestions`,
      (response) => {
        if (active) {
          const { suggestions, notes } = response as SearchSuggestionsResponse
          setState({ loading: false, suggestions: (suggestions || []).filter(isSupportedSuggestion), notes: notes || [] })
        }
      },
      (e) => {
        if (active) {
          setState({ loading: false, suggestions: [], notes: [], error: (e as Error).message })
        }
      },
    ).get()
    return () => {
      active = false
    }
  }, [familyGuid])

  const { loading, error, suggestions, notes } = state
  const apply = () => onApply(suggestions.filter(({ id }) => selectedIds.includes(id)))

  return (
    <Segment className="search-suggestions">
      <Header
        size="small"
        content="Suggestions from the clinical record"
        subheader="Based on structured fields only: pedigree, affected status, expected inheritance, candidate genes, phenotype prioritization results and project gene lists. Free-text notes are not read. Nothing is applied until you select it and click Apply."
      />
      <Loader inline active={loading} />
      {error && <Message error content={`Unable to load suggestions: ${error}`} />}
      {!loading && !error && suggestions.length === 0 && (
        <Message info content="No suggestions are available for this family." />
      )}
      {SUGGESTION_GROUPS.map(({ type, title, description }) => {
        const groupSuggestions = suggestions.filter(suggestion => suggestion.type === type)
        return groupSuggestions.length > 0 && (
          <div key={type} className={`suggestion-group-${type}`}>
            <Header size="tiny" content={title} subheader={description} />
            <List>
              {groupSuggestions.map(suggestion => (
                <List.Item key={suggestion.id}>
                  <Checkbox
                    id={suggestion.id}
                    checked={selectedIds.includes(suggestion.id)}
                    onChange={() => setSelectedIds(toggleSuggestion(selectedIds, suggestion, suggestions))}
                    label={(
                      <label htmlFor={suggestion.id}>
                        <b>{suggestionLabel(suggestion)}</b>
                        {` — ${suggestion.why}`}
                      </label>
                    )}
                  />
                </List.Item>
              ))}
            </List>
          </div>
        )
      })}
      {notes.length > 0 && (
        <Message className="suggestion-notes" header="Not available from the clinical record" list={notes} />
      )}
      <Button
        type="button"
        primary
        size="small"
        content="Apply selected"
        className="apply-suggestions"
        disabled={selectedIds.length === 0}
        onClick={apply}
      />
      <Button type="button" size="small" content="Cancel" className="cancel-suggestions" onClick={onClose} />
    </Segment>
  )
}

export default SearchSuggestionsPanel
