import React from 'react'
import { shallow, mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { RadioGroup } from '../../form/Inputs'
import FamilyReads from './FamilyReads'
import { flushAll } from 'shared/utils/testHelpers'
import { STATE1 } from '../fixtures'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<FamilyReads store={store} familyGuid="F011652_1" />)
})

const mockIgv = jest.fn(() => null)
jest.mock('../../graph/IGV', () => ({ __esModule: true, default: props => mockIgv(props) }))

const PROJECT_GUID_38 = 'R0002_grch38_project'
const FAMILY_GUID_38 = 'F000002_2'
const IGV_SAMPLE = {
  projectGuid: 'R0237_1000_genomes_demo',
  familyGuid: 'F011652_1',
  individualGuid: 'I021474_na19679',
  sampleGuid: 'S2310656_wal_mc16200_mc16203',
  sampleType: 'alignment',
  filePath: 'gs://seqr-datasets/GRCh37/cmg_sankaran_wes/CMG_MYOSEQ_MC16203.cram',
}
const GCNV_SAMPLE = { ...IGV_SAMPLE, sampleGuid: 'S_gcnv', sampleType: 'gcnv', filePath: 'gs://gcnv/batch.bed.gz' }
const MULTI_BUILD_STATE = {
  ...STATE1,
  projectsByGuid: {
    R0237_1000_genomes_demo: { ...STATE1.projectsByGuid.R0237_1000_genomes_demo, genomeVersion: '37' },
    [PROJECT_GUID_38]: { projectGuid: PROJECT_GUID_38, genomeVersion: '38' },
  },
  familiesByGuid: {
    F011652_1: { ...STATE1.familiesByGuid.F011652_1, projectGuid: 'R0237_1000_genomes_demo' },
    [FAMILY_GUID_38]: { familyGuid: FAMILY_GUID_38, projectGuid: PROJECT_GUID_38, individualGuids: [] },
  },
  igvSamplesByGuid: {
    [IGV_SAMPLE.sampleGuid]: IGV_SAMPLE,
    [GCNV_SAMPLE.sampleGuid]: GCNV_SAMPLE,
    S_grch38: {
      ...IGV_SAMPLE,
      projectGuid: PROJECT_GUID_38,
      familyGuid: FAMILY_GUID_38,
      individualGuid: 'I000002_grch38',
      sampleGuid: 'S_grch38',
    },
  },
  individualsByGuid: {
    ...STATE1.individualsByGuid,
    I000002_grch38: { ...STATE1.individualsByGuid.I021474_na19679, individualGuid: 'I000002_grch38', familyGuid: FAMILY_GUID_38 },
  },
  genesById: {
    ENSG00000228198: {
      geneId: 'ENSG00000228198',
      chromGrch37: '1',
      startGrch37: 930000,
      codingRegionSizeGrch37: 3000,
      chromGrch38: '1',
      startGrch38: 995000,
      codingRegionSizeGrch38: 3000,
    },
  },
}
const GRCH38_VARIANT = {
  variantId: '1-1000000-A-G',
  chrom: '1',
  pos: 1000000,
  ref: 'A',
  alt: 'G',
  genomeVersion: '38',
  liftedOverGenomeVersion: '37',
  liftedOverChrom: '1',
  liftedOverPos: 935380,
  transcripts: { ENSG00000228198: [{ transcriptId: 'ENST00000456743' }] },
  mainTranscriptId: 'ENST00000456743',
}
const NO_LIFTOVER_VARIANT = { ...GRCH38_VARIANT, liftedOverChrom: '', liftedOverPos: '' }
const GENE_LOCUS_37 = 'chr1:929000-934000'

const Layout = ({ showReads, reads }) => (
  <div>
    {showReads}
    {reads}
  </div>
)

const openReads = async (familyGuid, variant) => {
  mockIgv.mockClear()
  const store = configureStore()(MULTI_BUILD_STATE)
  const wrapper = mount(<FamilyReads store={store} layout={Layout} familyGuid={familyGuid} variant={variant} />)
  wrapper.find('ButtonLink').filterWhere(button => button.text() === 'SHOW READS').simulate('click')
  await flushAll()
  await new Promise(resolve => setTimeout(resolve, 10))
  wrapper.update()
  const { locus, reference } = mockIgv.mock.calls[mockIgv.mock.calls.length - 1][0]
  const rangeGroup = wrapper.find(RadioGroup)
  const rangeOptions = rangeGroup.exists() ? rangeGroup.props().options : []
  return { locus, referenceId: reference.id, rangeOptions }
}

test('opens IGV at the variant position for a family on the same genome build', async () => {
  const { locus, referenceId } = await openReads(FAMILY_GUID_38, GRCH38_VARIANT)
  expect(referenceId).toEqual('hg38')
  expect(locus).toEqual('chr1:999900-1000100')
})

test('opens IGV at the lifted over position for a family on the other genome build', async () => {
  const { locus, referenceId, rangeOptions } = await openReads('F011652_1', GRCH38_VARIANT)
  expect(referenceId).toEqual('hg19')
  expect(locus).toEqual('chr1:935280-935480')
  expect(rangeOptions).toEqual([
    { text: 'Variant', value: 'chr1:935280-935480' },
    { text: 'Gene', value: GENE_LOCUS_37 },
  ])
})

test('does not offer the variant locus for a family on the other genome build without liftover', async () => {
  const { locus, referenceId, rangeOptions } = await openReads('F011652_1', NO_LIFTOVER_VARIANT)
  expect(referenceId).toEqual('hg19')
  expect(locus).toEqual(GENE_LOCUS_37)
  expect(rangeOptions).toEqual([{ text: 'Gene', value: GENE_LOCUS_37 }])
})

test('opens IGV with no locus when neither liftover nor gene coordinates are available', async () => {
  const { locus } = await openReads('F011652_1', { ...NO_LIFTOVER_VARIANT, transcripts: {}, mainTranscriptId: null })
  expect(locus).toBeNull()
})

test('keeps the variant size when lifting over a structural variant', async () => {
  const { locus } = await openReads('F011652_1', { ...GRCH38_VARIANT, end: 1001000 })
  expect(locus).toEqual('chr1:934880-936880')
})
