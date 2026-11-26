import React from 'react'
import { connect } from 'react-redux'

import { getClinvarSubmissionMode } from '../../../../redux/selectors'
import Modal from '../../modal/Modal'
import { ButtonLink } from '../../StyledComponents'
import ClinvarSubmissionPanel from './ClinvarSubmissionPanel'
import { ClinvarMode } from './constants'

type Props = { variantGuid: string, mode?: ClinvarMode | null }

export const BaseClinvarSubmissionModal = ({ variantGuid, mode }: Props) => (mode ? (
  <Modal
    title="ClinVar Submission"
    size="large"
    modalName={`clinvar-${variantGuid}`}
    trigger={<ButtonLink content="ClinVar" />}
  >
    <ClinvarSubmissionPanel variantGuid={variantGuid} mode={mode} />
  </Modal>
) : null)

const mapStateToProps = (state: unknown) => ({
  mode: getClinvarSubmissionMode(state),
})

export default connect(mapStateToProps)(BaseClinvarSubmissionModal)
