import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter, Route } from 'react-router-dom'

import { STATE_WITH_2_FAMILIES } from 'pages/Project/fixtures'
import SavedVariants from './SavedVariants'

// As in the Project SavedVariants test, double the shared variant review panel to test this page's tag options
jest.mock('shared/components/panel/variants/SavedVariants', () => function MockSavedVariants(
  { tagOptions }: { tagOptions: { value: string }[] },
) {
  return <div className="tag-options">{tagOptions.map(({ value }) => value).join(',')}</div>
})

configure({ adapter: new Adapter() })

test('offers the global variant tags as tag options', () => {
  const store = configureStore([thunk])(STATE_WITH_2_FAMILIES)
  const wrapper = mount(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/summary_data/saved_variants']}>
        <Route path="/summary_data/saved_variants" component={SavedVariants} />
      </MemoryRouter>
    </Provider>,
  )

  const tagOptions = wrapper.find('.tag-options').text().split(',')
  expect(tagOptions).toEqual(expect.arrayContaining(['Review', 'Hypomorphic', 'seqr Prioritized']))
  expect(tagOptions.indexOf('Hypomorphic')).toEqual(tagOptions.indexOf('Confident AR one hit') + 1)
})
