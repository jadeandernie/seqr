import {
  ARTIFACT_THRESHOLDS,
  getArtifactFlags,
  isHemiXVariant,
  hasMitoContamination,
  isCommonLowHeteroplasmyCall,
  Genotype,
  Variant,
} from './artifactUtils'

const INDIVIDUALS = {
  CHILD: { individualGuid: 'CHILD', displayName: 'Kid', sex: 'F', maternalGuid: 'MOM', paternalGuid: 'DAD' },
  MOM: { individualGuid: 'MOM', displayName: 'Mum', sex: 'F' },
  DAD: { individualGuid: 'DAD', displayName: 'Dad', sex: 'M' },
  SON: { individualGuid: 'SON', displayName: 'Son', sex: 'M', maternalGuid: 'MOM', paternalGuid: 'DAD' },
}

const SNV: Variant = { chrom: '1', pos: 1000, genomeVersion: '38' }
const X_SNV: Variant = { chrom: 'X', pos: 50000000, genomeVersion: '38' }
const MITO: Variant = { chrom: 'M', pos: 100, genomeVersion: '38' }
const SV: Variant = { chrom: '1', pos: 1000, genomeVersion: '38', svType: 'DEL' }

const CLEAN_HET: Genotype = { numAlt: 1, gq: 99, ab: 0.5, dp: 40, filters: [] }
const CLEAN_REF: Genotype = { numAlt: 0, gq: 99, ab: 0, dp: 40, filters: [] }
const CLEAN_HOM: Genotype = { numAlt: 2, gq: 99, ab: 1, dp: 40, filters: [] }

const flagCodes = (variant: Variant, genotypes: Parameters<typeof getArtifactFlags>[1]) => getArtifactFlags(
  variant, genotypes, INDIVIDUALS,
).map(({ code, individualGuid }) => (individualGuid ? `${code}:${individualGuid}` : code))

const childCodes = (genotype: Genotype, variant: Variant = SNV) => flagCodes(variant, { CHILD: genotype })

test('ARTIFACT_THRESHOLDS reuse the "High Quality" search preset where one exists', () => {
  expect(ARTIFACT_THRESHOLDS).toEqual({
    MIN_GQ: 20,
    HET_MIN_AB: 0.25,
    HET_MAX_AB: 0.75,
    HOM_ALT_MIN_AB: 0.9,
    MIN_DP: 10,
    DE_NOVO_MIN_PARENT_ALT_READS: 2,
    MITO_MAX_CONTAMINATION: 0,
    GCNV_MIN_QS: 100,
    SV_MAX_LOW_GQ: 10,
  })
})

test('returns no flags for clean calls, missing genotypes or missing individuals', () => {
  expect(getArtifactFlags(SNV, { CHILD: CLEAN_HET, MOM: CLEAN_HET, DAD: CLEAN_REF }, INDIVIDUALS)).toEqual([])
  expect(getArtifactFlags(SNV, { CHILD: CLEAN_HOM }, INDIVIDUALS)).toEqual([])
  expect(getArtifactFlags(SNV, undefined, INDIVIDUALS)).toEqual([])
  expect(getArtifactFlags(SNV, null, INDIVIDUALS)).toEqual([])
  expect(getArtifactFlags(SNV, {}, INDIVIDUALS)).toEqual([])
  expect(getArtifactFlags(SNV, { CHILD: CLEAN_HET }, undefined)).toEqual([])
  expect(getArtifactFlags(SNV, { UNKNOWN: CLEAN_HET }, INDIVIDUALS)).toEqual([])
})

test('never flags no-calls or missing values', () => {
  expect(childCodes({ numAlt: -1, gq: 1, ab: 0.1, dp: 1 })).toEqual([])
  expect(childCodes({ numAlt: null, gq: 1, ab: 0.1, dp: 1 })).toEqual([])
  expect(childCodes({ gq: 1, ab: 0.1, dp: 1 })).toEqual([])
  expect(childCodes({ numAlt: 1 })).toEqual([])
  expect(childCodes({ numAlt: 1, gq: null, ab: null, dp: null, filters: null })).toEqual([])
  expect(childCodes({ numAlt: 2, gq: undefined, ab: undefined, dp: '' })).toEqual([])
  expect(childCodes({ numAlt: 1, dp: 'not a number' })).toEqual([])
})

test('flags het calls with allele balance outside 0.25-0.75', () => {
  expect(childCodes({ ...CLEAN_HET, ab: 0.25 })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, ab: 0.75 })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, ab: 0.249 })).toEqual(['AB_HET:CHILD'])
  expect(childCodes({ ...CLEAN_HET, ab: 0.751 })).toEqual(['AB_HET:CHILD'])
  expect(childCodes({ ...CLEAN_HET, ab: 0 })).toEqual(['AB_HET:CHILD'])
  expect(childCodes({ ...CLEAN_HET, ab: undefined })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, ab: null })).toEqual([])

  expect(getArtifactFlags(SNV, { CHILD: { ...CLEAN_HET, ab: 0.123 } }, INDIVIDUALS)).toEqual([{
    code: 'AB_HET',
    label: 'Unbalanced het call',
    detail: 'Allele balance 0.12 is outside 0.25-0.75',
    individualGuid: 'CHILD',
  }])
})

test('flags hom-alt calls with allele balance below 0.9', () => {
  expect(childCodes({ ...CLEAN_HOM, ab: 0.9 })).toEqual([])
  expect(childCodes({ ...CLEAN_HOM, ab: 0.899 })).toEqual(['AB_HOM_ALT:CHILD'])
  expect(childCodes({ ...CLEAN_HOM, ab: undefined })).toEqual([])
  expect(childCodes({ ...CLEAN_REF, ab: 0.1 })).toEqual([])

  expect(getArtifactFlags(SNV, { CHILD: { ...CLEAN_HOM, ab: 0.8 } }, INDIVIDUALS)).toEqual([{
    code: 'AB_HOM_ALT',
    label: 'Hom-alt call with reference reads',
    detail: 'Allele balance 0.80 is below 0.9',
    individualGuid: 'CHILD',
  }])
})

test('flags genotype quality below 20, including hom-ref calls', () => {
  expect(childCodes({ ...CLEAN_HET, gq: 20 })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, gq: 19 })).toEqual(['LOW_GQ:CHILD'])
  expect(childCodes({ ...CLEAN_HET, gq: 0 })).toEqual(['LOW_GQ:CHILD'])
  expect(childCodes({ ...CLEAN_REF, gq: 19 })).toEqual(['LOW_GQ:CHILD'])
  expect(childCodes({ ...CLEAN_HET, gq: undefined })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, gq: null })).toEqual([])

  expect(getArtifactFlags(SNV, { CHILD: { ...CLEAN_HET, gq: 5 } }, INDIVIDUALS)).toEqual([{
    code: 'LOW_GQ', label: 'Low genotype quality', detail: 'GQ 5 is below 20', individualGuid: 'CHILD',
  }])
})

test('flags read depth below 10, accepting numeric strings', () => {
  expect(childCodes({ ...CLEAN_HET, dp: 10 })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, dp: 9 })).toEqual(['LOW_DP:CHILD'])
  expect(childCodes({ ...CLEAN_HET, dp: '9' })).toEqual(['LOW_DP:CHILD'])
  expect(childCodes({ ...CLEAN_HET, dp: '74' })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, dp: 0 })).toEqual(['LOW_DP:CHILD'])
  expect(childCodes({ ...CLEAN_HET, dp: undefined })).toEqual([])

  expect(getArtifactFlags(SNV, { CHILD: { ...CLEAN_HET, dp: 4 } }, INDIVIDUALS)).toEqual([{
    code: 'LOW_DP', label: 'Low read depth', detail: 'DP 4 is below 10', individualGuid: 'CHILD',
  }])
})

test('reports every failing rule for a sample', () => {
  expect(childCodes({ numAlt: 1, gq: 3, ab: 0.1, dp: 5 })).toEqual(['AB_HET:CHILD', 'LOW_GQ:CHILD', 'LOW_DP:CHILD'])
})

test('flags non-empty site filters once per variant', () => {
  expect(childCodes({ ...CLEAN_HET, filters: [] })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, filters: null })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, filters: undefined })).toEqual([])
  expect(childCodes({ ...CLEAN_HET, filters: ['PASS'] })).toEqual([])

  expect(getArtifactFlags(SNV, {
    CHILD: { ...CLEAN_HET, filters: ['VQSRTrancheSNP99.90to99.95'] },
    MOM: { ...CLEAN_HET, filters: ['VQSRTrancheSNP99.90to99.95', 'ExcessHet'] },
    DAD: { numAlt: -1, filters: ['VQSRTrancheSNP99.90to99.95'] },
  }, INDIVIDUALS)).toEqual([{
    code: 'SITE_FILTER',
    label: 'Failed site filters',
    detail: 'VQSRTrancheSNP99.90to99.95, ExcessHet',
  }])
})

describe('sex chromosome hemizygous calls', () => {
  const sonCodes = (genotype: Genotype, variant: Variant = X_SNV) => flagCodes(variant, { SON: genotype })

  test('isHemiXVariant', () => {
    expect(isHemiXVariant(X_SNV, INDIVIDUALS.SON)).toBe(true)
    expect(isHemiXVariant({ ...X_SNV, chrom: 'Y' }, INDIVIDUALS.SON)).toBe(true)
    expect(isHemiXVariant(X_SNV, { ...INDIVIDUALS.SON, sex: 'XXY' })).toBe(true)
    expect(isHemiXVariant(X_SNV, INDIVIDUALS.CHILD)).toBe(false)
    expect(isHemiXVariant(X_SNV, { ...INDIVIDUALS.SON, sex: 'U' })).toBe(false)
    expect(isHemiXVariant(SNV, INDIVIDUALS.SON)).toBe(false)
    expect(isHemiXVariant({ ...X_SNV, pos: 2781480 }, INDIVIDUALS.SON)).toBe(false)
    expect(isHemiXVariant({ ...X_SNV, pos: 2781481 }, INDIVIDUALS.SON)).toBe(true)
    expect(isHemiXVariant({ ...X_SNV, pos: 2699521, genomeVersion: '37' }, INDIVIDUALS.SON)).toBe(false)
    expect(isHemiXVariant({ ...X_SNV, pos: 2699522, genomeVersion: '37' }, INDIVIDUALS.SON)).toBe(true)
  })

  test('are not flagged for allele balance', () => {
    expect(sonCodes({ ...CLEAN_HET, ab: 0.1 })).toEqual([])
    expect(sonCodes({ ...CLEAN_HET, ab: 1 })).toEqual([])
    expect(sonCodes({ ...CLEAN_HOM, ab: 0.8 })).toEqual([])
    expect(sonCodes({ ...CLEAN_HOM, ab: 0.8 }, { ...X_SNV, chrom: 'Y' })).toEqual([])
    expect(sonCodes({ ...CLEAN_HET, ab: 0.1 }, { ...X_SNV, genomeVersion: undefined })).toEqual([])
  })

  test('are still flagged for quality and depth', () => {
    expect(sonCodes({ ...CLEAN_HOM, ab: 0.8, gq: 5, dp: 3 })).toEqual(['LOW_GQ:SON', 'LOW_DP:SON'])
  })

  test('diploid sex chromosome calls are flagged for allele balance', () => {
    expect(flagCodes(X_SNV, { CHILD: { ...CLEAN_HET, ab: 0.1 } })).toEqual(['AB_HET:CHILD'])
    expect(sonCodes({ ...CLEAN_HET, ab: 0.1 }, { ...X_SNV, pos: 20000 })).toEqual(['AB_HET:SON'])
  })

  test('are not flagged when sex is unknown', () => {
    const individuals = { SON: { ...INDIVIDUALS.SON, sex: 'U' }, NO_SEX: { individualGuid: 'NO_SEX' } }
    expect(getArtifactFlags(X_SNV, { SON: { ...CLEAN_HET, ab: 0.1 } }, individuals)).toEqual([])
    expect(getArtifactFlags(X_SNV, { NO_SEX: { ...CLEAN_HET, ab: 0.1 } }, individuals)).toEqual([])
    expect(getArtifactFlags(SNV, { NO_SEX: { ...CLEAN_HET, ab: 0.1 } }, individuals).map(({ code }) => code)).toEqual(
      ['AB_HET'],
    )
  })
})

describe('apparent de novo calls', () => {
  type Samples = Genotype | Genotype[]
  const trioCodes = (mom: Samples, dad: Samples, child: Samples = CLEAN_HET) => (
    flagCodes(SNV, { CHILD: child, MOM: mom, DAD: dad })
  )

  test('are not flagged when both parents are clean hom-ref', () => {
    expect(trioCodes(CLEAN_REF, CLEAN_REF)).toEqual([])
  })

  test('are flagged when a parent has at least 2 alt reads', () => {
    expect(trioCodes({ ...CLEAN_REF, ab: 0.04, dp: 25 }, CLEAN_REF)).toEqual([])
    expect(trioCodes({ ...CLEAN_REF, ab: 0.08, dp: 25 }, CLEAN_REF)).toEqual(['DE_NOVO_PARENT_ALT_READS:CHILD'])
    expect(trioCodes(CLEAN_REF, { ...CLEAN_REF, ab: 0.05, dp: '40' })).toEqual(['DE_NOVO_PARENT_ALT_READS:CHILD'])
    expect(trioCodes({ ...CLEAN_REF, ab: undefined }, { ...CLEAN_REF, ab: 0.5, dp: undefined })).toEqual([])

    expect(getArtifactFlags(SNV, {
      CHILD: CLEAN_HET, MOM: { ...CLEAN_REF, ab: 0.06, dp: 50 }, DAD: CLEAN_REF,
    }, INDIVIDUALS)).toEqual([{
      code: 'DE_NOVO_PARENT_ALT_READS',
      label: 'Apparent de novo with alt reads in a parent',
      detail: 'Mother (Mum) has 3 alt reads (allele balance 0.060, DP 50)',
      individualGuid: 'CHILD',
    }])
  })

  test('are flagged when parental depth is below 10', () => {
    expect(trioCodes(CLEAN_REF, { ...CLEAN_REF, dp: 10 })).toEqual([])
    expect(trioCodes(CLEAN_REF, { ...CLEAN_REF, dp: 9 })).toEqual(['DE_NOVO_LOW_PARENT_DP:CHILD', 'LOW_DP:DAD'])
    expect(trioCodes(CLEAN_REF, { ...CLEAN_REF, dp: undefined })).toEqual([])

    expect(getArtifactFlags(SNV, {
      CHILD: CLEAN_HET, MOM: CLEAN_REF, DAD: { ...CLEAN_REF, dp: 6 },
    }, INDIVIDUALS)[0]).toEqual({
      code: 'DE_NOVO_LOW_PARENT_DP',
      label: 'Apparent de novo with low parental coverage',
      detail: 'Father (Dad) DP 6 is below 10',
      individualGuid: 'CHILD',
    })
  })

  test('require a het child and two called hom-ref parents', () => {
    const altReadsRef = { ...CLEAN_REF, ab: 0.2, dp: 40 }
    expect(trioCodes(altReadsRef, CLEAN_REF, CLEAN_HOM)).toEqual([])
    expect(trioCodes(altReadsRef, CLEAN_REF, CLEAN_REF)).toEqual([])
    expect(trioCodes(altReadsRef, CLEAN_HET)).toEqual([])
    expect(trioCodes(altReadsRef, { numAlt: -1 })).toEqual([])
    expect(flagCodes(SNV, { CHILD: CLEAN_HET, MOM: altReadsRef })).toEqual([])
    expect(getArtifactFlags(
      SNV, { CHILD: CLEAN_HET, MOM: altReadsRef, DAD: CLEAN_REF }, { CHILD: { individualGuid: 'CHILD' } },
    )).toEqual([])
  })

  test('are not evaluated for hemizygous, mitochondrial or structural variants', () => {
    const altReadsRef = { ...CLEAN_REF, ab: 0.2, dp: 40 }
    expect(flagCodes(X_SNV, { SON: CLEAN_HET, MOM: altReadsRef, DAD: CLEAN_REF })).toEqual([])
    expect(flagCodes(MITO, { CHILD: CLEAN_HET, MOM: altReadsRef, DAD: CLEAN_REF })).toEqual([])
    expect(flagCodes(SV, { CHILD: CLEAN_HET, MOM: altReadsRef, DAD: CLEAN_REF })).toEqual([])
  })
})

describe('multiple sample types per individual', () => {
  test('checks each sample and names its sample type', () => {
    expect(getArtifactFlags(SNV, {
      CHILD: [
        { ...CLEAN_HET, sampleType: 'WES', ab: 0.1 },
        { ...CLEAN_HET, sampleType: 'WGS', dp: 5 },
      ],
    }, INDIVIDUALS)).toEqual([
      {
        code: 'AB_HET',
        label: 'Unbalanced het call',
        detail: 'Allele balance 0.10 is outside 0.25-0.75 (WES)',
        individualGuid: 'CHILD',
      },
      { code: 'LOW_DP', label: 'Low read depth', detail: 'DP 5 is below 10 (WGS)', individualGuid: 'CHILD' },
    ])
  })

  test('does not name the sample type for a single sample', () => {
    const lowDp = { ...CLEAN_HET, sampleType: 'WES', dp: 5 }
    expect(getArtifactFlags(SNV, { CHILD: [lowDp] }, INDIVIDUALS)[0].detail).toEqual('DP 5 is below 10')
    expect(getArtifactFlags(SNV, { CHILD: lowDp }, INDIVIDUALS)[0].detail).toEqual('DP 5 is below 10')
  })

  test('returns no flags when every sample is clean or uncalled', () => {
    expect(flagCodes(SNV, {
      CHILD: [{ ...CLEAN_HET, sampleType: 'WES' }, { numAlt: -1, sampleType: 'WGS', gq: 0, dp: 0 }],
    })).toEqual([])
  })

  test('de novo checks use a het call in any child sample and every parent sample', () => {
    const child = [{ ...CLEAN_REF, sampleType: 'WES' }, { ...CLEAN_HET, sampleType: 'WGS' }]
    const mom = [{ ...CLEAN_REF, sampleType: 'WES' }, { ...CLEAN_REF, sampleType: 'WGS', ab: 0.1, dp: 30 }]
    const flags = getArtifactFlags(SNV, { CHILD: child, MOM: mom, DAD: CLEAN_REF }, INDIVIDUALS)
    expect(flags).toEqual([{
      code: 'DE_NOVO_PARENT_ALT_READS',
      label: 'Apparent de novo with alt reads in a parent',
      detail: 'Mother (Mum) has 3 alt reads (allele balance 0.10, DP 30) (WGS)',
      individualGuid: 'CHILD',
    }])

    const hetMom = [{ ...CLEAN_REF, sampleType: 'WES', ab: 0.1, dp: 30 }, { ...CLEAN_HET, sampleType: 'WGS' }]
    expect(flagCodes(SNV, { CHILD: child, MOM: hetMom, DAD: CLEAN_REF })).toEqual([])
  })
})

describe('mitochondrial variants', () => {
  const MITO_CALL: Genotype = { numAlt: 1, dp: 3000, hl: 0.4, mitoCn: 250, contamination: 0, filters: [] }

  test('predicates shared with the per-sample warnings', () => {
    expect(hasMitoContamination({ contamination: 0.01 })).toBe(true)
    expect(hasMitoContamination({ contamination: 0 })).toBe(false)
    expect(hasMitoContamination({ contamination: null })).toBe(false)
    expect(hasMitoContamination({})).toBe(false)

    expect(isCommonLowHeteroplasmyCall({ commonLowHeteroplasmy: true }, { hl: 0.01 })).toBe(true)
    expect(isCommonLowHeteroplasmyCall({ commonLowHeteroplasmy: true }, { hl: 0 })).toBe(false)
    expect(isCommonLowHeteroplasmyCall({ commonLowHeteroplasmy: true }, {})).toBe(false)
    expect(isCommonLowHeteroplasmyCall({ commonLowHeteroplasmy: false }, { hl: 0.01 })).toBe(false)
    expect(isCommonLowHeteroplasmyCall({}, { hl: 0.01 })).toBe(false)
  })

  test('flags contamination above 0', () => {
    expect(childCodes(MITO_CALL, MITO)).toEqual([])
    expect(childCodes({ ...MITO_CALL, contamination: undefined }, MITO)).toEqual([])
    expect(getArtifactFlags(MITO, { CHILD: { ...MITO_CALL, contamination: 0.02 } }, INDIVIDUALS)).toEqual([{
      code: 'MITO_CONTAMINATION',
      label: 'Mitochondrial contamination',
      detail: 'Contamination 0.02 is above 0',
      individualGuid: 'CHILD',
    }])
  })

  test('flags calls at common low heteroplasmy sites', () => {
    const lowHetSite = { ...MITO, commonLowHeteroplasmy: true }
    expect(childCodes({ ...MITO_CALL, hl: 0 }, lowHetSite)).toEqual([])
    expect(childCodes({ ...MITO_CALL, hl: undefined }, lowHetSite)).toEqual([])
    expect(childCodes({ ...MITO_CALL, hl: 0.03 }, MITO)).toEqual([])
    expect(getArtifactFlags(lowHetSite, { CHILD: { ...MITO_CALL, hl: 0.03 } }, INDIVIDUALS)).toEqual([{
      code: 'MITO_LOW_HETEROPLASMY',
      label: 'Common low heteroplasmy site',
      detail: 'Heteroplasmy level 0.030 at a site where low heteroplasmy calls are common',
      individualGuid: 'CHILD',
    }])
  })

  test('is flagged for low depth but not for allele balance', () => {
    expect(childCodes({ ...MITO_CALL, dp: 5, ab: 0.1 }, MITO)).toEqual(['LOW_DP:CHILD'])
    expect(childCodes({ ...MITO_CALL, numAlt: 2, ab: 0.5 }, MITO)).toEqual([])
  })
})

describe('structural variants', () => {
  test('flags gCNV calls with quality score below 100', () => {
    expect(childCodes({ numAlt: -1, cn: 1, qs: 100 }, SV)).toEqual([])
    expect(childCodes({ numAlt: -1, cn: 1, qs: 99 }, SV)).toEqual(['SV_LOW_QS:CHILD'])
    expect(childCodes({ numAlt: 1, cn: 1, qs: 99 }, SV)).toEqual(['SV_LOW_QS:CHILD'])
    expect(childCodes({ numAlt: -1, cn: 1 }, SV)).toEqual([])
    expect(childCodes({ numAlt: -1, cn: 1, qs: null }, SV)).toEqual([])

    expect(getArtifactFlags(SV, { CHILD: { numAlt: -1, cn: 0, qs: 57 } }, INDIVIDUALS)).toEqual([{
      code: 'SV_LOW_QS', label: 'Low SV quality score', detail: 'QS 57 is below 100', individualGuid: 'CHILD',
    }])
  })

  test('flags SV calls with genotype quality of 10 or less', () => {
    expect(childCodes({ numAlt: 1, cn: 1, gq: 11 }, SV)).toEqual([])
    expect(childCodes({ numAlt: 1, cn: 1, gq: 10 }, SV)).toEqual(['SV_LOW_GQ:CHILD'])
    expect(childCodes({ numAlt: 1, cn: 1 }, SV)).toEqual([])

    expect(getArtifactFlags(SV, { CHILD: { numAlt: 2, cn: 0, gq: 3 } }, INDIVIDUALS)).toEqual([{
      code: 'SV_LOW_GQ', label: 'Low SV genotype quality', detail: 'GQ 3 is not above 10', individualGuid: 'CHILD',
    }])
  })

  test('does not flag reference or uncalled samples, or apply SNV rules', () => {
    expect(childCodes({ numAlt: 0, cn: 2, gq: 1, qs: 1 }, SV)).toEqual([])
    expect(childCodes({ numAlt: -1, cn: 2, qs: 1 }, SV)).toEqual([])
    expect(childCodes({ numAlt: -1, qs: 1 }, SV)).toEqual([])
    expect(childCodes({ numAlt: 1, cn: 1, gq: 15, ab: 0.1, dp: 2 }, SV)).toEqual([])
    expect(childCodes({ numAlt: -1, cn: 1, qs: 5 }, { ...SV, svType: 'DUP', chrom: 'X' })).toEqual(['SV_LOW_QS:CHILD'])
  })

  test('still flags failed site filters', () => {
    expect(childCodes({ numAlt: 1, cn: 1, gq: 99, filters: ['HIGH_SR_BACKGROUND'] }, SV)).toEqual(['SITE_FILTER'])
  })
})
