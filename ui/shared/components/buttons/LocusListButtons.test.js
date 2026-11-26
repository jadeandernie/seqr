import React from 'react'
import { mount, shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import { createStore, applyMiddleware } from 'redux'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { Route, Router } from 'react-router-dom'
import { createMemoryHistory } from 'history'
import { act } from 'react-dom/test-utils'
import rootReducer from 'redux/rootReducer'
import SummaryData from 'pages/SummaryData/SummaryData'
import { flushAll, getLastFetchUrl, mockFetchResponse } from 'shared/utils/testHelpers'
import { CreateLocusList, UpdateLocusList, DeleteLocusList, DeleteLocusListButton } from './LocusListButtons'

import { LOCUS_LIST } from '../panel/fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  shallow(<CreateLocusList />)
  shallow(<UpdateLocusList locusList={LOCUS_LIST} />)
  shallow(<DeleteLocusList locusList={LOCUS_LIST} />)
})

test('deleting a gene list redirects to the gene lists page', async () => {
  const { locusListGuid } = LOCUS_LIST
  const store = createStore(
    rootReducer, { user: { email: 'test@broadinstitute.org' }, locusListsByGuid: { [locusListGuid]: LOCUS_LIST } },
    applyMiddleware(thunk),
  )
  const history = createMemoryHistory({ initialEntries: [`/summary_data/gene_lists/${locusListGuid}`] })
  const wrapper = mount(
    <Provider store={store}>
      <Router history={history}>
        <DeleteLocusListButton locusList={LOCUS_LIST} />
        <Route path="/summary_data" component={SummaryData} />
      </Router>
    </Provider>,
  )

  await act(flushAll)
  mockFetchResponse({ locusListsByGuid: { [locusListGuid]: null } })
  await act(async () => {
    wrapper.find('DispatchRequestButton').first().find('Confirm').prop('onConfirm')()
    await flushAll()
  })
  wrapper.update()

  expect(getLastFetchUrl()).toEqual(`/api/locus_lists/${locusListGuid}/delete`)
  expect(store.getState().locusListsByGuid).toEqual({})
  expect(history.location.pathname).toEqual('/summary_data/gene_lists')
  expect(wrapper.text()).toContain('My Gene Lists')
})
