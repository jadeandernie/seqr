import React, { useCallback, useMemo } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'

import { VARIANT_SEARCH_SORT_FIELD, VARIANT_PAGINATION_FIELD, SORT_BY_XPOS } from 'shared/utils/constants'
import { splitSorts, joinSorts } from 'shared/utils/multiSortUtils'
import FormWrapper from 'shared/components/form/FormWrapper'
import { Dropdown } from 'shared/components/form/Inputs'
import { loadSearchedVariants, updateSearchSort } from '../reducers'
import {
  getTotalVariantsCount,
  getVariantSearchDisplay,
} from '../selectors'

const MultiSortDropdown = ({ value, onChange, ...props }) => {
  const sorts = useMemo(() => splitSorts(value), [value])
  const onSortsChange = useCallback(newSorts => onChange(joinSorts(newSorts, SORT_BY_XPOS)), [onChange])
  return <Dropdown {...props} multiple value={sorts} onChange={onSortsChange} />
}

MultiSortDropdown.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
}

const FIELDS = [
  {
    ...VARIANT_SEARCH_SORT_FIELD,
    component: MultiSortDropdown,
    selection: true,
    labelHelp: 'Select multiple sorts to order variants by the first sort, then break ties with each following sort',
  },
]

const SearchDisplayForm = React.memo(({
  variantSearchDisplay, onSubmit, totalVariantsCount, formLocation, paginationOnly,
}) => {
  const { recordsPerPage } = variantSearchDisplay
  const paginationFields = (totalVariantsCount || 0) > recordsPerPage ?
    [{ ...VARIANT_PAGINATION_FIELD, totalPages: Math.ceil(totalVariantsCount / recordsPerPage) }] : []
  const fields = paginationOnly ? paginationFields : [...FIELDS, ...paginationFields]

  return (
    <FormWrapper
      onSubmit={onSubmit}
      modalName={`editSearchedVariantsDisplay${formLocation || ''}`}
      initialValues={variantSearchDisplay}
      closeOnSuccess={false}
      submitOnChange
      inline
      fields={fields}
    />
  )
})

SearchDisplayForm.propTypes = {
  formLocation: PropTypes.string,
  paginationOnly: PropTypes.bool,
  onSubmit: PropTypes.func,
  variantSearchDisplay: PropTypes.object,
  totalVariantsCount: PropTypes.number,
}

const mapStateToProps = (state, ownProps) => ({
  variantSearchDisplay: getVariantSearchDisplay(state),
  totalVariantsCount: getTotalVariantsCount(state, ownProps),
})

const mapDispatchToProps = (dispatch, ownProps) => ({
  onSubmit: updates => (
    ownProps.searchOnSubmit ? dispatch(loadSearchedVariants(ownProps.match.params, {
      displayUpdates: updates,
      ...ownProps,
    })) : dispatch(updateSearchSort(updates))
  ),
})

export default connect(mapStateToProps, mapDispatchToProps)(SearchDisplayForm)
