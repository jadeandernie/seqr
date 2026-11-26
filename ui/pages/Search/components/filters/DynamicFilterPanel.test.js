import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { Form } from 'react-final-form'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'

import { STATE } from '../../fixtures'
import schemaFixture from '../../filterSchemaFixture.json'
import { loadSearchFilterSchema, reducers } from '../../reducers'
import VariantSearchFormPanels from '../VariantSearchFormPanels'
import DynamicFilterPanel, {
  DynamicFilterSummary, LEGACY_FILTER_KEYS, getAdditionalFilterFields, getDynamicFilterSummary,
  getSearchAdditionalFilterFields,
} from './DynamicFilterPanel'

configure({ adapter: new Adapter() })

const SCHEMA = schemaFixture

const METHYLATION_FIELD = {
  key: 'methylation_outlier',
  group: 'in_silico',
  kind: 'min',
  scope: 'variant',
  label: 'Methylation Outlier',
  help: 'Outlier z-score of the nearest methylation region',
  integer: false,
  min: null,
  max: 20,
  step: 0.5,
  datasetTypes: ['SNV_INDEL'],
  legacyPath: ['in_silico', 'methylation_outlier'],
}
const TISSUE_FIELD = {
  key: 'methylation_tissue',
  group: 'in_silico',
  kind: 'enum',
  scope: 'variant',
  label: 'Methylation Tissue',
  options: [{ value: 'B', text: 'blood' }, { value: 'F', text: 'fibroblast' }],
  datasetTypes: ['SNV_INDEL'],
  legacyPath: ['in_silico', 'methylation_tissue'],
}
const COHORT_FIELD = {
  key: 'methylation_cohort_ac',
  group: 'frequency',
  kind: 'max',
  scope: 'variant',
  label: 'Methylation Cohort AC',
  help: 'Maximum allele count',
  integer: true,
  min: 0,
  max: null,
  step: null,
  datasetTypes: ['SNV_INDEL', 'MITO'],
  legacyPath: ['freqs', 'methylation_cohort', 'ac'],
}
const DEPTH_FIELD = {
  key: 'min_dp',
  group: 'quality',
  kind: 'min',
  scope: 'call',
  label: 'Minimum DP',
  integer: true,
  min: 0,
  max: null,
  step: 1,
  datasetTypes: ['SNV_INDEL'],
  legacyPath: ['qualityFilter', 'min_dp'],
}
const PHASED_FIELD = {
  key: 'phased_only',
  group: 'quality',
  kind: 'bool',
  scope: 'variant',
  label: 'Phased Only',
  datasetTypes: ['SV'],
  legacyPath: ['qualityFilter', 'phased_only'],
}
const NEW_FIELDS = [METHYLATION_FIELD, TISSUE_FIELD, COHORT_FIELD, DEPTH_FIELD, PHASED_FIELD]
const MOCK_SCHEMA = { 38: [...SCHEMA['38'], ...NEW_FIELDS] }

const keys = fields => fields.map(({ key }) => key)

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const SCHEMA_URL = '/api/search_filter_schema?'
const fetchMock = jest.fn()
const schemaRequests = () => fetchMock.mock.calls.filter(([url]) => url === SCHEMA_URL)
const schemaActions = store => store.getActions().filter(
  ({ type }) => type === 'RECEIVE_SEARCH_FILTER_SCHEMA',
)

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ searchFilterSchema: MOCK_SCHEMA }),
  }))
  global.fetch = fetchMock
})

test('every filter of the hard-coded panels is in the filter schema', () => {
  const schemaKeys = group => new Set(Object.values(SCHEMA).reduce(
    (acc, fields) => [...acc, ...fields.filter(field => field.group === group).map(({ key }) => key)], [],
  ))
  expect(LEGACY_FILTER_KEYS.in_silico.length).toEqual(23)
  expect(LEGACY_FILTER_KEYS.in_silico.filter(key => !schemaKeys('in_silico').has(key))).toEqual(
    // Offered by the In Silico panel but not filtered on by the search backend
    ['haplogroup_defining', 'mitotip'],
  )
  expect(LEGACY_FILTER_KEYS.frequency).toEqual([
    'gnomad_genomes_af', 'gnomad_genomes_ac', 'gnomad_genomes_hh', 'gnomad_exomes_af', 'gnomad_exomes_ac',
    'gnomad_exomes_hh', 'topmed_af', 'topmed_ac', 'callset_ac', 'callset_hh', 'gnomad_mito_af', 'gnomad_mito_ac',
    'gnomad_svs_af', 'gnomad_svs_ac', 'sv_callset_ac',
  ])
  expect(LEGACY_FILTER_KEYS.frequency.filter(key => !schemaKeys('frequency').has(key))).toEqual([])
  expect(LEGACY_FILTER_KEYS.quality.filter(key => !schemaKeys('quality').has(key))).toEqual(
    // A modifier of the other quality filters rather than a filter
    ['affected_only'],
  )
})

test('additional filters are the schema fields the hard-coded panels do not offer', () => {
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SNV_INDEL'], ['38']))).toEqual(['gnomad_noncoding', 'topmed_hh'])
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SNV_INDEL'], ['37']))).toEqual(['topmed_hh'])
  expect(keys(getAdditionalFilterFields(SCHEMA, ['MITO', 'SNV_INDEL'], ['38']))).toEqual([
    'gnomad_noncoding', 'topmed_hh', 'gnomad_mito_heteroplasmy_af', 'gnomad_mito_heteroplasmy_ac', 'helix_af',
    'helix_ac', 'helix_heteroplasmy_af', 'helix_heteroplasmy_ac', 'min_mitoCn',
  ])
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SV'], ['38']))).toEqual(['sv_callset_hh', 'sv_callset_af'])
  // Fields are listed once when searching across genome versions, or when the genome version is not loaded
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SNV_INDEL'], ['37', '38']))).toEqual(['topmed_hh', 'gnomad_noncoding'])
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SNV_INDEL'], []))).toEqual(['topmed_hh', 'gnomad_noncoding'])
  expect(keys(getAdditionalFilterFields(SCHEMA, ['SNV_INDEL'], ['39']))).toEqual(['topmed_hh', 'gnomad_noncoding'])
  expect(getAdditionalFilterFields(SCHEMA, [], ['38']).length).toEqual(11)

  expect(getAdditionalFilterFields(null, ['SNV_INDEL'], ['38'])).toEqual([])
  expect(getAdditionalFilterFields(undefined, [], [])).toEqual([])

  // A field added to the backend registry is offered with no UI change, unless the UI cannot render its kind
  const rangeField = { ...METHYLATION_FIELD, key: 'methylation_range', kind: 'range' }
  expect(keys(getAdditionalFilterFields({ 38: [...MOCK_SCHEMA['38'], rangeField] }, ['SNV_INDEL'], ['38']))).toEqual([
    'gnomad_noncoding', 'topmed_hh', 'methylation_outlier', 'methylation_tissue', 'methylation_cohort_ac', 'min_dp',
  ])
})

test('additional filters are selected for the searched projects', () => {
  const projectFamilies = [{ projectGuid: 'R0237_1000_genomes_demo', familyGuids: ['F011652_1'] }]
  const state = {
    ...STATE,
    searchFilterSchema: MOCK_SCHEMA,
    projectsByGuid: {
      R0237_1000_genomes_demo: {
        ...STATE.projectsByGuid.R0237_1000_genomes_demo, genomeVersion: '38', datasetTypes: ['SNV_INDEL', 'SV'],
      },
    },
  }
  const expectedKeys = [
    'gnomad_noncoding', 'topmed_hh', 'sv_callset_hh', 'sv_callset_af', 'methylation_outlier', 'methylation_tissue',
    'methylation_cohort_ac', 'min_dp', 'phased_only',
  ]
  expect(
    keys(getSearchAdditionalFilterFields(state, { projectFamilies: [...projectFamilies, ...projectFamilies] })),
  ).toEqual(expectedKeys)
  expect(getSearchAdditionalFilterFields({ ...state, searchFilterSchema: null }, { projectFamilies })).toEqual([])
  expect(keys(getSearchAdditionalFilterFields(state, {})).length).toEqual(16)
})

const renderPanel = (fields, initialValues = {}) => {
  let formValues = null
  const wrapper = mount(
    <Provider store={configureStore([thunk])({ ...STATE, searchFilterSchema: MOCK_SCHEMA })}>
      <Form onSubmit={() => {}} initialValues={initialValues}>
        {({ values }) => {
          formValues = values
          return <DynamicFilterPanel fields={fields} />
        }}
      </Form>
    </Provider>,
  )
  return { wrapper, getValues: () => formValues }
}

test('the panel is rendered from the schema and writes typed values to search.dynamic', () => {
  const fields = getAdditionalFilterFields(MOCK_SCHEMA, ['SNV_INDEL', 'SV'], ['38'])
  const { wrapper, getValues } = renderPanel(fields)

  expect(wrapper.find('Header').map(header => header.text())).toEqual(['In Silico', 'Frequency', 'Call Quality'])
  expect(wrapper.find('label').map(label => label.text().trim())).toEqual([
    'gnomAD Constraint', 'Methylation Outlier', 'Methylation Tissue', 'TOPMed H/H', 'seqr SV H/H', 'seqr SV AF',
    'Methylation Cohort AC', 'Minimum DP', 'Phased Only',
  ])
  // Fields the hard-coded panels offer are not repeated
  expect(wrapper.text()).not.toContain('CADD')
  expect(wrapper.text()).not.toContain('gnomAD genomes')
  expect(wrapper.text()).not.toContain('Genotype Quality')

  const input = key => wrapper.find(`input[name="search.dynamic.${key}"]`)
  expect(input('in_silico.methylation_outlier').props()).toEqual(expect.objectContaining(
    { type: 'number', max: 20, step: 0.5, value: '' },
  ))
  expect(input('in_silico.methylation_outlier').props().min).toBeUndefined()
  expect(input('frequency.methylation_cohort_ac').props()).toEqual(expect.objectContaining(
    { type: 'number', min: 0, step: 1, value: '' },
  ))
  expect(input('frequency.sv_callset_af').props()).toEqual(expect.objectContaining({ min: 0, max: 1, step: 0.0001 }))
  expect(input('in_silico.gnomad_noncoding').props().step).toEqual(0.1)

  input('in_silico.methylation_outlier').simulate('change', { target: { value: '2.5' } })
  expect(getValues()).toEqual({ search: { dynamic: { in_silico: { methylation_outlier: 2.5 } } } })
  input('frequency.methylation_cohort_ac').simulate('change', { target: { value: '10' } })
  input('quality.min_dp').simulate('change', { target: { value: '0' } })
  expect(getValues()).toEqual({
    search: {
      dynamic: {
        in_silico: { methylation_outlier: 2.5 }, frequency: { methylation_cohort_ac: 10 }, quality: { min_dp: 0 },
      },
    },
  })
  wrapper.update()
  expect(input('in_silico.methylation_outlier').props().value).toEqual(2.5)
  expect(input('quality.min_dp').props().value).toEqual(0)

  const tissueOptions = wrapper.find('Dropdown').find('DropdownItem')
  expect(tissueOptions.map(option => option.text())).toEqual(['', 'blood', 'fibroblast'])
  tissueOptions.at(2).simulate('click')
  wrapper.find('input[type="checkbox"]').simulate('change', { target: { checked: true } })
  expect(getValues()).toEqual({
    search: {
      dynamic: {
        in_silico: { methylation_outlier: 2.5, methylation_tissue: 'F' },
        frequency: { methylation_cohort_ac: 10 },
        quality: { min_dp: 0, phased_only: true },
      },
    },
  })

  // Cleared inputs are removed from the search rather than submitted as empty values
  input('frequency.methylation_cohort_ac').simulate('change', { target: { value: '' } })
  input('quality.min_dp').simulate('change', { target: { value: 'e' } })
  wrapper.update()
  wrapper.find('Dropdown').find('DropdownItem').at(0).simulate('click')
  wrapper.find('input[type="checkbox"]').simulate('change', { target: { checked: false } })
  expect(getValues()).toEqual({ search: { dynamic: { in_silico: { methylation_outlier: 2.5 } } } })
  input('in_silico.methylation_outlier').simulate('change', { target: { value: '' } })
  expect(getValues()).toEqual({})
})

test('the panel shows saved values and clears them', () => {
  const search = { annotations: { missense: ['missense_variant'] }, dynamic: { quality: { min_dp: 15 }, frequency: { helix_af: 0.01 } } }
  const { wrapper, getValues } = renderPanel([DEPTH_FIELD], { search })
  expect(wrapper.find('label').map(label => label.text().trim())).toEqual(['Minimum DP'])
  expect(wrapper.find('input[name="search.dynamic.quality.min_dp"]').props().value).toEqual(15)

  wrapper.find('button').filterWhere(button => button.text() === 'Clear additional filters').simulate('click')
  expect(getValues()).toEqual({ search: { annotations: search.annotations } })

  const emptyPanel = renderPanel([], { search })
  expect(emptyPanel.wrapper.find('input').length).toEqual(0)
  expect(emptyPanel.wrapper.text()).toContain('No additional filters are available for the selected data')
})

test('summary of the dynamic filters of a search', () => {
  expect(getDynamicFilterSummary(undefined, MOCK_SCHEMA)).toEqual('')
  expect(getDynamicFilterSummary({}, null)).toEqual('')
  const dynamic = {
    quality: { min_dp: 15, phased_only: true, vcf_filter: false, min_gq: null },
    in_silico: { methylation_outlier: 2.5, methylation_tissue: 'F', gnomad_noncoding: 0, removed_score: 3 },
    frequency: { helix_af: 0.01, methylation_cohort_ac: '' },
  }
  expect(getDynamicFilterSummary(dynamic, MOCK_SCHEMA)).toEqual(
    'Methylation Outlier >= 2.5; Methylation Tissue = fibroblast; gnomAD Constraint >= 0; removed_score = 3; ' +
    'Helix homoplasmic AF <= 0.01; Minimum DP >= 15; Phased Only',
  )
  expect(getDynamicFilterSummary(dynamic, null)).toEqual(
    'methylation_outlier = 2.5; methylation_tissue = F; gnomad_noncoding = 0; removed_score = 3; helix_af = 0.01; ' +
    'min_dp = 15; phased_only = true',
  )

  const store = configureStore([thunk])({ ...STATE, searchFilterSchema: MOCK_SCHEMA })
  const summary = mount(<Provider store={store}><DynamicFilterSummary value={dynamic} /></Provider>)
  expect(summary.text()).toContain('Methylation Tissue = fibroblast; gnomAD Constraint >= 0')
  expect(mount(<Provider store={store}><DynamicFilterSummary value={{}} /></Provider>).text()).toEqual('None')
})

const PROJECT_FAMILIES = [{ projectGuid: 'R0237_1000_genomes_demo', familyGuids: ['F011652_1'] }]

const renderSearchPanels = (searchFilterSchema, search) => {
  const initialValues = { projectFamilies: PROJECT_FAMILIES, search }
  const store = configureStore([thunk])({
    ...STATE, modal: {}, locusListsLoading: {}, locusListLoading: {}, searchFilterSchema,
  })
  const wrapper = mount(
    <Provider store={store}>
      <Form onSubmit={() => {}} initialValues={initialValues}>
        {() => <VariantSearchFormPanels />}
      </Form>
    </Provider>,
  )
  return { wrapper, store }
}

const PANEL_TITLES = ['Inheritance', 'Pathogenicity', 'Annotations', 'In Silico Filters', 'Frequency', 'Location', 'Call Quality']
const panelTitles = wrapper => wrapper.find('AccordionTitle').map(
  title => title.find('GridColumn').first().text(),
)

test('the search form offers the additional filters panel when the schema has fields for it', () => {
  const { wrapper, store } = renderSearchPanels(MOCK_SCHEMA)
  expect(panelTitles(wrapper)).toEqual([...PANEL_TITLES, 'Additional Filters', 'Exclude'])
  expect(schemaRequests()).toEqual([])
  expect(schemaActions(store)).toEqual([])
  const additionalTitle = wrapper.find('AccordionTitle').at(7)
  expect(additionalTitle.text()).toEqual('Additional FiltersNone')
  expect(wrapper.find('input[name="search.dynamic.in_silico.methylation_outlier"]').length).toEqual(1)
  expect(wrapper.find('input[name="search.dynamic.in_silico.cadd"]').length).toEqual(0)

  wrapper.find('input[name="search.dynamic.in_silico.methylation_outlier"]').simulate('change', { target: { value: '3' } })
  wrapper.update()
  expect(wrapper.find('AccordionTitle').at(7).text()).toEqual('Additional FiltersMethylation Outlier >= 3')
})

test('the search form hides the additional filters panel when every schema field has a hard-coded input', () => {
  const legacySchema = { 38: SCHEMA['38'].filter(field => LEGACY_FILTER_KEYS[field.group].includes(field.key)) }
  expect(legacySchema['38'].length).toEqual(42)
  expect(panelTitles(renderSearchPanels(legacySchema).wrapper)).toEqual([...PANEL_TITLES, 'Exclude'])

  // Filters of a saved search stay visible, and can be cleared, when the selected data has no input for them
  const { wrapper } = renderSearchPanels(legacySchema, { dynamic: { frequency: { helix_af: 0.01 } } })
  expect(panelTitles(wrapper)).toEqual([...PANEL_TITLES, 'Additional Filters', 'Exclude'])
  expect(wrapper.find('AccordionTitle').at(7).text()).toEqual('Additional Filtershelix_af = 0.01')
  wrapper.find('button').filterWhere(button => button.text() === 'Clear additional filters').simulate('click')
  wrapper.update()
  expect(panelTitles(wrapper)).toEqual([...PANEL_TITLES, 'Exclude'])
})

test('the filter schema is loaded once when the search form is shown', async () => {
  const { store } = renderSearchPanels(null)
  await flush()
  expect(schemaRequests()).toEqual([[SCHEMA_URL, { method: 'GET', credentials: 'include' }]])
  const actions = schemaActions(store)
  expect(actions).toEqual([{ type: 'RECEIVE_SEARCH_FILTER_SCHEMA', newValue: MOCK_SCHEMA }])
  expect(reducers.searchFilterSchema(undefined, {})).toEqual(null)
  const loadedSchema = reducers.searchFilterSchema(null, actions[0])
  expect(loadedSchema).toEqual(MOCK_SCHEMA)

  const loadedStore = configureStore([thunk])({ searchFilterSchema: loadedSchema })
  loadedStore.dispatch(loadSearchFilterSchema())
  expect(schemaRequests().length).toEqual(1)

  // A failed request leaves the schema unloaded so it is requested again
  fetchMock.mockImplementation(() => Promise.reject(new Error('Network error')))
  const failedStore = configureStore([thunk])({ searchFilterSchema: null })
  failedStore.dispatch(loadSearchFilterSchema())
  await flush()
  expect(failedStore.getActions()).toEqual([{ type: 'RECEIVE_SEARCH_FILTER_SCHEMA', newValue: null }])
})
