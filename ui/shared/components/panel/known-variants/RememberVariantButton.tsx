import React from 'react'
import { Button, Label } from 'semantic-ui-react'

import KnownVariantCheckForm from './KnownVariantCheckForm'

const DESCRIPTION = 'Record this variant with a verdict. Families loaded in future, in projects you can view, are ' +
  'automatically checked for it and any matches are listed on their project and family pages.'

const RememberVariantButton = ({ variantGuid }: { variantGuid: string }) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null)

  const open = () => setIsOpen(true)
  const close = () => setIsOpen(false)
  const onSuccess = (response: Record<string, unknown>) => setSavedMessage(
    response.matchingDeferred ? 'Remembered. Existing families will be checked later' : 'Remembered',
  )

  if (savedMessage) {
    return <Label basic size="small" icon="check" content={savedMessage} />
  }

  return (
    <span>
      <Button basic compact size="mini" icon="bookmark outline" content="Remember this variant" onClick={open} />
      {isOpen && (
        <KnownVariantCheckForm
          title="Remember this variant"
          description={DESCRIPTION}
          submitUrl="/api/known_variant_checks/create"
          requestParams={{ savedVariantGuid: variantGuid }}
          onSuccess={onSuccess}
          onClose={close}
        />
      )}
    </span>
  )
}

export default RememberVariantButton
