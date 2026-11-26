import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import RememberVariantButton from './RememberVariantButton'
import { mockFetch, clickButton, setFormValue, getPosts } from './testUtils'

configure({ adapter: new Adapter() })

const VARIANT_GUID = 'SV0000002_1248367227_r0390_100'

test('records a saved variant as a known variant with a verdict and references', async () => {
  const fetch = mockFetch(() => ({ json: { knownVariantChecksByGuid: { KVC1: {} }, matchingDeferred: false } }))
  const wrapper = mount(<RememberVariantButton variantGuid={VARIANT_GUID} />)

  expect(wrapper.find('Modal').length).toEqual(0)
  await clickButton(wrapper, 'Remember this variant')
  expect(wrapper.find('Modal').length).toEqual(1)
  expect(wrapper.find('ModalHeader').text()).toEqual('Remember this variant')
  expect(wrapper.find('ModalContent').text()).toContain('Families loaded in future, in projects you can view')

  // The verdict is a fixed vocabulary, and there is no free text, variant or sharing field
  const verdictField = wrapper.find('Modal').find({ name: 'verdict' }).first()
  expect(verdictField.prop('options')).toEqual([
    { value: 'C', text: 'Confirmed causal' },
    { value: 'S', text: 'Suspected, confirmed on follow-up' },
    { value: 'R', text: 'Suspected, refuted on follow-up' },
    { value: 'B', text: 'Benign or artefact (expected noise)' },
  ])
  expect(wrapper.find('Modal').find('FormField').map(field => field.prop('name'))).toEqual(
    ['verdict', 'pubmedId', 'clinvarAccession'],
  )
  expect(wrapper.find('textarea').length).toEqual(0)

  // A verdict is required
  await clickButton(wrapper, 'Save')
  expect(fetch).not.toHaveBeenCalled()
  expect(wrapper.find('Message').text()).toEqual('Verdict is required')

  await setFormValue(wrapper, 'verdict', { value: 'S' })
  await setFormValue(wrapper, 'pubmedId', { value: '12345678' })
  await setFormValue(wrapper, 'clinvarAccession', { value: 'VCV000012345' })
  await clickButton(wrapper, 'Save')

  expect(getPosts(fetch)).toEqual([['/api/known_variant_checks/create', {
    savedVariantGuid: VARIANT_GUID, verdict: 'S', pubmedId: '12345678', clinvarAccession: 'VCV000012345',
  }]])
  expect(wrapper.find('Modal').length).toEqual(0)
  expect(wrapper.find('Button').length).toEqual(0)
  expect(wrapper.find('Label').text()).toEqual('Remembered')
})

test('shows validation errors from the server and keeps the form open', async () => {
  const fetch = mockFetch(() => ({
    status: 400, json: { errors: ['PubMed ID must be a number, for example 12345678'] },
  }))
  const wrapper = mount(<RememberVariantButton variantGuid={VARIANT_GUID} />)

  await clickButton(wrapper, 'Remember this variant')
  await setFormValue(wrapper, 'verdict', { value: 'C' })
  await setFormValue(wrapper, 'pubmedId', { value: 'PMID 1' })
  await clickButton(wrapper, 'Save')

  expect(fetch).toHaveBeenCalledTimes(1)
  expect(wrapper.find('Modal').length).toEqual(1)
  expect(wrapper.find('Message').text()).toEqual('PubMed ID must be a number, for example 12345678')
  expect(wrapper.find('Label').length).toEqual(0)

  await clickButton(wrapper, 'Cancel')
  expect(wrapper.find('Modal').length).toEqual(0)
  expect(wrapper.find('Button').first().prop('content')).toEqual('Remember this variant')
})

test('tells the user when existing families will be checked later', async () => {
  mockFetch(() => ({ json: { knownVariantChecksByGuid: {}, matchingDeferred: true } }))
  const wrapper = mount(<RememberVariantButton variantGuid={VARIANT_GUID} />)

  await clickButton(wrapper, 'Remember this variant')
  await setFormValue(wrapper, 'verdict', { value: 'B' })
  await clickButton(wrapper, 'Save')

  expect(wrapper.find('Label').text()).toEqual('Remembered. Existing families will be checked later')
})
