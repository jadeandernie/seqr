import React, { useState } from 'react'
import { connect } from 'react-redux'
import { Button, Message } from 'semantic-ui-react'

import FormWrapper from '../../../../shared/components/form/FormWrapper'
import Modal from '../../../../shared/components/modal/Modal'
import { ButtonLink } from '../../../../shared/components/StyledComponents'
import AutomaticHpoImport, { ImportIndividual } from './AutomaticHpoImport'

const MANUAL = 'manual'
const AUTOMATIC = 'automatic'

const MODES = [
  { mode: MANUAL, content: 'Manual import', icon: 'write' },
  { mode: AUTOMATIC, content: 'Automatic import', icon: 'magic' },
]

interface HpoImportProps {
  modalId: string
  initialValues: ImportIndividual
  formFields: Record<string, unknown>[]
  onSubmit: (values: Record<string, unknown>) => Promise<unknown>
  formContainer?: React.ReactElement
  formMetaId?: string
  showErrorPanel?: boolean
  hasUnsavedChanges?: boolean
}

// Manual import is the existing HPO term editor. Automatic import proposes terms from pasted clinical notes.
const BaseHpoImportModes = ({
  modalId, initialValues, formFields, onSubmit, formContainer = <div />, formMetaId, showErrorPanel, hasUnsavedChanges,
}: HpoImportProps) => {
  const [mode, setMode] = useState(MANUAL)
  return (
    <div>
      <Button.Group size="small" widths="2">
        {MODES.map(({ mode: buttonMode, content, icon }) => (
          <Button
            key={buttonMode}
            type="button"
            className={`hpo-import-mode-${buttonMode}`}
            icon={icon}
            content={content}
            primary={mode === buttonMode}
            active={mode === buttonMode}
            disabled={mode !== buttonMode && hasUnsavedChanges}
            onClick={() => setMode(buttonMode)}
          />
        ))}
      </Button.Group>
      {hasUnsavedChanges && (
        <Message size="tiny" content="Save or discard your changes before switching between manual and automatic import." />
      )}
      {mode === MANUAL ? React.cloneElement(formContainer, {
        children: (
          <FormWrapper
            onSubmit={onSubmit}
            modalName={modalId}
            initialValues={initialValues}
            fields={formFields}
            showErrorPanel={showErrorPanel}
            formMetaId={formMetaId}
            confirmCloseIfNotSaved
          />
        ),
      }) : <AutomaticHpoImport individual={initialValues} modalName={modalId} />}
    </div>
  )
}

interface ModalState {
  modal: Record<string, { confirmOnClose?: string | null }>
}

// Both the manual form and the automatic import register a confirmation message while they hold unsaved changes
const mapStateToProps = (state: ModalState, ownProps: HpoImportProps) => ({
  hasUnsavedChanges: !!(state.modal[ownProps.modalId] || {}).confirmOnClose,
})

export const HpoImportModes = connect(mapStateToProps)(BaseHpoImportModes)

interface HpoImportButtonProps extends HpoImportProps {
  modalTitle?: string
  modalSize?: string
  size?: string
}

const HpoImportButton = React.memo(({ modalTitle, modalSize, size, ...props }: HpoImportButtonProps) => (
  <Modal
    title={modalTitle}
    modalName={props.modalId}
    size={modalSize}
    trigger={<ButtonLink icon="write" size={size} />}
  >
    <HpoImportModes {...props} />
  </Modal>
))

export default HpoImportButton
