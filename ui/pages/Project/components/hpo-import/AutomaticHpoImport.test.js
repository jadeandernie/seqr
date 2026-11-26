import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'

import AutomaticHpoImport from './AutomaticHpoImport'
import { clearHpoIndex } from './hpoVocabulary'
import {
  INDIVIDUAL_GUID, FATHER_GUID, MOTHER_GUID, NOTE, NOTE_FRAGMENTS, SENTINELS, STATE, containsNoteFragment, containsNoteText,
  createTestStore, flush,
  getFetchCalls, getSaveCalls, mockApi,
} from './testUtils'

configure({ adapter: new Adapter() })

const MODAL_NAME = 'hpo-import-test'

const SAVE_URL = `/api/individual/${INDIVIDUAL_GUID}/update_hpo_terms`

const DEFAULT_SAVE_BODY = {
  individualGuid: INDIVIDUAL_GUID,
  individualField: 'hpo_terms',
  features: [
    { id: 'HP:0001324', notes: 'proximal', qualifiers: [{ type: 'severity', label: 'Mild' }] },
    { id: 'HP:0001250' },
    { id: 'HP:0001252' },
  ],
  absentFeatures: [{ id: 'HP:0001631' }, { id: 'HP:0000252' }],
  nonstandardFeatures: [{ id: 'Odd gait', notes: 'since 2y' }],
  absentNonstandardFeatures: [],
}

beforeEach(() => {
  clearHpoIndex()
  mockApi()
  localStorage.clear()
  sessionStorage.clear()
})

const mountImport = async (store = createTestStore(), individualGuid = INDIVIDUAL_GUID) => {
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter>
        <AutomaticHpoImport
          individual={store.getState().individualsByGuid[individualGuid]}
          modalName={MODAL_NAME}
        />
      </MemoryRouter>
    </Provider>,
  )
  await flush(wrapper)
  return wrapper
}

const enterNotes = (wrapper, text) => {
  wrapper.find('textarea').simulate('change', { target: { value: text } })
  wrapper.update()
}

const extract = (wrapper, text = NOTE) => {
  enterNotes(wrapper, text)
  wrapper.find('button.hpo-import-extract').simulate('click')
  wrapper.update()
}

const isDisabled = (wrapper, selector) => !!wrapper.find(selector).prop('disabled')

const getProposal = (wrapper, id) => wrapper.find(`.hpo-import-proposal[data-term="${id}"]`).hostNodes()

const getProposals = (wrapper, group) => wrapper.find(`.hpo-import-group-${group} .hpo-import-proposal`).hostNodes().map(
  row => [
    row.prop('data-term'),
    row.find('Checkbox').prop('checked'),
    row.find('.hpo-import-assertion').hostNodes().text(),
  ],
)

const clickApply = async (wrapper) => {
  wrapper.find('button.hpo-import-apply').simulate('click')
  await flush(wrapper)
}

const addWithPicker = (wrapper, result) => {
  wrapper.find('button.hpo-import-add').simulate('click')
  wrapper.update()
  act(() => {
    wrapper.find('AwesomeBar').instance().handleResultSelect({ preventDefault: () => {} }, { result })
  })
  wrapper.update()
}

test('explains that notes stay in the browser and loads the vocabulary once with a plain GET', async () => {
  const store = createTestStore()
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter>
        <AutomaticHpoImport individual={STATE.individualsByGuid[INDIVIDUAL_GUID]} modalName={MODAL_NAME} />
      </MemoryRouter>
    </Provider>,
  )

  expect(wrapper.text()).toContain(
    'Paste clinical notes — the text stays in your browser and is never sent to seqr or stored',
  )
  expect(wrapper.text()).toContain('Nothing is saved until you apply the terms you have confirmed')
  expect(wrapper.text()).toContain('Loading the HPO vocabulary')
  enterNotes(wrapper, 'seizures')
  expect(isDisabled(wrapper, 'button.hpo-import-extract')).toBe(true)

  await flush(wrapper)
  expect(wrapper.text()).not.toContain('Loading the HPO vocabulary')
  expect(isDisabled(wrapper, 'button.hpo-import-extract')).toBe(false)
  enterNotes(wrapper, '   ')
  expect(isDisabled(wrapper, 'button.hpo-import-extract')).toBe(true)

  const textarea = wrapper.find('textarea')
  expect(textarea.prop('spellCheck')).toBe(false)
  expect(textarea.prop('autoComplete')).toEqual('off')
  expect(textarea.prop('placeholder')).toContain('never sent to seqr or stored')

  wrapper.unmount()
  await mountImport(store)
  expect(getFetchCalls()).toEqual([{ url: '/api/hpo_vocabulary?', method: 'GET', body: undefined }])
})

test('reports a vocabulary that fails to load and retries on request', async () => {
  mockApi({ vocabulary: null })
  const wrapper = await mountImport()

  expect(wrapper.text()).toContain('The HPO vocabulary could not be loaded')
  expect(wrapper.text()).toContain('Vocabulary unavailable')
  expect(wrapper.text()).not.toContain('Loading the HPO vocabulary')
  enterNotes(wrapper, 'seizures')
  expect(isDisabled(wrapper, 'button.hpo-import-extract')).toBe(true)

  mockApi()
  wrapper.find('Message[error=true]').find('button').simulate('click')
  await flush(wrapper)

  expect(wrapper.text()).not.toContain('The HPO vocabulary could not be loaded')
  expect(isDisabled(wrapper, 'button.hpo-import-extract')).toBe(false)
  expect(getFetchCalls().map(({ url }) => url)).toEqual(['/api/hpo_vocabulary?', '/api/hpo_vocabulary?'])
})

test('ignores a vocabulary response that arrives after the dialog was closed', async () => {
  const consoleError = jest.spyOn(console, 'error')
  const mountAndClose = async () => {
    const wrapper = mount(
      <Provider store={createTestStore()}>
        <MemoryRouter>
          <AutomaticHpoImport individual={STATE.individualsByGuid[INDIVIDUAL_GUID]} modalName={MODAL_NAME} />
        </MemoryRouter>
      </Provider>,
    )
    wrapper.unmount()
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  await mountAndClose()
  clearHpoIndex()
  mockApi({ vocabulary: null })
  await mountAndClose()

  expect(consoleError).not.toHaveBeenCalled()
  expect(getFetchCalls().map(({ url }) => url)).toEqual(['/api/hpo_vocabulary?', '/api/hpo_vocabulary?'])
  consoleError.mockRestore()
})

test('highlights the matched text with a status that does not rely on colour', async () => {
  const wrapper = await mountImport()
  extract(wrapper)

  const marks = wrapper.find('.hpo-import-note mark').map(mark => [
    mark.prop('data-status'), mark.text(), mark.prop('title'), mark.prop('style').borderBottom,
  ])
  expect(marks).toEqual([
    ['present', 'seizures [present]', 'Seizure (HP:0001250) — present', '2px solid #1e561f'],
    ['present', 'low muscle tone [present]', 'Hypotonia (HP:0001252) — present', '2px solid #1e561f'],
    ['absent', 'microcephaly [absent]', 'Microcephaly (HP:0000252) — absent', '2px dashed #912d2b'],
    ['uncertain', 'scoliosis [unconfirmed]', 'Scoliosis (HP:0002650) — unconfirmed', '4px double #7a5c00'],
    ['family', 'hearing loss [family history]', 'Hearing impairment (HP:0000365) — family history', '2px dotted #4a4a4a'],
    ['present', 'Muscle weakness [present]', 'Muscle weakness (HP:0001324) — present', '2px solid #1e561f'],
    ['present', 'atrial septal defect [present]', 'Atrial septal defect (HP:0001631) — present', '2px solid #1e561f'],
    ['present', 'Headaches [present]', 'Headache (HP:0002315) — present', '2px solid #1e561f'],
    ['absent', 'headache [absent]', 'Headache (HP:0002315) — absent', '2px dashed #912d2b'],
  ])
  // Apart from the status tags the note is shown unchanged
  expect(wrapper.find('.hpo-import-note').hostNodes().text().replace(/ \[[a-z ]+\]/g, '')).toEqual(NOTE)
  expect(wrapper.find('.hpo-import-legend').hostNodes().text()).toEqual(
    '[present][absent][family history][unconfirmed]',
  )
  expect(wrapper.find('textarea').exists()).toBe(false)
})

test('proposes each term once and only pre-ticks confident present and absent terms', async () => {
  const wrapper = await mountImport()
  extract(wrapper)

  expect(getProposals(wrapper, 'confident')).toEqual([
    ['HP:0001250', true, 'Present'],
    ['HP:0001252', true, 'Present'],
    ['HP:0000252', true, 'Not present'],
  ])
  expect(getProposals(wrapper, 'uncertain')).toEqual([
    ['HP:0002650', false, 'Present'],
    ['HP:0002315', false, 'Present'],
  ])
  expect(getProposals(wrapper, 'family')).toEqual([['HP:0000365', false, 'Present']])

  expect(getProposal(wrapper, 'HP:0001252').text()).toContain('Hypotonia (HP:0001252)')
  expect(getProposal(wrapper, 'HP:0001252').text()).toContain('found as “low muscle tone”')
  expect(getProposal(wrapper, 'HP:0000252').text()).toContain('found as “microcephaly” · context: “No”')
  expect(getProposal(wrapper, 'HP:0002315').text()).toContain(
    'found as “Headaches”, “headache” · context: “no” · both stated and negated in the notes',
  )
  expect(getProposal(wrapper, 'HP:0000365').text()).toContain('context: “Mother”')
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 3 terms to NA19675')
})

test('shows terms that are already recorded without proposing them again', async () => {
  const wrapper = await mountImport()
  extract(wrapper)

  expect(getProposal(wrapper, 'HP:0001324').exists()).toBe(false)
  expect(getProposal(wrapper, 'HP:0001631').exists()).toBe(false)
  const recorded = wrapper.find('.hpo-import-recorded').hostNodes()
  expect(recorded.text()).toContain('Already recorded — these will not be changed')
  expect(recorded.find('[data-term="HP:0001324"]').hostNodes().text()).toEqual(
    'Muscle weakness (HP:0001324) — already recorded as present',
  )
  expect(recorded.find('[data-term="HP:0001631"]').hostNodes().text()).toEqual(
    'Atrial septal defect (HP:0001631) — already recorded as not present, but the notes suggest present. Use Manual import to change it.',
  )
})

test('sends nothing to the server until the terms are applied', async () => {
  const store = createTestStore()
  const wrapper = await mountImport(store)
  extract(wrapper)
  getProposal(wrapper, 'HP:0002650').find('input[type="checkbox"]').simulate('change')
  getProposal(wrapper, 'HP:0001250').find('button.hpo-import-flip').simulate('click')
  await flush(wrapper)

  expect(getFetchCalls().map(({ url }) => url)).toEqual(['/api/hpo_vocabulary?'])
  expect(store.getState().individualsByGuid[INDIVIDUAL_GUID]).toEqual(STATE.individualsByGuid[INDIVIDUAL_GUID])
})

test('applies only the confirmed term ids, merged with the recorded terms', async () => {
  const store = createTestStore()
  const wrapper = await mountImport(store)
  extract(wrapper)
  await clickApply(wrapper)

  expect(getSaveCalls()).toEqual([{ url: SAVE_URL, method: 'POST', body: DEFAULT_SAVE_BODY }])

  expect(wrapper.text()).toContain('Added 3 HPO terms to NA19675')
  expect(wrapper.text()).toContain('2 present and 1 not present. The pasted notes have been discarded.')
  expect(wrapper.find('.hpo-import-note').exists()).toBe(false)

  const individual = store.getState().individualsByGuid[INDIVIDUAL_GUID]
  expect(individual.features.map(({ id, label }) => [id, label])).toEqual([
    ['HP:0001324', 'Muscle weakness'], ['HP:0001250', 'Seizure'], ['HP:0001252', 'Hypotonia'],
  ])
  expect(individual.absentFeatures.map(({ id }) => id)).toEqual(['HP:0001631', 'HP:0000252'])
  expect(individual.nonstandardFeatures).toEqual([{ id: 'Odd gait', notes: 'since 2y' }])

  wrapper.find('Button[content="Import more notes for NA19675"]').simulate('click')
  wrapper.update()
  expect(wrapper.find('textarea').prop('value')).toEqual('')

  // Terms applied a moment ago are now recognised as recorded
  extract(wrapper, 'seizures, obesity')
  expect(getProposals(wrapper, 'confident')).toEqual([['HP:0001513', true, 'Present']])
  expect(wrapper.find('.hpo-import-recorded [data-term="HP:0001250"]').hostNodes().text()).toEqual(
    'Seizure (HP:0001250) — already recorded as present',
  )
})

test('lets the reviewer tick, untick, flip and remove proposals before applying', async () => {
  const wrapper = await mountImport()
  extract(wrapper)

  getProposal(wrapper, 'HP:0001252').find('input[type="checkbox"]').simulate('change')
  getProposal(wrapper, 'HP:0002650').find('input[type="checkbox"]').simulate('change')
  getProposal(wrapper, 'HP:0000365').find('input[type="checkbox"]').simulate('change')
  expect(getProposal(wrapper, 'HP:0000365').find('button.hpo-import-flip').text()).toEqual('Change to absent')
  getProposal(wrapper, 'HP:0000365').find('button.hpo-import-flip').simulate('click')
  expect(getProposal(wrapper, 'HP:0000365').find('button.hpo-import-flip').text()).toEqual('Change to present')
  getProposal(wrapper, 'HP:0000252').find('button.hpo-import-flip').simulate('click')
  getProposal(wrapper, 'HP:0001250').find('button.hpo-import-flip').simulate('click')
  getProposal(wrapper, 'HP:0001250').find('button.hpo-import-flip').simulate('click')
  expect(getProposal(wrapper, 'HP:0002315').find('button.hpo-import-remove').prop('aria-label')).toEqual(
    'Remove Headache',
  )
  getProposal(wrapper, 'HP:0002315').find('button.hpo-import-remove').simulate('click')
  wrapper.update()

  expect(getProposals(wrapper, 'confident')).toEqual([
    ['HP:0001250', true, 'Present'],
    ['HP:0001252', false, 'Present'],
    ['HP:0000252', true, 'Present'],
  ])
  expect(getProposals(wrapper, 'uncertain')).toEqual([['HP:0002650', true, 'Present']])
  expect(getProposals(wrapper, 'family')).toEqual([['HP:0000365', true, 'Not present']])
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 4 terms to NA19675')

  await clickApply(wrapper)
  expect(getSaveCalls()).toEqual([{
    url: SAVE_URL,
    method: 'POST',
    body: {
      ...DEFAULT_SAVE_BODY,
      features: [DEFAULT_SAVE_BODY.features[0], { id: 'HP:0001250' }, { id: 'HP:0000252' }, { id: 'HP:0002650' }],
      absentFeatures: [{ id: 'HP:0001631' }, { id: 'HP:0000365' }],
    },
  }])
  expect(wrapper.text()).toContain('Added 4 HPO terms to NA19675')
  expect(wrapper.text()).toContain('3 present and 1 not present')
})

test('adds more terms through the HPO term picker', async () => {
  const wrapper = await mountImport()
  extract(wrapper)

  expect(wrapper.find('AwesomeBar').exists()).toBe(false)
  addWithPicker(wrapper, { key: 'HP:0001513', title: 'Obesity', category: 'HP:0001507' })
  expect(wrapper.find('AwesomeBar').exists()).toBe(false)
  expect(getProposals(wrapper, 'confident')).toEqual([
    ['HP:0001250', true, 'Present'],
    ['HP:0001252', true, 'Present'],
    ['HP:0000252', true, 'Not present'],
    ['HP:0001513', true, 'Present'],
  ])
  expect(getProposal(wrapper, 'HP:0001513').text()).toContain('Obesity (HP:0001513)')
  expect(getProposal(wrapper, 'HP:0001513').text()).toContain('added by you')

  // picking a term that is already proposed ticks it instead of adding it twice
  addWithPicker(wrapper, { key: 'HP:0002650', title: 'Scoliosis', category: 'HP:0000924' })
  expect(getProposals(wrapper, 'uncertain')).toEqual([['HP:0002650', true, 'Present'], ['HP:0002315', false, 'Present']])

  // picking a recorded term changes nothing
  addWithPicker(wrapper, { key: 'HP:0001631', title: 'Atrial septal defect', category: 'HP:0001626' })
  expect(wrapper.text()).toContain('Atrial septal defect (HP:0001631) is already recorded for NA19675')
  expect(getProposal(wrapper, 'HP:0001631').exists()).toBe(false)

  getProposal(wrapper, 'HP:0001513').find('button.hpo-import-flip').simulate('click')
  await clickApply(wrapper)
  expect(getSaveCalls()[0].body).toEqual({
    ...DEFAULT_SAVE_BODY,
    features: [...DEFAULT_SAVE_BODY.features, { id: 'HP:0002650' }],
    absentFeatures: [...DEFAULT_SAVE_BODY.absentFeatures, { id: 'HP:0001513' }],
  })
})

test('closes the picker without adding a term', async () => {
  const wrapper = await mountImport()
  extract(wrapper, 'nothing recognisable')

  expect(wrapper.text()).toContain('No HPO terms were recognised in the notes')
  expect(isDisabled(wrapper, 'button.hpo-import-apply')).toBe(true)
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 0 terms to NA19675')

  addWithPicker(wrapper, { key: 'HP:0001513', title: 'Obesity', category: 'HP:0001507' })
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 1 term to NA19675')
  expect(isDisabled(wrapper, 'button.hpo-import-apply')).toBe(false)
})

test('keeps the review when saving fails and can be retried', async () => {
  mockApi({ saveError: 'Permission Denied' })
  const store = createTestStore()
  const wrapper = await mountImport(store)
  extract(wrapper)
  await clickApply(wrapper)

  expect(wrapper.text()).toContain('The terms were not saved')
  expect(wrapper.text()).toContain('Permission Denied')
  expect(getProposals(wrapper, 'confident').length).toEqual(3)
  expect(wrapper.find('.hpo-import-note').exists()).toBe(true)
  expect(isDisabled(wrapper, 'button.hpo-import-apply')).toBe(false)
  expect(store.getState().individualsByGuid[INDIVIDUAL_GUID]).toEqual(STATE.individualsByGuid[INDIVIDUAL_GUID])

  mockApi()
  await clickApply(wrapper)
  expect(wrapper.text()).not.toContain('The terms were not saved')
  expect(wrapper.text()).toContain('Added 3 HPO terms to NA19675')
  expect(getSaveCalls().map(({ body }) => body)).toEqual([DEFAULT_SAVE_BODY, DEFAULT_SAVE_BODY])
})

test('returns to the notes for editing, or discards them', async () => {
  const store = createTestStore()
  const wrapper = await mountImport(store)
  extract(wrapper)

  wrapper.find('button.hpo-import-edit').simulate('click')
  wrapper.update()
  expect(wrapper.find('textarea').prop('value')).toEqual(NOTE)
  expect(wrapper.find('.hpo-import-note').exists()).toBe(false)

  extract(wrapper, 'obesity')
  expect(getProposals(wrapper, 'confident')).toEqual([['HP:0001513', true, 'Present']])

  wrapper.find('button.hpo-import-discard').simulate('click')
  wrapper.update()
  expect(wrapper.find('textarea').prop('value')).toEqual('')
  expect(getSaveCalls()).toEqual([])
})

test('asks for confirmation before closing while notes or unapplied terms would be lost', async () => {
  const store = createTestStore()
  const getConfirm = () => store.getState().modal[MODAL_NAME].confirmOnClose
  const wrapper = await mountImport(store)
  expect(getConfirm()).toBe(null)

  enterNotes(wrapper, NOTE)
  expect(getConfirm()).toContain('The pasted notes and any terms that have not been applied will be discarded')
  enterNotes(wrapper, '')
  expect(getConfirm()).toBe(null)

  extract(wrapper)
  expect(getConfirm()).toContain('will be discarded')
  await clickApply(wrapper)
  expect(getConfirm()).toBe(null)
})

test('imports notes for several individuals of the family one after another', async () => {
  const store = createTestStore()
  const wrapper = await mountImport(store)
  const getTabs = () => wrapper.find('MenuItem').map(item => [item.prop('name'), item.prop('active'), item.text()])
  const selectTab = (guid) => {
    wrapper.find(`MenuItem[name="${guid}"]`).find('a').simulate('click')
    wrapper.update()
  }

  expect(getTabs()).toEqual([
    [INDIVIDUAL_GUID, true, 'NA19675'], [FATHER_GUID, false, 'NA19678'], [MOTHER_GUID, false, 'NA19679_1'],
  ])

  extract(wrapper, 'Zebedee has seizures')
  selectTab(MOTHER_GUID)
  expect(wrapper.find('textarea').prop('value')).toEqual('')
  expect(wrapper.find('textarea').prop('aria-label')).toEqual('Clinical notes for NA19679_1')
  enterNotes(wrapper, 'Mrs Quuxley: obesity, no hearing loss')
  selectTab(FATHER_GUID)
  expect(wrapper.find('textarea').prop('value')).toEqual('')
  selectTab(MOTHER_GUID)
  expect(wrapper.find('textarea').prop('value')).toEqual('Mrs Quuxley: obesity, no hearing loss')
  wrapper.find('button.hpo-import-extract').simulate('click')
  wrapper.update()
  expect(getTabs()).toEqual([
    [INDIVIDUAL_GUID, false, 'NA19675in review'], [FATHER_GUID, false, 'NA19678'], [MOTHER_GUID, true, 'NA19679_1in review'],
  ])
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 2 terms to NA19679_1')
  await clickApply(wrapper)
  expect(wrapper.text()).toContain('Added 2 HPO terms to NA19679_1')

  selectTab(INDIVIDUAL_GUID)
  expect(getProposals(wrapper, 'confident')).toEqual([['HP:0001250', true, 'Present']])
  await clickApply(wrapper)
  expect(getTabs()).toEqual([
    [INDIVIDUAL_GUID, true, 'NA19675applied'], [FATHER_GUID, false, 'NA19678'], [MOTHER_GUID, false, 'NA19679_1applied'],
  ])

  expect(getSaveCalls()).toEqual([
    {
      url: `/api/individual/${MOTHER_GUID}/update_hpo_terms`,
      method: 'POST',
      body: {
        individualGuid: MOTHER_GUID,
        individualField: 'hpo_terms',
        features: [{ id: 'HP:0001513' }],
        absentFeatures: [{ id: 'HP:0000365' }],
        nonstandardFeatures: [],
        absentNonstandardFeatures: [],
      },
    },
    {
      url: SAVE_URL,
      method: 'POST',
      body: { ...DEFAULT_SAVE_BODY, features: [DEFAULT_SAVE_BODY.features[0], { id: 'HP:0001250' }], absentFeatures: [{ id: 'HP:0001631' }] },
    },
  ])
  expect(store.getState().individualsByGuid[MOTHER_GUID].absentFeatures.map(({ id }) => id)).toEqual(['HP:0000365'])
})

test('shows no individual selector for a family with one individual', async () => {
  const individual = { ...STATE.individualsByGuid[INDIVIDUAL_GUID], familyGuid: 'F_single', displayName: 'Proband' }
  const store = createTestStore({
    ...STATE, individualsByGuid: { [INDIVIDUAL_GUID]: individual },
  })
  const wrapper = await mountImport(store)

  expect(wrapper.find('MenuItem').exists()).toBe(false)
  extract(wrapper, 'seizures')
  expect(wrapper.find('button.hpo-import-apply').text()).toEqual('Apply 1 term to Proband')

  // an individual whose family is not loaded in the store can still be imported for
  const orphanStore = createTestStore({ ...STATE, individualsByGuid: {} })
  const orphanWrapper = mount(
    <Provider store={orphanStore}>
      <MemoryRouter>
        <AutomaticHpoImport individual={{ ...individual, features: null, absentFeatures: null }} modalName={MODAL_NAME} />
      </MemoryRouter>
    </Provider>,
  )
  await flush(orphanWrapper)
  expect(orphanWrapper.find('MenuItem').exists()).toBe(false)
  extract(orphanWrapper, 'muscle weakness')
  expect(orphanWrapper.find('button.hpo-import-apply').text()).toEqual('Apply 1 term to Proband')
})

test('never puts the note text in a request, the redux store, browser storage or the URL', async () => {
  const setItem = jest.spyOn(Storage.prototype, 'setItem')
  const initialHref = window.location.href
  const initialCookie = document.cookie
  const store = createTestStore()
  const wrapper = await mountImport(store)
  expect(containsNoteFragment(JSON.stringify(store.getState()))).toBe(false)
  NOTE_FRAGMENTS.forEach((fragment) => {
    expect(NOTE).toContain(fragment)
  })

  enterNotes(wrapper, NOTE)
  expect(containsNoteFragment(wrapper.html())).toBe(true)
  expect(containsNoteFragment(JSON.stringify(store.getState()))).toBe(false)
  wrapper.find('button.hpo-import-extract').simulate('click')
  wrapper.update()
  getProposal(wrapper, 'HP:0002650').find('input[type="checkbox"]').simulate('change')
  getProposal(wrapper, 'HP:0000365').find('button.hpo-import-flip').simulate('click')
  addWithPicker(wrapper, { key: 'HP:0001513', title: 'Obesity', category: 'HP:0001507' })
  wrapper.find('button.hpo-import-edit').simulate('click')
  wrapper.update()
  wrapper.find('button.hpo-import-extract').simulate('click')
  wrapper.update()
  expect(containsNoteFragment(JSON.stringify(store.getState()))).toBe(false)
  await clickApply(wrapper)
  expect(wrapper.text()).toContain('Added 3 HPO terms to NA19675')

  // the checks below would fail if the note were sent anywhere
  expect(containsNoteText(`prefix ${NOTE.slice(75, 87)} suffix`)).toBe(true)
  expect(containsNoteText('{"notes":"Quuxley"}')).toBe(true)
  expect(containsNoteText(JSON.stringify(DEFAULT_SAVE_BODY))).toBe(false)

  const calls = getFetchCalls()
  expect(calls.map(({ url, method }) => [url, method])).toEqual([['/api/hpo_vocabulary?', 'GET'], [SAVE_URL, 'POST']])
  calls.forEach(({ url, body }) => {
    expect(containsNoteText(url)).toBe(false)
    expect(containsNoteText(body || '')).toBe(false)
    SENTINELS.forEach((sentinel) => {
      expect(`${url} ${body}`.toLowerCase()).not.toContain(sentinel.toLowerCase())
    })
  })
  fetch.mock.calls.forEach((args) => {
    expect(containsNoteText(JSON.stringify(args))).toBe(false)
  })

  expect(containsNoteFragment(JSON.stringify(store.getState()))).toBe(false)
  expect(store.getDispatched().length).toBeGreaterThan(0)
  expect(containsNoteFragment(JSON.stringify(store.getDispatched()))).toBe(false)

  expect(setItem).not.toHaveBeenCalled()
  expect(localStorage.length).toEqual(0)
  expect(sessionStorage.length).toEqual(0)
  expect(containsNoteFragment(JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).toBe(false)
  expect(document.cookie).toEqual(initialCookie)
  expect(window.location.href).toEqual(initialHref)

  // once applied, the note is no longer rendered or held by the dialog
  expect(containsNoteFragment(wrapper.html())).toBe(false)
  wrapper.unmount()
  setItem.mockRestore()
})
