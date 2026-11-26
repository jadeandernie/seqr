import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import UpdateButton from 'shared/components/buttons/UpdateButton'

import IndividualRow from '../FamilyTable/IndividualRow'
import { HPO_FORM_FIELDS } from '../HpoTerms'
import HpoImportButton from './HpoImportButton'
import { clearHpoIndex } from './hpoVocabulary'
import {
  INDIVIDUAL_GUID, NOTE, STATE, containsNoteFragment, createTestStore, flush, getFetchCalls, mockApi,
} from './testUtils'

configure({ adapter: new Adapter() })

const MODAL_ID = 'edit-hpo-terms'

beforeEach(() => {
  clearHpoIndex()
  mockApi()
})

const mountButton = (store, onSubmit = jest.fn(() => Promise.resolve())) => mount(
  <Provider store={store}>
    <MemoryRouter>
      <HpoImportButton
        modalTitle="Features for Individual NA19675"
        modalId={MODAL_ID}
        initialValues={{ ...store.getState().individualsByGuid[INDIVIDUAL_GUID], individualField: 'hpo_terms' }}
        formFields={HPO_FORM_FIELDS}
        onSubmit={onSubmit}
      />
    </MemoryRouter>
  </Provider>,
)

const openModal = async (wrapper) => {
  wrapper.find('ButtonLink').first().find('button').simulate('click')
  await flush(wrapper)
}

const selectMode = async (wrapper, mode) => {
  wrapper.find(`button.hpo-import-mode-${mode}`).simulate('click')
  await flush(wrapper)
}

const isModeDisabled = (wrapper, mode) => !!wrapper.find(`button.hpo-import-mode-${mode}`).prop('disabled')

const enterNotes = (wrapper, text) => {
  wrapper.find('textarea').simulate('change', { target: { value: text } })
  wrapper.update()
}

test('opens the existing HPO term editor as the manual import mode', async () => {
  const store = createTestStore()
  const onSubmit = jest.fn(() => Promise.resolve())
  const wrapper = mountButton(store, onSubmit)
  expect(wrapper.find('button.hpo-import-mode-manual').exists()).toBe(false)

  await openModal(wrapper)

  expect(wrapper.find('ModalHeader').text()).toContain('Features for Individual NA19675')
  expect(wrapper.find('button.hpo-import-mode-manual').text()).toEqual('Manual import')
  expect(wrapper.find('button.hpo-import-mode-automatic').text()).toEqual('Automatic import')
  expect(wrapper.find('button.hpo-import-mode-manual').hasClass('active')).toBe(true)
  expect(wrapper.find('button.hpo-import-mode-automatic').hasClass('active')).toBe(false)
  expect(wrapper.find('FormWrapper').exists()).toBe(true)
  expect(wrapper.find('.hpo-automatic-import').exists()).toBe(false)
  expect(wrapper.text()).toContain('Muscle weakness (HP:0001324)')
  expect(wrapper.find('ButtonLink[content="Add Feature"]').length).toEqual(2)
  expect(getFetchCalls()).toEqual([])

  wrapper.find('Icon[id="HP:0001324"]').simulate('click')
  await flush(wrapper)
  expect(isModeDisabled(wrapper, 'automatic')).toBe(true)
  expect(wrapper.text()).toContain('Save or discard your changes before switching between manual and automatic import')

  wrapper.find('form').simulate('submit')
  await flush(wrapper)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0]).toEqual({ ...STATE.individualsByGuid[INDIVIDUAL_GUID], individualField: 'hpo_terms', features: [] })
  expect(store.getState().modal[MODAL_ID].open).toBe(false)
})

test('switches between manual and automatic import while nothing is unsaved', async () => {
  const store = createTestStore()
  const wrapper = mountButton(store)
  await openModal(wrapper)

  await selectMode(wrapper, 'automatic')
  expect(wrapper.find('button.hpo-import-mode-automatic').hasClass('active')).toBe(true)
  expect(wrapper.find('.hpo-automatic-import').hostNodes().exists()).toBe(true)
  expect(wrapper.find('FormWrapper').exists()).toBe(false)
  expect(wrapper.text()).toContain('the text stays in your browser and is never sent to seqr or stored')
  expect(wrapper.find('MenuItem').length).toEqual(3)
  expect(isModeDisabled(wrapper, 'manual')).toBe(false)
  expect(wrapper.text()).not.toContain('Save or discard your changes')

  enterNotes(wrapper, NOTE)
  expect(isModeDisabled(wrapper, 'manual')).toBe(true)
  expect(wrapper.text()).toContain('Save or discard your changes before switching between manual and automatic import')
  wrapper.find('button.hpo-import-mode-manual').simulate('click')
  wrapper.update()
  expect(wrapper.find('textarea').prop('value')).toEqual(NOTE)

  enterNotes(wrapper, '')
  expect(isModeDisabled(wrapper, 'manual')).toBe(false)
  await selectMode(wrapper, 'manual')
  expect(wrapper.find('FormWrapper').exists()).toBe(true)
  expect(wrapper.find('.hpo-automatic-import').exists()).toBe(false)
})

test('drops the pasted notes when the dialog is closed', async () => {
  const store = createTestStore()
  const wrapper = mountButton(store)
  await openModal(wrapper)
  await selectMode(wrapper, 'automatic')
  enterNotes(wrapper, NOTE)
  wrapper.find('button.hpo-import-extract').simulate('click')
  wrapper.update()
  expect(containsNoteFragment(wrapper.html())).toBe(true)

  wrapper.find('ModalHeader').find('button').simulate('click')
  await flush(wrapper)
  expect(store.getState().modal[MODAL_ID].open).toBe(true)
  expect(wrapper.find('Confirm').last().prop('content')).toContain(
    'The pasted notes and any terms that have not been applied will be discarded',
  )
  wrapper.find('Confirm').last().prop('onConfirm')()
  await flush(wrapper)

  expect(store.getState().modal[MODAL_ID].open).toBe(false)
  expect(wrapper.find('.hpo-automatic-import').exists()).toBe(false)
  expect(containsNoteFragment(wrapper.html())).toBe(false)
  expect(containsNoteFragment(JSON.stringify(store.getState()))).toBe(false)

  await openModal(wrapper)
  expect(wrapper.find('button.hpo-import-mode-manual').hasClass('active')).toBe(true)
  await selectMode(wrapper, 'automatic')
  expect(wrapper.find('textarea').prop('value')).toEqual('')
  expect(wrapper.find('.hpo-import-note').exists()).toBe(false)
  expect(containsNoteFragment(wrapper.html())).toBe(false)
  expect(getFetchCalls().map(({ url }) => url)).toEqual(['/api/hpo_vocabulary?'])
})

test('is the edit dialog of the HPO terms of an individual', async () => {
  const store = createTestStore()
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter>
        <IndividualRow
          family={STATE.familiesByGuid.F011652_1}
          individual={STATE.individualsByGuid[INDIVIDUAL_GUID]}
        />
      </MemoryRouter>
    </Provider>,
  )
  if (!wrapper.find(HpoImportButton).exists()) {
    wrapper.find('CollapsableLayout').find('Icon[name="dropdown"]').first().simulate('click')
    wrapper.update()
  }

  const button = wrapper.find(HpoImportButton)
  expect(button.length).toEqual(1)
  expect(button.prop('modalTitle')).toContain('Features for Individual')
  expect(button.prop('initialValues').individualField).toEqual('hpo_terms')
  expect(button.prop('formFields')).toBe(HPO_FORM_FIELDS)

  button.find('ButtonLink').first().find('button').simulate('click')
  await flush(wrapper)
  expect(wrapper.find('button.hpo-import-mode-manual').exists()).toBe(true)
  expect(wrapper.find('button.hpo-import-mode-automatic').exists()).toBe(true)
  // every other editable field keeps the standard edit dialog
  expect(wrapper.find(UpdateButton).length).toBeGreaterThan(0)
})
