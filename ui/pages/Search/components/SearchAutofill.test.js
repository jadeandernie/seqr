import React from 'react'
import { mount, configure } from 'enzyme'
import { act } from 'react-dom/test-utils'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Form, Field } from 'react-final-form'

import { configuredField } from 'shared/components/form/FormHelpers'
import SearchAutofill from './SearchAutofill'
import { INHERITANCE_PANEL } from './VariantSearchFormPanelConfigs'
import { INHERITANCE_FILTER_LOOKUP } from '../constants'

configure({ adapter: new Adapter() })

const SINGLE_FAMILY = [{ projectGuid: 'R0237_1000_genomes_demo', familyGuids: ['F011652_1'] }]
const INITIAL_SEARCH = {
  inheritance: { mode: 'any_affected', filter: INHERITANCE_FILTER_LOOKUP.any_affected },
  locus: { rawItems: 'CFTR' },
  freqs: { gnomad_genomes: { af: 0.01 } },
}

const suggestion = (type, value, label) => (
  { id: `${type}:${value}`, type, value, label: label || value, sources: ['pedigree'], why: `Why ${value}.` }
)
const RESPONSE = {
  familyGuid: 'F011652_1',
  suggestions: [
    suggestion('inheritance', 'de_novo'), suggestion('inheritance', 'recessive'),
    suggestion('gene', 'MTHFR'), suggestion('gene', 'OR4F5'), suggestion('gene_list', 'LL001', 'Retina proteome'),
  ],
  notes: [],
}

const INHERITANCE_FIELD = { ...INHERITANCE_PANEL.headerProps.inputProps, name: 'search.inheritance' }

const flush = async (wrapper) => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  wrapper.update()
}

const mountForm = (initialValues) => {
  let form
  const onSubmit = jest.fn()
  const wrapper = mount(
    <Form onSubmit={onSubmit} initialValues={initialValues}>
      {(props) => {
        form = props.form // eslint-disable-line prefer-destructuring
        return (
          <form onSubmit={props.handleSubmit}>
            <SearchAutofill />
            {configuredField(INHERITANCE_FIELD)}
            <Field name="search.locus.rawItems" component="textarea" />
          </form>
        )
      }}
    </Form>,
  )
  return { wrapper, onSubmit, getValues: () => form.getState().values, form }
}

const toggle = (wrapper, id) => {
  act(() => {
    wrapper.find('Checkbox').filterWhere(c => c.prop('id') === id).prop('onChange')()
  })
  wrapper.update()
}

const inheritanceSelectValue = wrapper => wrapper.find('Select').first().prop('value')

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) }))
})

afterEach(() => {
  delete global.fetch
})

test('renders Clear and Autofill controls without loading suggestions', () => {
  const { wrapper } = mountForm({ projectFamilies: SINGLE_FAMILY, search: INITIAL_SEARCH })

  expect(wrapper.find('Button.clear-search').text()).toEqual('Clear')
  expect(wrapper.find('Button.autofill-search').text()).toEqual('Autofill from clinical records')
  expect(wrapper.find('Button.autofill-search').prop('disabled')).toBe(false)
  expect(wrapper.find('Popup')).toHaveLength(0)
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
  expect(global.fetch).not.toHaveBeenCalled()
  expect(inheritanceSelectValue(wrapper)).toEqual('any_affected')
})

test('Clear resets the search to the empty search used by the "None" saved search', () => {
  const { wrapper, getValues, onSubmit } = mountForm({ projectFamilies: SINGLE_FAMILY, search: INITIAL_SEARCH })

  wrapper.find('button.clear-search').simulate('click')
  wrapper.update()

  expect(getValues()).toEqual({ projectFamilies: SINGLE_FAMILY, search: {} })
  expect(inheritanceSelectValue(wrapper)).toEqual('all')
  expect(wrapper.find('textarea').prop('value')).toEqual('')
  expect(onSubmit).not.toHaveBeenCalled()
  expect(global.fetch).not.toHaveBeenCalled()
})

test('Autofill applies only the selected suggestions to the editable form fields', async () => {
  const { wrapper, getValues, onSubmit } = mountForm({ projectFamilies: SINGLE_FAMILY, search: INITIAL_SEARCH })

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(global.fetch.mock.calls[0][0]).toEqual('/api/family/F011652_1/search_suggestions?')
  expect(wrapper.find('SearchSuggestionsPanel').prop('familyGuid')).toEqual('F011652_1')
  expect(wrapper.find('.suggestion-group-inheritance label').first().text()).toEqual(
    'De Novo/ Dominant — Why de_novo.',
  )
  // Opening the review panel changes nothing
  expect(getValues().search).toEqual(INITIAL_SEARCH)

  toggle(wrapper, 'inheritance:recessive')
  toggle(wrapper, 'gene:OR4F5')
  expect(getValues().search).toEqual(INITIAL_SEARCH)

  wrapper.find('button.apply-suggestions').simulate('click')
  wrapper.update()

  expect(getValues()).toEqual({
    projectFamilies: SINGLE_FAMILY,
    search: {
      inheritance: { mode: 'recessive', filter: INHERITANCE_FILTER_LOOKUP.recessive },
      locus: { rawItems: 'CFTR, OR4F5' },
      freqs: { gnomad_genomes: { af: 0.01 } },
    },
  })
  expect(inheritanceSelectValue(wrapper)).toEqual('recessive')
  expect(wrapper.find('textarea').prop('value')).toEqual('CFTR, OR4F5')
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
  expect(wrapper.find('Message.applied-suggestions').text()).toEqual(
    'Applied from the clinical recordInheritance: Recessive; Location genes: OR4F5. These values are now in the Inheritance and Location filters below, where they can be reviewed and edited before searching.',
  )
  expect(onSubmit).not.toHaveBeenCalled()

  // Applied values stay editable through the normal fields
  wrapper.find('textarea').simulate('change', { target: { value: 'CFTR' } })
  act(() => { wrapper.find('Select').first().prop('onChange')('de_novo') })
  wrapper.update()
  expect(getValues().search.locus).toEqual({ rawItems: 'CFTR' })
  expect(getValues().search.inheritance).toEqual({ mode: 'de_novo', filter: INHERITANCE_FILTER_LOOKUP.de_novo })

  // Clear removes the applied values and the confirmation
  wrapper.find('button.clear-search').simulate('click')
  wrapper.update()
  expect(getValues().search).toEqual({})
  expect(wrapper.find('Message.applied-suggestions')).toHaveLength(0)
})

test('Autofill can select a project gene list and reopening hides the previous confirmation', async () => {
  const { wrapper, getValues } = mountForm({ projectFamilies: SINGLE_FAMILY })

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  toggle(wrapper, 'gene_list:LL001')
  wrapper.find('button.apply-suggestions').simulate('click')
  wrapper.update()

  expect(getValues().search).toEqual({ locus: { locusListGuid: 'LL001' } })
  expect(wrapper.find('Message.applied-suggestions').text()).toContain('Location gene list: Retina proteome.')

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  expect(wrapper.find('Message.applied-suggestions')).toHaveLength(0)
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(1)
  expect(global.fetch).toHaveBeenCalledTimes(2)
})

test('Cancel and Clear close the review panel without applying', async () => {
  const { wrapper, getValues } = mountForm({ projectFamilies: SINGLE_FAMILY, search: INITIAL_SEARCH })

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  toggle(wrapper, 'gene:MTHFR')
  wrapper.find('button.cancel-suggestions').simulate('click')
  wrapper.update()
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
  expect(wrapper.find('Message.applied-suggestions')).toHaveLength(0)
  expect(getValues().search).toEqual(INITIAL_SEARCH)

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  wrapper.find('button.clear-search').simulate('click')
  wrapper.update()
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
  expect(getValues().search).toEqual({})
})

test('Autofill is disabled with an explanation for multi-family searches', () => {
  const multiFamilyContexts = [
    [{ projectGuid: 'R0237_1000_genomes_demo', familyGuids: ['F011652_1', 'F011653_2'] }],
    [...SINGLE_FAMILY, { projectGuid: 'R0238_other', familyGuids: ['F011654_3'] }],
    [{ projectGuid: 'R0237_1000_genomes_demo', analysisGroupGuid: 'AG0000183_test_group' }],
    undefined,
  ]
  multiFamilyContexts.forEach((projectFamilies) => {
    const { wrapper, getValues } = mountForm({ projectFamilies, search: INITIAL_SEARCH })

    expect(wrapper.find('Button.autofill-search').prop('disabled')).toBe(true)
    expect(wrapper.find('Popup').prop('content')).toEqual(
      'Autofill from clinical records is only available when searching a single family',
    )
    wrapper.find('button.autofill-search').simulate('click')
    expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()

    // Clear is still available
    wrapper.find('button.clear-search').simulate('click')
    expect(getValues().search).toEqual({})
  })
})

test('the review panel closes if the search stops being a single-family search', async () => {
  const { wrapper, form } = mountForm({ projectFamilies: SINGLE_FAMILY, search: INITIAL_SEARCH })

  wrapper.find('button.autofill-search').simulate('click')
  await flush(wrapper)
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(1)

  act(() => {
    form.change('projectFamilies', [{ projectGuid: 'R0237_1000_genomes_demo', familyGuids: ['F011652_1', 'F2'] }])
  })
  wrapper.update()
  expect(wrapper.find('SearchSuggestionsPanel')).toHaveLength(0)
  expect(wrapper.find('Button.autofill-search').prop('disabled')).toBe(true)
})
