import React from 'react'
import { connect } from 'react-redux'

import UpdateButton from '../../../shared/components/buttons/UpdateButton'
import { validators } from '../../../shared/components/form/FormHelpers'
import { Select } from '../../../shared/components/form/Inputs'
import { logExternalMmeMatch } from '../reducers'

interface ExternalMatchFormValues {
  submissionGuid: string
  source: string
  institution?: string
  contactName?: string
  contactEmail?: string
  genes?: string
  hpoTerms?: string
}

interface ExternalMatch extends Omit<ExternalMatchFormValues, 'genes' | 'hpoTerms'> {
  genes: string[]
  hpoTerms: string[]
}

interface LogExternalMatchButtonProps {
  submissionGuid: string
  disabled?: boolean
  onSubmit: (values: ExternalMatch) => Promise<unknown>
}

const SOURCE_OPTIONS = [
  { value: 'variantmatcher', text: 'VariantMatcher' },
  { value: 'genematcher', text: 'GeneMatcher' },
  { value: 'other', text: 'Other' },
]

// UpdateButton is not typed
const ModalFormButton = UpdateButton as React.ComponentType<Record<string, unknown>>

const HPO_TERM_REGEX = /^HP:\d{7}$/

export const parseListInput = (value?: string): string[] => (value || '').split(/[\s,;]+/).filter(item => item)

const validateHpoTerms = (value?: string) => {
  const invalid = parseListInput(value).filter(term => !HPO_TERM_REGEX.test(term))
  return invalid.length ? `Invalid HPO terms: ${invalid.join(', ')}` : undefined
}

const FORM_FIELDS = [
  { name: 'source', label: 'Source', component: Select, options: SOURCE_OPTIONS, validate: validators.required },
  { name: 'institution', label: 'Institution', validate: validators.required },
  { name: 'contactName', label: 'Contact Name' },
  { name: 'contactEmail', label: 'Contact Email', validate: validators.requiredEmail },
  { name: 'genes', label: 'Genes', placeholder: 'Comma-separated gene symbols or Ensembl IDs' },
  {
    name: 'hpoTerms',
    label: 'HPO Terms',
    placeholder: 'Comma-separated HPO IDs, e.g. HP:0001250',
    validate: validateHpoTerms,
  },
]

const BaseLogExternalMatchButton = ({ submissionGuid, disabled, onSubmit }: LogExternalMatchButtonProps) => {
  const initialValues = React.useMemo(() => ({ submissionGuid, source: SOURCE_OPTIONS[0].value }), [submissionGuid])
  const submit = React.useCallback((values: ExternalMatchFormValues) => onSubmit({
    ...values, genes: parseListInput(values.genes), hpoTerms: parseListInput(values.hpoTerms),
  }), [onSubmit])
  return (
    <ModalFormButton
      modalTitle="Log a Match Received Outside of the Matchmaker Exchange"
      modalId={`${submissionGuid}_-_logExternalMatch`}
      buttonText="Log External Match"
      editIconName="plus"
      disabled={disabled}
      formFields={FORM_FIELDS}
      initialValues={initialValues}
      onSubmit={submit}
      showErrorPanel
    />
  )
}

const mapDispatchToProps = {
  onSubmit: logExternalMmeMatch,
}

export default connect(null, mapDispatchToProps)(BaseLogExternalMatchButton)
