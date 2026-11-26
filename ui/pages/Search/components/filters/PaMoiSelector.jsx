import PropTypes from 'prop-types'
import React from 'react'
import { connect } from 'react-redux'

import { getParsedLocusListsByGuid } from 'redux/selectors'
import { Multiselect } from 'shared/components/form/Inputs'
import { getSelectedLocusLists } from 'shared/utils/locusListUtils'
import { moiToMoiInitials } from 'shared/utils/panelAppUtils'
import { PANEL_APP_MOI_OPTIONS } from 'shared/utils/constants'

const EMPTY_LIST = []

class PaMoiDropdown extends React.PureComponent {

  static propTypes = {
    locus: PropTypes.object,
    locusListsByGuid: PropTypes.object,
    value: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.string), PropTypes.string]),
    label: PropTypes.node,
    width: PropTypes.number,
    onChange: PropTypes.func,
  }

  panelAppItems = () => {
    const { locus, locusListsByGuid } = this.props
    return getSelectedLocusLists(locus, locusListsByGuid).filter(
      ({ paLocusList, items }) => paLocusList && items,
    ).map(({ items }) => items)
  }

  moiOptions = (panelAppItems) => {
    const initials = panelAppItems.flat().reduce((acc, gene) => {
      moiToMoiInitials(gene.pagene?.modeOfInheritance, false).forEach((initial) => {
        acc[initial] = true
      })
      return acc
    }, {})

    return PANEL_APP_MOI_OPTIONS.map(moi => ({
      ...moi,
      disabled: !initials[moi.value],
    }))
  }

  render() {
    const { value, label, width, onChange } = this.props
    const panelAppItems = this.panelAppItems()
    const disabled = panelAppItems.length === 0
    return (
      <Multiselect
        label={label}
        value={value}
        width={width}
        inline
        onChange={onChange}
        placeholder="Showing all MOIs as listed in Panel App"
        disabled={disabled}
        options={disabled ? EMPTY_LIST : this.moiOptions(panelAppItems)}
        color="violet"
      />
    )
  }

}

const mapStateToProps = state => ({
  locusListsByGuid: getParsedLocusListsByGuid(state),
})

export default connect(mapStateToProps)(PaMoiDropdown)
