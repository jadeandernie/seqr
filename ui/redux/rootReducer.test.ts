import { loadProjectDetails } from './utils/reducerUtils'
import { LoaderCase, testLoader } from './utils/loadingTestUtils'
import { fetchProjects, loadGene, loadGenes, loadLocusListItems } from './rootReducer'

const GENES = { genesById: { ENSG1: { geneId: 'ENSG1', notes: [] as string[] } } }

const LOADERS: LoaderCase[] = [
  {
    loader: 'projectsLoading',
    load: fetchProjects,
    response: { projectsByGuid: { P2: { projectGuid: 'P2' } } },
    dataKey: 'projectsByGuid',
  },
  {
    loader: 'projectDetailsLoading',
    load: () => loadProjectDetails('P1'),
    response: { projectsByGuid: { P1: { projectGuid: 'P1', canEdit: true } } },
    dataKey: 'projectsByGuid',
  },
  { loader: 'genesLoading', load: () => loadGene('ENSG1'), response: GENES, dataKey: 'genesById' },
  { loader: 'genesLoading', load: () => loadGenes(['ENSG1']), response: GENES, dataKey: 'genesById' },
  {
    loader: 'locusListLoading',
    load: () => loadLocusListItems('LL1'),
    response: { locusListsByGuid: { LL1: { locusListGuid: 'LL1', items: [{ geneId: 'ENSG1' }] } } },
    dataKey: 'locusListsByGuid',
  },
]

describe('root loading reducers', () => {
  LOADERS.forEach(testLoader)
})
