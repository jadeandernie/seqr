import React from 'react'
import { RouterHistory, RouterLocation } from 'react-router-dom'

import BaseUpdateButton from '../../../shared/components/buttons/UpdateButton'
import BaseDeleteButton from '../../../shared/components/buttons/DeleteButton'
import BaseSearchResultsLink from '../../../shared/components/buttons/SearchResultsLink'
import { CATEGORY_NAMES } from '../../../shared/components/panel/HpoPanel'
import BaseVariantSearchResults from '../../Search/components/VariantSearchResults'
import { Option } from './types'

// Prop types for the javascript components used by the workbook pages

export interface FormField {
  name: string
  label: string
  component?: React.ElementType
  options?: Option[]
  color?: string
  validate?: (value?: string) => string | undefined
  format?: (value?: string[]) => string[]
}

interface UpdateButtonProps<V> {
  modalId: string
  modalTitle: string
  formFields: FormField[]
  onSubmit: (values: V) => Promise<void>
  initialValues?: Partial<V>
  buttonText?: string
  editIconName?: string
  trigger?: React.ReactNode
  showErrorPanel?: boolean
}

interface DeleteButtonProps {
  onSubmit: () => Promise<void>
  confirmDialog: React.ReactNode
  onSuccess?: () => void
  buttonText?: string
  size?: string
  title?: string
  'aria-label'?: string
}

interface VariantSearchResultsProps {
  match: { params: { searchHash: string } }
  history: RouterHistory
  location: RouterLocation
}

interface SearchResultsLinkProps {
  buttonText: string
  location: string
  familyGuids: string[]
  initialSearch: Record<string, unknown>
}

export const HPO_CATEGORY_NAMES: Record<string, string> = CATEGORY_NAMES

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const UpdateButton = BaseUpdateButton as unknown as React.ComponentType<UpdateButtonProps<any>>
export const DeleteButton = BaseDeleteButton as unknown as React.ComponentType<DeleteButtonProps>
export const VariantSearchResults = (
  BaseVariantSearchResults as unknown as React.ComponentType<VariantSearchResultsProps>
)
export const SearchResultsLink = BaseSearchResultsLink as unknown as React.ComponentType<SearchResultsLinkProps>
