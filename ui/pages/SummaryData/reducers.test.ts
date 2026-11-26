import { testLoader } from '../../redux/utils/loadingTestUtils'
import { loadSavedVariants } from './reducers'

describe('summary data loading reducers', () => {
  testLoader({
    loader: 'savedVariantsLoading',
    load: () => loadSavedVariants({ tag: 'Known gene for phenotype' }),
    response: { savedVariantsByGuid: { SV1: { variantGuid: 'SV1' } } },
    dataKey: 'savedVariantsByGuid',
  })
})
