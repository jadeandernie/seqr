import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { Form } from 'react-final-form'

import VariantSearchFormPanels from './VariantSearchFormPanels'
import { STATE, PROJECT_GUID, FAMILY_GUID } from '../fixtures'

// The other search filters load their own data, so only the gene evidence filters are rendered in full
jest.mock('./filters/LocusListSelector', () => () => null)
jest.mock('./filters/LocusListItemsFilter', () => () => null)
jest.mock('./filters/CustomInheritanceFilter', () => () => null)
jest.mock('./filters/LabeledSlider', () => () => null)
jest.mock('./filters/FrequencyFilter', () => ({ FrequencyFilter: () => null, HeaderFrequencyFilter: () => null }))
jest.mock('shared/components/modal/Modal', () => () => null)

configure({ adapter: new Adapter() })

const PROJECT_FAMILIES = [{ projectGuid: PROJECT_GUID, familyGuids: [FAMILY_GUID] }]

const rnaState = (rnaDataTypes: string[]) => ({
  ...STATE,
  familiesByGuid: { ...STATE.familiesByGuid, [FAMILY_GUID]: { ...STATE.familiesByGuid[FAMILY_GUID], rnaDataTypes } },
})

const mountPanels = (state: object, search: object) => {
  const store = configureStore([thunk])(state)
  let formValues: Record<string, any> = {}
  const wrapper = mount(
    <Provider store={store}>
      <Form onSubmit={() => {}} initialValues={{ projectFamilies: PROJECT_FAMILIES, search }}>
        {({ values }) => {
          formValues = values
          return <VariantSearchFormPanels />
        }}
      </Form>
    </Provider>,
  )
  return { wrapper, getSearch: () => formValues.search }
}

const panelTitles = (wrapper: any): string[] => wrapper.find('AccordionTitle').map((title: any) => title.find('GridColumn').first().text())

const evidenceContent = (wrapper: any) => wrapper.find('AccordionContent').filterWhere(
  (content: any) => content.key() === 'gene_evidence-content',
)

const checkboxLabels = (wrapper: any): string[] => evidenceContent(wrapper).find('Checkbox').map((checkbox: any) => checkbox.text().trim())

const toggle = (wrapper: any, label: string) => {
  const checkbox = evidenceContent(wrapper).find('Checkbox').filterWhere((box: any) => box.text().trim() === label)
  checkbox.find('input').simulate('change')
  wrapper.update()
}

const summary = (wrapper: any): string => wrapper.find('AccordionTitle').filterWhere(
  (title: any) => title.key() === 'gene_evidence-title',
).find('i').not('.icon').text()

test('hides the gene evidence panel when the searched family has no RNA outlier data', () => {
  const { wrapper } = mountPanels(rnaState([]), {})
  expect(panelTitles(wrapper)).toEqual([
    'Inheritance', 'Pathogenicity', 'Annotations', 'In Silico Filters', 'Frequency', 'Location', 'Call Quality', 'Exclude',
  ])
  expect(evidenceContent(wrapper)).toHaveLength(0)

  const { wrapper: noContextWrapper } = mountPanels(STATE, {})
  expect(panelTitles(noContextWrapper)).not.toContain('Gene Evidence')
})

test('shows gene evidence for the loaded RNA data types and updates the search', () => {
  const { wrapper, getSearch } = mountPanels(rnaState(['E', 'S']), {})
  expect(panelTitles(wrapper)).toEqual([
    'Inheritance', 'Pathogenicity', 'Annotations', 'In Silico Filters', 'Frequency', 'Location', 'Call Quality',
    'Gene Evidence', 'Exclude',
  ])
  expect(checkboxLabels(wrapper)).toEqual([
    'RNA Expression Outlier', 'RNA Splice Outlier', 'Any selected evidence', 'All selected evidence',
  ])
  expect(summary(wrapper)).toEqual('No gene evidence required')
  expect(getSearch()).toEqual({})

  toggle(wrapper, 'RNA Expression Outlier')
  expect(getSearch()).toEqual({ gene_evidence: { rna_expression_outlier: true } })
  expect(summary(wrapper)).toEqual('In genes with RNA Expression Outlier evidence in the family')

  toggle(wrapper, 'RNA Splice Outlier')
  expect(getSearch()).toEqual({ gene_evidence: { rna_expression_outlier: true, rna_splice_outlier: true } })
  expect(summary(wrapper)).toEqual('In genes with RNA Expression Outlier or RNA Splice Outlier evidence in the family')

  toggle(wrapper, 'All selected evidence')
  expect(getSearch()).toEqual({ gene_evidence: { rna_expression_outlier: true, rna_splice_outlier: true, match: 'all' } })
  expect(summary(wrapper)).toEqual('In genes with RNA Expression Outlier and RNA Splice Outlier evidence in the family')

  toggle(wrapper, 'RNA Expression Outlier')
  expect(getSearch()).toEqual({ gene_evidence: { rna_expression_outlier: false, rna_splice_outlier: true, match: 'all' } })
  expect(summary(wrapper)).toEqual('In genes with RNA Splice Outlier evidence in the family')
})

test('only offers the evidence the searched family has data for', () => {
  const { wrapper } = mountPanels(rnaState(['S']), {})
  expect(panelTitles(wrapper)).toContain('Gene Evidence')
  expect(checkboxLabels(wrapper)).toEqual(['RNA Splice Outlier'])
})

test('keeps evidence from a saved search editable when the family has no data for it', () => {
  const { wrapper, getSearch } = mountPanels(rnaState([]), { gene_evidence: { rna_expression_outlier: true } })
  expect(panelTitles(wrapper)).toContain('Gene Evidence')
  expect(checkboxLabels(wrapper)).toEqual(['RNA Expression Outlier'])
  expect(summary(wrapper)).toEqual('In genes with RNA Expression Outlier evidence in the family')

  toggle(wrapper, 'RNA Expression Outlier')
  expect(getSearch()).toEqual({ gene_evidence: { rna_expression_outlier: false } })
  expect(panelTitles(wrapper)).not.toContain('Gene Evidence')
})
