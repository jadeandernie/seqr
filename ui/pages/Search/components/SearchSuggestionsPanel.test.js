import React from 'react'
import { mount, configure } from 'enzyme'
import { act } from 'react-dom/test-utils'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import SearchSuggestionsPanel from './SearchSuggestionsPanel'

configure({ adapter: new Adapter() })

const suggestion = (type, value, label, why) => (
  { id: `${type}:${value}`, type, value, label: label || value, sources: ['pedigree'], why }
)

const DE_NOVO = suggestion('inheritance', 'de_novo', 'de_novo', 'Both parents are unaffected.')
const RECESSIVE = suggestion('inheritance', 'recessive', 'recessive', 'Parents could be carriers.')
const GENE = suggestion('gene', 'MTHFR', 'MTHFR', 'Recorded as a candidate gene for NA19675_1.')
const GENE_2 = suggestion('gene', 'OR4F5', 'OR4F5', 'Ranked 1 by exomiser for NA19675_1 (Some disease).')
const GENE_LIST = suggestion('gene_list', 'LL001', 'Retina proteome', 'Gene list with 3 entries attached to project A.')
const RESPONSE = {
  familyGuid: 'F000001_1',
  suggestions: [
    DE_NOVO, RECESSIVE, suggestion('inheritance', 'unsupported_mode', 'unsupported_mode', 'Unknown'),
    GENE, GENE_2, GENE_LIST,
  ],
  notes: ['3 HPO terms are recorded for affected individuals, but they produce no suggestions.'],
}

const flush = async (wrapper) => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  wrapper.update()
}

const mockFetch = (body, ok = true) => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok, status: ok ? 200 : 403, statusText: 'Forbidden', json: () => Promise.resolve(body),
  }))
}

const mountPanel = async (props) => {
  const onApply = jest.fn()
  const onClose = jest.fn()
  const wrapper = mount(
    <SearchSuggestionsPanel familyGuid="F000001_1" onApply={onApply} onClose={onClose} {...props} />,
  )
  await flush(wrapper)
  return { wrapper, onApply, onClose }
}

const toggle = (wrapper, id) => {
  act(() => {
    wrapper.find('Checkbox').filterWhere(c => c.prop('id') === id).prop('onChange')()
  })
  wrapper.update()
}

const checkedIds = wrapper => wrapper.find('Checkbox').filterWhere(c => c.prop('checked')).map(c => c.prop('id'))

afterEach(() => {
  delete global.fetch
})

test('loads suggestions for the family only when rendered and lists each with its why', async () => {
  mockFetch(RESPONSE)
  const { wrapper } = await mountPanel()

  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(global.fetch.mock.calls[0][0]).toEqual('/api/family/F000001_1/search_suggestions?')
  expect(global.fetch.mock.calls[0][1].method).toEqual('GET')

  expect(wrapper.find('Loader').prop('active')).toBe(false)
  expect(wrapper.find('.suggestion-group-inheritance label').map(l => l.text())).toEqual([
    'De Novo/ Dominant — Both parents are unaffected.',
    'Recessive — Parents could be carriers.',
  ])
  expect(wrapper.find('.suggestion-group-gene label').map(l => l.text())).toEqual([
    'MTHFR — Recorded as a candidate gene for NA19675_1.',
    'OR4F5 — Ranked 1 by exomiser for NA19675_1 (Some disease).',
  ])
  expect(wrapper.find('.suggestion-group-gene_list label').map(l => l.text())).toEqual([
    'Retina proteome — Gene list with 3 entries attached to project A.',
  ])
  expect(wrapper.find('.suggestion-group-gene').first().text()).toContain('restricts the search to those genes')
  expect(wrapper.find('Message.suggestion-notes').text()).toContain(
    '3 HPO terms are recorded for affected individuals, but they produce no suggestions.',
  )
  expect(wrapper.text()).toContain('Free-text notes are not read.')
  expect(wrapper.find('Message').filterWhere(m => m.prop('info'))).toHaveLength(0)
})

test('nothing is selected by default and only selected suggestions are applied', async () => {
  mockFetch(RESPONSE)
  const { wrapper, onApply, onClose } = await mountPanel()

  expect(checkedIds(wrapper)).toEqual([])
  expect(wrapper.find('Button.apply-suggestions').prop('disabled')).toBe(true)

  toggle(wrapper, GENE.id)
  toggle(wrapper, DE_NOVO.id)
  toggle(wrapper, RECESSIVE.id)
  expect(checkedIds(wrapper)).toEqual([RECESSIVE.id, GENE.id])
  expect(wrapper.find('Button.apply-suggestions').prop('disabled')).toBe(false)

  wrapper.find('button.apply-suggestions').simulate('click')
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(onApply).toHaveBeenCalledWith([RECESSIVE, GENE])
  expect(onClose).not.toHaveBeenCalled()
})

test('a gene list replaces selected genes and can be deselected', async () => {
  mockFetch(RESPONSE)
  const { wrapper, onApply } = await mountPanel()

  toggle(wrapper, GENE.id)
  toggle(wrapper, GENE_2.id)
  expect(checkedIds(wrapper)).toEqual([GENE.id, GENE_2.id])
  toggle(wrapper, GENE_LIST.id)
  expect(checkedIds(wrapper)).toEqual([GENE_LIST.id])
  toggle(wrapper, GENE_LIST.id)
  expect(checkedIds(wrapper)).toEqual([])
  expect(wrapper.find('Button.apply-suggestions').prop('disabled')).toBe(true)
  expect(onApply).not.toHaveBeenCalled()
})

test('cancel closes without applying', async () => {
  mockFetch(RESPONSE)
  const { wrapper, onApply, onClose } = await mountPanel()
  toggle(wrapper, GENE.id)
  wrapper.find('button.cancel-suggestions').simulate('click')
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onApply).not.toHaveBeenCalled()
})

test('empty state says nothing can be suggested and what is missing', async () => {
  mockFetch({
    familyGuid: 'F000001_1',
    suggestions: [],
    notes: ['No candidate genes are recorded for affected individuals.', 'No gene lists are attached to this project.'],
  })
  const { wrapper } = await mountPanel()

  expect(wrapper.find('Message').filterWhere(m => m.prop('info')).text()).toEqual(
    'No suggestions are available for this family.',
  )
  expect(wrapper.find('Checkbox')).toHaveLength(0)
  expect(wrapper.find('Message.suggestion-notes li').map(li => li.text())).toEqual([
    'No candidate genes are recorded for affected individuals.', 'No gene lists are attached to this project.',
  ])
  expect(wrapper.find('Button.apply-suggestions').prop('disabled')).toBe(true)
})

test('handles a response without suggestions or notes', async () => {
  mockFetch({ familyGuid: 'F000001_1' })
  const { wrapper } = await mountPanel()
  expect(wrapper.find('Message').filterWhere(m => m.prop('info'))).toHaveLength(1)
  expect(wrapper.find('Message.suggestion-notes')).toHaveLength(0)
})

test('shows a loading error', async () => {
  mockFetch({ error: 'User does not have sufficient permissions' }, false)
  const { wrapper } = await mountPanel()
  expect(wrapper.find('Message').filterWhere(m => m.prop('error')).text()).toEqual(
    'Unable to load suggestions: User does not have sufficient permissions',
  )
  expect(wrapper.find('Message').filterWhere(m => m.prop('info'))).toHaveLength(0)
  expect(wrapper.find('Checkbox')).toHaveLength(0)
})

test('reloads when the family changes and ignores responses after unmount', async () => {
  mockFetch(RESPONSE)
  const { wrapper } = await mountPanel()
  toggle(wrapper, GENE.id)

  mockFetch({ familyGuid: 'F000002_2', suggestions: [GENE_2], notes: [] })
  act(() => { wrapper.setProps({ familyGuid: 'F000002_2' }) })
  wrapper.update()
  expect(wrapper.find('Loader').prop('active')).toBe(true)
  await flush(wrapper)
  expect(global.fetch.mock.calls[0][0]).toEqual('/api/family/F000002_2/search_suggestions?')
  expect(wrapper.find('Checkbox').map(c => c.prop('id'))).toEqual([GENE_2.id])
  expect(checkedIds(wrapper)).toEqual([])

  const errorSpy = jest.spyOn(console, 'error')
  mockFetch(RESPONSE)
  act(() => { wrapper.setProps({ familyGuid: 'F000003_3' }) })
  expect(global.fetch).toHaveBeenCalledTimes(1)
  wrapper.unmount()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  mockFetch({ error: 'failed' }, false)
  const remounted = mount(<SearchSuggestionsPanel familyGuid="F000004_4" onApply={jest.fn()} onClose={jest.fn()} />)
  remounted.unmount()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(errorSpy).not.toHaveBeenCalled()
  errorSpy.mockRestore()
})
