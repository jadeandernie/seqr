import React from 'react'

import Modal from '../../../../shared/components/modal/Modal'
import { ButtonLink } from '../../../../shared/components/StyledComponents'
import ImportPhenopackets from './ImportPhenopackets'

const MODAL_NAME = 'importPhenopackets'

export default React.memo(() => (
  <Modal
    modalName={MODAL_NAME}
    title="Import Clinical Data (Phenopackets)"
    size="large"
    trigger={<ButtonLink>Import clinical data (Phenopackets)</ButtonLink>}
  >
    <ImportPhenopackets />
  </Modal>
))
