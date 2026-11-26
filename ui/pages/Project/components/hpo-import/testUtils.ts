import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import { act } from 'react-dom/test-utils'
import { flushAll } from 'shared/utils/testHelpers'

import rootReducer from 'redux/rootReducer'
import { STATE_WITH_2_FAMILIES } from '../../fixtures'

export const INDIVIDUAL_GUID = 'I021475_na19675_1'
export const FATHER_GUID = 'I021476_na19678_1'
export const MOTHER_GUID = 'I021474_na19679_1'

export const VOCABULARY = [
  ['HP:0000252', 'Microcephaly', 'HP:0000240', []],
  ['HP:0000365', 'Hearing impairment', 'HP:0000364', ['Hearing loss']],
  ['HP:0001250', 'Seizure', 'HP:0012638', ['Seizures']],
  ['HP:0001252', 'Hypotonia', 'HP:0003808', ['Low muscle tone']],
  ['HP:0001324', 'Muscle weakness', 'HP:0011804', []],
  ['HP:0001513', 'Obesity', 'HP:0004324', []],
  ['HP:0001631', 'Atrial septal defect', 'HP:0001671', ['Defect in the atrial septum']],
  ['HP:0002315', 'Headache', 'HP:0012638', []],
  ['HP:0002650', 'Scoliosis', 'HP:0002943', []],
]

const LABELS = VOCABULARY.reduce((acc, [id, label]) => ({ ...acc, [id]: label }), {})

// Identifying details that must never leave the text area
export const SENTINELS = ['Zebedee', 'Quuxley', '99-431-7', '03/04/2019', 'Wobblethorpe']

// Stretches of the note, including the wording of every matched term, that must not be stored anywhere
export const NOTE_FRAGMENTS = [
  ...SENTINELS, 'seen at', 'Has seizures', 'low muscle tone', 'No microcephaly', 'Possible scoliosis', 'Mother has',
  'hearing loss', 'weakness noted', 'defect on echo', 'Headaches reported', 'no headache',
]

export const containsNoteFragment = haystack => NOTE_FRAGMENTS.some(fragment => haystack.includes(fragment))

export const NOTE = 'Zebedee Quuxley (MRN 99-431-7) DOB 03/04/2019, seen at Wobblethorpe clinic. Has seizures and ' +
  'low muscle tone. No microcephaly. Possible scoliosis. Mother has hearing loss. Muscle weakness noted; atrial ' +
  'septal defect on echo. Headaches reported, no headache now.'

export const STATE = {
  ...STATE_WITH_2_FAMILIES,
  individualsByGuid: {
    ...STATE_WITH_2_FAMILIES.individualsByGuid,
    [INDIVIDUAL_GUID]: {
      ...STATE_WITH_2_FAMILIES.individualsByGuid[INDIVIDUAL_GUID],
      features: [{
        id: 'HP:0001324',
        label: 'Muscle weakness',
        category: 'HP:0003011',
        notes: 'proximal',
        qualifiers: [{ type: 'severity', label: 'Mild' }],
      }],
      absentFeatures: [{ id: 'HP:0001631', label: 'Defect in the atrial septum', category: 'HP:0001626' }],
      nonstandardFeatures: [{ id: 'Odd gait', notes: 'since 2y' }],
      absentNonstandardFeatures: null,
    },
  },
}

export const createTestStore = (state = STATE) => {
  // The page fixtures hold some keys of other pages' reducers, which createStore would warn about
  const reducerKeys = Object.keys(rootReducer(undefined, { type: 'INIT_TEST_STORE' }))
  const initialState = reducerKeys.reduce((acc, key) => (key in state ? { ...acc, [key]: state[key] } : acc), {})
  const actions = []
  const recordActions = () => next => (action) => {
    actions.push(action)
    return next(action)
  }
  const store = createStore(rootReducer, initialState, applyMiddleware(thunk, recordActions))
  store.getDispatched = () => actions
  return store
}

const jsonResponse = (json, ok = true) => Promise.resolve({
  ok, status: ok ? 200 : 400, statusText: 'Bad Request', json: () => Promise.resolve(json),
})

const addLabels = features => features && features.map(feature => ({ ...feature, label: LABELS[feature.id] }))

// Routes the global fetch() mock: the vocabulary, the HPO terms save endpoint and the term search
export const mockApi = ({ vocabulary = { version: '2025-03-03', terms: VOCABULARY }, saveError } = {}) => {
  fetch.mockImplementation((url, options) => {
    if (url.startsWith('/api/hpo_vocabulary')) {
      return vocabulary ? jsonResponse(vocabulary) : jsonResponse({ error: 'Vocabulary unavailable' }, false)
    }
    const saveMatch = url.match(/^\/api\/individual\/([^/]+)\/update_hpo_terms$/)
    if (saveMatch) {
      if (saveError) {
        return jsonResponse({ error: saveError }, false)
      }
      const body = JSON.parse(options.body)
      return jsonResponse({
        [saveMatch[1]]: {
          features: addLabels(body.features),
          absentFeatures: addLabels(body.absentFeatures),
          nonstandardFeatures: body.nonstandardFeatures,
          absentNonstandardFeatures: body.absentNonstandardFeatures,
        },
      })
    }
    return jsonResponse({})
  })
}

export const getFetchCalls = () => fetch.mock.calls.map(([url, options]) => ({
  url, method: (options || {}).method, body: (options || {}).body,
}))

export const getSaveCalls = () => getFetchCalls().filter(({ url }) => url.includes('update_hpo_terms')).map(
  ({ url, method, body }) => ({ url, method, body: JSON.parse(body) }),
)

const WINDOW_SIZE = 10

// True if any identifying detail or any 10 character stretch of the note occurs in the given string
export const containsNoteText = (haystack, note = NOTE) => {
  if (SENTINELS.some(sentinel => haystack.includes(sentinel))) {
    return true
  }
  for (let i = 0; i + WINDOW_SIZE <= note.length; i += 1) {
    if (haystack.includes(note.slice(i, i + WINDOW_SIZE))) {
      return true
    }
  }
  return false
}

// Lets pending requests resolve and the resulting state updates render
export const flush = async (wrapper) => {
  await act(async () => {
    await flushAll()
  })
  wrapper.update()
}
