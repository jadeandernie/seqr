import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'
import { FormSpy } from 'react-final-form'
import { Form } from 'semantic-ui-react'
import styled from 'styled-components'

import { loadLocusListItems } from 'redux/rootReducer'
import { getLocusListsIsLoading, getParsedLocusListsByGuid } from 'redux/selectors'
import { Dropdown } from 'shared/components/form/Inputs'
import { getLocusListGuids, getLocusListGuidsValue, getSelectedLocusLists, mergeLocusListItems } from 'shared/utils/locusListUtils'
import { LocusListsLoader } from 'shared/components/LocusListLoader'
import { getLocusListOptions } from '../../selectors'

const DropdownInput = styled(Dropdown).attrs({
  inline: true,
  selection: true,
  search: true,
  includeCategories: true,
  multiple: true,
  fluid: true,
  labeled: true,
  width: 16,
})`
  label {
    white-space: nowrap;
  }
`

const isSameList = (list1, list2) => list1.length === list2.length && list1.every((val, i) => val === list2[i])

const isLoaded = ({ items, paLocusList }) => !!items && (
  !paLocusList || items.length === 0 || items.some(({ pagene }) => pagene)
)

const getRawItems = ({ value, locusListsByGuid }) => getSelectedLocusLists(value, locusListsByGuid).map(
  locusList => (isLoaded(locusList) ? locusList.rawItems : undefined),
)

const isSameLocusLists = (props1, props2) => (
  isSameList(getLocusListGuids(props1.value), getLocusListGuids(props2.value)) &&
  isSameList(getRawItems(props1), getRawItems(props2))
)

class BaseLocusListDropdown extends React.Component {

  static propTypes = {
    value: PropTypes.object,
    locusListsByGuid: PropTypes.object,
    locusListOptions: PropTypes.arrayOf(PropTypes.object),
    loading: PropTypes.bool,
    onChange: PropTypes.func,
    loadItems: PropTypes.func,
  }

  componentDidMount() {
    this.loadItems()
  }

  shouldComponentUpdate(nextProps) {
    const { locusListOptions, onChange, loading } = this.props
    return nextProps.locusListOptions !== locusListOptions ||
      nextProps.onChange !== onChange ||
      nextProps.loading !== loading ||
      !isSameLocusLists(nextProps, this.props)
  }

  componentDidUpdate(prevProps) {
    const { value, locusListsByGuid, onChange } = this.props

    if (!isSameList(getLocusListGuids(prevProps.value), getLocusListGuids(value))) {
      this.loadItems()
    }

    if (!isSameLocusLists(prevProps, this.props) && getRawItems(this.props).every(rawItems => rawItems !== undefined)) {
      const locusListGuids = getLocusListGuids(value)
      onChange({
        ...getLocusListGuidsValue(locusListGuids),
        ...mergeLocusListItems(getSelectedLocusLists(value, locusListsByGuid), value?.selectedMOIs),
      })
    }
  }

  onChange = (locusListGuids) => {
    const { onChange } = this.props
    onChange(getLocusListGuidsValue(locusListGuids))
  }

  loadItems = () => {
    const { value, loadItems } = this.props
    getLocusListGuids(value).forEach(loadItems)
  }

  render() {
    const { value, locusListOptions, loading } = this.props
    return (
      <Form.Group inline>
        <DropdownInput
          label="Gene Lists"
          value={getLocusListGuids(value)}
          loading={loading}
          disabled={loading}
          onChange={this.onChange}
          options={locusListOptions}
        />
      </Form.Group>
    )
  }

}

const mapStateToProps = (state, ownProps) => ({
  locusListOptions: getLocusListOptions(state, ownProps),
  locusListsByGuid: getParsedLocusListsByGuid(state),
  loading: getLocusListsIsLoading(state),
})

const mapDispatchToProps = {
  loadItems: loadLocusListItems,
}

const LocusListDropdown = connect(mapStateToProps, mapDispatchToProps)(BaseLocusListDropdown)

const SUBSCRIPTION = { values: true }

const LocusListSelector = React.memo(props => (
  <LocusListsLoader allProjectLists hideLoading>
    <LocusListDropdown {...props} />
  </LocusListsLoader>
))

export default props => (
  <FormSpy subscription={SUBSCRIPTION}>
    {({ values }) => <LocusListSelector {...props} projectFamilies={values.projectFamilies} />}
  </FormSpy>
)
