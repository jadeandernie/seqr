import { LoaderCase, testLoader } from '../../redux/utils/loadingTestUtils'
import {
  loadSavedVariants, loadRnaSeqData, loadPhenotypeGeneScores, loadFamilyVariantSummary, loadIndividuals,
  loadMmeSubmissions,
} from './reducers'

const LOADERS: LoaderCase[] = [
  {
    loader: 'savedVariantsLoading',
    load: () => loadSavedVariants({ familyGuids: ['F1'], variantGuid: null, tag: null }),
    response: { savedVariantsByGuid: { SV1: { variantGuid: 'SV1' } } },
    dataKey: 'savedVariantsByGuid',
  },
  {
    loader: 'rnaSeqDataLoading',
    load: () => loadRnaSeqData('I1'),
    response: { rnaSeqData: { I1: { outliers: {}, spliceOutliers: {} } } },
    dataKey: 'rnaSeqData',
    stateKey: 'rnaSeqDataByIndividual',
  },
  {
    loader: 'phenotypeDataLoading',
    load: () => loadPhenotypeGeneScores('I1'),
    response: { phenotypeGeneScores: { I1: { ENSG1: { lirical: [{ rank: 1 }] } } } },
    dataKey: 'phenotypeGeneScores',
    stateKey: 'phenotypeGeneScoresByIndividual',
  },
  {
    loader: 'familyVariantSummaryLoading',
    load: () => loadFamilyVariantSummary('F1'),
    response: { familiesByGuid: { F1: { discoveryGeneIds: ['ENSG1'] } } },
    dataKey: 'familiesByGuid',
  },
  {
    loader: 'individualsLoading',
    load: loadIndividuals,
    response: { individualsByGuid: { I2: { individualGuid: 'I2' } } },
    dataKey: 'individualsByGuid',
  },
  {
    loader: 'mmeSubmissionsLoading',
    load: loadMmeSubmissions,
    response: { mmeSubmissionsByGuid: { MS1: { submissionGuid: 'MS1' } } },
    dataKey: 'mmeSubmissionsByGuid',
  },
]

describe('project loading reducers', () => {
  LOADERS.forEach(testLoader)
})
