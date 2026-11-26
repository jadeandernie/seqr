import React from 'react'
import PropTypes from 'prop-types'
import { Confirm } from 'semantic-ui-react'

import RequestStatus, { NONE, SUCCEEDED, ERROR, IN_PROGRESS } from '../panel/RequestStatus'
import { ButtonLink } from '../StyledComponents'

class DispatchRequestButton extends React.PureComponent {

  static propTypes = {

    /** React component to show if no children */
    buttonContent: PropTypes.node,

    /** Callback to dispatch on submit */
    onSubmit: PropTypes.func.isRequired,

    /** Optional confirm dialog to show before submitting the request */
    confirmDialog: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),

    /** Optional callback to compute the confirm dialog content when it is shown, used instead of confirmDialog */
    getConfirmDialog: PropTypes.func,

    /** child componenets */
    children: PropTypes.node,

    buttonContainer: PropTypes.node,

    /** Optional callback when request succeeds */
    onSuccess: PropTypes.func,

    hideNoRequestStatus: PropTypes.bool,
  }

  state = {
    requestStatus: NONE,
    requestErrorMessage: null,
    isConfirmDialogVisible: false,
  }

  handleButtonClick = (event) => {
    const { confirmDialog, getConfirmDialog } = this.props
    event.preventDefault()
    if (confirmDialog || getConfirmDialog) {
      this.setState({ isConfirmDialogVisible: true })
    } else {
      this.performAction()
    }
  }

  performAction = () => {
    this.setState({ isConfirmDialogVisible: false, requestStatus: IN_PROGRESS })

    const { onSubmit } = this.props
    const dispatch = onSubmit()
    dispatch.onClear = this.handleReset
    dispatch.then(
      this.handleRequestSuccess,
      this.handleRequestError,
    )
  }

  handleRequestSuccess = () => {
    const { onSuccess } = this.props
    this.setState({ requestStatus: SUCCEEDED })
    if (onSuccess) {
      onSuccess()
    }
  }

  handleRequestError = (error) => {
    const { requestStatus } = this.state
    if (requestStatus !== NONE) {
      this.setState({
        requestStatus: ERROR,
        requestErrorMessage: (
          (error.errors || {})._error || [] // eslint-disable-line no-underscore-dangle
        )[0] || error.message,
      })
    }
  }

  handleReset = () => {
    this.setState({ requestStatus: NONE, requestErrorMessage: null })
  }

  hideConfirmDialog = () => {
    this.setState({ isConfirmDialogVisible: false })
  }

  render() {
    const {
      buttonContainer, buttonContent, confirmDialog, getConfirmDialog, children, onSuccess, onSubmit,
      hideNoRequestStatus, ...props
    } = this.props
    const { requestStatus, requestErrorMessage, isConfirmDialogVisible } = this.state
    return React.cloneElement(buttonContainer || <span />, {
      children: [
        children ?
          React.cloneElement(children, { onClick: this.handleButtonClick, key: 'button' }) :
          <ButtonLink key="button" onClick={this.handleButtonClick} content={buttonContent} {...props} />,
        (!hideNoRequestStatus || requestStatus !== NONE) ? (
          <RequestStatus
            key="status"
            status={requestStatus}
            errorMessage={requestErrorMessage}
          />
        ) : null,
        <Confirm
          key="confirm"
          content={(getConfirmDialog && isConfirmDialogVisible) ? getConfirmDialog() : confirmDialog}
          open={isConfirmDialogVisible}
          onConfirm={this.performAction}
          onCancel={this.hideConfirmDialog}
        />,
      ],
    })
  }

}

export default DispatchRequestButton
