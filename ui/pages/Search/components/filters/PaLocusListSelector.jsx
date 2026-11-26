import React from 'react'
import { BaseSemanticInput } from 'shared/components/form/Inputs'
import { connect } from 'react-redux'
import { getParsedLocusListsByGuid } from 'redux/selectors'
import { getSelectedLocusLists } from 'shared/utils/locusListUtils'
import { formatMergedPanelAppItems } from 'shared/utils/panelAppUtils'
import PropTypes from 'prop-types'

const EMPTY_STRING = ''

class PaLocusListSelector extends React.Component {

  static propTypes = {
    locus: PropTypes.object,
    locusListsByGuid: PropTypes.object,
    dispatch: PropTypes.func,
    onChange: PropTypes.func,
    value: PropTypes.string,
    color: PropTypes.string,
  }

  shouldComponentUpdate(nextProps) {
    const { locus, value } = this.props
    return nextProps.locus.selectedMOIs !== locus.selectedMOIs ||
      nextProps.value !== value
  }

  componentDidUpdate(prevProps) {
    const { locus, locusListsByGuid, onChange, color } = this.props
    const { selectedMOIs } = locus

    if (prevProps.locus.selectedMOIs !== selectedMOIs) {
      const panelAppItems = formatMergedPanelAppItems(getSelectedLocusLists(locus, locusListsByGuid), selectedMOIs)
      if (panelAppItems[color]) {
        onChange(panelAppItems[color])
      } else {
        onChange(EMPTY_STRING)
      }
    }
  }

  render() {
    const { locusListsByGuid, dispatch, ...props } = this.props
    return <BaseSemanticInput {...props} />
  }

}

const mapStateToProps = state => ({
  locusListsByGuid: getParsedLocusListsByGuid(state),
})

export default connect(mapStateToProps)(PaLocusListSelector)
