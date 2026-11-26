import React from 'react'
import { Label } from 'semantic-ui-react'

import { VERDICT_OPTIONS, getPubmedUrl, getClinvarUrl } from '../../../utils/knownVariantUtils'

export const VerdictLabel = ({ verdict }: { verdict: string }) => {
  const option = VERDICT_OPTIONS.find(({ value }) => value === verdict)
  return <Label size="small" horizontal color={option ? option.color : 'grey'} content={option ? option.text : verdict} />
}

type ReferenceLinksProps = {
  pubmedId?: string | null
  clinvarAccession?: string | null
}

export const ReferenceLinks = ({ pubmedId, clinvarAccession }: ReferenceLinksProps) => {
  const pubmedUrl = getPubmedUrl(pubmedId)
  const clinvarUrl = getClinvarUrl(clinvarAccession)
  return (
    <span>
      {pubmedUrl && <a href={pubmedUrl} target="_blank" rel="noopener noreferrer">{`PMID ${pubmedId}`}</a>}
      {pubmedUrl && clinvarUrl && ', '}
      {clinvarUrl && <a href={clinvarUrl} target="_blank" rel="noopener noreferrer">{`ClinVar ${clinvarAccession}`}</a>}
    </span>
  )
}
