import React from 'react'
import { connect } from 'react-redux'
import { Label, Popup } from 'semantic-ui-react'

import { getIndividualsByGuid } from '../../../../redux/selectors'
import {
  getArtifactFlags, ArtifactFlag, GenotypesByIndividual, Individual, Variant,
} from '../../../utils/artifactUtils'

type DisplayIndividual = Individual & { individualId?: string }

type ArtifactFlagsProps = {
  variant: Variant & { genotypes?: GenotypesByIndividual }
  individualsByGuid?: { [individualGuid: string]: DisplayIndividual }
}

const SITE_GROUP = 'Variant'

const LIST_STYLE = { margin: '0 0 0.5em', paddingLeft: '1.5em' }

const groupFlags = (flags: ArtifactFlag[], individualsByGuid: ArtifactFlagsProps['individualsByGuid']) => (
  flags.reduce((acc, flag) => {
    const { displayName, individualId } = individualsByGuid[flag.individualGuid] || {}
    const title = flag.individualGuid ? (displayName || individualId || flag.individualGuid) : SITE_GROUP
    const group = acc.find(g => g.title === title)
    if (group) {
      group.flags.push(flag)
    } else {
      acc.push({ title, flags: [flag] })
    }
    return acc
  }, [] as { title: string, flags: ArtifactFlag[] }[])
)

const BaseArtifactFlags = React.memo(({ variant, individualsByGuid }: ArtifactFlagsProps) => {
  const flags = getArtifactFlags(variant, variant.genotypes, individualsByGuid)
  if (!flags.length) {
    return null
  }
  return (
    <Popup
      hoverable
      wide="very"
      header="This call may be a sequencing or calling error"
      trigger={<Label color="orange" size="small" horizontal icon="warning sign" content="Possible artifact" />}
      content={groupFlags(flags, individualsByGuid).map(group => (
        <div key={group.title} className="artifact-flag-group">
          <b>{group.title}</b>
          <ul style={LIST_STYLE}>
            {group.flags.map(({ code, label, detail }) => <li key={`${code}-${detail}`}>{`${label}: ${detail}`}</li>)}
          </ul>
        </div>
      ))}
    />
  )
})

const mapStateToProps = (state: object) => ({
  individualsByGuid: getIndividualsByGuid(state),
})

export default connect(mapStateToProps)(BaseArtifactFlags)
