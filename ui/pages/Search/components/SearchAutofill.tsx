import React from 'react'
import { useForm, useFormState } from 'react-final-form'
import { Button, Message, Popup } from 'semantic-ui-react'

import SearchSuggestionsPanel from './SearchSuggestionsPanel'
import { SearchSuggestion, applySuggestions, describeAppliedSuggestions, getSingleFamilyGuid } from './searchSuggestions'

const SUBSCRIPTION = { values: true }

const CONTAINER_STYLE = { margin: '1em 0' }

const MULTI_FAMILY_HELP = 'Autofill from clinical records is only available when searching a single family'

const SearchAutofill = () => {
  const form = useForm()
  const { values } = useFormState({ subscription: SUBSCRIPTION })
  const [isOpen, setIsOpen] = React.useState(false)
  const [applied, setApplied] = React.useState('')

  const familyGuid = getSingleFamilyGuid(values.projectFamilies)

  const clear = () => {
    form.change('search', {})
    setIsOpen(false)
    setApplied('')
  }
  const open = () => {
    setIsOpen(true)
    setApplied('')
  }
  const close = () => setIsOpen(false)
  const apply = (selected: SearchSuggestion[]) => {
    form.change('search', applySuggestions(form.getState().values.search, selected))
    setIsOpen(false)
    setApplied(describeAppliedSuggestions(selected))
  }

  const autofillButton = (
    <Button
      type="button"
      size="small"
      icon="magic"
      content="Autofill from clinical records"
      className="autofill-search"
      disabled={!familyGuid}
      onClick={open}
    />
  )

  return (
    <div className="search-autofill" style={CONTAINER_STYLE}>
      <Button type="button" size="small" icon="eraser" content="Clear" className="clear-search" onClick={clear} />
      {familyGuid ? autofillButton : <Popup content={MULTI_FAMILY_HELP} trigger={<span>{autofillButton}</span>} />}
      {familyGuid && isOpen && <SearchSuggestionsPanel familyGuid={familyGuid} onApply={apply} onClose={close} />}
      {applied && (
        <Message
          positive
          size="small"
          className="applied-suggestions"
          header="Applied from the clinical record"
          content={`${applied}. These values are now in the Inheritance and Location filters below, where they can be reviewed and edited before searching.`}
        />
      )}
    </div>
  )
}

export default SearchAutofill
