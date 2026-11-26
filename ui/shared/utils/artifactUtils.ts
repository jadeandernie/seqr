import { HIGH_QUALITY_FILTER, SIMPLIFIED_SEX_LOOKUP } from './constants'

type MaybeNumber = number | string | null | undefined

export type Genotype = {
  numAlt?: number | null
  gq?: MaybeNumber
  ab?: MaybeNumber
  dp?: MaybeNumber
  filters?: string[] | null
  hl?: MaybeNumber
  contamination?: MaybeNumber
  mitoCn?: MaybeNumber
  cn?: number | null
  qs?: MaybeNumber
  sampleType?: string | null
}

export type GenotypesByIndividual = { [individualGuid: string]: Genotype | Genotype[] }

export type Variant = {
  chrom?: string
  pos?: number
  genomeVersion?: string
  svType?: string | null
  commonLowHeteroplasmy?: boolean | null
}

export type Individual = {
  individualGuid?: string
  displayName?: string
  sex?: string
  maternalGuid?: string | null
  paternalGuid?: string | null
}

export type IndividualsByGuid = { [individualGuid: string]: Individual }

export type ArtifactFlag = {
  code: string
  label: string
  detail: string
  individualGuid?: string
}

export const ARTIFACT_THRESHOLDS = {
  // Same genotype quality cutoff as the "High Quality" search preset
  MIN_GQ: HIGH_QUALITY_FILTER.min_gq,
  // Same het allele balance cutoff as the "High Quality" search preset
  HET_MIN_AB: HIGH_QUALITY_FILTER.min_ab / 100,
  // Mirror of the lower het cutoff: a het call with mostly alt reads is as suspect as one with few
  HET_MAX_AB: 1 - (HIGH_QUALITY_FILTER.min_ab / 100),
  // A true hom-alt call should have almost no reference reads
  HOM_ALT_MIN_AB: 0.9,
  // Fewer than 10 reads cannot reliably distinguish het, hom and reference calls
  MIN_DP: 10,
  // A single alt read in a parent is plausibly a sequencing error, two or more suggest inheritance or mosaicism
  DE_NOVO_MIN_PARENT_ALT_READS: 2,
  // Matches the existing per-sample warning for any mitochondrial contamination
  MITO_MAX_CONTAMINATION: 0,
  // Same gCNV quality score cutoff as the "High Quality" search preset
  GCNV_MIN_QS: HIGH_QUALITY_FILTER.min_qs,
  // The SV genotype quality search filter recommends only keeping calls with GQ > 10
  SV_MAX_LOW_GQ: 10,
}

const PAR_REGIONS: { [genomeVersion: string]: { [chrom: string]: number[][] } } = {
  37: {
    X: [[60001, 2699521], [154931044, 155260561]],
    Y: [[10001, 2649521], [59034050, 59363567]],
  },
  38: {
    X: [[10001, 2781480], [155701383, 156030896]],
    Y: [[10001, 2781480], [56887903, 57217416]],
  },
}

const MITO_CHROMS = ['M', 'MT']

const isSexChrom = ({ chrom }: Variant): boolean => chrom === 'X' || chrom === 'Y'

const isInPar = ({ chrom, pos, genomeVersion }: Variant): boolean => (
  PAR_REGIONS[genomeVersion]?.[chrom] || []).some(region => pos >= region[0] && pos <= region[1])

const simplifiedSex = (individual?: Individual): string | undefined => (
  SIMPLIFIED_SEX_LOOKUP as { [sex: string]: string })[individual?.sex]

export const isHemiXVariant = (variant: Variant, individual: Individual): boolean => (
  simplifiedSex(individual) === 'M' && isSexChrom(variant) && !isInPar(variant)
)

const isKnownDiploid = (variant: Variant, individual?: Individual): boolean => (
  !isSexChrom(variant) || isInPar(variant) || simplifiedSex(individual) === 'F'
)

const toNumber = (value: MaybeNumber): number | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  const num = Number(value)
  return Number.isNaN(num) ? undefined : num
}

const isBelow = (value: MaybeNumber, threshold: number): boolean => toNumber(value) < threshold

const isAbove = (value: MaybeNumber, threshold: number): boolean => toNumber(value) > threshold

const isCalled = (value?: number | null): boolean => Number.isInteger(value) && value >= 0

const formatRatio = (value: MaybeNumber): string => toNumber(value).toPrecision(2)

export const hasMitoContamination = ({ contamination }: Genotype): boolean => (
  isAbove(contamination, ARTIFACT_THRESHOLDS.MITO_MAX_CONTAMINATION)
)

export const isCommonLowHeteroplasmyCall = (variant: Variant, { hl }: Genotype): boolean => (
  !!variant.commonLowHeteroplasmy && isAbove(hl, 0)
)

type Rule = {
  code: string
  label: string
  test: (genotype: Genotype, variant: Variant, isDiploid: boolean) => boolean
  detail: (genotype: Genotype) => string
}

const {
  MIN_GQ, HET_MIN_AB, HET_MAX_AB, HOM_ALT_MIN_AB, MIN_DP, DE_NOVO_MIN_PARENT_ALT_READS, MITO_MAX_CONTAMINATION,
  GCNV_MIN_QS, SV_MAX_LOW_GQ,
} = ARTIFACT_THRESHOLDS

const SNV_RULES: Rule[] = [
  {
    code: 'AB_HET',
    label: 'Unbalanced het call',
    test: ({ numAlt, ab }, variant, isDiploid) => (
      isDiploid && numAlt === 1 && (isBelow(ab, HET_MIN_AB) || isAbove(ab, HET_MAX_AB))
    ),
    detail: ({ ab }) => `Allele balance ${formatRatio(ab)} is outside ${HET_MIN_AB}-${HET_MAX_AB}`,
  },
  {
    code: 'AB_HOM_ALT',
    label: 'Hom-alt call with reference reads',
    test: ({ numAlt, ab }, variant, isDiploid) => isDiploid && numAlt === 2 && isBelow(ab, HOM_ALT_MIN_AB),
    detail: ({ ab }) => `Allele balance ${formatRatio(ab)} is below ${HOM_ALT_MIN_AB}`,
  },
  {
    code: 'LOW_GQ',
    label: 'Low genotype quality',
    test: ({ gq }) => isBelow(gq, MIN_GQ),
    detail: ({ gq }) => `GQ ${gq} is below ${MIN_GQ}`,
  },
  {
    code: 'LOW_DP',
    label: 'Low read depth',
    test: ({ dp }) => isBelow(dp, MIN_DP),
    detail: ({ dp }) => `DP ${dp} is below ${MIN_DP}`,
  },
  {
    code: 'MITO_CONTAMINATION',
    label: 'Mitochondrial contamination',
    test: hasMitoContamination,
    detail: ({ contamination }) => `Contamination ${contamination} is above ${MITO_MAX_CONTAMINATION}`,
  },
  {
    code: 'MITO_LOW_HETEROPLASMY',
    label: 'Common low heteroplasmy site',
    test: (genotype, variant) => isCommonLowHeteroplasmyCall(variant, genotype),
    detail: ({ hl }) => `Heteroplasmy level ${formatRatio(hl)} at a site where low heteroplasmy calls are common`,
  },
]

const SV_RULES: Rule[] = [
  {
    code: 'SV_LOW_QS',
    label: 'Low SV quality score',
    test: ({ qs }) => isBelow(qs, GCNV_MIN_QS),
    detail: ({ qs }) => `QS ${qs} is below ${GCNV_MIN_QS}`,
  },
  {
    code: 'SV_LOW_GQ',
    label: 'Low SV genotype quality',
    test: ({ gq }) => toNumber(gq) <= SV_MAX_LOW_GQ,
    detail: ({ gq }) => `GQ ${gq} is not above ${SV_MAX_LOW_GQ}`,
  },
]

const isSvCarrier = ({ numAlt, cn }: Genotype, refCn: number): boolean => (
  isCalled(numAlt) ? numAlt > 0 : (isCalled(cn) && cn !== refCn)
)

const sampleGenotypes = (genotypes: Genotype | Genotype[] | undefined): Genotype[] => {
  if (!genotypes) {
    return []
  }
  return Array.isArray(genotypes) ? genotypes : [genotypes]
}

const sampleSuffix = ({ sampleType }: Genotype, samples: Genotype[]): string => (
  samples.length > 1 && sampleType ? ` (${sampleType})` : ''
)

const getSampleFlags = (variant: Variant, samples: Genotype[], individual: Individual): ArtifactFlag[] => {
  const { individualGuid } = individual
  const isDiploid = !MITO_CHROMS.includes(variant.chrom) && isKnownDiploid(variant, individual)
  const refCn = isHemiXVariant(variant, individual) ? 1 : 2
  return samples.filter(
    genotype => (variant.svType ? isSvCarrier(genotype, refCn) : isCalled(genotype.numAlt)),
  ).reduce((acc, genotype) => [
    ...acc,
    ...(variant.svType ? SV_RULES : SNV_RULES).filter(({ test }) => test(genotype, variant, isDiploid)).map(
      ({ code, label, detail }) => ({
        code, label, detail: `${detail(genotype)}${sampleSuffix(genotype, samples)}`, individualGuid,
      }),
    ),
  ], [] as ArtifactFlag[])
}

const PARENTS: { field: 'maternalGuid' | 'paternalGuid', title: string }[] = [
  { field: 'maternalGuid', title: 'Mother' },
  { field: 'paternalGuid', title: 'Father' },
]

const getDeNovoFlags = (
  variant: Variant, genotypes: GenotypesByIndividual, individual: Individual, individualsByGuid: IndividualsByGuid,
): ArtifactFlag[] => {
  const { individualGuid } = individual
  if (variant.svType || MITO_CHROMS.includes(variant.chrom) || !isKnownDiploid(variant, individual) ||
    !sampleGenotypes(genotypes[individualGuid]).some(({ numAlt }) => numAlt === 1)) {
    return []
  }
  const parents = PARENTS.map(({ field, title }) => {
    const { displayName } = individualsByGuid[individual[field]] || {}
    return {
      name: displayName ? `${title} (${displayName})` : title,
      samples: sampleGenotypes(genotypes[individual[field]]),
    }
  })
  if (!parents.every(({ samples }) => samples.length > 0 && samples.every(({ numAlt }) => numAlt === 0))) {
    return []
  }

  return parents.reduce((acc, { name, samples }) => {
    samples.forEach((genotype) => {
      const { ab, dp } = genotype
      const suffix = sampleSuffix(genotype, samples)
      const altReads = Math.round(toNumber(ab) * toNumber(dp))
      if (altReads >= DE_NOVO_MIN_PARENT_ALT_READS) {
        acc.push({
          code: 'DE_NOVO_PARENT_ALT_READS',
          label: 'Apparent de novo with alt reads in a parent',
          detail: `${name} has ${altReads} alt reads (allele balance ${formatRatio(ab)}, DP ${dp})${suffix}`,
          individualGuid,
        })
      }
      if (isBelow(dp, MIN_DP)) {
        acc.push({
          code: 'DE_NOVO_LOW_PARENT_DP',
          label: 'Apparent de novo with low parental coverage',
          detail: `${name} DP ${dp} is below ${MIN_DP}${suffix}`,
          individualGuid,
        })
      }
    })
    return acc
  }, [] as ArtifactFlag[])
}

const getSiteFilterFlags = (samples: Genotype[]): ArtifactFlag[] => {
  const filters = [...new Set(samples.reduce((acc, genotype) => [...acc, ...(genotype.filters || [])], [] as string[]))]
    .filter(filter => filter && filter.toUpperCase() !== 'PASS')
  return filters.length ? [{ code: 'SITE_FILTER', label: 'Failed site filters', detail: filters.join(', ') }] : []
}

export const getArtifactFlags = (
  variant: Variant,
  genotypes: GenotypesByIndividual | null | undefined,
  individualsByGuid: IndividualsByGuid | null | undefined,
): ArtifactFlag[] => {
  if (!genotypes || !individualsByGuid) {
    return []
  }
  const familyGenotypes = Object.entries(genotypes).filter(([individualGuid]) => individualsByGuid[individualGuid])
  return [
    ...getSiteFilterFlags(familyGenotypes.flatMap(([, individualGenotypes]) => sampleGenotypes(individualGenotypes))),
    ...familyGenotypes.reduce((acc, [individualGuid, individualGenotypes]) => {
      const individual = { ...individualsByGuid[individualGuid], individualGuid }
      return [
        ...acc,
        ...getDeNovoFlags(variant, genotypes, individual, individualsByGuid),
        ...getSampleFlags(variant, sampleGenotypes(individualGenotypes), individual),
      ]
    }, [] as ArtifactFlag[]),
  ]
}
