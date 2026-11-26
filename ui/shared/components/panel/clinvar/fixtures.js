export const PAYLOAD = {
  clinvarSubmissionReleaseStatus: 'public',
  germlineSubmission: [{
    recordStatus: 'novel',
    localKey: 'CS0000001_clinvar',
    germlineClassification: { germlineClassificationDescription: 'Pathogenic' },
    conditionSet: { condition: [{ db: 'MONDO', id: 'MONDO:0044970' }] },
    observedIn: [{ affectedStatus: 'yes', alleleOrigin: 'germline', collectionMethod: 'research', numberOfIndividuals: 1 }],
    variantSet: {
      variant: [{
        chromosomeCoordinates: {
          assembly: 'GRCh37', chromosome: '1', start: 248367227, stop: 248367228, referenceAllele: 'TC', alternateAllele: 'T',
        },
      }],
    },
  }],
}

export const OPTIONS = {
  conditionId: ['MONDO:0044970', 'OMIM:615123'],
  modeOfInheritance: ['Autosomal dominant inheritance', 'Autosomal recessive inheritance'],
  collectionMethod: ['clinical testing', 'research'],
  affectedStatus: ['yes', 'no', 'unknown'],
  alleleOrigin: ['germline', 'de novo'],
}

export const OBSERVATION = { affectedCarriers: 1, unaffectedCarriers: 1, zygosity: { homozygous: 1 } }

export const UNSAVED_SUBMISSION = {
  submissionGuid: null,
  status: null,
  recordStatus: 'novel',
  variantGuid: 'SV0000002_1248367227_r0390_100',
  classification: 'Pathogenic',
  conditionId: 'MONDO:0044970',
  modeOfInheritance: null,
  collectionMethod: 'research',
  affectedStatus: 'yes',
  alleleOrigin: 'germline',
  citations: ['34415322'],
  validationErrors: [],
  payload: PAYLOAD,
}

export const DRAFT_SUBMISSION = {
  ...UNSAVED_SUBMISSION,
  submissionGuid: 'CS0000001_clinvar',
  status: 'draft',
  variantId: '1-248367227-TC-T',
  familyGuid: 'F000002_2',
  projectGuid: 'R0001_1kg',
  scvAccession: null,
  ncbiSubmissionId: null,
  response: null,
  createdBy: 'Test Manager User',
  lastEditedBy: 'Test Manager User',
  reviewedBy: null,
  reviewedDate: null,
  submittedBy: null,
  submittedDate: null,
  withdrawalRequestedBy: null,
  lastModifiedDate: '2026-11-20T10:00:00.000Z',
}

export const DRAFT_RESPONSE = {
  clinvarSubmission: UNSAVED_SUBMISSION, clinvarMode: 'dry_run', options: OPTIONS, observation: OBSERVATION,
}
