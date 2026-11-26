import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { act } from 'react-dom/test-utils'
import { Dropdown } from 'semantic-ui-react'

import { EXCLUSION_REASONS } from 'shared/utils/exclusionReasons'
import { flushAll } from 'shared/utils/testHelpers'
import TagFieldView, { TagFieldDisplay } from './TagFieldView'

configure({ adapter: new Adapter() })

const EXCLUDED_TAG_TYPE = { name: 'Excluded', color: '#555555', metadataTitle: 'Reason' }
const TAG_OPTIONS = [
  { name: 'Review', color: '#668FE3' },
  EXCLUDED_TAG_TYPE,
  { name: 'Validated', color: '#00aa00', metadataTitle: 'Test Type(s)' },
  { name: 'Linkage', color: '#aa0000', metadataTitle: 'LOD Score' },
  { name: 'Annotated', color: '#aaaa00', metadataTitle: 'Notes' },
]

const mountEditForm = (tags, onSubmit = jest.fn()) => {
  const store = configureStore([thunk])({ user: {}, modal: {} })
  const wrapper = mount(
    <Provider store={store}>
      <TagFieldView
        isEditable
        showInLine
        field="tags"
        idField="variantGuids"
        initialValues={{ variantGuids: 'SV1', tags }}
        tagOptions={TAG_OPTIONS}
        onSubmit={onSubmit}
      />
    </Provider>,
  )
  wrapper.find('ButtonLink').first().simulate('click')
  return { wrapper, onSubmit }
}

const reasonDropdown = wrapper => wrapper.find(Dropdown).filterWhere(n => n.prop('allowAdditions'))

const callReasonDropdown = (wrapper, handler, value) => {
  act(() => {
    reasonDropdown(wrapper).prop(handler)({}, { value })
  })
  wrapper.update()
}

const selectReason = (wrapper, value) => callReasonDropdown(wrapper, 'onChange', value)

const submit = async (wrapper) => {
  await act(async () => {
    wrapper.find('form').simulate('submit')
    await flushAll()
  })
  wrapper.update()
}

test('shallow-render without crashing', () => {
  const props = {
    isEditable: true,
    field: 'SOME_NAME',
    idField: 'SOME_ID',
    initialValues: { SOME_NAME: [{ name: 'a' }, { name: 'b' }] },
    tagOptions: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    onSubmit: () => {},
  }

  shallow(<TagFieldView {...props} />)
})

test('offers the standard exclusion reasons in a dropdown for a "Reason" tag', () => {
  const { wrapper } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1' }])

  const dropdown = reasonDropdown(wrapper)
  expect(dropdown.length).toEqual(1)
  expect(dropdown.prop('options').map(({ value }) => value)).toEqual(EXCLUSION_REASONS)
  expect(dropdown.prop('allowAdditions')).toBe(true)
  expect(dropdown.prop('clearable')).toBe(true)
  expect(dropdown.prop('multiple')).toBeFalsy()
  expect(wrapper.find('input[name="tags[0].metadata"]').length).toEqual(0)
})

test('keeps an existing free-text reason selected and editable', () => {
  const { wrapper } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1', metadata: 'seen in unaffected sib' }])

  const dropdown = reasonDropdown(wrapper)
  expect(dropdown.prop('value')).toEqual('seen in unaffected sib')
  expect(dropdown.prop('options').map(({ value }) => value)).toEqual([...EXCLUSION_REASONS, 'seen in unaffected sib'])
})

test('saves an Excluded tag with no reason, as created by the one-click shortcut', async () => {
  const { wrapper, onSubmit } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1' }])

  await submit(wrapper)

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].tags).toEqual([expect.objectContaining({ name: 'Excluded', tagGuid: 'VT1' })])
  expect(onSubmit.mock.calls[0][0].tags[0].metadata).toBeUndefined()
})

test('saves the selected standard reason as the tag metadata', async () => {
  const { wrapper, onSubmit } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1' }])

  selectReason(wrapper, 'Poor quality data')
  await submit(wrapper)

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].tags).toEqual([
    expect.objectContaining({ name: 'Excluded', tagGuid: 'VT1', metadata: 'Poor quality data' }),
  ])
})

test('saves a custom reason added in the dropdown', async () => {
  const { wrapper, onSubmit } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1', metadata: 'Other' }])

  callReasonDropdown(wrapper, 'onAddItem', 'mosaic in parent')
  selectReason(wrapper, 'mosaic in parent')
  expect(reasonDropdown(wrapper).prop('options').map(({ value }) => value)).toContain('mosaic in parent')
  await submit(wrapper)

  expect(onSubmit.mock.calls[0][0].tags[0].metadata).toEqual('mosaic in parent')
})

test('clears a saved reason with an explicit null so the server removes it', async () => {
  const { wrapper, onSubmit } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1', metadata: 'Poor quality data' }])

  selectReason(wrapper, '')
  await submit(wrapper)

  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].tags[0].metadata).toBeNull()
})

test('keeps the originally saved free-text reason available after another reason is chosen', () => {
  const { wrapper } = mountEditForm([{ name: 'Excluded', tagGuid: 'VT1', metadata: 'seen in unaffected sib' }])

  selectReason(wrapper, 'Other')

  expect(reasonDropdown(wrapper).prop('value')).toEqual('Other')
  expect(reasonDropdown(wrapper).prop('options').map(({ value }) => value)).toContain('seen in unaffected sib')
})

test('still requires metadata for other tag types, but not for Notes', async () => {
  const { wrapper, onSubmit } = mountEditForm([{ name: 'Linkage', tagGuid: 'VT2' }, { name: 'Annotated', tagGuid: 'VT3' }])

  expect(reasonDropdown(wrapper).length).toEqual(0)
  expect(wrapper.find('input[name="tags[0].metadata"]').prop('type')).toEqual('number')
  await submit(wrapper)
  expect(onSubmit).not.toHaveBeenCalled()

  act(() => {
    wrapper.find('input[name="tags[0].metadata"]').simulate('change', { target: { value: '3' } })
  })
  await submit(wrapper)
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(onSubmit.mock.calls[0][0].tags.map(({ name, metadata }) => [name, metadata])).toEqual([
    ['Linkage', '3'], ['Annotated', undefined],
  ])
})

test('TagFieldDisplay shows the exclusion reason on the tag label only when metadata display is on', () => {
  const tags = [
    { name: 'Excluded', tagGuid: 'VT1', color: '#555555', metadataTitle: 'Reason', metadata: 'Poor quality data' },
    { name: 'Excluded', tagGuid: 'VT2', color: '#555555', metadataTitle: 'Reason' },
  ]

  const withMetadata = mount(<TagFieldDisplay displayFieldValues={tags} displayMetadata />)
  expect(withMetadata.find('Label').map(l => l.text())).toEqual(['Excluded: Poor quality data', 'Excluded'])

  const withoutMetadata = mount(<TagFieldDisplay displayFieldValues={tags} />)
  expect(withoutMetadata.find('Label').map(l => l.text())).toEqual(['Excluded', 'Excluded'])
})
