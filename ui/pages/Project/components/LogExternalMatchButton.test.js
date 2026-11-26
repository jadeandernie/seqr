import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureMockStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { mockFetchResponse, flushAll, getLastFetchUrl, getLastFetchBody } from 'shared/utils/testHelpers'
import { STATE_WITH_2_FAMILIES } from '../fixtures'
import Matchmaker from './Matchmaker'
import LogExternalMatchButton, { parseListInput } from './LogExternalMatchButton'

configure({ adapter: new Adapter() })

const configureStore = configureMockStore([thunk])

const SUBMISSION_GUID = 'MS021475_na19675_1'
const MODAL_ID = `${SUBMISSION_GUID}_-_logExternalMatch`
const MATCH = { params: { familyGuid: 'F011652_1' } }

const mountButton = (props) => {
  const store = configureStore({ modal: { [MODAL_ID]: { open: true } } })
  const wrapper = mount(
    <Provider store={store}>
      <LogExternalMatchButton submissionGuid={SUBMISSION_GUID} {...props} />
    </Provider>,
  )
  return { store, wrapper }
}

test('parseListInput splits genes and HPO terms', () => {
  expect(parseListInput('MFSD9, ENSG00000135953;OR4F5\nHP:0001250  ')).toEqual(
    ['MFSD9', 'ENSG00000135953', 'OR4F5', 'HP:0001250'],
  )
  expect(parseListInput(' , ')).toEqual([])
  expect(parseListInput('')).toEqual([])
  expect(parseListInput(undefined)).toEqual([])
})

test('is available for a submitted individual on the matchmaker page', () => {
  const wrapper = mount(
    <Provider store={configureStore(STATE_WITH_2_FAMILIES)}>
      <Matchmaker match={MATCH} />
    </Provider>,
  )
  const button = wrapper.find('ButtonLink[content="Log External Match"]')
  expect(button).toHaveLength(1)
  expect(button.prop('disabled')).toBeFalsy()
  expect(wrapper.find({ modalId: MODAL_ID }).first().prop('initialValues')).toEqual({
    submissionGuid: SUBMISSION_GUID, source: 'variantmatcher',
  })
})

test('validates the logged match fields', () => {
  const { wrapper } = mountButton({ disabled: true })
  expect(wrapper.find('ButtonLink[content="Log External Match"]').prop('disabled')).toBe(true)

  const getField = name => wrapper.find(`ForwardRef(Field)[name="${name}"]`).first()
  expect(wrapper.find('ForwardRef(Field)').map(field => field.prop('name'))).toEqual([
    'source', 'institution', 'contactName', 'contactEmail', 'genes', 'hpoTerms',
  ])
  expect(wrapper.find('FormWrapper').prop('initialValues')).toEqual({
    submissionGuid: SUBMISSION_GUID, source: 'variantmatcher',
  })
  expect(getField('source').prop('options').map(({ value }) => value)).toEqual([
    'variantmatcher', 'genematcher', 'other',
  ])

  expect(getField('institution').prop('validate')('')).toEqual('Required')
  expect(getField('institution').prop('validate')('A Lab')).toBeUndefined()
  expect(getField('source').prop('validate')(undefined)).toEqual('Required')

  const validateEmail = getField('contactEmail').prop('validate')
  expect(validateEmail('pi@lab.org')).toBeUndefined()
  expect(validateEmail(undefined)).toEqual('Invalid email address')
  expect(validateEmail('A 5 year old patient with seizures')).toEqual('Invalid email address')
  expect(validateEmail('mailto:pi@lab.org')).toEqual('Invalid email address')

  const validateHpoTerms = getField('hpoTerms').prop('validate')
  expect(validateHpoTerms(undefined)).toBeUndefined()
  expect(validateHpoTerms('HP:0001250, HP:0001252')).toBeUndefined()
  expect(validateHpoTerms('HP:0001250, seizures HP:12')).toEqual('Invalid HPO terms: seizures, HP:12')
  expect(getField('contactName').prop('validate')).toBeUndefined()
  expect(getField('genes').prop('validate')).toBeUndefined()
})

test('submits the logged match and adds it to the matches for the submission', async () => {
  const { store, wrapper } = mountButton()

  const responseJson = { mmeResultsByGuid: { MR_new: { id: 'variantmatcher-1', submissionGuid: SUBMISSION_GUID } } }
  mockFetchResponse(responseJson)
  wrapper.find('FormWrapper').prop('onSubmit')({
    submissionGuid: SUBMISSION_GUID,
    source: 'variantmatcher',
    institution: 'A Lab',
    contactEmail: 'pi@lab.org',
    genes: 'MFSD9, OR4F5',
    hpoTerms: 'HP:0001250',
  })
  await flushAll()

  expect(getLastFetchUrl()).toEqual(`/api/matchmaker/submission/${SUBMISSION_GUID}/log_external_match`)
  expect(getLastFetchBody()).toEqual({
    submissionGuid: SUBMISSION_GUID,
    source: 'variantmatcher',
    institution: 'A Lab',
    contactEmail: 'pi@lab.org',
    genes: ['MFSD9', 'OR4F5'],
    hpoTerms: ['HP:0001250'],
  })
  expect(store.getActions()).toContainEqual({ type: 'RECEIVE_DATA', updatesById: responseJson })

  // A match with no genes or phenotypes entered is sent with empty lists for the server to reject
  mockFetchResponse({ errors: ['Genes or HPO terms are required'] }, { ok: false, status: 400 })
  const submitted = wrapper.find('FormWrapper').prop('onSubmit')({ submissionGuid: SUBMISSION_GUID, source: 'other' })
  await expect(submitted).rejects.toThrow()
  expect(getLastFetchBody()).toEqual({ submissionGuid: SUBMISSION_GUID, source: 'other', genes: [], hpoTerms: [] })
  expect(store.getActions().filter(({ type }) => type === 'RECEIVE_DATA')).toHaveLength(1)
})
