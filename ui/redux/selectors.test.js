/* eslint-disable no-undef */

import { STATE_WITH_2_FAMILIES } from 'pages/Project/fixtures'
import {
  getVariantTagNotesByFamilyVariants,
  getSelectableTagTypesByProject,
  getUserOptions,
  getLocusListIntervalsByChromProject,
  getSpliceOutliersByChromFamily,
  getProjectAnalysisGroupFamilyGuidsByGuid,
  familyPassesFilters,
} from './selectors'
import {DYNAMIC_ANALYSIS_GROUP_GUID, FAMILY_GUID, GENE_ID, SEARCH, SEARCH_HASH, STATE} from "../pages/Search/fixtures";

test('getVariantTagNotesByByFamilyVariants', () => {
  const tagsNotesByGuid = getVariantTagNotesByFamilyVariants(
    STATE_WITH_2_FAMILIES,
  )
  expect(Object.keys(tagsNotesByGuid).length).toEqual(2)
  expect(Object.keys(tagsNotesByGuid.F011652_1).length).toEqual(3)
  expect(tagsNotesByGuid.F011652_1['22-45919065-TTTC-T'].notes.length).toEqual(1)
  expect(tagsNotesByGuid.F011652_1['22-45919065-TTTC-T'].tags.length).toEqual(1)
  expect(tagsNotesByGuid.F011652_1['1-248367227-TC-T'].tags.length).toEqual(2)
  expect(tagsNotesByGuid.F011652_1['batch_123_DEL'].tags).toEqual(undefined)
  expect(Object.keys(tagsNotesByGuid.F011652_2).length).toEqual(3)
  expect(tagsNotesByGuid.F011652_2['22-248367227-C-T']).toEqual({ variantGuids: 'SV0000003_2246859832_r0390_100'})
  expect(tagsNotesByGuid.F011652_2['22-248367228-C-T']).toEqual({ variantGuids: 'SV0000005_2246859833_r0390_100'})
  expect(tagsNotesByGuid.F011652_2['22-248367227-C-T,22-248367228-C-T'].tags.length).toEqual(1)
})

test('getSelectableTagTypesByProject', () => {
  expect(getSelectableTagTypesByProject(STATE, {})).toEqual(
    { R0237_1000_genomes_demo: [] },
  )
})

test('getUserOptions', () => {
  const options = getUserOptions(STATE_WITH_2_FAMILIES)
  expect(Object.keys(options).length).toEqual(7)
  expect(options[1]).toEqual({ key: '4MW8vPtmHG', value: '4MW8vPtmHG', text: 'Mekdes (mgetaneh@broadinstitute.org)'})
})

test('getLocusListIntervalsByChromProject', () => {
  expect(getLocusListIntervalsByChromProject(STATE, {})).toEqual({
    ['1']: {
      'R0237_1000_genomes_demo': [
        {'chrom': '1', 'end': 7300, 'genomeVersion': '37', 'locusListGuid': 'LL00132_2017_monogenic_ibd_gen', 'locusListIntervalGuid': 'LLI0000012_test_list_edit4545_', 'start': 7200},
      ],
    },
    ['3']: {
      'R0237_1000_genomes_demo': [
        {'chrom': '3', 'end': 3000, 'genomeVersion': '37', 'locusListGuid': 'LL00132_2017_monogenic_ibd_gen', 'locusListIntervalGuid': 'LLI0000013_a_new_list325_3000', 'start': 25},
      ],
    }
  })
})

test('getSpliceOutliersByChromFamily', () => {
  expect(getSpliceOutliersByChromFamily(STATE, {})).toEqual({
    ['10']: {
      'F011652_1': [
        {
          familyGuid: "F011652_1", geneSymbol: "ENSG00000136758", idField: "ENSG00000136758-10-27114300-27114400-*-psi5", individualGuid: "I021474_na19679", individualName: "",
          chrom: "10", deltaPsi: 0.56, end: 27114400, geneId: "ENSG00000136758", isSignificant: true, pValue: 2.1234e-10, rareDiseaseSamplesTotal: 171, rareDiseaseSamplesWithJunction: 1, readCount: 1208, start: 27114300, strand: "*", tissueType: "F", type: "psi5", zScore: 2.96,
        },
      ],
    },
    ['11']: {
      'F011652_1': [
        {
          familyGuid: "F011652_1", geneSymbol: "ENSG00000136758", idField: "ENSG00000136758-11-27114300-27114400-*-psi5", individualGuid: "I021474_na19679", individualName: "",
          chrom: "11", deltaPsi: 0.56, end: 27114400, geneId: "ENSG00000136758", isSignificant: true, pValue: 2.1234e-10, rareDiseaseSamplesTotal: 171, rareDiseaseSamplesWithJunction: 1, readCount: 1208, start: 27114300, strand: "*", tissueType: "F", type: "psi5", zScore: 2.96,
        },
      ],
    }
  })
})

test('getProjectAnalysisGroupFamilyGuidsByGuid', () => {
  expect(getProjectAnalysisGroupFamilyGuidsByGuid(STATE, { projectGuid: 'R0237_1000_genomes_demo' })).toEqual({
    AG0000183_test_group: ['F011652_1'],
    DAG0000183_test: ['F011652_1'],
    DAG0000184_test_2: [],
  })
  expect(getProjectAnalysisGroupFamilyGuidsByGuid(STATE, {})).toEqual({
    DAG0000183_test: [],
  })
})

describe('data loaded filters', () => {
  const WEEK = 'SHOW_DATA_LOADED_PAST_WEEK'
  const MONTH = 'SHOW_DATA_LOADED_PAST_MONTH'
  const THREE_MONTHS = 'SHOW_DATA_LOADED_PAST_3_MONTHS'
  const SV = 'SHOW_DATA_LOADED_SV'
  const MITO = 'SHOW_DATA_LOADED_MITO'
  const RNA = 'SHOW_DATA_LOADED_RNA'
  const ALL = 'SHOW_DATA_LOADED'

  const FAMILY = STATE.familiesByGuid[FAMILY_GUID]
  const OLD_SV_STATE = {
    ...STATE,
    datasetsByGuid: {
      ...STATE.datasetsByGuid,
      S2310657_wal_mc16200_mc16203: {
        ...STATE.datasetsByGuid.S2310657_wal_mc16200_mc16203, loadedDate: '2017-11-02T13:25:21.551Z',
      },
    },
  }

  const mockNow = (date) => jest.spyOn(Date, 'now').mockReturnValue(Date.parse(date))
  const passes = (firstSample, { state = STATE, family = FAMILY } = {}) => (
    familyPassesFilters(state)(family, { firstSample })
  )

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('filters by a fixed cutoff relative to now', () => {
    mockNow('2018-03-20T23:00:00.000Z')
    expect(passes([WEEK])).toBe(true)
    expect(passes([MONTH])).toBe(true)
    expect(passes([THREE_MONTHS])).toBe(true)

    mockNow('2018-03-21T00:00:00.000Z')
    expect(passes([WEEK])).toBe(false)
    expect(passes([MONTH])).toBe(true)
    expect(passes([WEEK, MONTH])).toBe(true)

    mockNow('2018-04-14T00:00:00.000Z')
    expect(passes([MONTH])).toBe(false)
    expect(passes([THREE_MONTHS])).toBe(true)

    mockNow('2018-06-14T00:00:00.000Z')
    expect(passes([THREE_MONTHS])).toBe(false)
    expect(passes([WEEK, MONTH, THREE_MONTHS])).toBe(false)
    expect(passes([ALL])).toBe(true)
  })

  test('requires the same dataset to match the data type and the loaded date', () => {
    mockNow('2018-03-15T12:00:00.000Z')
    expect(passes([SV, WEEK])).toBe(true)
    expect(passes([ALL, WEEK])).toBe(true)
    expect(passes([MITO, WEEK])).toBe(false)
    expect(passes([MITO, SV, WEEK])).toBe(true)

    expect(passes([SV], { state: OLD_SV_STATE })).toBe(true)
    expect(passes([WEEK], { state: OLD_SV_STATE })).toBe(true)
    expect(passes([ALL, WEEK], { state: OLD_SV_STATE })).toBe(true)
    expect(passes([SV, WEEK], { state: OLD_SV_STATE })).toBe(false)
    expect(passes([SV, MONTH], { state: OLD_SV_STATE })).toBe(false)
    expect(passes([SV, WEEK, MONTH], { state: OLD_SV_STATE })).toBe(false)
    expect(passes([SV, MITO, THREE_MONTHS], { state: OLD_SV_STATE })).toBe(false)

    mockNow('2018-01-15T12:00:00.000Z')
    expect(passes([SV, WEEK], { state: OLD_SV_STATE })).toBe(false)
    expect(passes([SV, THREE_MONTHS], { state: OLD_SV_STATE })).toBe(true)
  })

  test('ignores inactive datasets and families with no data', () => {
    mockNow('2018-03-15T12:00:00.000Z')
    const state = {
      ...STATE,
      datasetsByGuid: {
        S2310656_wal_mc16200_mc16203: STATE.datasetsByGuid.S2310656_wal_mc16200_mc16203,
      },
    }
    expect(passes([WEEK], { state })).toBe(false)
    expect(passes([ALL], { state })).toBe(false)
    expect(passes([WEEK], { state: { ...STATE, datasetsByGuid: {} } })).toBe(false)
  })

  test('keeps family-level options as alternatives to the dataset options', () => {
    mockNow('2018-06-14T00:00:00.000Z')
    expect(passes([RNA, WEEK])).toBe(false)
    expect(passes([RNA, WEEK], { family: { ...FAMILY, hasRna: true } })).toBe(true)
    expect(passes([RNA, MITO], { family: { ...FAMILY, hasRna: true } })).toBe(true)
    expect(passes([RNA, SV])).toBe(true)
    expect(passes(['SHOW_DATA_LOADED_PHENO', MONTH])).toBe(false)
    expect(passes(['SHOW_DATA_LOADED_PHENO', MONTH], { family: { ...FAMILY, hasPhenotypePrioritization: true } })).toBe(true)
  })

  test('uses the loaded dates of search context sample types', () => {
    mockNow('2018-03-15T12:00:00.000Z')
    const family = {
      ...FAMILY,
      sampleTypes: [
        { datasetType: 'SNV_INDEL', sampleType: 'WES', isActive: true, loadedDate: '2017-02-05T06:25:55.397+00:00' },
        { datasetType: 'MITO', sampleType: 'WGS', isActive: true, loadedDate: '2018-03-10T06:25:55.397+00:00' },
      ],
    }
    expect(passes([WEEK], { family })).toBe(true)
    expect(passes([MITO, WEEK], { family })).toBe(true)
    expect(passes([SV, WEEK], { family })).toBe(false)
    expect(passes([SV], { family })).toBe(false)
    expect(passes([ALL], { family })).toBe(true)
    expect(passes([WEEK], { family: { ...family, sampleTypes: family.sampleTypes.slice(0, 1) } })).toBe(false)
    expect(passes([WEEK], {
      family: { ...family, sampleTypes: [{ datasetType: 'SNV_INDEL', sampleType: 'WES', isActive: true }] },
    })).toBe(false)
  })

  test('combines with other criteria in dynamic analysis groups', () => {
    const state = {
      ...STATE,
      datasetsByGuid: {
        ...STATE.datasetsByGuid,
        S2310657_wal_mc16200_mc16203: {
          ...STATE.datasetsByGuid.S2310657_wal_mc16200_mc16203, loadedDate: '2018-01-20T13:25:21.551Z',
        },
      },
      analysisGroupsByGuid: {
        DAG_recent: { analysisGroupGuid: 'DAG_recent', projectGuid: null, criteria: { firstSample: [WEEK] } },
        DAG_recent_sv: { analysisGroupGuid: 'DAG_recent_sv', projectGuid: null, criteria: { firstSample: [SV, WEEK] } },
        DAG_quarter_sv: {
          analysisGroupGuid: 'DAG_quarter_sv',
          projectGuid: null,
          criteria: { firstSample: [SV, THREE_MONTHS], analysisStatus: ['Rcpc'] },
        },
        DAG_quarter_sv_status: {
          analysisGroupGuid: 'DAG_quarter_sv_status',
          projectGuid: null,
          criteria: { firstSample: [SV, THREE_MONTHS], analysisStatus: ['I'] },
        },
      },
    }
    const props = { projectGuid: 'R0237_1000_genomes_demo' }

    mockNow('2018-03-15T12:00:00.000Z')
    expect(getProjectAnalysisGroupFamilyGuidsByGuid(state, props)).toEqual({
      DAG_recent: ['F011652_1'], DAG_recent_sv: [], DAG_quarter_sv: ['F011652_1'], DAG_quarter_sv_status: [],
    })

    mockNow('2018-05-01T12:00:00.000Z')
    expect(getProjectAnalysisGroupFamilyGuidsByGuid(
      { ...state, familiesByGuid: { ...state.familiesByGuid } }, props,
    )).toEqual({
      DAG_recent: [], DAG_recent_sv: [], DAG_quarter_sv: [], DAG_quarter_sv_status: [],
    })
  })
})
