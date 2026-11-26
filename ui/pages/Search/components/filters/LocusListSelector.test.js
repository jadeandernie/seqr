import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'
import { Form, Field, FormSpy } from 'react-final-form'

import rootReducer from 'redux/rootReducer'
import { configuredField } from 'shared/components/form/FormHelpers'
import { flushAll } from 'shared/utils/testHelpers'
import LocusListSelector from './LocusListSelector'
import { LOCATION_FIELDS } from '../VariantSearchFormPanelConfigs'
import { DECORATORS } from '../VariantSearchForm'

import { STATE, LOCUS_LIST } from '../../fixtures'

configure({ adapter: new Adapter() })

const GENE_LIST_1 = { locusListGuid: 'LL1_genes', name: 'Muscle Genes', numEntries: 2, isPublic: true }
const GENE_LIST_2 = { locusListGuid: 'LL2_genes', name: 'Extra Genes', numEntries: 3, isPublic: false }
const PA_LIST_1 = { locusListGuid: 'LL3_panel', name: 'Panel One', numEntries: 3, isPublic: true, paLocusList: { panelAppId: 3 } }
const PA_LIST_2 = { locusListGuid: 'LL4_panel', name: 'Panel Two', numEntries: 3, isPublic: true, paLocusList: { panelAppId: 4 } }

const GENES_BY_ID = ['ACTA1', 'DMD', 'NEB', 'TTN'].reduce(
  (acc, geneSymbol) => ({ ...acc, [`ENSG_${geneSymbol}`]: { geneId: `ENSG_${geneSymbol}`, geneSymbol } }), {},
)

const gene = (geneSymbol, confidenceLevel, modeOfInheritance) => ({
  geneId: `ENSG_${geneSymbol}`,
  ...(confidenceLevel === undefined ? {} : { pagene: { confidenceLevel, modeOfInheritance } }),
})

const LIST_ITEMS = {
  LL1_genes: [gene('TTN'), gene('NEB')],
  LL2_genes: [gene('ACTA1'), gene('TTN'), { chrom: '1', start: 100, end: 200 }],
  LL3_panel: [gene('TTN', 3, 'BIALLELIC'), gene('DMD', 1, 'BIALLELIC'), gene('ACTA1', 2, 'MONOALLELIC')],
  LL4_panel: [gene('DMD', 3, 'MONOALLELIC'), gene('NEB', 0), gene('TTN', 2, 'MONOALLELIC')],
}

const noop = () => {}
const formatLocus = val => val || {}
const renderSelector = ({ input }) => <LocusListSelector value={input.value} onChange={input.onChange} />
const LOCUS_FIELDS = LOCATION_FIELDS.filter(({ name }) => name !== 'create').map(
  field => configuredField({ ...field, name: `search.locus.${field.name}` }),
)

const renderForm = async (locus, loadedListGuids = []) => {
  fetch.mockImplementation((url) => {
    const locusListGuid = url.replace(/\?$/, '').split('/api/locus_lists/')[1]
    const json = LIST_ITEMS[locusListGuid] ?
      { locusListsByGuid: { [locusListGuid]: { items: LIST_ITEMS[locusListGuid] } }, genesById: GENES_BY_ID } : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) })
  })
  const store = createStore(rootReducer, {
    user: STATE.user,
    projectsByGuid: STATE.projectsByGuid,
    genesById: loadedListGuids.length ? GENES_BY_ID : {},
    locusListsByGuid: [GENE_LIST_1, GENE_LIST_2, PA_LIST_1, PA_LIST_2].reduce((acc, locusList) => ({
      ...acc,
      [locusList.locusListGuid]: loadedListGuids.includes(locusList.locusListGuid) ?
        { ...locusList, items: LIST_ITEMS[locusList.locusListGuid] } : locusList,
    }), {}),
  }, applyMiddleware(thunk))
  let values
  const onChange = (formState) => {
    values = formState.values
  }
  const initialValues = { search: { locus }, projectFamilies: [{ projectGuid: 'R0237_1000_genomes_demo' }] }
  const wrapper = mount(
    <Provider store={store}>
      <Form onSubmit={noop} initialValues={initialValues} decorators={DECORATORS}>
        {() => (
          <div>
            <Field name="search.locus" format={formatLocus} render={renderSelector} />
            {LOCUS_FIELDS}
            <FormSpy subscription={{ values: true }} onChange={onChange} />
          </div>
        )}
      </Form>
    </Provider>,
  )
  const flush = async () => {
    await act(async () => {
      await flushAll()
    })
    wrapper.update()
  }
  await flush()
  return { wrapper, flush, store, getLocus: () => values.search.locus }
}

const getDropdown = wrapper => wrapper.find('FormDropdown[label="Gene Lists"]')

const selectLists = async ({ wrapper, flush }, locusListGuids) => {
  act(() => {
    getDropdown(wrapper).prop('onChange')({}, { value: locusListGuids })
  })
  await flush()
}

const loadedListUrls = () => fetch.mock.calls.map(([url]) => url).filter(
  url => url.startsWith('/api/locus_lists/'),
).map(url => url.replace(/\?$/, ''))

const getTextAreaValues = wrapper => wrapper.find('TextArea').reduce(
  (acc, textArea) => ({ ...acc, [textArea.prop('name')]: textArea.prop('value') }), {},
)

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE)

  shallow(<LocusListSelector store={store} value={LOCUS_LIST} />)
})

test('renders a multi-select of the available gene lists', async () => {
  const { wrapper, getLocus } = await renderForm(undefined)

  const dropdown = getDropdown(wrapper)
  expect(dropdown.prop('multiple')).toBe(true)
  expect(dropdown.prop('value')).toEqual([])
  expect(dropdown.prop('options').filter(({ value }) => value).map(({ value, text, description }) => [value, text, description])).toEqual([
    ['LL2_genes', 'Extra Genes', '3 Genes'],
    ['LL1_genes', 'Muscle Genes', '2 Genes'],
    ['LL3_panel', 'Panel One', '3 Genes - PanelApp'],
    ['LL4_panel', 'Panel Two', '3 Genes - PanelApp'],
  ])
  expect(loadedListUrls()).toEqual([])
  expect(getLocus()).toBeUndefined()
})

test('selecting a single gene list sets its items exactly as before', async () => {
  const form = await renderForm(undefined)

  await selectLists(form, ['LL1_genes'])

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL1_genes'])
  expect(form.getLocus()).toEqual({ locusListGuid: 'LL1_genes', rawItems: 'NEB, TTN' })
  expect(getDropdown(form.wrapper).prop('value')).toEqual(['LL1_genes'])
  expect(getTextAreaValues(form.wrapper)).toEqual({ 'search.locus.rawItems': 'NEB, TTN', 'search.locus.rawVariantItems': '' })
})

test('selecting a single PanelApp list groups its items by confidence exactly as before', async () => {
  const form = await renderForm(undefined)

  await selectLists(form, ['LL3_panel'])

  expect(form.getLocus()).toEqual({
    locusListGuid: 'LL3_panel',
    panelAppItems: { amber: 'ACTA1', red: 'DMD', green: 'TTN' },
    rawItems: 'ACTA1,DMD,TTN',
  })
  expect(getTextAreaValues(form.wrapper)).toEqual({
    'search.locus.panelAppItems.green': 'TTN',
    'search.locus.panelAppItems.amber': 'ACTA1',
    'search.locus.panelAppItems.red': 'DMD',
    'search.locus.panelAppItems.none': '',
    'search.locus.rawVariantItems': '',
  })
})

test('replaces the items of a PanelApp list when switching to a gene list which is already loaded', async () => {
  const form = await renderForm(undefined, ['LL1_genes'])

  await selectLists(form, ['LL3_panel'])
  await selectLists(form, ['LL1_genes'])

  expect(form.getLocus()).toEqual({ locusListGuid: 'LL1_genes', rawItems: 'NEB, TTN' })
  expect(getTextAreaValues(form.wrapper)).toEqual({ 'search.locus.rawItems': 'NEB, TTN', 'search.locus.rawVariantItems': '' })
})

test('merges the items of multiple gene lists', async () => {
  const form = await renderForm(undefined)

  await selectLists(form, ['LL1_genes'])
  await selectLists(form, ['LL1_genes', 'LL2_genes'])

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL1_genes', '/api/locus_lists/LL2_genes'])
  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL1_genes', 'LL2_genes'], rawItems: 'ACTA1, chr1:100-200, NEB, TTN',
  })
  expect(getDropdown(form.wrapper).prop('value')).toEqual(['LL1_genes', 'LL2_genes'])
  expect(getDropdown(form.wrapper).find('Label').map(label => label.text())).toEqual(['Muscle Genes', 'Extra Genes'])
  expect(getTextAreaValues(form.wrapper)['search.locus.rawItems']).toEqual('ACTA1, chr1:100-200, NEB, TTN')

  await selectLists(form, ['LL2_genes'])

  expect(form.getLocus()).toEqual({ locusListGuid: 'LL2_genes', rawItems: 'ACTA1, chr1:100-200, TTN' })
  expect(loadedListUrls().length).toEqual(2)

  await selectLists(form, [])

  expect(form.getLocus()).toEqual({})
  expect(JSON.stringify(form.getLocus())).toEqual('{}')
  expect(getDropdown(form.wrapper).prop('value')).toEqual([])
  expect(getTextAreaValues(form.wrapper)).toEqual({ 'search.locus.rawItems': '', 'search.locus.rawVariantItems': '' })
})

test('uses the highest confidence for genes in multiple PanelApp lists', async () => {
  const form = await renderForm(undefined)

  await selectLists(form, ['LL3_panel', 'LL4_panel'])

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL3_panel', '/api/locus_lists/LL4_panel'])
  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL3_panel', 'LL4_panel'],
    panelAppItems: { amber: 'ACTA1', green: 'DMD, TTN', none: 'NEB' },
    rawItems: 'ACTA1,DMD,TTN,NEB',
  })
  expect(getTextAreaValues(form.wrapper)).toEqual({
    'search.locus.panelAppItems.green': 'DMD, TTN',
    'search.locus.panelAppItems.amber': 'ACTA1',
    'search.locus.panelAppItems.red': '',
    'search.locus.panelAppItems.none': 'NEB',
    'search.locus.rawVariantItems': '',
  })
})

test('shows non-PanelApp genes with no confidence when combined with a PanelApp list', async () => {
  const form = await renderForm(undefined)

  await selectLists(form, ['LL2_genes', 'LL3_panel', 'LL1_genes'])

  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL2_genes', 'LL3_panel', 'LL1_genes'],
    panelAppItems: { amber: 'ACTA1', red: 'DMD', green: 'TTN', none: 'chr1:100-200, NEB' },
    rawItems: 'ACTA1,chr1:100-200,NEB,DMD,TTN',
  })

  await selectLists(form, ['LL2_genes', 'LL1_genes'])

  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL2_genes', 'LL1_genes'], rawItems: 'ACTA1, chr1:100-200, NEB, TTN',
  })
  expect(Object.keys(getTextAreaValues(form.wrapper))).toEqual(['search.locus.rawItems', 'search.locus.rawVariantItems'])
})

test('filters merged PanelApp items by the selected modes of inheritance', async () => {
  const form = await renderForm(undefined)
  await selectLists(form, ['LL3_panel', 'LL4_panel', 'LL1_genes'])

  const moiSelector = () => form.wrapper.find('PaMoiDropdown').find('Multiselect')
  expect(moiSelector().prop('disabled')).toBe(false)
  expect(moiSelector().prop('options').filter(({ disabled }) => !disabled).map(({ value }) => value)).toEqual(['AD', 'AR'])

  act(() => {
    moiSelector().prop('onChange')(['AD'])
  })
  await form.flush()

  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL3_panel', 'LL4_panel', 'LL1_genes'],
    selectedMOIs: ['AD'],
    panelAppItems: { green: 'DMD', amber: 'ACTA1, TTN', none: 'NEB' },
    rawItems: expect.any(String),
  })
  expect(form.getLocus().rawItems.split(',').sort()).toEqual(['ACTA1', 'DMD', 'NEB', 'TTN'])

  act(() => {
    moiSelector().prop('onChange')(['AR'])
  })
  await form.flush()

  expect(form.getLocus().panelAppItems).toEqual({ green: 'TTN', red: 'DMD', none: 'NEB' })
  expect(form.getLocus().rawItems.split(',').sort()).toEqual(['DMD', 'NEB', 'TTN'])
  expect(getTextAreaValues(form.wrapper)).toEqual({
    'search.locus.panelAppItems.green': 'TTN',
    'search.locus.panelAppItems.amber': '',
    'search.locus.panelAppItems.red': 'DMD',
    'search.locus.panelAppItems.none': 'NEB',
    'search.locus.rawVariantItems': '',
  })
})

test('disables the modes of inheritance filter until a PanelApp list has loaded', async () => {
  const form = await renderForm({ locusListGuids: ['LL1_genes', 'LL2_genes'], panelAppItems: { none: 'TTN' } }, ['LL1_genes', 'LL2_genes'])

  const moiSelector = form.wrapper.find('PaMoiDropdown').find('Multiselect')
  expect(moiSelector.prop('disabled')).toBe(true)
  expect(moiSelector.prop('options')).toEqual([])
})

test('loads the current items of a saved search with a single gene list', async () => {
  const form = await renderForm({ locusListGuid: 'LL1_genes', rawItems: 'NEB, OLD_GENE' })

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL1_genes'])
  expect(getDropdown(form.wrapper).prop('value')).toEqual(['LL1_genes'])
  expect(form.getLocus()).toEqual({ locusListGuid: 'LL1_genes', rawItems: 'NEB, TTN' })
})

test('keeps the items of a saved search whose single gene list is already loaded', async () => {
  const form = await renderForm({ locusListGuid: 'LL1_genes', rawItems: 'NEB, TTN, EDITED' }, ['LL1_genes'])

  expect(loadedListUrls()).toEqual([])
  expect(getDropdown(form.wrapper).prop('value')).toEqual(['LL1_genes'])
  expect(form.getLocus()).toEqual({ locusListGuid: 'LL1_genes', rawItems: 'NEB, TTN, EDITED' })
})

test('loads the current items of a saved search with multiple gene lists', async () => {
  const form = await renderForm({
    locusListGuids: ['LL4_panel', 'LL1_genes'],
    selectedMOIs: ['AD'],
    panelAppItems: { green: 'OLD_GENE' },
    rawItems: 'OLD_GENE',
  }, ['LL1_genes'])

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL4_panel'])
  expect(getDropdown(form.wrapper).prop('value')).toEqual(['LL4_panel', 'LL1_genes'])
  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL4_panel', 'LL1_genes'],
    selectedMOIs: ['AD'],
    panelAppItems: { green: 'DMD', amber: 'TTN', none: 'NEB' },
    rawItems: 'DMD,NEB,TTN',
  })
})

test('loads the confidence levels of a PanelApp list which was loaded without them', async () => {
  const form = await renderForm(undefined, ['LL1_genes'])
  act(() => {
    form.store.dispatch({
      type: 'RECEIVE_DATA',
      updatesById: { locusListsByGuid: { LL3_panel: { items: LIST_ITEMS.LL3_panel.map(({ geneId }) => ({ geneId })) } } },
    })
  })
  let resolveItems
  fetch.mockImplementation(() => new Promise((resolve) => {
    resolveItems = () => resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ locusListsByGuid: { LL3_panel: { items: LIST_ITEMS.LL3_panel } } }),
    })
  }))

  await selectLists(form, ['LL1_genes', 'LL3_panel'])

  expect(loadedListUrls()).toEqual(['/api/locus_lists/LL3_panel'])
  expect(form.getLocus()).toEqual({ locusListGuids: ['LL1_genes', 'LL3_panel'] })

  act(resolveItems)
  await form.flush()

  expect(form.getLocus().panelAppItems).toEqual({ amber: 'ACTA1', red: 'DMD', green: 'TTN', none: 'NEB' })
})

test('sets the items of an empty PanelApp list', async () => {
  const form = await renderForm(undefined, ['LL1_genes'])
  fetch.mockImplementation(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ locusListsByGuid: { LL3_panel: { items: [] } } }),
  }))

  await selectLists(form, ['LL1_genes', 'LL3_panel'])

  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL1_genes', 'LL3_panel'], panelAppItems: { none: 'NEB, TTN' }, rawItems: 'NEB,TTN',
  })
})

test('waits for every selected gene list to load before setting the items', async () => {
  const form = await renderForm(undefined, ['LL1_genes'])
  let resolveItems
  fetch.mockImplementation(() => new Promise((resolve) => {
    resolveItems = () => resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ locusListsByGuid: { LL2_genes: { items: LIST_ITEMS.LL2_genes } }, genesById: GENES_BY_ID }),
    })
  }))

  await selectLists(form, ['LL1_genes', 'LL2_genes'])

  expect(form.getLocus()).toEqual({ locusListGuids: ['LL1_genes', 'LL2_genes'] })

  act(resolveItems)
  await form.flush()

  expect(form.getLocus()).toEqual({
    locusListGuids: ['LL1_genes', 'LL2_genes'], rawItems: 'ACTA1, chr1:100-200, NEB, TTN',
  })
})

test('treats a gene list which fails to load as empty', async () => {
  const form = await renderForm(undefined, ['LL1_genes'])
  fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.resolve({}) }))

  await selectLists(form, ['LL1_genes', 'LL2_genes'])

  expect(form.getLocus()).toEqual({ locusListGuids: ['LL1_genes', 'LL2_genes'], rawItems: 'NEB, TTN' })
})
