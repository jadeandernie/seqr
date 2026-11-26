import React from 'react'
import { Icon, Label, List, Popup, SemanticCOLORS, SemanticICONS } from 'semantic-ui-react'

import { CompletenessSummary, IndividualCompleteness } from '../../../shared/utils/completeness'

type Level = { minScore: number, description: string, icon: SemanticICONS, color: SemanticCOLORS }

// Each level has its own wording and icon so that the indicator does not rely on color
const LEVELS: Level[] = [
  { minScore: 100, description: 'complete', icon: 'check circle', color: 'green' },
  { minScore: 50, description: 'partly complete', icon: 'adjust', color: 'yellow' },
  { minScore: 0, description: 'mostly missing', icon: 'warning circle', color: 'orange' },
]

const pluralize = (count: number, noun: string) => `${count} affected ${noun}${count === 1 ? '' : 's'}`

const noFeaturesSummary = (numNoFeatures: number) => (
  `${numNoFeatures} ${numNoFeatures === 1 ? 'individual has' : 'individuals have'} no HPO terms`
)

const CompletenessLabel = ({ score }: { score: number }) => {
  const { description, icon, color } = LEVELS.find(({ minScore }) => score >= minScore)
  return (
    <Label basic size="small" color={color}>
      <Icon name={icon} />
      {`Clinical data ${score}% ${description}`}
    </Label>
  )
}

export const MissingClinicalData = ({ completeness }: { completeness: IndividualCompleteness }) => (
  completeness.missing.length > 0 ? (
    <div>
      <b>Not yet recorded for this individual:</b>
      <List bulleted>
        {completeness.missing.map(({ field, label }) => <List.Item key={field}>{label}</List.Item>)}
      </List>
    </div>
  ) : <div>All of the scored clinical data is recorded for this individual</div>
)

export const IndividualCompletenessLabel = ({ completeness }: { completeness?: IndividualCompleteness | null }) => (
  completeness ? (
    <Popup
      hoverable
      trigger={<span><CompletenessLabel score={completeness.score} /></span>}
      content={<MissingClinicalData completeness={completeness} />}
    />
  ) : null
)

export const FamilyCompletenessSummary = ({ completeness }: { completeness: CompletenessSummary }) => (
  <div>
    {`Average for ${pluralize(completeness.numIndividuals, 'individual')} in this family`}
    {completeness.numNoFeatures > 0 && <div>{noFeaturesSummary(completeness.numNoFeatures)}</div>}
  </div>
)

export const FamilyCompletenessLabel = ({ completeness }: { completeness?: CompletenessSummary | null }) => (
  completeness ? (
    <Popup
      hoverable
      trigger={<span><CompletenessLabel score={completeness.score} /></span>}
      content={<FamilyCompletenessSummary completeness={completeness} />}
    />
  ) : null
)

export const ProjectCompletenessSummary = ({ completeness }: { completeness?: CompletenessSummary | null }) => (
  completeness ? (
    <div>
      {`${completeness.score}% across ${pluralize(completeness.numIndividuals, 'individual')}`}
      <div>{noFeaturesSummary(completeness.numNoFeatures)}</div>
    </div>
  ) : <div>No affected individuals</div>
)
