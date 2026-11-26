import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'

import { flushAll, mockFetchResponse, getLastFetchUrl, getLastFetchOptions, getLastFetchBody } from 'shared/utils/testHelpers'
import ImportPhenopackets, { getDefaultSelections } from './ImportPhenopackets'
import ImportPhenopacketsButton from './ImportPhenopacketsButton'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const PROJECT_GUID = 'R0237_1000_genomes_demo'
const STATE = { currentProjectGuid: PROJECT_GUID, modal: {} }

const HPO_CHANGE = {
  field: 'features',
  label: 'HPO terms',
  isList: true,
  current: ['Arrhythmia (HP:0011675)', 'Absent: Nausea and vomiting (HP:0002017)'],
  proposed: ['Nausea and vomiting (HP:0002017)', 'Failure to thrive (HP:0001508)'],
  added: ['Failure to thrive (HP:0001508)'],
  removed: ['Arrhythmia (HP:0011675)', 'Absent: Nausea and vomiting (HP:0002017)'],
  conflicts: ['Nausea and vomiting (HP:0002017)'],
  canMerge: true,
  canReplace: true,
  conflict: true,
}
const PREVIEW = {
  uploadedFileId: 'abc123',
  info: ['4 subject(s) read from 2 file(s)', '2 existing individual(s) have proposed changes'],
  individuals: [{
    individualGuid: 'I1_na19675',
    individualId: 'NA19675',
    familyId: '1',
    unknownHpoTerms: ['HP:0004322'],
    warnings: ['measurements is present but is not imported: seqr has no field for it'],
    changes: [HPO_CHANGE, {
      field: 'disorders',
      label: 'Disorders (OMIM)',
      isList: true,
      current: [],
      proposed: ['OMIM:236250'],
      added: ['OMIM:236250'],
      removed: [],
      canMerge: true,
      canReplace: false,
      conflict: false,
    }, {
      field: 'birthYear',
      label: 'Birth year',
      isList: false,
      current: '1999',
      proposed: '2001',
      canMerge: false,
      canReplace: true,
      conflict: true,
    }, {
      field: 'onsetAge',
      label: 'Age of onset',
      isList: false,
      current: null,
      proposed: 'Childhood onset',
      canMerge: true,
      canReplace: false,
      conflict: false,
    }, {
      field: 'candidateGenes',
      label: 'Candidate genes',
      isList: true,
      current: ['MTHFR', 'CDC7'],
      proposed: ['MTHFR'],
      added: [],
      removed: ['CDC7'],
      canMerge: false,
      canReplace: true,
      conflict: false,
    }],
  }, {
    individualGuid: 'I2_na19678',
    individualId: 'NA19678',
    familyId: '1',
    unknownHpoTerms: [],
    warnings: [],
    changes: [{
      field: 'mondoId',
      label: 'Family MONDO ID',
      isList: false,
      current: null,
      proposed: 'MONDO:0008788',
      canMerge: true,
      canReplace: false,
      conflict: false,
    }],
  }, {
    individualGuid: 'I3_na19679',
    individualId: 'NA19679',
    familyId: '1',
    unknownHpoTerms: [],
    warnings: ['The pedigree mother is not another individual in the same seqr family and is not proposed'],
    changes: [],
  }],
  unmatchedSubjects: ['EXT-0001', 'EXT-0002'],
  unchangedIndividuals: ['HG00731'],
  warnings: ['1 record(s) repeat a subject that was already read; only the first record for each subject is used'],
  ignoredFields: ['metaData.createdBy', 'subject.alternateIds'],
}

const FILES = [
  new File(['{"subject": {"id": "NA19675"}}'], 'jane_citizen.json', { type: 'application/json' }),
  new File(['{"members": []}'], 'clinic_cohort.json', { type: 'application/json' }),
]

const mountImport = (store = configureStore(STATE)) => mount(
  <Provider store={store}>
    <ImportPhenopackets modalName="test" />
  </Provider>,
)

const selectFiles = async (wrapper, files = FILES) => {
  wrapper.find('input[type="file"]').simulate('change', { target: { files, value: 'C:\\fakepath\\jane_citizen.json' } })
  await flushAll()
  wrapper.update()
}

const uploadPreview = async (wrapper, preview = PREVIEW) => {
  mockFetchResponse(preview)
  await selectFiles(wrapper)
}

const getCheckbox = (wrapper, individualGuid, field, value) => wrapper.find('Checkbox').filterWhere(
  checkbox => checkbox.prop('name') === `${individualGuid}|${field}` && checkbox.prop('value') === value,
)

const toggle = (wrapper, individualGuid, field, value) => {
  getCheckbox(wrapper, individualGuid, field, value).find('input').simulate('change')
  wrapper.update()
}

const applyButton = wrapper => wrapper.find('Button').filterWhere(button => /^Apply/.test(button.prop('content')))

test('explains what is imported and shows no review before a file is chosen', () => {
  const wrapper = mountImport()

  expect(wrapper.text()).toContain('Import clinical data from GA4GH Phenopackets (v2) JSON files')
  expect(wrapper.text()).toContain('REDCap, PhenoTips, FHIR and other sources must first be exported or converted')
  expect(wrapper.text()).toContain('no individuals are created')
  expect(wrapper.text()).toContain('Names, alternate ids, full dates, free-text descriptions, files and authorship are ignored')
  expect(wrapper.find('input[type="file"]').prop('multiple')).toBe(true)
  expect(applyButton(wrapper).exists()).toBe(false)
  expect(wrapper.find('.phenopacket-individual').exists()).toBe(false)
})

test('opens the file browser from the choose files button', () => {
  const wrapper = mountImport()
  const click = jest.spyOn(wrapper.find('input[type="file"]').getDOMNode(), 'click')

  wrapper.find('Button').filterWhere(button => button.prop('content') === 'Choose files').simulate('click')

  expect(click).toHaveBeenCalledTimes(1)
})

test('uploads the chosen files as multipart data under generic names and shows the review', async () => {
  const wrapper = mountImport()
  await uploadPreview(wrapper)

  expect(fetch).toHaveBeenCalledTimes(1)
  expect(getLastFetchUrl()).toEqual(`/api/project/${PROJECT_GUID}/upload_phenopackets`)
  const options = getLastFetchOptions()
  expect(options.method).toEqual('POST')
  expect(options.body).toBeInstanceOf(FormData)
  expect(Array.from(options.body.keys())).toEqual(['file_0', 'file_1'])
  expect(options.body.get('file_0').name).toEqual('phenopacket_1.json')
  expect(options.body.get('file_1').name).toEqual('phenopacket_2.json')
  expect(Object.keys(options.headers)).toEqual(['X-CSRFToken'])

  // the uploader sees their own file names, numbered to match the "File N" errors
  expect(wrapper.find('.phenopacket-files').hostNodes().text()).toEqual('jane_citizen.jsonclinic_cohort.json')

  const text = wrapper.text()
  expect(text).toContain('4 subject(s) read from 2 file(s)')
  expect(text).toContain('Fields present in the files that are ignored and not stored')
  expect(text).toContain('metaData.createdBy, subject.alternateIds')
  expect(text).toContain('1 record(s) repeat a subject that was already read')
  expect(text).toContain('Subjects with no matching Individual ID in this project, which will not be imported')
  expect(text).toContain('EXT-0001, EXT-0002')
  expect(text).toContain('Individuals with nothing new to import')
  expect(text).toContain('HG00731')

  const individuals = wrapper.find('.phenopacket-individual').hostNodes()
  expect(individuals).toHaveLength(3)
  const first = individuals.at(0).text()
  expect(first).toContain('NA19675 (family 1)')
  expect(first).toContain("HPO terms not in seqr's HPO data, which will not be added: HP:0004322")
  expect(first).toContain('measurements is present but is not imported')
  expect(first).toContain('Add: Failure to thrive (HP:0001508)')
  expect(first).toContain('Replace would set: Nausea and vomiting (HP:0002017); Failure to thrive (HP:0001508)')
  expect(first).toContain('(removing Arrhythmia (HP:0011675); Absent: Nausea and vomiting (HP:0002017))')
  expect(first).toContain('Conflict: recorded the opposite way in seqr and kept unless replaced: Nausea and vomiting (HP:0002017)')
  expect(first).toContain('Add: OMIM:236250')
  expect(first).toContain('1999 → 2001')
  expect(first).toContain('Conflict: existing value is kept unless replaced')
  expect(first).toContain('not set → Childhood onset')
  expect(first).toContain('Nothing new to add')
  expect(first).toContain('Replace would set: MTHFR (removing CDC7)')
  expect(individuals.at(1).text()).toContain('not set → MONDO:0008788')
  expect(individuals.at(1).text()).not.toContain('Conflict')
  expect(individuals.at(2).text()).toContain('The pedigree mother is not another individual')
  expect(individuals.at(2).text()).toContain('No changes to apply')

  // conflicts are highlighted
  const rows = individuals.at(0).find('TableRow')
  expect(rows.map(row => row.prop('negative'))).toEqual([true, false, true, false, false])

  // merges are selected by default, replacing is always opt-in
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'merge').prop('checked')).toBe(true)
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'replace').prop('checked')).toBe(false)
  expect(getCheckbox(wrapper, 'I1_na19675', 'disorders', 'replace').exists()).toBe(false)
  expect(getCheckbox(wrapper, 'I1_na19675', 'birthYear', 'merge').exists()).toBe(false)
  expect(getCheckbox(wrapper, 'I1_na19675', 'birthYear', 'replace').prop('checked')).toBe(false)
  expect(getCheckbox(wrapper, 'I1_na19675', 'candidateGenes', 'replace').prop('checked')).toBe(false)
  expect(applyButton(wrapper).prop('content')).toEqual('Apply 4 selected change(s)')
  expect(applyButton(wrapper).prop('disabled')).toBe(false)
})

test('applies only the selected changes with the selected modes', async () => {
  const store = configureStore(STATE)
  const wrapper = mountImport(store)
  await uploadPreview(wrapper)

  toggle(wrapper, 'I1_na19675', 'disorders', 'merge')
  expect(applyButton(wrapper).prop('content')).toEqual('Apply 3 selected change(s)')
  toggle(wrapper, 'I1_na19675', 'birthYear', 'replace')
  toggle(wrapper, 'I1_na19675', 'features', 'replace')
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'merge').prop('checked')).toBe(true)
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'replace').prop('checked')).toBe(true)
  toggle(wrapper, 'I1_na19675', 'candidateGenes', 'replace')
  toggle(wrapper, 'I1_na19675', 'candidateGenes', 'replace')
  toggle(wrapper, 'I2_na19678', 'mondoId', 'merge')
  expect(applyButton(wrapper).prop('content')).toEqual('Apply 3 selected change(s)')

  const updates = { individualsByGuid: { I1_na19675: { individualGuid: 'I1_na19675', birthYear: 2001 } } }
  mockFetchResponse(updates)
  applyButton(wrapper).simulate('click')
  await flushAll()
  wrapper.update()

  expect(getLastFetchUrl()).toEqual(`/api/project/${PROJECT_GUID}/save_phenopackets/abc123`)
  expect(getLastFetchBody()).toEqual({
    individuals: { I1_na19675: { features: 'replace', onsetAge: 'merge', birthYear: 'replace' } },
  })
  expect(store.getActions()).toEqual([{ type: 'RECEIVE_DATA', updatesById: updates }])
  expect(wrapper.text()).toContain('Clinical data applied to 1 individual(s)')
  expect(wrapper.find('.phenopacket-individual').exists()).toBe(false)
  expect(applyButton(wrapper).exists()).toBe(false)
})

test('unticking replace falls back to merge for lists and to no change for conflicting values', async () => {
  const wrapper = mountImport()
  await uploadPreview(wrapper)

  toggle(wrapper, 'I1_na19675', 'features', 'replace')
  toggle(wrapper, 'I1_na19675', 'features', 'replace')
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'merge').prop('checked')).toBe(true)
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'replace').prop('checked')).toBe(false)

  toggle(wrapper, 'I1_na19675', 'features', 'merge')
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'merge').prop('checked')).toBe(false)
  toggle(wrapper, 'I1_na19675', 'features', 'replace')
  toggle(wrapper, 'I1_na19675', 'features', 'merge')
  expect(getCheckbox(wrapper, 'I1_na19675', 'features', 'replace').prop('checked')).toBe(false)

  toggle(wrapper, 'I1_na19675', 'birthYear', 'replace')
  expect(getCheckbox(wrapper, 'I1_na19675', 'birthYear', 'replace').prop('checked')).toBe(true)
  toggle(wrapper, 'I1_na19675', 'birthYear', 'replace')
  expect(getCheckbox(wrapper, 'I1_na19675', 'birthYear', 'replace').prop('checked')).toBe(false)

  toggle(wrapper, 'I1_na19675', 'disorders', 'merge')
  toggle(wrapper, 'I1_na19675', 'onsetAge', 'merge')
  toggle(wrapper, 'I2_na19678', 'mondoId', 'merge')
  expect(applyButton(wrapper).prop('content')).toEqual('Apply 0 selected change(s)')
  expect(applyButton(wrapper).prop('disabled')).toBe(true)
})

test('shows server errors from a rejected upload and recovers on the next upload', async () => {
  const wrapper = mountImport()

  mockFetchResponse({ errors: ['File 1: subject.id: required string is missing'], warnings: [] }, { ok: false })
  await selectFiles(wrapper)
  expect(wrapper.text()).toContain('Unable to import')
  expect(wrapper.text()).toContain('File 1: subject.id: required string is missing')
  expect(applyButton(wrapper).exists()).toBe(false)

  mockFetchResponse({ error: 'Permission Denied' }, { ok: false, status: 403 })
  await selectFiles(wrapper)
  expect(wrapper.text()).toContain('Permission Denied')
  expect(wrapper.text()).not.toContain('subject.id')

  fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) }))
  await selectFiles(wrapper)
  expect(wrapper.text()).toContain('Upload failed (502)')

  await uploadPreview(wrapper)
  expect(wrapper.text()).not.toContain('Unable to import')
  expect(wrapper.find('.phenopacket-individual').hostNodes()).toHaveLength(3)
})

test('keeps the review and shows the error when applying fails', async () => {
  const store = configureStore(STATE)
  const wrapper = mountImport(store)
  await uploadPreview(wrapper)

  fetch.mockImplementationOnce(() => Promise.resolve({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: () => Promise.resolve({ errors: ['I1_na19675: birthYear is not a proposed change'], warnings: null }),
  }))
  applyButton(wrapper).simulate('click')
  await flushAll()
  wrapper.update()
  expect(wrapper.text()).toContain('I1_na19675: birthYear is not a proposed change')
  expect(wrapper.find('.phenopacket-individual').hostNodes()).toHaveLength(3)
  expect(store.getActions()).toEqual([])

  mockFetchResponse({ error: 'Permission Denied' }, { ok: false, status: 403 })
  applyButton(wrapper).simulate('click')
  await flushAll()
  wrapper.update()
  expect(wrapper.text()).toContain('Permission Denied')
  expect(wrapper.text()).not.toContain('birthYear is not a proposed change')

  fetch.mockImplementationOnce(() => Promise.reject({})) // eslint-disable-line prefer-promise-reject-errors
  applyButton(wrapper).simulate('click')
  await flushAll()
  wrapper.update()
  expect(wrapper.text()).toContain('Request failed')
  expect(applyButton(wrapper).prop('disabled')).toBe(false)
})

test('uploads dropped files and ignores an empty selection', async () => {
  const wrapper = mountImport()
  const dropZone = wrapper.find('.phenopacket-drop').hostNodes()

  const dragOver = { preventDefault: jest.fn() }
  dropZone.simulate('dragover', dragOver)
  expect(dragOver.preventDefault).toHaveBeenCalled()

  await selectFiles(wrapper, [])
  wrapper.find('input[type="file"]').simulate('change', { target: { files: null, value: '' } })
  await flushAll()
  expect(fetch).not.toHaveBeenCalled()

  mockFetchResponse({ ...PREVIEW, individuals: [], unmatchedSubjects: [], unchangedIndividuals: [], warnings: [], ignoredFields: [] })
  const drop = { preventDefault: jest.fn(), dataTransfer: { files: [FILES[1]] } }
  dropZone.simulate('drop', drop)
  await flushAll()
  wrapper.update()

  expect(drop.preventDefault).toHaveBeenCalled()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(Array.from(getLastFetchOptions().body.keys())).toEqual(['file_0'])
  expect(wrapper.find('.phenopacket-files').hostNodes().text()).toEqual('clinic_cohort.json')
  expect(wrapper.text()).not.toContain('Subjects with no matching Individual ID')
  expect(wrapper.text()).not.toContain('Individuals with nothing new to import')
  expect(wrapper.text()).not.toContain('ignored and not stored')
  expect(applyButton(wrapper).prop('disabled')).toBe(true)
})

test('selects only changes that can be merged by default', () => {
  expect(getDefaultSelections(PREVIEW)).toEqual({
    I1_na19675: { features: 'merge', disorders: 'merge', onsetAge: 'merge' },
    I2_na19678: { mondoId: 'merge' },
    I3_na19679: {},
  })
})

test('opens the import from its own button', () => {
  const closed = mount(
    <Provider store={configureStore(STATE)}>
      <ImportPhenopacketsButton />
    </Provider>,
  )
  expect(closed.text()).toEqual('Import clinical data (Phenopackets)')

  const open = mount(
    <Provider store={configureStore({ ...STATE, modal: { importPhenopackets: { open: true } } })}>
      <ImportPhenopacketsButton />
    </Provider>,
  )
  expect(open.find('BaseImportPhenopackets').prop('projectGuid')).toEqual(PROJECT_GUID)
  expect(open.find('input[type="file"]').exists()).toBe(true)
})
