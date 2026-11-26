export type CompletenessItem = { field: string, label: string, weight: number, level: string }

export type IndividualCompleteness = { score: number, missing: CompletenessItem[] }

export type CompletenessSummary = { score: number, numIndividuals: number, numNoFeatures: number }

type Individual = { completeness?: IndividualCompleteness | null }

type Family = {
  familyGuid?: string,
  individualGuids?: string[],
  individuals?: (Individual | undefined)[],
  completeness?: CompletenessSummary | null,
  [field: string]: unknown,
}

type IndividualsByGuid = { [guid: string]: Individual | undefined }

type CompletenessFilter = (family: Family) => boolean

const FEATURES_FIELD = 'features'
const FAMILY_COMPLETENESS_FIELDS = ['codedPhenotype', 'mondoId']
const UNSCORED_SORT_KEY = 'unscored'

const summarize = (summaries: CompletenessSummary[]): CompletenessSummary | null => {
  if (!summaries.length) {
    return null
  }
  const numIndividuals = summaries.reduce((acc, summary) => acc + summary.numIndividuals, 0)
  const totalScore = summaries.reduce((acc, summary) => acc + (summary.score * summary.numIndividuals), 0)
  return {
    score: Math.round(totalScore / numIndividuals),
    numIndividuals,
    numNoFeatures: summaries.reduce((acc, summary) => acc + summary.numNoFeatures, 0),
  }
}

// Scores from loaded individuals reflect edits made since the family was loaded, so they take precedence
export const getFamilyCompleteness = (
  family: Family, individuals: (Individual | undefined)[] = [],
): CompletenessSummary | null => {
  if (!individuals.length || individuals.some(individual => !individual)) {
    return family.completeness || null
  }
  return summarize(individuals.map(individual => individual.completeness).filter(completeness => completeness).map(
    ({ score, missing }) => ({
      score,
      numIndividuals: 1,
      numNoFeatures: missing.some(({ field }) => field === FEATURES_FIELD) ? 1 : 0,
    }),
  ))
}

const getFamilyIndividuals = (family: Family, individualsByGuid: IndividualsByGuid) => (
  (family.individualGuids || []).map(individualGuid => individualsByGuid[individualGuid])
)

export const getCompletenessByFamily = (
  familiesByGuid: { [guid: string]: Family }, individualsByGuid: IndividualsByGuid,
): { [guid: string]: CompletenessSummary | null } => Object.entries(familiesByGuid).reduce(
  (acc, [familyGuid, family]) => ({
    ...acc, [familyGuid]: getFamilyCompleteness(family, getFamilyIndividuals(family, individualsByGuid)),
  }), {},
)

export const getProjectCompleteness = (
  families: Family[], individualsByGuid: IndividualsByGuid,
): CompletenessSummary | null => summarize(families.map(
  family => getFamilyCompleteness(family, getFamilyIndividuals(family, individualsByGuid)),
).filter(completeness => completeness))

// Families with no affected individuals sort after every scored family
export const createCompletenessSortKeyGetter = (individualsByGuid: IndividualsByGuid) => (family: Family): string => {
  const completeness = getFamilyCompleteness(family, getFamilyIndividuals(family, individualsByGuid))
  return completeness ? String(completeness.score).padStart(3, '0') : UNSCORED_SORT_KEY
}

const createCompletenessFilter = (
  passes: (completeness: CompletenessSummary) => boolean,
): CompletenessFilter => (family) => {
  const completeness = getFamilyCompleteness(family, family.individuals)
  return !!completeness && passes(completeness)
}

export const COMPLETENESS_FAMILY_FILTERS = [
  {
    value: 'SHOW_CLINICAL_DATA_COMPLETE',
    name: 'Fully Complete',
    createFilter: createCompletenessFilter(({ score }) => score === 100),
  },
  {
    value: 'SHOW_CLINICAL_DATA_INCOMPLETE',
    name: 'Incomplete',
    createFilter: createCompletenessFilter(({ score }) => score < 100),
  },
  {
    value: 'SHOW_CLINICAL_DATA_UNDER_HALF',
    name: 'Less Than 50% Complete',
    createFilter: createCompletenessFilter(({ score }) => score < 50),
  },
  {
    value: 'SHOW_CLINICAL_DATA_NO_FEATURES',
    name: 'Affected Individuals Without HPO Terms',
    createFilter: createCompletenessFilter(({ numNoFeatures }) => numNoFeatures > 0),
  },
].map(filter => ({ ...filter, category: 'Clinical Data Completeness' }))

export const hasFamilyCompletenessUpdate = (family: Family, updatedFamily: Family): boolean => (
  FAMILY_COMPLETENESS_FIELDS.some(
    field => field in updatedFamily && (updatedFamily[field] || null) !== (family[field] || null),
  )
)
