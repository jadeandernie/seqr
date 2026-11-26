/* eslint-disable no-undef */

import orderBy from 'lodash/orderBy'
import { getVisibleFamilies, getVisibleFamiliesInSortedOrder, getProjectExportUrls, getCurrentAnalysisGroup,
  getCaseReviewStatusCounts, getProjectAnalysisGroupFamiliesByGuid, getIndividualTaggedVariants,
  getDefaultMmeSubmission, getMmeResultsBySubmission, getMmeDefaultContactEmail, getIndividualPhenotypeGeneScores,
  getCompletenessByFamilyGuid, getProjectAnalysisGroupCompleteness, getOpenDataRequestsByIndividualGuid,
  getProjectOpenDataRequests,
} from './selectors'

import { STATE_WITH_2_FAMILIES } from './fixtures'

test('getVisibleFamilies', () => {

  const visibleFamilies = getVisibleFamilies(STATE_WITH_2_FAMILIES, {})

  expect(visibleFamilies.length).toEqual(2)
  expect(visibleFamilies[0].familyGuid).toEqual('F011652_1')
  expect(visibleFamilies[1].familyGuid).toEqual('F011652_2')
})

test('getVisibleFamilies - Case Review', () => {

  const visibleFamilies = getVisibleFamilies(STATE_WITH_2_FAMILIES, { tableName: 'Case Review' })

  expect(visibleFamilies.length).toEqual(2)
  expect(visibleFamilies[0].familyGuid).toEqual('F011652_1')
  expect(visibleFamilies[1].familyGuid).toEqual('F011652_2')
})


test('getVisibleFamiliesInSortedOrder', () => {
  const visibleFamiliesSorted = getVisibleFamiliesInSortedOrder(STATE_WITH_2_FAMILIES, {})

  expect(visibleFamiliesSorted.length).toEqual(2)
  expect(visibleFamiliesSorted[0].familyGuid).toEqual('F011652_2')
  expect(visibleFamiliesSorted[1].familyGuid).toEqual('F011652_1')
})


test('getProjectExportUrls', () => {
  const exportUrls = getProjectExportUrls(STATE_WITH_2_FAMILIES, {})

  expect(exportUrls.length).toEqual(3)
  expect(exportUrls.map(({ name }) => name)).toEqual(['Families', 'Individuals', 'Samples'])

  const exportFamilies = exportUrls[0].getRawData(STATE_WITH_2_FAMILIES)

  expect(exportFamilies.length).toEqual(2)
  expect(exportFamilies[0].familyGuid).toEqual('F011652_2')
  expect(exportFamilies[1].familyGuid).toEqual('F011652_1')
  expect(exportFamilies[0].firstSample.datasetType).toEqual('SNV_INDEL')
  expect(exportFamilies[0].firstSample.sampleType).toEqual('WES')
  expect(exportFamilies[0].firstSample.loadedDate).toEqual('2018-03-13')
  expect(exportFamilies[1].firstSample).toEqual(null)
  expect(exportFamilies[0].analysisNotes.length).toEqual(2)
  expect(exportFamilies[0].caseNotes).toEqual(undefined)

  const exportIndividuals = exportUrls[1].getRawData(STATE_WITH_2_FAMILIES)

  expect(exportIndividuals.length).toEqual(6)
  expect(exportIndividuals.map(individual => individual.individualId)).toEqual([
    'NA19675', 'NA19678', 'NA19679', 'NA19675', 'NA19678', 'NA19679',
  ])
  expect(exportIndividuals[1].familyId).toEqual('2')
  expect(exportIndividuals[1].hasLoadedSamples).toEqual(true)
  expect(exportIndividuals[3].familyId).toEqual('1')
  expect(exportIndividuals[3].hasLoadedSamples).toEqual(false)
})

test('getCaseReviewStatusCounts', () => {
  const caseReviewStatusCounts = getCaseReviewStatusCounts(STATE_WITH_2_FAMILIES)
  const caseReviewStatusCountsSorted = orderBy(caseReviewStatusCounts, [obj => obj.count], 'desc')

  expect(caseReviewStatusCountsSorted.length).toEqual(10)

  expect(caseReviewStatusCountsSorted[0]).toHaveProperty('name', 'In Review')
  expect(caseReviewStatusCountsSorted[0]).toHaveProperty('value', 'I')
  expect(caseReviewStatusCountsSorted[0]).toHaveProperty('count', 4)


  expect(caseReviewStatusCountsSorted[1]).toHaveProperty('name', 'Accepted')
  expect(caseReviewStatusCountsSorted[1]).toHaveProperty('value', 'A')
  expect(caseReviewStatusCountsSorted[1]).toHaveProperty('count', 2)

  expect(caseReviewStatusCountsSorted[2]).toHaveProperty('count', 0)

})

test('getCurrentAnalysisGroup', () => {

  const group = getCurrentAnalysisGroup(STATE_WITH_2_FAMILIES, { analysisGroupGuid: 'AG0000183_test_group' })
  expect(group.analysisGroupGuid).toEqual('AG0000183_test_group')
  expect(group.workspaceName).toEqual('anvil-analysis-group')

  expect(getCurrentAnalysisGroup(STATE_WITH_2_FAMILIES)).toBe(undefined)
})

test('getProjectAnalysisGroupFamiliesByGuid', () => {

  const families = getProjectAnalysisGroupFamiliesByGuid(STATE_WITH_2_FAMILIES, { analysisGroupGuid: 'AG0000183_test_group' })

  expect(Object.keys(families)).toEqual(['F011652_1'])
  expect(families.F011652_1.familyId).toEqual('1')
})

test('getIndividualTaggedVariants', () => {
  const individualVariants = getIndividualTaggedVariants(STATE_WITH_2_FAMILIES, { individualGuid: 'I021475_na19675_1' })
  expect(individualVariants.length).toEqual(2)
  expect(individualVariants[0].variantGuid).toEqual('SV0000004_116042722_r0390_1000')
  expect(individualVariants[0].variantId).toEqual('SV0000004_116042722_r0390_1000-ENSG00000228198')
  expect(individualVariants[0].numAlt).toEqual(2)
  expect(individualVariants[0].gq).toEqual(99)
  expect(individualVariants[0].geneSymbol).toEqual('OR2M3')
})

test('getDefaultMmeSubmission', () => {
  const defaultSubmissions = getDefaultMmeSubmission(STATE_WITH_2_FAMILIES)
  expect(defaultSubmissions).toEqual({
    contacts: [{ email: 'test@broadinstitute.org', name: 'PI' }, { email: 'other_user@broadinstitute.org', name: '' }],
    geneVariants: [],
    phenotypes: [],
  })
})

test('getMmeResultsBySubmission', () => {
  const mmeResults = getMmeResultsBySubmission(STATE_WITH_2_FAMILIES, {match: {params: {}}})
  expect(Object.keys(mmeResults).length).toEqual(1)
  expect(mmeResults.MS021475_na19675_1.active.length).toEqual(1)
  expect(mmeResults.MS021475_na19675_1.active[0].id).toEqual('12531')
  expect(mmeResults.MS021475_na19675_1.active[0].geneVariants.length).toEqual(1)
  expect(mmeResults.MS021475_na19675_1.active[0].comments).toEqual('This seems promising')
  expect(mmeResults.MS021475_na19675_1.active[0].matchStatus.comments).toEqual('This seems promising')

  expect(mmeResults.MS021475_na19675_1.removed.length).toEqual(1)
  expect(mmeResults.MS021475_na19675_1.removed[0].id).toEqual('10509')
})

test('getMmeDefaultContactEmail', () => {
  expect(getMmeDefaultContactEmail(STATE_WITH_2_FAMILIES, { matchmakerResultGuid: 'MR0005038_HK018_0047' })).toEqual({
    matchmakerResultGuid: 'MR0005038_HK018_0047',
    patientId: '12531',
    to: 'crowley@unc.edu,test@test.com,test@broadinstitute.org',
    subject: 'OR2M3 Matchmaker Exchange connection (NA19675_1)',
    body: 'Dear James Crowley,\n\nWe recently matched with one of your patients in Matchmaker Exchange harboring variants in OR2M3. Our patient has a homozygous frameshift variant 22:45919065 TTTC>T (hg19) (c.862delC/p.Leu288SerfsTer10), a copy number deletion 1:248367227-248369100 (hg19) (CN=0) and presents with childhood onset short-limb short stature and flexion contracture. Would you be willing to share whether your patient\'s phenotype and genotype match with ours? We are very grateful for your help and look forward to hearing more.\n\nBest wishes,\nTest User',
  })

  const missingDetailState = {
    ...STATE_WITH_2_FAMILIES,
    mmeSubmissionsByGuid: {
      MS021475_na19675_1: {
        ...STATE_WITH_2_FAMILIES.mmeSubmissionsByGuid.MS021475_na19675_1,
        phenotypes: STATE_WITH_2_FAMILIES.mmeSubmissionsByGuid.MS021475_na19675_1.phenotypes.map(p => ({ ...p, observed: 'yes' })),
      }
    },
    mmeResultsByGuid: {
      ...STATE_WITH_2_FAMILIES.mmeResultsByGuid,
      MS12345_missing_data: {
        id: 12345, submissionGuid: 'MS021475_na19675_1', patient: {
          contact: {
              href: "mailto:test_2@test.com",
              institution: "Data Center",
              name: "Test User"
          },
          id: "54321"
      },
      },
    },
  }
  const missingDataEmail = {
    matchmakerResultGuid: 'MS12345_missing_data',
    patientId: '54321',
    to: 'test_2@test.com,test@test.com,test@broadinstitute.org',
    subject: 'Patient 54321 Matchmaker Exchange connection (NA19675_1)',
    body: 'Dear Test User,\n\nWe recently matched with one of your patients in Matchmaker Exchange harboring variants in OR2M3. Our patient has a homozygous frameshift variant 22:45919065 TTTC>T (hg19) (c.862delC/p.Leu288SerfsTer10), a copy number deletion 1:248367227-248369100 (hg19) (CN=0) and presents with childhood onset short-limb short stature, abnormality of nervous system physiology, and flexion contracture. Would you be willing to share whether your patient\'s phenotype and genotype match with ours? We are very grateful for your help and look forward to hearing more.\n\nBest wishes,\nTest User',
  }
  expect(getMmeDefaultContactEmail(missingDetailState, { matchmakerResultGuid: 'MS12345_missing_data' })).toEqual(missingDataEmail)

  expect(getMmeDefaultContactEmail({
    ...missingDetailState,
    mmeSubmissionsByGuid: {
      ...missingDetailState.mmeSubmissionsByGuid,
      MS021475_na19675_1: {
        ...missingDetailState.mmeSubmissionsByGuid.MS021475_na19675_1,
        geneVariants: [{ geneId: 'ENSG_UNKNOWN', variantGuid: 'SV0000004_116042722_r0390_1000' }],
        phenotypes: null,
      }
    },
    mmeResultsByGuid: {
      ...missingDetailState.mmeResultsByGuid,
      MS12345_missing_data: {
        ...missingDetailState.mmeResultsByGuid.MS12345_missing_data,
        geneVariants: [
          { geneId: 'ENSG_UNKNOWN' },
          { geneId: 'ENSG_UNKNOWN', variantGuid: 'SV0000004_116042722_r0390_1000' },
        ],
      }
    }
  }, { matchmakerResultGuid: 'MS12345_missing_data' })).toEqual({
    ...missingDataEmail,
    body: missingDataEmail.body.slice(0, 219).replace('variants in OR2M3', 'a variant in ') + missingDataEmail.body.slice(405),
  })
})

test('getIndividualPhenotypeGeneScores', () => {
  expect(getIndividualPhenotypeGeneScores(STATE_WITH_2_FAMILIES)).toEqual({
    I021476_na19678_1: [
      {
        tool: 'lirical',
        diseaseId: 'OMIM:618460',
        diseaseName: 'Khan-Khan-Katsanis syndrome',
        familyGuid: 'F011652_1',
        gene: STATE_WITH_2_FAMILIES.genesById.ENSG00000228198,
        rowId: 'ENSG00000228198-lirical-OMIM:618460',
        rank: 1,
        scores: { compositeLR: 0.066, post_test_probability: 0 },
      },
    ],
  })

  expect(getIndividualPhenotypeGeneScores({ ...STATE_WITH_2_FAMILIES, phenotypeGeneScoresByIndividual: null })).toEqual({})
})

const COMPLETENESS_STATE = {
  ...STATE_WITH_2_FAMILIES,
  familiesByGuid: {
    ...STATE_WITH_2_FAMILIES.familiesByGuid,
    F011652_1: {
      ...STATE_WITH_2_FAMILIES.familiesByGuid.F011652_1,
      completeness: { score: 1, numIndividuals: 1, numNoFeatures: 1 },
    },
    F011652_2: {
      ...STATE_WITH_2_FAMILIES.familiesByGuid.F011652_2,
      individualGuids: [],
      completeness: { score: 30, numIndividuals: 3, numNoFeatures: 2 },
    },
  },
  individualsByGuid: {
    ...STATE_WITH_2_FAMILIES.individualsByGuid,
    I021476_na19678_1: {
      ...STATE_WITH_2_FAMILIES.individualsByGuid.I021476_na19678_1, completeness: { score: 100, missing: [] },
    },
    I021474_na19679_1: {
      ...STATE_WITH_2_FAMILIES.individualsByGuid.I021474_na19679_1,
      completeness: { score: 60, missing: [{ field: 'features', label: 'Observed features (HPO terms)' }] },
    },
  },
}

test('getCompletenessByFamilyGuid', () => {
  expect(getCompletenessByFamilyGuid(STATE_WITH_2_FAMILIES)).toEqual({ F011652_1: null, F011652_2: null })

  // loaded individuals take precedence over the roll-up loaded with the family
  expect(getCompletenessByFamilyGuid(COMPLETENESS_STATE)).toEqual({
    F011652_1: { score: 80, numIndividuals: 2, numNoFeatures: 1 },
    F011652_2: { score: 30, numIndividuals: 3, numNoFeatures: 2 },
  })
})

test('getProjectAnalysisGroupCompleteness', () => {
  expect(getProjectAnalysisGroupCompleteness(STATE_WITH_2_FAMILIES, {})).toBeNull()

  expect(getProjectAnalysisGroupCompleteness(COMPLETENESS_STATE, {})).toEqual(
    { score: 50, numIndividuals: 5, numNoFeatures: 3 },
  )
  expect(getProjectAnalysisGroupCompleteness(COMPLETENESS_STATE, { analysisGroupGuid: 'AG0000183_test_group' })).toEqual(
    { score: 80, numIndividuals: 2, numNoFeatures: 1 },
  )
})

test('getVisibleFamiliesInSortedOrder by clinical data completeness', () => {
  const sortedGuids = familiesSortDirection => getVisibleFamiliesInSortedOrder({
    ...COMPLETENESS_STATE,
    familyTableState: { familiesSortOrder: 'SORT_BY_CLINICAL_DATA_COMPLETENESS', familiesSortDirection },
  }, {}).map(({ familyGuid }) => familyGuid)

  expect(sortedGuids(1)).toEqual(['F011652_2', 'F011652_1'])
  expect(sortedGuids(-1)).toEqual(['F011652_1', 'F011652_2'])
})

test('getVisibleFamilies filtered by clinical data completeness', () => {
  const visibleGuids = filter => getVisibleFamilies({
    ...COMPLETENESS_STATE,
    familyTableFilterState: { R0237_1000_genomes_demo: { firstSample: [filter] } },
  }, {}).map(({ familyGuid }) => familyGuid)

  expect(visibleGuids('SHOW_CLINICAL_DATA_COMPLETE')).toEqual([])
  expect(visibleGuids('SHOW_CLINICAL_DATA_INCOMPLETE')).toEqual(['F011652_1', 'F011652_2'])
  expect(visibleGuids('SHOW_CLINICAL_DATA_UNDER_HALF')).toEqual(['F011652_2'])
  expect(visibleGuids('SHOW_CLINICAL_DATA_NO_FEATURES')).toEqual(['F011652_1', 'F011652_2'])
})

const DATA_REQUEST = {
  dataRequestGuid: 'DR1',
  individualGuid: 'I021474_na19679_1',
  familyGuid: 'F011652_1',
  projectGuid: 'R0237_1000_genomes_demo',
  status: 'O',
  createdDate: '2026-11-20T10:00:00Z',
}
const DATA_REQUEST_STATE = {
  ...STATE_WITH_2_FAMILIES,
  dataRequestsByGuid: {
    DR1: DATA_REQUEST,
    DR2: { ...DATA_REQUEST, dataRequestGuid: 'DR2', individualGuid: 'I021476_na19678_1', createdDate: '2026-10-01T10:00:00Z' },
    DR3: { ...DATA_REQUEST, dataRequestGuid: 'DR3', individualGuid: 'I021476_na19678_2', familyGuid: 'F011652_2', status: 'F' },
    DR4: { ...DATA_REQUEST, dataRequestGuid: 'DR4', individualGuid: 'I_other', familyGuid: 'F_other', projectGuid: 'R_other' },
  },
}

test('getOpenDataRequestsByIndividualGuid', () => {
  expect(getOpenDataRequestsByIndividualGuid(STATE_WITH_2_FAMILIES)).toEqual({})
  expect(getOpenDataRequestsByIndividualGuid(DATA_REQUEST_STATE)).toEqual({
    I021474_na19679_1: DATA_REQUEST,
    I021476_na19678_1: DATA_REQUEST_STATE.dataRequestsByGuid.DR2,
    I_other: DATA_REQUEST_STATE.dataRequestsByGuid.DR4,
  })
})

test('getProjectOpenDataRequests returns the open requests of the current project, oldest first', () => {
  expect(getProjectOpenDataRequests(STATE_WITH_2_FAMILIES)).toEqual([])
  expect(getProjectOpenDataRequests(DATA_REQUEST_STATE).map(({ dataRequestGuid }) => dataRequestGuid)).toEqual(
    ['DR2', 'DR1'],
  )
})

test('getVisibleFamilies filtered by open data request', () => {
  const visibleGuids = (state, filters = ['SHOW_OPEN_DATA_REQUEST']) => getVisibleFamilies({
    ...state,
    familyTableFilterState: { R0237_1000_genomes_demo: { firstSample: filters } },
  }, {}).map(({ familyGuid }) => familyGuid)

  // fulfilled requests and requests in other projects do not count
  expect(visibleGuids(DATA_REQUEST_STATE)).toEqual(['F011652_1'])
  expect(visibleGuids(STATE_WITH_2_FAMILIES)).toEqual([])
  expect(visibleGuids(DATA_REQUEST_STATE, [])).toEqual(['F011652_1', 'F011652_2'])

  const fulfilledState = {
    ...DATA_REQUEST_STATE,
    dataRequestsByGuid: {
      DR1: { ...DATA_REQUEST, status: 'F' },
      DR3: { ...DATA_REQUEST_STATE.dataRequestsByGuid.DR3, status: 'O' },
    },
  }
  expect(visibleGuids(fulfilledState)).toEqual(['F011652_2'])
})
