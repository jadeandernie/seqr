import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'

import { getLastFetchBody, getLastFetchOptions, getLastFetchUrl } from 'shared/utils/testHelpers'
import { updateLocusList } from './rootReducer'

const DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE = 2621440

const LOCUS_LIST_GUID = 'LL00132_large_gene_list'

const GENE_IDS = [...Array(1500).keys()].map(i => `ENSG${String(i).padStart(11, '0')}`)

const LOCUS_LIST = {
  locusListGuid: LOCUS_LIST_GUID,
  name: 'Mendeliome',
  description: 'A very large gene list',
  isPublic: false,
  canEdit: true,
  createdBy: 'test@broadinstitute.org',
  createdDate: '2021-05-20T03:05:38.270Z',
  lastModifiedDate: '2021-05-20T03:05:38.270Z',
  numEntries: GENE_IDS.length,
  intervalGenomeVersion: '37',
  rawItems: GENE_IDS.join(', '),
  items: GENE_IDS.map(geneId => ({
    geneId,
    display: geneId,
    pagene: null as null,
    gene: { geneId, geneSymbol: geneId, notes: 'x'.repeat(2000) },
  })),
}

const dispatchUpdate = (values: Record<string, unknown>) => {
  const store = configureStore([thunk])({})
  return store.dispatch(updateLocusList(values) as any)
}

test('updateLocusList only posts the fields used to update a large gene list', async () => {
  expect(JSON.stringify(LOCUS_LIST).length).toBeGreaterThan(DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE)

  await dispatchUpdate({ ...LOCUS_LIST, ignoreInvalidItems: true })

  expect(getLastFetchUrl()).toEqual(`/api/locus_lists/${LOCUS_LIST_GUID}/update`)
  expect(getLastFetchBody()).toEqual({
    name: 'Mendeliome',
    description: 'A very large gene list',
    isPublic: false,
    rawItems: LOCUS_LIST.rawItems,
    intervalGenomeVersion: '37',
    ignoreInvalidItems: true,
  })
  expect(getLastFetchOptions().body.length).toBeLessThan(DJANGO_DATA_UPLOAD_MAX_MEMORY_SIZE / 10)
})

test('updateLocusList only posts the edited field for single field updates', async () => {
  await dispatchUpdate({ locusListGuid: LOCUS_LIST_GUID, isPublic: true })

  expect(getLastFetchUrl()).toEqual(`/api/locus_lists/${LOCUS_LIST_GUID}/update`)
  expect(getLastFetchBody()).toEqual({ isPublic: true })
})

test('updateLocusList posts no gene list content on delete', async () => {
  await dispatchUpdate({ ...LOCUS_LIST, delete: true })

  expect(getLastFetchUrl()).toEqual(`/api/locus_lists/${LOCUS_LIST_GUID}/delete`)
  expect(getLastFetchBody()).toEqual({})
})

test('updateLocusList posts the form values on create', async () => {
  const { name, description, isPublic, rawItems } = LOCUS_LIST
  await dispatchUpdate({ name, description, isPublic, rawItems })

  expect(getLastFetchUrl()).toEqual('/api/locus_lists/create')
  expect(getLastFetchBody()).toEqual({ name, description, isPublic, rawItems })
})
