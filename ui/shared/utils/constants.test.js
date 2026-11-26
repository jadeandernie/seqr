import {
  VARIANT_SORT_LOOKUP,
  VARIANT_EXPORT_DATA,
  ORDERED_PREDICTOR_FIELDS,
  clinvarColor,
  getPermissionedHgmdClass,
  getVariantMainGeneId,
  getVariantMainTranscript,
  getVariantSummary,
  predictionFieldValue,
  isValidMailtoEmail,
} from './constants'

// Saved variants are sorted with the selected comparator and then by position, as in getVisibleSortedSavedVariants
const sortedIds = (sort, variants, ...context) => [...variants].sort(
  (a, b) => VARIANT_SORT_LOOKUP[sort](a, b, ...context) || a.xpos - b.xpos,
).map(({ variantId }) => variantId)

const permutations = items => (items.length < 2 ? [items] : items.reduce(
  (acc, item, i) => [
    ...acc, ...permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]),
  ], [],
))

const expectOrder = (sort, variants, expected, ...context) => {
  permutations(variants).forEach((input) => {
    expect(sortedIds(sort, input, ...context)).toEqual(expected)
  })
}

const USER = { isAnalyst: false }
const ANALYST = { isAnalyst: true }
const FAMILIES_BY_GUID = { F1: { projectGuid: 'P1' }, F2: { projectGuid: 'P2' } }
const PROJECTS_BY_GUID = { P1: { enableHgmd: false }, P2: { enableHgmd: true } }

describe('saved variant sort comparators', () => {
  test('gnomAD frequency sorts ascending with variants lacking a frequency last', () => {
    const variants = [
      { variantId: 'common', xpos: 1, populations: { gnomad_genomes: { af: 0.1 }, gnomad_exomes: { af: 0.002 } } },
      { variantId: 'sv', xpos: 2, populations: { sv_callset: { af: 0.03, ac: 7 } } },
      { variantId: 'rare', xpos: 3, populations: { gnomad_genomes: { af: 0.001 }, gnomad_exomes: { af: 0.2 } } },
      { variantId: 'absent', xpos: 4, populations: { gnomad_genomes: { af: 0 }, gnomad_exomes: { af: 0 } } },
      { variantId: 'no_data', xpos: 5 },
      { variantId: 'null_af', xpos: 6, populations: { gnomad_genomes: { af: null }, gnomad_exomes: { af: null } } },
    ]
    expectOrder('GNOMAD', variants.slice(0, 5), ['absent', 'rare', 'common', 'sv', 'no_data'])
    expectOrder('GNOMAD_EXOMES', variants.slice(0, 5), ['absent', 'common', 'rare', 'sv', 'no_data'])
    expectOrder('GNOMAD', variants.slice(2), ['absent', 'rare', 'no_data', 'null_af'])
  })

  test('seqr allele count sorts ascending with variants lacking a count last', () => {
    expectOrder('SEQR_AC', [
      { variantId: 'ac_12', xpos: 1, populations: { seqr: { ac: 12 } } },
      { variantId: 'no_data', xpos: 2, populations: {} },
      { variantId: 'ac_1', xpos: 3, populations: { seqr: { ac: 1 } } },
      { variantId: 'ac_0', xpos: 4, populations: { seqr: { ac: 0 } } },
    ], ['ac_0', 'ac_1', 'ac_12', 'no_data'])
  })

  test('in silico scores sort descending with unscored variants last', () => {
    const variants = [
      { variantId: 'unscored', xpos: 1, predictions: {} },
      { variantId: 'low', xpos: 2, predictions: { cadd: 3.2, revel: 0.9 } },
      { variantId: 'high', xpos: 3, predictions: { cadd: 31, revel: 0.1 } },
      { variantId: 'no_predictions', xpos: 4 },
    ]
    expectOrder('CADD', variants, ['high', 'low', 'unscored', 'no_predictions'])
    expectOrder('REVEL', variants, ['low', 'high', 'unscored', 'no_predictions'])
  })

  test('protein consequence sorts the most severe transcript consequence first', () => {
    expectOrder('PROTEIN_CONSEQUENCE', [
      { variantId: 'missense', xpos: 1, transcripts: { G1: [{ majorConsequence: 'missense_variant' }] } },
      {
        variantId: 'stop_gained',
        xpos: 2,
        transcripts: { G1: [{ majorConsequence: 'intron_variant' }], G2: [{ majorConsequence: 'stop_gained' }] },
      },
      { variantId: 'intron', xpos: 3, transcripts: { G1: [{ majorConsequence: 'intron_variant' }] } },
      { variantId: 'ablation', xpos: 4, transcripts: { G1: [{ majorConsequence: 'transcript_ablation' }] } },
      { variantId: 'no_transcripts', xpos: 5, transcripts: {} },
    ], ['ablation', 'stop_gained', 'missense', 'intron', 'no_transcripts'])
  })

  test('AlphaMissense sorts the highest transcript score first', () => {
    expectOrder('ALPHAMISSENSE', [
      { variantId: 'unscored', xpos: 1, transcripts: { G1: [{ transcriptId: 'T1' }] } },
      {
        variantId: 'high',
        xpos: 2,
        transcripts: { G1: [{ alphamissense: { pathogenicity: 0.2 } }, { alphamissense: { pathogenicity: 0.97 } }] },
      },
      { variantId: 'mid', xpos: 3, transcripts: { G1: [{ alphamissense: { pathogenicity: 0.6 } }] } },
    ], ['high', 'mid', 'unscored'])
  })

  test('pathogenicity ranks ClinVar and HGMD and hides HGMD without access', () => {
    const variants = [
      { variantId: 'benign', xpos: 1, familyGuids: ['F1'], clinvar: { pathogenicity: 'Benign' } },
      { variantId: 'none', xpos: 2, familyGuids: ['F1'] },
      { variantId: 'vus', xpos: 3, familyGuids: ['F1'], clinvar: { pathogenicity: 'Uncertain_significance' } },
      { variantId: 'pathogenic', xpos: 4, familyGuids: ['F1'], clinvar: { pathogenicity: 'Pathogenic' } },
      { variantId: 'hgmd_only', xpos: 5, familyGuids: ['F1'], hgmd: { class: 'DM' } },
    ]
    const context = [undefined, undefined]
    expectOrder(
      'PATHOGENICITY', variants, ['pathogenic', 'vus', 'hgmd_only', 'benign', 'none'],
      ...context, ANALYST, FAMILIES_BY_GUID, PROJECTS_BY_GUID,
    )
    expectOrder(
      'PATHOGENICITY', variants, ['pathogenic', 'vus', 'benign', 'none', 'hgmd_only'],
      ...context, USER, FAMILIES_BY_GUID, PROJECTS_BY_GUID,
    )
  })

  test('constraint sorts the most constrained gene first and unconstrained genes last', () => {
    const genesById = {
      LOF: { constraints: { louef: 0.1, misZ: 1 } },
      MISSENSE: { constraints: { louef: 0.3, misZ: 4 } },
      TOLERANT: { constraints: { louef: 1.2, misZ: 0 } },
      UNKNOWN: {},
    }
    expectOrder('CONSTRAINT', [
      { variantId: 'tolerant', xpos: 1, transcripts: { TOLERANT: [] } },
      { variantId: 'unknown', xpos: 2, transcripts: { UNKNOWN: [] } },
      { variantId: 'lof', xpos: 3, transcripts: { TOLERANT: [], LOF: [] } },
      { variantId: 'missense', xpos: 4, transcripts: { MISSENSE: [] } },
    ], ['missense', 'lof', 'tolerant', 'unknown'], genesById)
  })

  test('OMIM, family and tagged date sorts', () => {
    const genesById = { G1: { omimPhenotypes: [{}, {}] }, G2: { omimPhenotypes: [{}] }, G3: { omimPhenotypes: [] } }
    const tagsByGuid = {
      T1: { lastModifiedDate: '2024-01-05T00:00:00Z' },
      T2: { lastModifiedDate: '2025-06-01T00:00:00Z' },
      T3: { lastModifiedDate: '2023-03-01T00:00:00Z' },
    }
    const variants = [
      { variantId: 'a', xpos: 3, familyGuids: ['F2'], transcripts: { G3: [] }, tagGuids: ['T3'] },
      { variantId: 'b', xpos: 2, familyGuids: ['F1'], transcripts: { G1: [], G2: [] }, tagGuids: ['T1'] },
      { variantId: 'c', xpos: 1, familyGuids: ['F1'], transcripts: { G2: [], MISSING: [] }, tagGuids: ['T3', 'T2'] },
      { variantId: 'd', xpos: 4, familyGuids: ['F3'], tagGuids: [] },
    ]
    expectOrder('IN_OMIM', variants, ['b', 'c', 'a', 'd'], genesById)
    expectOrder('FAMILY_GUID', variants, ['c', 'b', 'a', 'd'])
    expectOrder('XPOS', variants, ['c', 'b', 'a', 'd'])
    expectOrder('TAGGED_DATE', variants, ['c', 'b', 'a', 'd'], genesById, tagsByGuid)
  })

  test('phenotype prioritized gene sorts by best rank across tools', () => {
    const genesById = { G1: {}, G2: {}, G3: {} }
    const individualGeneDataByFamilyGene = {
      F1: {
        phenotypeGeneScores: {
          G1: { lirical: [{ rank: 7 }], exomiser: [{ rank: 3 }, { rank: 12 }] },
          G2: { lirical: [{ rank: 1 }] },
        },
      },
    }
    expectOrder('PRIORITIZED_GENE', [
      { variantId: 'unranked', xpos: 1, familyGuids: ['F1'], transcripts: { G3: [] } },
      { variantId: 'rank_3', xpos: 2, familyGuids: ['F1'], transcripts: { G1: [] } },
      { variantId: 'other_family', xpos: 3, familyGuids: ['F2'], transcripts: { G2: [] } },
      { variantId: 'rank_1', xpos: 4, familyGuids: ['F1'], transcripts: { G3: [], G2: [] } },
    ], ['rank_1', 'rank_3', 'unranked', 'other_family'],
    genesById, undefined, undefined, undefined, undefined, individualGeneDataByFamilyGene)
  })
})

describe('ClinVar and HGMD display helpers', () => {
  test('clinvarColor groups pathogenic, risk and benign assertions', () => {
    const color = pathogenicity => clinvarColor(pathogenicity && { pathogenicity }, 'red', 'orange', 'green')
    expect(color('Pathogenic')).toEqual('red')
    expect(color('Likely_pathogenic/Likely_risk_allele')).toEqual('red')
    expect(color('Established_risk_allele')).toEqual('orange')
    expect(color('Likely_risk_allele')).toEqual('orange')
    expect(color('Conflicting_classifications_of_pathogenicity')).toBeNull()
    expect(color('Uncertain_significance')).toBeNull()
    expect(color('No_pathogenic_assertion')).toBeNull()
    expect(color('Likely_benign')).toEqual('green')
    expect(color('Benign')).toEqual('green')
    expect(color('Some_new_clinvar_term')).toBeNull()
    expect(color()).toBeNull()
  })

  test('getPermissionedHgmdClass only returns HGMD for analysts or HGMD-enabled projects', () => {
    const hgmdClass = (variant, user) => getPermissionedHgmdClass(
      variant, user, FAMILIES_BY_GUID, PROJECTS_BY_GUID,
    )
    const variant = { familyGuids: ['F1'], hgmd: { class: 'DM' } }
    expect(hgmdClass(variant, USER)).toBeFalsy()
    expect(hgmdClass(variant, ANALYST)).toEqual('DM')
    expect(hgmdClass({ ...variant, familyGuids: ['F1', 'F2'] }, USER)).toEqual('DM')
    expect(hgmdClass({ hgmd: { class: 'DM' } }, USER)).toBeFalsy()
    expect(hgmdClass({ familyGuids: ['F2'] }, ANALYST)).toBeFalsy()
  })
})

describe('main transcript helpers', () => {
  const TRANSCRIPTS = {
    ENSG1: [
      { transcriptId: 'ENST1', majorConsequence: 'missense_variant', hgvsc: 'ENST1.3:c.100A>G', hgvsp: 'ENSP1.1:p.Thr34Ala' },
      { transcriptId: 'ENST2', majorConsequence: 'intron_variant' },
    ],
    ENSG2: [{ transcriptId: 'ENST3', majorConsequence: 'splice_donor_variant', hgvsc: 'ENST3.1:c.55+1G>A' }],
  }

  test('the user-selected transcript takes precedence over the default main transcript', () => {
    const variant = { transcripts: TRANSCRIPTS, mainTranscriptId: 'ENST1' }
    expect(getVariantMainGeneId(variant)).toEqual('ENSG1')
    expect(getVariantMainTranscript(variant).transcriptId).toEqual('ENST1')

    const selected = { ...variant, selectedMainTranscriptId: 'ENST3' }
    expect(getVariantMainGeneId(selected)).toEqual('ENSG2')
    expect(getVariantMainTranscript(selected).transcriptId).toEqual('ENST3')
  })

  test('falls back safely when the main transcript is missing', () => {
    expect(getVariantMainGeneId({ transcripts: TRANSCRIPTS, mainTranscriptId: 'ENST_GONE' })).toBeUndefined()
    expect(getVariantMainTranscript({ transcripts: TRANSCRIPTS, mainTranscriptId: 'ENST_GONE' })).toEqual({})
    expect(getVariantMainGeneId({ transcripts: TRANSCRIPTS })).toBeNull()
    expect(getVariantMainGeneId({ transcripts: { ENSG9: [] } })).toEqual('ENSG9')
    expect(getVariantMainGeneId({ transcripts: { ENSG9: [], ENSG8: [] } })).toBeNull()
    expect(getVariantMainGeneId({})).toBeNull()
    expect(getVariantMainTranscript({})).toEqual({})
  })
})

describe('getVariantSummary', () => {
  const SNV = {
    chrom: '7',
    pos: 117559590,
    ref: 'ATCT',
    alt: 'A',
    genomeVersion: '38',
    mainTranscriptId: 'ENST1',
    transcripts: {
      ENSG1: [{
        transcriptId: 'ENST1',
        majorConsequence: 'inframe_deletion',
        hgvsc: 'ENST1.3:c.1521_1523del',
        hgvsp: 'ENSP1.1:p.Phe508del',
      }],
    },
    genotypes: { I1: { numAlt: 1 }, I2: { numAlt: 2 } },
  }

  test('describes zygosity, consequence, position, build and HGVS for SNVs and indels', () => {
    expect(getVariantSummary(SNV)).toEqual(
      'a inframe deletion variant 7:117559590 ATCT>A (hg38) (c.1521_1523del/p.Phe508del)',
    )
    expect(getVariantSummary(SNV, 'I1')).toEqual(
      'a heterozygous inframe deletion variant 7:117559590 ATCT>A (hg38) (c.1521_1523del/p.Phe508del)',
    )
    expect(getVariantSummary(SNV, 'I2')).toEqual(
      'a homozygous inframe deletion variant 7:117559590 ATCT>A (hg38) (c.1521_1523del/p.Phe508del)',
    )
  })

  test('uses the selected main transcript and the hg19 label for build 37', () => {
    expect(getVariantSummary({
      ...SNV,
      genomeVersion: '37',
      selectedMainTranscript: { majorConsequence: 'splice_donor_variant', hgvsc: 'ENST9.1:c.55+1G>A' },
    }, 'I1')).toEqual('a heterozygous splice donor variant 7:117559590 ATCT>A (hg19) (c.55+1G>A)')
  })

  test('describes copy number variants as deletions or duplications', () => {
    const sv = {
      chrom: '1', pos: 1000, end: 5000, genomeVersion: '38', genotypes: { I1: { numAlt: -1, cn: 1 }, I2: { numAlt: -1, cn: 3 } },
    }
    expect(getVariantSummary(sv, 'I1')).toEqual('a copy number deletion 1:1000-5000 (hg38) (CN=1)')
    expect(getVariantSummary(sv, 'I2')).toEqual('a copy number duplication 1:1000-5000 (hg38) (CN=3)')
  })
})

describe('predictionFieldValue', () => {
  const predictorConfig = field => ORDERED_PREDICTOR_FIELDS.find(f => f.field === field)
  const prediction = (field, value) => {
    const { color, value: displayValue } = predictionFieldValue({ [field]: value }, predictorConfig(field)) || {}
    return { color, value: displayValue }
  }

  test('colors scores by threshold band, including band boundaries', () => {
    expect(prediction('primate_ai', 0.2)).toEqual({ color: 'olive', value: '0.200' })
    expect(prediction('primate_ai', 0.484)).toEqual({ color: 'grey', value: '0.484' })
    expect(prediction('primate_ai', 0.789)).toEqual({ color: 'grey', value: '0.789' })
    expect(prediction('primate_ai', 0.79)).toEqual({ color: 'yellow', value: '0.790' })
    expect(prediction('primate_ai', 0.867)).toEqual({ color: 'red', value: '0.867' })
    expect(prediction('primate_ai', '0.95')).toEqual({ color: 'red', value: '0.950' })
    expect(prediction('mut_pred', 0.005)).toEqual({ color: 'green', value: '0.00500' })
    expect(prediction('mut_pred', 0.95)).toEqual({ color: '#8b0000', value: '0.950' })
    expect(prediction('vest', 0.97)).toEqual({ color: '#8b0000', value: '0.970' })
  })

  test('reverses the colors for predictors where low scores are damaging', () => {
    expect(prediction('fathmm', -6)).toEqual({ color: 'red', value: '-6.00' })
    expect(prediction('fathmm', -4.5)).toEqual({ color: 'yellow', value: '-4.50' })
    expect(prediction('fathmm', 0)).toEqual({ color: 'grey', value: '0.00' })
    expect(prediction('fathmm', 3.32)).toEqual({ color: 'olive', value: '3.32' })
  })

  test('uses the absolute value for signed predictors', () => {
    expect(prediction('promoter_ai', -0.6)).toEqual({ color: 'red', value: '-0.600' })
    expect(prediction('promoter_ai', 0.3)).toEqual({ color: 'yellow', value: '0.300' })
    expect(prediction('promoter_ai', -0.1)).toEqual({ color: 'grey', value: '-0.100' })
  })

  test('maps categorical predictors and labelled bands', () => {
    expect(prediction('mut_taster', 'D')).toEqual({ color: 'red', value: 'disease causing' })
    expect(prediction('mut_taster', 'N')).toEqual({ color: 'green', value: 'polymorphism' })
    expect(prediction('pext', 0)).toEqual({ color: 'green', value: 'Not Expressed' })
    expect(prediction('pext', 0.1)).toEqual({ color: 'olive', value: 'Low Expression' })
    expect(prediction('pext', 0.9)).toEqual({ color: 'grey', value: 'Expressed' })
  })

  test('shows missing scores in grey with the default value', () => {
    expect(prediction('primate_ai', undefined)).toEqual({ color: 'grey', value: undefined })
    expect(prediction('primate_ai', null)).toEqual({ color: 'grey', value: null })
    expect(prediction('splice_ai', undefined)).toEqual({ color: 'grey', value: '?' })
    expect(predictionFieldValue({}, { ...predictorConfig('primate_ai'), fieldValue: 0.8 }).color).toEqual('yellow')
  })
})

describe('VARIANT_EXPORT_DATA', () => {
  const exportRow = (variant, tagsByGuid = {}, notesByGuid = {}, genesById = {}) => VARIANT_EXPORT_DATA.reduce((acc, { header, getVal }) => (
    getVal ? { ...acc, [header]: getVal(variant, tagsByGuid, notesByGuid, genesById) } : acc
  ), {})

  test('exports the main transcript, frequencies, predictions, tags, notes and classification', () => {
    const row = exportRow({
      mainTranscriptId: 'ENST1',
      selectedMainTranscriptId: 'ENST3',
      transcripts: {
        ENSG1: [{ transcriptId: 'ENST1', geneId: 'ENSG1', majorConsequence: 'missense_variant' }],
        ENSG2: [{
          transcriptId: 'ENST3', geneId: 'ENSG2', majorConsequence: 'stop_gained', hgvsc: 'ENST3:c.1C>T', hgvsp: 'ENSP3:p.Gln1Ter',
        }],
      },
      populations: { seqr: { af: 0.01 }, gnomad_genomes: { af: 0.0002 }, gnomad_exomes: { af: 0 } },
      predictions: { cadd: 35, mut_taster: 'A' },
      rsid: 'rs123',
      clinvar: { pathogenicity: 'Likely_pathogenic', goldStars: 2 },
      tagGuids: ['T1', 'T2'],
      noteGuids: ['N1', 'N2'],
      acmgClassification: { score: 10, classify: 'Pathogenic', criteria: ['PVS1_VS', 'PM2_M'] },
    }, { T1: { name: 'Review' }, T2: { name: 'Tier 1 - Novel gene and phenotype' } }, {
      N1: { createdBy: 'a@test.org', note: 'first line\nsecond line' },
      N2: { createdBy: 'b@test.org', note: 'ok' },
    }, { ENSG2: { geneSymbol: 'GENE2' } })

    expect(row).toEqual({
      gene: 'GENE2',
      worst_consequence: 'stop_gained',
      callset_freq: 0.01,
      exac_freq: undefined,
      gnomad_genomes_freq: 0.0002,
      gnomad_exomes_freq: 0,
      topmed_freq: undefined,
      cadd: 35,
      revel: undefined,
      eigen: undefined,
      splice_ai: undefined,
      polyphen: undefined,
      sift: undefined,
      muttaster: 'disease causing automatic',
      fathmm: undefined,
      rsid: 'rs123',
      hgvsc: 'ENST3:c.1C>T',
      hgvsp: 'ENSP3:p.Gln1Ter',
      clinvar_clinical_significance: 'Likely_pathogenic',
      clinvar_gold_stars: 2,
      tags: 'Review|Tier 1 - Novel gene and phenotype',
      classification: '10, Pathogenic, PVS1_VS,PM2_M',
      notes: 'a@test.org: first line second line|b@test.org: ok',
    })
  })

  test('exports a variant with no annotations without failing', () => {
    const row = exportRow({ transcripts: { ENSG5: [{ transcriptId: 'ENST5', geneId: 'ENSG5' }] }, mainTranscriptId: 'ENST5', tagGuids: [], noteGuids: [] })
    expect(row.gene).toEqual('ENSG5')
    expect(row.classification).toEqual('')
    expect(row.tags).toEqual('')
    expect(row.notes).toEqual('')
    expect(row.gnomad_genomes_freq).toBeUndefined()
    expect(row.muttaster).toBeUndefined()
  })
})

test('isValidMailtoEmail accepts one or more addresses and rejects anything else', () => {
  expect(isValidMailtoEmail('mailto:matchmaker@broadinstitute.org')).toBe(true)
  expect(isValidMailtoEmail('mailto:a.b+c@lab.org, d@clinic.edu,e@x.io')).toBe(true)
  expect(isValidMailtoEmail('matchmaker@broadinstitute.org')).toBe(false)
  expect(isValidMailtoEmail('mailto:not-an-email')).toBe(false)
  expect(isValidMailtoEmail('mailto:a@lab.org; d@clinic.edu')).toBe(false)
  expect(isValidMailtoEmail('https://example.org')).toBe(false)
})
