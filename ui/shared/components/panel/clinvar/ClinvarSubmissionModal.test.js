import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'

import { mockFetchResponse, flushAll, getLastFetchUrl } from 'shared/utils/testHelpers'
import ClinvarSubmissionModal from './ClinvarSubmissionModal'
import { DRAFT_RESPONSE } from './fixtures'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const VARIANT_GUID = 'SV0000002_1248367227_r0390_100'

const mountModal = (clinvarSubmissionMode, modal = {}) => {
  const store = configureStore({ meta: { clinvarSubmissionMode }, modal })
  const wrapper = mount(<Provider store={store}><ClinvarSubmissionModal variantGuid={VARIANT_GUID} /></Provider>)
  return { store, wrapper }
}

test('renders nothing when ClinVar submission is not enabled', () => {
  [null, undefined].forEach((mode) => {
    const { wrapper } = mountModal(mode)
    expect(wrapper.html()).toEqual('')
  })
  expect(fetch).not.toHaveBeenCalled()
})

test('renders a ClinVar action that opens the panel when enabled', async () => {
  const { store, wrapper } = mountModal('dry_run')
  expect(wrapper.text()).toEqual('ClinVar')
  expect(wrapper.find('ClinvarSubmissionPanel').exists()).toBe(false)
  expect(fetch).not.toHaveBeenCalled()

  wrapper.find('ButtonLink').find('button').simulate('click')
  expect(store.getActions()).toEqual([{ type: 'UPDATE_MODAL_STATE', updatesById: { [`clinvar-${VARIANT_GUID}`]: { open: true } } }])
})

test('loads the draft in the opened modal', async () => {
  mockFetchResponse(DRAFT_RESPONSE)
  const { wrapper } = mountModal('dry_run', { [`clinvar-${VARIANT_GUID}`]: { open: true } })
  await flushAll()
  wrapper.update()

  expect(getLastFetchUrl()).toEqual(`/api/saved_variant/${VARIANT_GUID}/clinvar_submission?`)
  const panel = wrapper.find('ClinvarSubmissionPanel')
  expect(panel.props()).toEqual({ variantGuid: VARIANT_GUID, mode: 'dry_run' })
  expect(panel.find('.clinvar-mode-banner').first().text()).toContain('DRY RUN — nothing is sent to ClinVar')
  expect(wrapper.find('Modal').first().prop('open')).toBe(true)
})
