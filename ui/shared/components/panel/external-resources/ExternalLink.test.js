import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { Provider } from 'react-redux'
import configureStore from 'redux-mock-store'

import ExternalLink from './ExternalLink'

configure({ adapter: new Adapter() })

const FRAMEABLE = {
  key: 'gnomad', label: 'gnomAD', url: 'https://gnomad.broadinstitute.org/gene/ENSG00000155657', frameable: true,
}
const REFUSED = { key: 'clinvar', label: 'ClinVar', url: 'https://www.ncbi.nlm.nih.gov/clinvar?term=TTN[gene]', frameable: false }
const CONTEXT = { entity: 'gene', title: 'TTN', geneId: 'ENSG00000155657', links: [FRAMEABLE, REFUSED] }

const OPEN_ACTION = { type: 'OPEN_EXTERNAL_RESOURCE_FLYOUT', context: CONTEXT, activeKey: 'gnomad' }

const setup = (props) => {
  const store = configureStore()({})
  const wrapper = mount(<Provider store={store}><ExternalLink context={CONTEXT} {...props} /></Provider>)
  const click = (eventProps) => {
    const event = { button: 0, preventDefault: jest.fn(), ...eventProps }
    wrapper.find('a').simulate('click', event)
    return event.preventDefault
  }
  return { store, wrapper, click }
}

test('renders a real new-tab anchor', () => {
  const { wrapper } = setup({ link: FRAMEABLE, className: 'divided' })
  const anchor = wrapper.find('a')
  expect(anchor.props()).toEqual(expect.objectContaining({
    href: FRAMEABLE.url, target: '_blank', rel: 'noreferrer', className: 'divided',
  }))
  expect(anchor.text()).toEqual('gnomAD')

  const withChildren = setup({ link: FRAMEABLE, children: <b>Custom</b> })
  expect(withChildren.wrapper.find('a').html()).toEqual(
    `<a target="_blank" rel="noreferrer" href="${FRAMEABLE.url}"><b>Custom</b></a>`,
  )
})

test('plain click on a frameable resource opens the flyout instead of a tab', () => {
  const { store, click } = setup({ link: FRAMEABLE })
  expect(click()).toHaveBeenCalled()
  expect(store.getActions()).toEqual([OPEN_ACTION])
})

test.each([
  ['meta', { metaKey: true }],
  ['ctrl', { ctrlKey: true }],
  ['shift', { shiftKey: true }],
  ['alt', { altKey: true }],
  ['middle button', { button: 1 }],
])('%s click on a frameable resource keeps the browser default', (name, eventProps) => {
  const { store, click } = setup({ link: FRAMEABLE })
  expect(click(eventProps)).not.toHaveBeenCalled()
  expect(store.getActions()).toEqual([])
})

test('click on a resource that refuses framing keeps the browser default', () => {
  const { store, click } = setup({ link: REFUSED })
  expect(click()).not.toHaveBeenCalled()
  expect(store.getActions()).toEqual([])
})

test('click without a flyout context keeps the browser default', () => {
  const { store, click } = setup({ link: FRAMEABLE, context: undefined })
  expect(click()).not.toHaveBeenCalled()
  expect(store.getActions()).toEqual([])
})

test('calls a wrapping onClick handler', () => {
  const onClick = jest.fn()
  const { store, click } = setup({ link: FRAMEABLE, onClick })
  click()
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(store.getActions()).toEqual([OPEN_ACTION])
})
