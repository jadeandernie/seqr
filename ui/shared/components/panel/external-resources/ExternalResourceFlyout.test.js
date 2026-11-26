import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import { createStore, combineReducers } from 'redux'
import { act } from 'react-dom/test-utils'

import flyoutReducers, { openExternalResourceFlyout } from 'redux/utils/externalResourceFlyoutReducer'
import ExternalResourceFlyout from './ExternalResourceFlyout'

jest.mock('../genes/GeneDetail', () => ({ geneId }) => <div id="gene-detail">{geneId}</div>)

configure({ adapter: new Adapter() })

const GNOMAD = { key: 'gnomad', label: 'gnomAD', url: 'https://gnomad.broadinstitute.org/gene/ENSG00000155657', frameable: true }
const GTEX = { key: 'gtex', label: 'GTEx Portal', url: 'https://www.gtexportal.org/home/gene/ENSG00000155657', frameable: true }
const CLINVAR = { key: 'clinvar', label: 'ClinVar', url: 'https://www.ncbi.nlm.nih.gov/clinvar?term=TTN[gene]', frameable: false }
const HGMD = { key: 'hgmd', label: 'HGMD', url: 'https://my.qiagendigitalinsights.com/bbp/view/hgmd/pro/gene.php?gene=TTN', frameable: false }

const GENE_CONTEXT = { entity: 'gene', title: 'TTN', geneId: 'ENSG00000155657', links: [GNOMAD, CLINVAR, GTEX, HGMD] }
const VARIANT_CONTEXT = { entity: 'variant', title: 'TTN 2:179400000 C > T', links: [CLINVAR, GTEX, GNOMAD] }

let wrapper
let store
let trigger

const dispatch = (action) => {
  act(() => {
    store.dispatch(action)
  })
  wrapper.update()
}

const pressKey = (key, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  wrapper.update()
}

const tabNames = () => wrapper.find('MenuItem').map(item => item.text())
const activeTab = () => wrapper.find('MenuItem').filterWhere(item => item.prop('active')).map(item => item.text())
const clickTab = (label) => {
  wrapper.find('MenuItem').filterWhere(item => item.text() === label).find('a').simulate('click')
}
const button = label => wrapper.find(`button[aria-label="${label}"]`)
const panel = () => wrapper.find('aside')

beforeEach(() => {
  trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()

  store = createStore(combineReducers(flyoutReducers))
  wrapper = mount(<Provider store={store}><ExternalResourceFlyout /></Provider>)
})

afterEach(() => {
  wrapper.unmount()
  trigger.remove()
})

test('renders nothing until a resource is opened', () => {
  expect(wrapper.html()).toEqual('')
  expect(document.querySelector('aside')).toBeNull()
})

test('opens at the clicked resource with only its iframe mounted', () => {
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))

  expect(document.body.querySelector('aside')).not.toBeNull()
  expect(panel().prop('aria-label')).toEqual('TTN resources')
  expect(wrapper.find('h3').text()).toEqual('TTN')
  expect(tabNames()).toEqual(['Summary', 'gnomAD', 'GTEx Portal'])
  expect(activeTab()).toEqual(['gnomAD'])

  expect(wrapper.find('iframe')).toHaveLength(1)
  expect(wrapper.find('iframe').props()).toEqual(expect.objectContaining({
    src: GNOMAD.url,
    title: 'gnomAD: TTN',
    sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
    referrerPolicy: 'no-referrer',
  }))
  expect(wrapper.find('#gene-detail')).toHaveLength(0)
})

test('switching tabs replaces the iframe and the open-in-new-tab target', () => {
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))
  const openInNewTab = () => wrapper.find('a.button').filterWhere(a => a.text() === 'Open in new tab')
  expect(openInNewTab().props()).toEqual(expect.objectContaining({ href: GNOMAD.url, target: '_blank', rel: 'noreferrer' }))

  clickTab('GTEx Portal')
  expect(store.getState().externalResourceFlyout.activeKey).toEqual('gtex')
  expect(activeTab()).toEqual(['GTEx Portal'])
  expect(wrapper.find('iframe')).toHaveLength(1)
  expect(wrapper.find('iframe').prop('src')).toEqual(GTEX.url)
  expect(openInNewTab().prop('href')).toEqual(GTEX.url)

  clickTab('Summary')
  expect(activeTab()).toEqual(['Summary'])
  expect(wrapper.find('iframe')).toHaveLength(0)
  expect(wrapper.find('#gene-detail').text()).toEqual('ENSG00000155657')
  expect(openInNewTab()).toHaveLength(0)
})

test('lists resources that refuse framing as new-tab links', () => {
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'summary'))
  const footerLinks = wrapper.find('a').filterWhere(a => [CLINVAR.label, HGMD.label].includes(a.text()))
  expect(footerLinks.map(a => [a.prop('href'), a.prop('target'), a.prop('rel')])).toEqual([
    [CLINVAR.url, '_blank', 'noreferrer'], [HGMD.url, '_blank', 'noreferrer'],
  ])

  dispatch(openExternalResourceFlyout({ ...GENE_CONTEXT, links: [GNOMAD] }, 'gnomad'))
  expect(panel().text()).not.toContain('Open in new tab:')
})

test('variants have no summary tab and fall back to the first frameable resource', () => {
  dispatch(openExternalResourceFlyout(VARIANT_CONTEXT, 'gnomad'))
  expect(wrapper.find('h3').text()).toEqual('TTN 2:179400000 C > T')
  expect(tabNames()).toEqual(['GTEx Portal', 'gnomAD'])
  expect(activeTab()).toEqual(['gnomAD'])

  dispatch(openExternalResourceFlyout(VARIANT_CONTEXT, 'summary'))
  expect(activeTab()).toEqual(['GTEx Portal'])
  expect(wrapper.find('iframe').prop('src')).toEqual(GTEX.url)
  expect(wrapper.find('#gene-detail')).toHaveLength(0)
})

test('expands to most of the page and back', () => {
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))
  expect(panel().prop('style')).toEqual(expect.objectContaining({ position: 'fixed', right: 0, width: '45vw' }))

  button('Expand panel').simulate('click')
  expect(panel().prop('style').width).toEqual('90vw')
  expect(wrapper.find('iframe').prop('src')).toEqual(GNOMAD.url)

  button('Collapse panel').simulate('click')
  expect(panel().prop('style').width).toEqual('45vw')
})

test('moves focus into the panel and returns it on close', () => {
  expect(document.activeElement).toBe(trigger)
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))
  expect(document.activeElement).toBe(document.querySelector('aside'))

  button('Close panel').simulate('click')
  expect(store.getState().externalResourceFlyout).toBeNull()
  expect(document.querySelector('aside')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('Escape closes the panel without reaching other listeners', () => {
  const otherListener = jest.fn()
  document.addEventListener('keydown', otherListener)
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))

  pressKey('a')
  expect(store.getState().externalResourceFlyout).not.toBeNull()
  expect(otherListener).toHaveBeenCalledTimes(1)

  pressKey('Escape')
  expect(store.getState().externalResourceFlyout).toBeNull()
  expect(otherListener).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(trigger)

  pressKey('Escape')
  expect(otherListener).toHaveBeenCalledTimes(2)
  document.removeEventListener('keydown', otherListener)
})

test('Escape pressed inside a modal is left to the modal', () => {
  const modal = document.createElement('div')
  modal.className = 'ui modal'
  document.body.appendChild(modal)
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))

  pressKey('Escape', modal)
  expect(store.getState().externalResourceFlyout).not.toBeNull()
  modal.remove()
})

test('clicks inside the panel do not reach document listeners and page scroll is untouched', () => {
  const documentClick = jest.fn()
  document.addEventListener('click', documentClick)
  document.addEventListener('mousedown', documentClick)
  dispatch(openExternalResourceFlyout(GENE_CONTEXT, 'gnomad'))

  const heading = document.querySelector('aside h3')
  heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  heading.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(documentClick).not.toHaveBeenCalled()

  trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(documentClick).toHaveBeenCalledTimes(1)
  expect(store.getState().externalResourceFlyout).not.toBeNull()
  expect(document.body.style.overflow).toEqual('')

  document.removeEventListener('click', documentClick)
  document.removeEventListener('mousedown', documentClick)
})
