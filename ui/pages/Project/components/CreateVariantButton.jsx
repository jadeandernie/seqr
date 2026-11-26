import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { Grid, Divider, Accordion } from 'semantic-ui-react'

import {
  getUser, getSortedIndividualsByFamily, getGenesById, getFamiliesByGuid, getProjectsByGuid,
} from 'redux/selectors'

import UpdateButton from 'shared/components/buttons/UpdateButton'
import { Select, IntegerInput, LargeMultiselect } from 'shared/components/form/Inputs'
import { validators, configuredField } from 'shared/components/form/FormHelpers'
import { AwesomeBarFormInput } from 'shared/components/page/AwesomeBar'
import { SV_TYPES } from 'shared/utils/constants'

import { TAG_FORM_FIELD } from '../constants'
import { createManualVariant, updateManualVariant } from '../reducers'
import { getTaggedVariantsByFamilyType, getProjectTagTypeOptions, getCurrentProject } from '../selectors'
import SelectSavedVariantsTable, { VARIANT_POS_COLUMN, TAG_COLUMN, GENES_COLUMN } from './SelectSavedVariantsTable'

const CHROMOSOMES = [...Array(23).keys(), 'X', 'Y', 'M'].map(val => val.toString()).splice(1)
const ZYGOSITY_OPTIONS = [{ value: 0, name: 'Hom Ref' }, { value: 1, name: 'Het' }, { value: 2, name: 'Hom Alt' }]

const SV_FIELD_NAME = 'svName'
const GENE_ID_FIELD_NAME = 'geneId'
const TRANSCRIPT_ID_FIELD_NAME = 'mainTranscriptId'
const HGVSC_FIELD_NAME = 'hgvsc'
const HGVSP_FIELD_NAME = 'hgvsp'
const VARIANTS_FIELD_NAME = 'variants'

const ZygosityInput = React.memo(({ individuals, name, title, individualField, error }) => (
  <div>
    <Divider horizontal>{title}</Divider>
    <Grid columns="equal">
      {individuals.map((({ individualGuid, displayName }) => (
        <Grid.Column key={individualGuid}>
          {configuredField({
            name: `${name}.${individualGuid}`,
            label: displayName,
            error,
            ...individualField,
          })}
        </Grid.Column>
      )))}
    </Grid>
  </div>
))

ZygosityInput.propTypes = {
  individuals: PropTypes.arrayOf(PropTypes.object),
  name: PropTypes.string,
  title: PropTypes.string,
  error: PropTypes.bool,
  individualField: PropTypes.object,
}

const mapZygosityInputStateToProps = (state, ownProps) => ({
  individuals: getSortedIndividualsByFamily(state)[ownProps.meta.data.formId],
})

const mapTagInputStateToProps = state => ({
  options: getProjectTagTypeOptions(state),
})

const accordionPanels = ({ accordionLabel, dispatch, showSVs, ...props }) => ([{
  key: 'mnv',
  title: accordionLabel,
  content: { content: <SelectSavedVariantsTable {...props} /> },
}])

const SavedVariantToggle = props => <Accordion styled fluid panels={accordionPanels(props)} />

const mapSavedVariantsStateToProps = (state, ownProps) => {
  const familyGuid = ownProps.meta.data.formId
  return {
    data: (getTaggedVariantsByFamilyType(state)[familyGuid] || {})[ownProps.showSVs || false],
    familyGuid,
  }
}

const SavedVariantField = connect(mapSavedVariantsStateToProps)(SavedVariantToggle)

const SAVED_VARIANT_COLUMNS = [
  GENES_COLUMN,
  VARIANT_POS_COLUMN,
  TAG_COLUMN,
]
const SAVED_SV_COLUMNS = [{ name: 'svType', content: 'SV Type', width: 2 }, ...SAVED_VARIANT_COLUMNS]

const ZYGOSITY_FIELD = {
  name: 'genotypes',
  component: connect(mapZygosityInputStateToProps)(ZygosityInput),
}

const TAG_FIELD = {
  component: connect(mapTagInputStateToProps)(LargeMultiselect),
  ...TAG_FORM_FIELD,
}

const CHROM_FIELD = {
  name: 'chrom',
  label: 'Chrom',
  component: Select,
  options: CHROMOSOMES.map(value => ({ value })),
  validate: validators.required,
  width: 2,
}

const POS_FIELD = {
  validate: validators.required, component: IntegerInput, width: 7, min: 0,
}
const START_FIELD = { name: 'pos', label: 'Start Position', ...POS_FIELD }
const END_FIELD = { name: 'end', label: 'Stop Position', ...POS_FIELD }

const GENE_FIELD = {
  name: GENE_ID_FIELD_NAME,
  label: 'Gene',
  control: AwesomeBarFormInput,
  categories: ['genes'],
  fluid: true,
  placeholder: 'Search for gene',
}

const SAVED_VARIANT_FIELD = {
  name: VARIANTS_FIELD_NAME,
  idField: 'variantGuid',
  control: SavedVariantField,
}

const validateHasTranscriptId = (value, allValues, props, name) => {
  if (!value) {
    return undefined
  }
  return allValues[TRANSCRIPT_ID_FIELD_NAME] ? undefined : `Transcript ID is required to include ${name}`
}

const formatField = (field) => {
  const formattedField = { inline: true, width: 16, ...field }
  if (field.validate && field.validate !== validateHasTranscriptId) {
    formattedField.label = `${field.label}*`
  }
  return formattedField
}

const SNV_FIELDS = [
  CHROM_FIELD,
  START_FIELD,
  { ...END_FIELD, validate: null },
  { name: 'ref', label: 'Ref', validate: validators.required, width: 4 },
  { name: 'alt', label: 'Alt', validate: validators.required, width: 4 },
  { ...GENE_FIELD, width: 8, validate: validators.required },
  { name: TRANSCRIPT_ID_FIELD_NAME, label: 'Transcript ID', width: 6 },
  { name: HGVSC_FIELD_NAME, label: 'HGVSC', width: 5, validate: validateHasTranscriptId },
  { name: HGVSP_FIELD_NAME, label: 'HGVSP', width: 5, validate: validateHasTranscriptId },
  TAG_FIELD,
  { accordionLabel: 'Multinucleotide Variant', columns: SAVED_VARIANT_COLUMNS, ...SAVED_VARIANT_FIELD },
  {
    ...ZYGOSITY_FIELD,
    title: 'Zygosity',
    individualField: {
      options: ZYGOSITY_OPTIONS,
      component: Select,
      parse: numAlt => ({ numAlt }),
      format: value => (value || {}).numAlt,
    },
  },
].map(formatField)

const SV_FIELDS = [
  CHROM_FIELD,
  START_FIELD,
  END_FIELD,
  GENE_FIELD,
  TAG_FIELD,
  { name: SV_FIELD_NAME, validate: validators.required, label: 'SV Name', width: 8 },
  {
    name: 'svType',
    label: 'SV Type',
    component: Select,
    options: SV_TYPES,
    validate: validators.required,
    width: 8,
  },
  { accordionLabel: 'Associated SVs', columns: SAVED_SV_COLUMNS, showSVs: true, ...SAVED_VARIANT_FIELD },
  {
    ...ZYGOSITY_FIELD,
    title: 'Copy Number',
    validate: validators.required,
    individualField: {
      component: IntegerInput,
      parse: cn => ({ cn }),
      format: value => (value || {}).cn,
      min: 0,
      max: 12,
    },
  },
].map(formatField)

const BaseCreateVariantButton = React.memo(({ variantType, family, user, project, ...props }) => (
  (project.isAnalystProject ? user.isAnalyst : project.canEdit) ? (
    <UpdateButton
      key={`manual${variantType}`}
      modalTitle={`Add a Manual ${variantType} for Family ${family.displayName}`}
      modalId={`${family.familyGuid}-addVariant-${variantType || 'SNV'}`}
      formMetaId={family.familyGuid}
      modalSize="large"
      buttonText={`Add Manual ${variantType}`}
      editIconName="plus"
      showErrorPanel
      {...props}
    />
  ) : null
))

BaseCreateVariantButton.propTypes = {
  variantType: PropTypes.string,
  family: PropTypes.object,
  user: PropTypes.object,
  project: PropTypes.object,
  formFields: PropTypes.arrayOf(PropTypes.object),
  onSubmit: PropTypes.func,
}

const mapStateToProps = state => ({
  user: getUser(state),
  project: getCurrentProject(state),
})

const mapDispatchToProps = (dispatch, ownProps) => ({
  onSubmit: values => dispatch(createManualVariant(ownProps.family.familyGuid, values)),
})

const CreateVariantButton = connect(mapStateToProps, mapDispatchToProps)(BaseCreateVariantButton)

const CreateVariantButtons = React.memo(({ family }) => ([
  <CreateVariantButton key="SNV" family={family} variantType="Variant" formFields={SNV_FIELDS} />,
  <CreateVariantButton key="SV" family={family} variantType="SV" formFields={SV_FIELDS} />,
]))

CreateVariantButtons.propTypes = {
  family: PropTypes.object,
}

const mapEditGeneInputStateToProps = (state, ownProps) => (
  ownProps.value ? {
    placeholder: `${getGenesById(state)[ownProps.value]?.geneSymbol || ownProps.value} (search to change)`,
  } : {}
)

const EditGeneInput = connect(mapEditGeneInputStateToProps)(AwesomeBarFormInput)

const NON_EDITABLE_FIELDS = new Set([TAG_FORM_FIELD.name, VARIANTS_FIELD_NAME])

const getEditFields = fields => fields.filter(({ name }) => !NON_EDITABLE_FIELDS.has(name)).map(
  field => (field.name === GENE_ID_FIELD_NAME ? { ...field, control: EditGeneInput } : field),
)

const EDIT_SNV_FIELDS = getEditFields(SNV_FIELDS)
const EDIT_SV_FIELDS = getEditFields(SV_FIELDS)

const getEditInitialValues = ({
  chrom, pos, end, ref, alt, svType, genotypes, geneIds, mainTranscriptId, transcripts, variantId,
}) => {
  const mainTranscript = mainTranscriptId && Object.values(transcripts || {}).flat().find(
    ({ transcriptId }) => transcriptId === mainTranscriptId,
  )
  return {
    chrom,
    pos,
    end,
    ref,
    alt,
    svType,
    genotypes,
    [GENE_ID_FIELD_NAME]: mainTranscript?.geneId || (geneIds || [])[0],
    [TRANSCRIPT_ID_FIELD_NAME]: mainTranscriptId,
    [HGVSC_FIELD_NAME]: mainTranscript?.hgvsc,
    [HGVSP_FIELD_NAME]: mainTranscript?.hgvsp,
    [SV_FIELD_NAME]: svType ? variantId : undefined,
  }
}

const BaseEditManualVariantButton = React.memo(({ variant, family, project, onSubmit }) => {
  const initialValues = React.useMemo(() => getEditInitialValues(variant), [variant])
  if (!family || !project?.canEdit) {
    return null
  }
  const variantType = variant.svType ? 'SV' : 'Variant'
  return (
    <UpdateButton
      modalTitle={`Edit Manual ${variantType} for Family ${family.displayName}`}
      modalId={`${variant.variantGuid}-editVariant`}
      formMetaId={family.familyGuid}
      modalSize="large"
      buttonText={`Edit Manual ${variantType}`}
      initialValues={initialValues}
      formFields={variant.svType ? EDIT_SV_FIELDS : EDIT_SNV_FIELDS}
      onSubmit={onSubmit}
      showErrorPanel
    />
  )
})

BaseEditManualVariantButton.propTypes = {
  variant: PropTypes.object.isRequired,
  family: PropTypes.object,
  project: PropTypes.object,
  onSubmit: PropTypes.func,
}

const mapEditStateToProps = (state, ownProps) => {
  const family = getFamiliesByGuid(state)[ownProps.variant.familyGuids[0]]
  return {
    family,
    project: getProjectsByGuid(state)[family?.projectGuid],
  }
}

const mapEditDispatchToProps = (dispatch, ownProps) => ({
  onSubmit: values => dispatch(
    updateManualVariant(ownProps.variant.familyGuids[0], ownProps.variant.variantGuid, values),
  ),
})

export const EditManualVariantButton = connect(
  mapEditStateToProps, mapEditDispatchToProps,
)(BaseEditManualVariantButton)

export default CreateVariantButtons
