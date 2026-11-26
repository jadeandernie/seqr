import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import { mockFetchResponse, flushAll, getLastFetchUrl, getLastFetchBody, getLastFetchOptions } from 'shared/utils/testHelpers'
import ClinvarSubmissionPanel from './ClinvarSubmissionPanel'
import { DRAFT_RESPONSE, DRAFT_SUBMISSION, PAYLOAD } from './fixtures'

configure({ adapter: new Adapter() })

const VARIANT_GUID = 'SV0000002_1248367227_r0390_100'
const DRAFT_URL = `/api/saved_variant/${VARIANT_GUID}/clinvar_submission`

const mountPanel = async (response, mode = 'dry_run', fetchOptions = {}) => {
  mockFetchResponse(response, fetchOptions)
  const wrapper = mount(<ClinvarSubmissionPanel variantGuid={VARIANT_GUID} mode={mode} />)
  await flushAll()
  wrapper.update()
  return wrapper
}

const mountWithSubmission = (submission, mode = 'dry_run') => mountPanel({ ...DRAFT_RESPONSE, clinvarMode: mode, clinvarSubmission: { ...DRAFT_SUBMISSION, ...submission } }, mode)

const buttonLabels = (wrapper) => wrapper.find('Button').map(b => b.text())

const clickButton = async (wrapper, label) => {
  wrapper.find('Button').filterWhere(b => b.text() === label).find('button').simulate('click')
  await flushAll()
  wrapper.update()
}

test('prefills an unsaved draft with the dry-run banner and the exact JSON', async () => {
  const wrapper = await mountPanel(DRAFT_RESPONSE)

  expect(fetch.mock.calls).toHaveLength(1)
  expect(getLastFetchUrl()).toEqual(`${DRAFT_URL}?`)
  expect(getLastFetchOptions().method).toEqual('GET')

  expect(wrapper.find('.clinvar-mode-banner').first().text()).toContain('DRY RUN — nothing is sent to ClinVar')
  expect(wrapper.find('Label').first().text()).toEqual('Not saved')
  expect(wrapper.text()).toContain('New ClinVar record')

  expect(wrapper.find('FormInput[name="classification"]').prop('value')).toEqual('Pathogenic')
  expect(wrapper.find('FormInput[name="classification"]').prop('readOnly')).toBe(true)
  const selectValues = wrapper.find('FormSelect').reduce((acc, s) => ({ ...acc, [s.prop('name')]: s.prop('value') }), {})
  expect(selectValues).toEqual({
    conditionId: 'MONDO:0044970', modeOfInheritance: '', collectionMethod: 'research', affectedStatus: 'yes', alleleOrigin: 'germline',
  })
  expect(wrapper.find('FormSelect[name="conditionId"]').prop('options')).toEqual([
    { value: 'MONDO:0044970', text: 'MONDO:0044970' }, { value: 'OMIM:615123', text: 'OMIM:615123' },
  ])
  expect(wrapper.find('FormSelect[name="modeOfInheritance"]').prop('options')[0]).toEqual({ value: '', text: '(none)' })
  expect(wrapper.find('FormInput[name="citations"]').prop('value')).toEqual('34415322')
  expect(wrapper.find('.clinvar-observation').text()).toEqual(
    '1 affected and 1 unaffected individual(s) in the family carry this variant — 1 homozygous. No free-text comment is sent to ClinVar.',
  )

  expect(JSON.parse(wrapper.find('.clinvar-payload').first().find('pre').text())).toEqual(PAYLOAD)
  expect(wrapper.find('.clinvar-validation-errors').exists()).toBe(false)
  expect(buttonLabels(wrapper)).toEqual(['Save draft'])
  expect(wrapper.find('Button').prop('disabled')).toBe(false)
})

test('shows validation errors instead of a record', async () => {
  const errors = ['The variant has no ACMG classification in seqr: classify it before drafting a ClinVar submission']
  const wrapper = await mountWithSubmission({ classification: null, payload: null, validationErrors: errors })

  expect(wrapper.find('.clinvar-validation-errors').first().text()).toContain('This record cannot be submitted')
  expect(wrapper.find('.clinvar-validation-errors').first().text()).toContain(errors[0])
  expect(wrapper.find('.clinvar-payload').first().text()).toEqual('No record can be built until the errors above are fixed')
  expect(wrapper.find('FormInput[name="classification"]').prop('value')).toEqual('Not classified')
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Request review', 'Withdraw'])
  expect(wrapper.find('Button[name="request_review"]').prop('disabled')).toBe(true)
})

test('saves edited fields and never posts the record itself', async () => {
  const wrapper = await mountPanel(DRAFT_RESPONSE)

  wrapper.find('FormSelect[name="collectionMethod"]').prop('onChange')({}, { name: 'collectionMethod', value: 'clinical testing' })
  wrapper.find('FormSelect[name="modeOfInheritance"]').prop('onChange')({}, { name: 'modeOfInheritance', value: '' })
  wrapper.find('FormInput[name="citations"]').prop('onChange')({}, { name: 'citations', value: '34415322, 33665635;123 ' })
  wrapper.update()
  expect(wrapper.find('FormSelect[name="collectionMethod"]').prop('value')).toEqual('clinical testing')
  expect(wrapper.find('FormInput[name="citations"]').prop('value')).toEqual('34415322, 33665635, 123')

  mockFetchResponse({
    ...DRAFT_RESPONSE, clinvarSubmission: { ...DRAFT_SUBMISSION, collectionMethod: 'clinical testing', citations: ['34415322', '33665635', '123'] },
  })
  await clickButton(wrapper, 'Save draft')

  expect(getLastFetchUrl()).toEqual(DRAFT_URL)
  expect(getLastFetchOptions().method).toEqual('POST')
  expect(getLastFetchBody()).toEqual({
    collectionMethod: 'clinical testing', modeOfInheritance: null, citations: ['34415322', '33665635', '123'],
  })
  expect(wrapper.find('Label').first().text()).toEqual('Draft')
  expect(wrapper.text()).toContain('Drafted by Test Manager User')
  expect(wrapper.text()).not.toContain('Last edited by')
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Request review', 'Withdraw'])
  expect(wrapper.find('Button[name="request_review"]').prop('disabled')).toBe(false)
  expect(wrapper.find('Button').first().prop('disabled')).toBe(true)

  // Unsaved edits block the workflow actions
  wrapper.find('FormSelect[name="alleleOrigin"]').prop('onChange')({}, { name: 'alleleOrigin', value: 'de novo' })
  wrapper.update()
  expect(wrapper.find('Button[name="request_review"]').prop('disabled')).toBe(true)
  expect(wrapper.find('Button').first().prop('disabled')).toBe(false)
})

test('requests review and shows the review state to the approver', async () => {
  const wrapper = await mountWithSubmission({})
  mockFetchResponse({ clinvarSubmission: { ...DRAFT_SUBMISSION, status: 'in_review' } })
  await clickButton(wrapper, 'Request review')

  expect(getLastFetchUrl()).toEqual('/api/clinvar_submission/CS0000001_clinvar/request_review')
  expect(getLastFetchBody()).toEqual({})
  expect(wrapper.find('Label').first().text()).toEqual('In review')
  expect(wrapper.text()).toContain('Waiting for approval by a second person: the author cannot approve it')
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Approve', 'Withdraw'])
  expect(wrapper.find('FormSelect[name="conditionId"]').prop('options')).toHaveLength(2)

  // The server refuses the author's own approval
  mockFetchResponse(
    { error: 'A ClinVar submission must be approved by a different user than its author' }, { ok: false, status: 403 },
  )
  await clickButton(wrapper, 'Approve')
  expect(getLastFetchUrl()).toEqual('/api/clinvar_submission/CS0000001_clinvar/approve')
  expect(wrapper.find('.clinvar-error').first().text()).toEqual(
    'A ClinVar submission must be approved by a different user than its author',
  )
  expect(wrapper.find('Label').first().text()).toEqual('In review')

  mockFetchResponse({
    clinvarSubmission: {
      ...DRAFT_SUBMISSION, status: 'approved', lastEditedBy: 'Test User', reviewedBy: 'Test PM User', reviewedDate: '2026-11-21T10:00:00.000Z',
    },
  })
  await clickButton(wrapper, 'Approve')
  expect(wrapper.find('.clinvar-error').exists()).toBe(false)
  expect(wrapper.find('Label').first().text()).toEqual('Approved')
  expect(wrapper.text()).toContain('Drafted by Test Manager User')
  expect(wrapper.text()).toContain('Last edited by Test User')
  expect(wrapper.text()).toContain(`Approved by Test PM User on ${new Date('2026-11-21T10:00:00.000Z').toLocaleDateString()}`)
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Run dry run (nothing is sent)', 'Withdraw'])
})

test('runs the dry run and shows its result', async () => {
  const wrapper = await mountWithSubmission({ status: 'approved', reviewedBy: 'Test PM User' })
  const dryRun = { ok: true, dryRun: true, sentToNcbi: false, message: 'Validated by seqr only' }
  mockFetchResponse({
    clinvarSubmission: { ...DRAFT_SUBMISSION, status: 'dry_run_passed', reviewedBy: 'Test PM User', response: { dryRun } },
    message: 'DRY RUN: nothing was sent to ClinVar. Validated by seqr only',
  })
  await clickButton(wrapper, 'Run dry run (nothing is sent)')

  expect(getLastFetchUrl()).toEqual('/api/clinvar_submission/CS0000001_clinvar/submit')
  expect(wrapper.find('Label').first().text()).toEqual('Dry run passed')
  expect(wrapper.find('.clinvar-message').first().text()).toEqual('DRY RUN: nothing was sent to ClinVar. Validated by seqr only')
  expect(wrapper.find('.clinvar-result-dryRun').first().text()).toEqual('Dry run passedValidated by seqr only')
  expect(wrapper.find('Message.clinvar-result-dryRun').prop('positive')).toBe(true)
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Run dry run (nothing is sent)', 'Withdraw'])

  const failedDryRun = { ok: false, message: 'ClinVar returned 400: Submission is incorrect', errors: ['recordStatus is required'] }
  mockFetchResponse({
    clinvarSubmission: { ...DRAFT_SUBMISSION, status: 'error', reviewedBy: 'Test PM User', response: { dryRun: failedDryRun } },
    message: failedDryRun.message,
  })
  await clickButton(wrapper, 'Run dry run (nothing is sent)')
  expect(wrapper.find('Label').first().text()).toEqual('Error')
  expect(wrapper.find('Label').first().prop('color')).toEqual('red')
  expect(wrapper.find('Message.clinvar-result-dryRun').prop('negative')).toBe(true)
  expect(wrapper.find('.clinvar-result-dryRun').first().text()).toEqual(
    'Dry run failedrecordStatus is requiredClinVar returned 400: Submission is incorrect',
  )
  // A reviewed submission can be retried, an unreviewed one cannot
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Run dry run (nothing is sent)', 'Withdraw'])
  const unreviewed = await mountWithSubmission({ status: 'error' })
  expect(buttonLabels(unreviewed)).toEqual(['Save changes', 'Withdraw'])
})

test('makes test and live modes unmistakable', async () => {
  const testWrapper = await mountWithSubmission({ status: 'approved' }, 'test')
  expect(testWrapper.find('.clinvar-mode-banner').first().text()).toContain(
    'TEST MODE — records are sent to the ClinVar test endpoint only',
  )
  expect(testWrapper.find('Message.clinvar-mode-banner').prop('color')).toEqual('orange')
  expect(buttonLabels(testWrapper)).toEqual(['Save changes', 'Submit to ClinVar', 'Withdraw'])

  const liveWrapper = await mountWithSubmission({
    status: 'submitted',
    reviewedBy: 'Test PM User',
    submittedBy: 'Test User',
    submittedDate: '2026-11-22T10:00:00.000Z',
    ncbiSubmissionId: 'SUB14900000',
    response: { dryRun: { ok: true, message: 'NCBI dry run passed' }, submission: { ok: true, message: 'ClinVar created submission SUB14900000' } },
  }, 'live')
  expect(liveWrapper.find('.clinvar-mode-banner').first().text()).toContain('LIVE — approved records are published in ClinVar')
  expect(liveWrapper.find('Message.clinvar-mode-banner').prop('color')).toEqual('red')
  expect(liveWrapper.text()).toContain(`Submitted by Test User on ${new Date('2026-11-22T10:00:00.000Z').toLocaleDateString()}`)
  expect(liveWrapper.text()).toContain('ClinVar submission SUB14900000')
  expect(liveWrapper.find('.clinvar-result-submission').first().text()).toEqual('Submission passedClinVar created submission SUB14900000')
  expect(buttonLabels(liveWrapper)).toEqual(['Save changes'])
})

test('shows a published record as an update and confirms its deletion', async () => {
  const wrapper = await mountWithSubmission({
    status: 'processed', recordStatus: 'update', scvAccession: 'SCV000123456', reviewedBy: 'Test PM User',
  }, 'live')
  expect(wrapper.text()).toContain('Update of SCV000123456')
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Withdraw'])

  mockFetchResponse({
    clinvarSubmission: {
      ...DRAFT_SUBMISSION, status: 'processed', recordStatus: 'update', scvAccession: 'SCV000123456', withdrawalRequestedBy: 'Test Manager User',
    },
    message: 'Deletion of SCV000123456 requested: a different user must confirm it',
  })
  await clickButton(wrapper, 'Withdraw')
  expect(getLastFetchUrl()).toEqual('/api/clinvar_submission/CS0000001_clinvar/withdraw')
  expect(wrapper.text()).toContain('Deletion requested by Test Manager User: a different user must confirm it')
  expect(buttonLabels(wrapper)).toEqual(['Save changes', 'Confirm deletion from ClinVar'])

  mockFetchResponse({
    clinvarSubmission: {
      ...DRAFT_SUBMISSION,
      status: 'withdrawn',
      recordStatus: 'update',
      scvAccession: 'SCV000123456',
      response: { deletionDryRun: { ok: true, message: 'NCBI dry run passed' }, deletion: { ok: true, message: 'ClinVar created submission SUB777' } },
    },
  })
  await clickButton(wrapper, 'Confirm deletion from ClinVar')
  expect(wrapper.find('Label').first().text()).toEqual('Withdrawn')
  expect(wrapper.find('.clinvar-result-deletion').first().text()).toEqual('Deletion passedClinVar created submission SUB777')
  expect(buttonLabels(wrapper)).toEqual(['Save changes'])
})

test('shows the server error when the feature cannot be loaded', async () => {
  mockFetchResponse(
    { error: 'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")' }, { ok: false, status: 403 },
  )
  const wrapper = mount(<ClinvarSubmissionPanel variantGuid={VARIANT_GUID} mode="dry_run" />)
  expect(wrapper.find('Loader').exists()).toBe(true)
  expect(wrapper.find('.clinvar-mode-banner').first().text()).toContain('DRY RUN — nothing is sent to ClinVar')
  await flushAll()
  wrapper.update()

  expect(wrapper.find('Loader').exists()).toBe(false)
  expect(wrapper.find('.clinvar-error').first().text()).toEqual(
    'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")',
  )
  expect(wrapper.find('Button').exists()).toBe(false)
})
