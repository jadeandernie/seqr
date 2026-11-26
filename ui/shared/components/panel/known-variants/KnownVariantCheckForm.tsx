import React from 'react'
import { Button, Form, Message, Modal } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../utils/httpRequestHelper'
import {
  CheckFormValues,
  VERDICT_OPTIONS,
  KNOWN_VARIANT_GENOME_VERSION_OPTIONS,
  KNOWN_VARIANT_DATASET_TYPE_OPTIONS,
  getRequestErrors,
} from '../../../utils/knownVariantUtils'

type Props = {
  title: string
  description?: string
  submitUrl: string
  initialValues?: CheckFormValues
  requestParams?: Record<string, unknown>
  showVariantFields?: boolean
  showGlobal?: boolean
  onSuccess: (response: Record<string, unknown>) => void
  onClose: () => void
}

const DEFAULT_VARIANT_VALUES = { genomeVersion: '38', datasetType: 'SNV_INDEL', variantId: '' }

const KnownVariantCheckForm = (
  { title, description, submitUrl, initialValues, requestParams, showVariantFields, showGlobal, onSuccess, onClose }: Props,
) => {
  const [values, setValues] = React.useState<CheckFormValues>({
    ...(showVariantFields ? DEFAULT_VARIANT_VALUES : {}), ...(initialValues || {}),
  })
  const [errors, setErrors] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  const setValue = (field: keyof CheckFormValues) => (
    e: unknown, data: { value?: unknown, checked?: boolean },
  ) => setValues(prevValues => ({ ...prevValues, [field]: field === 'isGlobal' ? data.checked : data.value }))

  const submit = () => {
    if (!values.verdict) {
      setErrors(['Verdict is required'])
      return null
    }
    setSubmitting(true)
    return new HttpRequestHelper(
      submitUrl,
      (response: Record<string, unknown>) => {
        onSuccess(response)
        onClose()
      },
      (exception: unknown) => {
        setSubmitting(false)
        setErrors(getRequestErrors(exception))
      },
    ).post({ ...requestParams, ...values })
  }

  return (
    <Modal open size="small" onClose={onClose} closeIcon>
      <Modal.Header content={title} />
      <Modal.Content>
        {description && <p>{description}</p>}
        <Form error={errors.length > 0} loading={submitting}>
          {showVariantFields && (
            <Form.Group widths="equal">
              <Form.Select
                name="genomeVersion"
                label="Genome Version"
                options={KNOWN_VARIANT_GENOME_VERSION_OPTIONS}
                value={values.genomeVersion}
                onChange={setValue('genomeVersion')}
              />
              <Form.Select
                name="datasetType"
                label="Variant Type"
                options={KNOWN_VARIANT_DATASET_TYPE_OPTIONS}
                value={values.datasetType}
                onChange={setValue('datasetType')}
              />
              <Form.Input
                name="variantId"
                label="Variant ID"
                placeholder="1-248367227-TC-T"
                value={values.variantId}
                onChange={setValue('variantId')}
              />
            </Form.Group>
          )}
          <Form.Select
            name="verdict"
            label="Verdict"
            placeholder="Select a verdict"
            options={VERDICT_OPTIONS.map(({ value, text }) => ({ value, text }))}
            value={values.verdict}
            onChange={setValue('verdict')}
          />
          <Form.Group widths="equal">
            <Form.Input
              name="pubmedId"
              label="PubMed ID (optional)"
              placeholder="12345678"
              value={values.pubmedId || ''}
              onChange={setValue('pubmedId')}
            />
            <Form.Input
              name="clinvarAccession"
              label="ClinVar Accession (optional)"
              placeholder="VCV000012345"
              value={values.clinvarAccession || ''}
              onChange={setValue('clinvarAccession')}
            />
          </Form.Group>
          {showGlobal && (
            <Form.Checkbox
              name="isGlobal"
              label="Check families in all projects, including projects the person who recorded this variant can not view"
              checked={!!values.isGlobal}
              onChange={setValue('isGlobal')}
            />
          )}
          <Message error list={errors} />
        </Form>
      </Modal.Content>
      <Modal.Actions>
        <Button content="Cancel" onClick={onClose} />
        <Button primary content="Save" disabled={submitting} onClick={submit} />
      </Modal.Actions>
    </Modal>
  )
}

export default KnownVariantCheckForm
