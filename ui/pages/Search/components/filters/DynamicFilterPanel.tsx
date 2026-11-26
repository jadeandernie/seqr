import React from 'react'
import { connect } from 'react-redux'
import { createSelector } from 'reselect'
import { useForm } from 'react-final-form'
import { Form, Grid, Header } from 'semantic-ui-react'

import { getProjectsByGuid } from '../../../../redux/selectors'
import { ButtonLink } from '../../../../shared/components/StyledComponents'
import { configuredField } from '../../../../shared/components/form/FormHelpers'
import { Select, BooleanCheckbox } from '../../../../shared/components/form/Inputs'
import { ORDERED_PREDICTOR_FIELDS, FREQUENCIES } from '../../../../shared/utils/constants'

import { getDatasetTypes, getSearchFilterSchema } from '../../selectors'
import { QUALITY_FILTER_FIELDS } from '../VariantSearchFormPanelConfigs'

export const DYNAMIC_FILTER_NAME = 'dynamic'

type FilterGroup = 'in_silico' | 'frequency' | 'quality'
type FilterValue = number | string | boolean

export interface FilterSchemaField {
  key: string
  group: FilterGroup
  kind: 'min' | 'max' | 'enum' | 'bool'
  scope: 'variant' | 'call'
  label: string
  help?: string | null
  integer?: boolean
  min?: number | null
  max?: number | null
  step?: number | null
  options?: { value: string, text: string }[]
  datasetTypes: string[]
  legacyPath: string[]
}

export type FilterSchema = Record<string, FilterSchemaField[]>
export type DynamicFilters = Partial<Record<FilterGroup, Record<string, FilterValue | null>>>

interface ProjectFamilies { projectGuid: string }
interface SelectorProps { projectFamilies?: ProjectFamilies[] }

const GROUPS: { name: FilterGroup, title: string }[] = [
  { name: 'in_silico', title: 'In Silico' },
  { name: 'frequency', title: 'Frequency' },
  { name: 'quality', title: 'Call Quality' },
]

const KIND_DISPLAY: Record<FilterSchemaField['kind'], { symbol: string, help?: string }> = {
  min: { symbol: '>=', help: 'Variants with a value greater than or equal to the entered value are returned' },
  max: { symbol: '<=', help: 'Variants with a value less than or equal to the entered value are returned' },
  enum: { symbol: '=' },
  bool: { symbol: '' },
}

type FrequencyConfig = { name: string, skipAf?: boolean, homHemi?: boolean }

// The filters the hard-coded In Silico, Frequency and Call Quality panels already offer, as filter schema keys
export const LEGACY_FILTER_KEYS: Record<FilterGroup, string[]> = {
  in_silico: (ORDERED_PREDICTOR_FIELDS as { field: string, displayOnly?: boolean }[]).filter(
    ({ displayOnly }) => !displayOnly,
  ).map(({ field }) => field),
  frequency: (FREQUENCIES as FrequencyConfig[]).reduce((acc, { name, skipAf, homHemi }) => [
    ...acc, ...(skipAf ? [] : [`${name}_af`]), `${name}_ac`, ...(homHemi ? [`${name}_hh`] : []),
  ], [] as string[]),
  quality: (QUALITY_FILTER_FIELDS as { name: string }[]).map(({ name }) => name),
}

export const getAdditionalFilterFields = (
  schema: FilterSchema | null | undefined, datasetTypes: string[], genomeVersions: string[],
): FilterSchemaField[] => {
  const schemaVersions = genomeVersions.filter(version => (schema || {})[version])
  const versions = schemaVersions.length ? schemaVersions : Object.keys(schema || {}).sort()
  const seen = new Set<string>()
  return versions.reduce((acc, version) => [...acc, ...schema[version]], [] as FilterSchemaField[]).filter((field) => {
    const id = `${field.group}.${field.key}`
    if (seen.has(id) || !KIND_DISPLAY[field.kind] || (LEGACY_FILTER_KEYS[field.group] || []).includes(field.key) || (
      datasetTypes.length && !field.datasetTypes.some(datasetType => datasetTypes.includes(datasetType)))) {
      return false
    }
    seen.add(id)
    return true
  })
}

const hasValue = (value: FilterValue | null | undefined) => (
  value !== null && value !== undefined && value !== '' && value !== false
)

export const getDynamicFilterSummary = (
  dynamic: DynamicFilters | null | undefined, schema: FilterSchema | null | undefined,
): string => {
  const fieldsByGroupKey = Object.values(schema || {}).reduce((acc, fields) => fields.reduce(
    (fieldAcc, field) => ({ ...fieldAcc, [`${field.group}.${field.key}`]: field }), acc,
  ), {} as Record<string, FilterSchemaField>)
  return GROUPS.reduce((acc, { name }) => [
    ...acc,
    ...Object.entries((dynamic || {})[name] || {}).filter(([, value]) => hasValue(value)).map(([key, value]) => {
      const field = fieldsByGroupKey[`${name}.${key}`]
      if (!field) {
        return `${key} = ${value}`
      }
      if (field.kind === 'bool') {
        return field.label
      }
      const option = (field.options || []).find(opt => opt.value === value)
      return `${field.label} ${KIND_DISPLAY[field.kind].symbol} ${option ? option.text : value}`
    }),
  ], [] as string[]).join('; ')
}

const getGenomeVersions = createSelector(
  (state: unknown, props: SelectorProps) => props.projectFamilies,
  getProjectsByGuid,
  (projectFamilies, projectsByGuid: Record<string, { genomeVersion?: string }>) => [...new Set(
    (projectFamilies || []).map(({ projectGuid }) => (projectsByGuid[projectGuid] || {}).genomeVersion),
  )].filter(version => version).sort().join(','),
)

export const getSearchAdditionalFilterFields = createSelector(
  getSearchFilterSchema,
  getDatasetTypes,
  getGenomeVersions,
  (schema: FilterSchema | null, datasetTypes: string, genomeVersions: string) => getAdditionalFilterFields(
    schema, datasetTypes ? datasetTypes.split(',') : [], genomeVersions ? genomeVersions.split(',') : [],
  ),
)

const parseNumber = (value: string | number | null | undefined) => (
  value === '' || value === null || value === undefined || Number.isNaN(Number(value)) ? undefined : Number(value)
)
const formatInput = (value: FilterValue | null | undefined) => (value === null || value === undefined ? '' : value)
const parseOptional = (value: FilterValue | null | undefined) => value || undefined

const labelHelp = ({ help, kind, scope, label }: FilterSchemaField) => [
  help || label,
  KIND_DISPLAY[kind].help,
  scope === 'call' && 'Applied to the genotype call of every individual',
].filter(text => text).join('. ')

const fieldConfig = (field: FilterSchemaField) => {
  const config = {
    name: `search.${DYNAMIC_FILTER_NAME}.${field.group}.${field.key}`,
    label: field.label,
    labelHelp: labelHelp(field),
  }
  if (field.kind === 'enum') {
    return {
      ...config, component: Select, options: [{ text: '', value: null }, ...field.options], parse: parseOptional,
    }
  }
  if (field.kind === 'bool') {
    return { ...config, component: BooleanCheckbox, parse: parseOptional }
  }
  return {
    ...config,
    control: Form.Input,
    type: 'number',
    min: field.min === null ? undefined : field.min,
    max: field.max === null ? undefined : field.max,
    step: field.step || (field.integer ? 1 : 'any'),
    parse: parseNumber,
    format: formatInput,
  }
}

interface DynamicFilterPanelProps {
  fields: FilterSchemaField[]
}

const DynamicFilterPanel = ({ fields }: DynamicFilterPanelProps) => {
  const form = useForm()
  const clear = React.useCallback(() => form.change(`search.${DYNAMIC_FILTER_NAME}`, undefined), [form])
  return (
    <div>
      <i>
        Filters that the search supports for the loaded data and that are not part of the panels above. These are
        applied together with the In Silico, Frequency and Call Quality filters. &nbsp;
        <ButtonLink onClick={clear} content="Clear additional filters" />
      </i>
      <Form.Field>
        {fields.length ? (
          <Grid divided="vertically">
            {GROUPS.filter(({ name }) => fields.some(field => field.group === name)).map(({ name, title }) => (
              <Grid.Row key={name}>
                <Grid.Column width={2} verticalAlign="middle"><Header size="small" content={title} /></Grid.Column>
                <Grid.Column width={14}>
                  <Grid>
                    <Grid.Row>
                      {fields.filter(field => field.group === name).map(field => (
                        <Grid.Column key={field.key} width={4}>{configuredField(fieldConfig(field))}</Grid.Column>
                      ))}
                    </Grid.Row>
                  </Grid>
                </Grid.Column>
              </Grid.Row>
            ))}
          </Grid>
        ) : <Header size="small" content="No additional filters are available for the selected data" />}
      </Form.Field>
    </div>
  )
}

export default DynamicFilterPanel

interface SummaryProps {
  value?: DynamicFilters
  schema?: FilterSchema | null
}

const BaseDynamicFilterSummary = ({ value, schema }: SummaryProps) => (
  <span>{getDynamicFilterSummary(value, schema) || 'None'}</span>
)

const mapSummaryStateToProps = (state: unknown) => ({
  schema: getSearchFilterSchema(state),
})

export const DynamicFilterSummary = connect(mapSummaryStateToProps)(BaseDynamicFilterSummary)
