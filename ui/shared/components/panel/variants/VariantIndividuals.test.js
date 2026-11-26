import React from 'react'
import { mount, shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'

import VariantIndividuals, { Alleles } from './VariantIndividuals'
import { STATE1, VARIANT, SV_VARIANT } from '../fixtures'

configure({ adapter: new Adapter() })

const PROBAND = {
  individualGuid: 'I_proband',
  familyGuid: 'F1',
  displayName: 'Proband',
  sex: 'M',
  affected: 'A',
  maternalGuid: 'I_mother',
  paternalGuid: 'I_father',
}
const MOTHER = { individualGuid: 'I_mother', familyGuid: 'F1', displayName: 'Mother', sex: 'F', affected: 'N' }
const FATHER = { individualGuid: 'I_father', familyGuid: 'F1', displayName: 'Father', sex: 'M', affected: 'N' }

const SNV = { variantId: '1-1000-A-G', chrom: '1', pos: 1000, ref: 'A', alt: 'G', genomeVersion: '38', familyGuids: ['F1'] }
const SV = { variantId: 'sv1', chrom: '1', pos: 1000, end: 9000, svType: 'DEL', genomeVersion: '38', familyGuids: ['F1'] }

const genotypesFor = (proband, mother, father) => ({
  I_proband: proband, ...(mother ? { I_mother: mother } : {}), ...(father ? { I_father: father } : {}),
})

const renderIndividuals = (variant, { proband = PROBAND, isCompoundHet = false, genesById = {} } = {}) => {
  const store = configureStore()({
    individualsByGuid: { I_proband: proband, I_mother: MOTHER, I_father: FATHER },
    mmeSubmissionsByGuid: {},
    genesById,
  })
  return mount(
    <Provider store={store}>
      <VariantIndividuals variant={variant} isCompoundHet={isCompoundHet} />
    </Provider>,
  )
}

// Individuals are displayed affected first, so the proband is always the first genotype shown
const probandGenotype = (variant, options) => {
  const alleles = renderIndividuals(variant, options).find(Alleles).first()
  return { alleles: alleles.text(), isHemiX: alleles.prop('isHemiX'), warning: alleles.prop('warning') }
}

test('shallow-render without crashing', () => {
  const store = configureStore()(STATE1)

  shallow(<VariantIndividuals familyGuid="F011652_1" store={store} variant={VARIANT} />)
  shallow(<VariantIndividuals familyGuid="F011652_1" store={store} variant={SV_VARIANT} />)
})

describe('SNV genotype display', () => {
  test('shows ref and alt alleles by zygosity for every family member', () => {
    const wrapper = renderIndividuals({
      ...SNV,
      genotypes: genotypesFor({ numAlt: 2, gq: 99, ab: 1 }, { numAlt: 1, gq: 60, ab: 0.4567 }, { numAlt: 0, gq: 40 }),
    })
    expect(wrapper.find(Alleles).map(a => a.text())).toEqual(['G/G', 'A/G', 'A/A'])
    expect(wrapper.text()).toContain('Proband')
    expect(wrapper.text()).toContain('99, 1.0')
    expect(wrapper.text()).toContain('60, 0.46')
    expect(wrapper.text()).toContain('40, -')
  })

  test('shows no call when neither a genotype nor a copy number was called', () => {
    const wrapper = renderIndividuals({ ...SNV, genotypes: genotypesFor({ numAlt: -1 }, { numAlt: 1 }) })
    expect(wrapper.find(Alleles).map(a => a.text())).toEqual(['A/G'])
    expect(wrapper.text()).toContain('NO CALL')
  })

  test('omits individuals without a genotype', () => {
    const wrapper = renderIndividuals({ ...SNV, genotypes: genotypesFor({ numAlt: 1 }) })
    expect(wrapper.find(Alleles).length).toEqual(1)
    expect(wrapper.text()).toContain('Mother')
    expect(wrapper.text()).not.toContain('NO CALL')
  })

  test('shows quality score and filters when there is no genotype quality', () => {
    const wrapper = renderIndividuals({
      ...SNV, genotypes: genotypesFor({ numAlt: 1, qs: 57, hl: 0.123, filters: ['artifact_prone_site', 'weak_evidence'] }),
    })
    expect(wrapper.text()).toContain('57, 0.12')
    expect(wrapper.text()).toContain('artifact_prone_site, weak_evidence')
  })
})

describe('hemizygous display on sex chromosomes', () => {
  const xVariant = (pos, genomeVersion = '38') => ({
    ...SNV, chrom: 'X', pos, genomeVersion, genotypes: genotypesFor({ numAlt: 2 }, { numAlt: 1 }, { numAlt: 0 }),
  })

  test('males are hemizygous on X outside the pseudoautosomal regions', () => {
    const wrapper = renderIndividuals(xVariant(50000000))
    expect(wrapper.find(Alleles).map(a => a.text())).toEqual(['G/-', 'A/G', 'A/-'])
    expect(wrapper.find(Alleles).map(a => a.prop('isHemiX'))).toEqual([true, false, true])
    expect(wrapper.find(Alleles).first().prop('warning')).toEqual('')
  })

  test('males are diploid inside the pseudoautosomal regions', () => {
    expect(probandGenotype(xVariant(2000000)).alleles).toEqual('G/G')
    expect(probandGenotype(xVariant(155800000)).alleles).toEqual('G/G')
    expect(probandGenotype(xVariant(10000)).alleles).toEqual('G/-')
    expect(probandGenotype(xVariant(2781481)).alleles).toEqual('G/-')
  })

  test('pseudoautosomal boundaries depend on the genome build', () => {
    expect(probandGenotype(xVariant(2700000, '37')).isHemiX).toBe(true)
    expect(probandGenotype(xVariant(2700000, '38')).isHemiX).toBe(false)
    expect(probandGenotype(xVariant(155000000, '37')).isHemiX).toBe(false)
    expect(probandGenotype(xVariant(155000000, '38')).isHemiX).toBe(true)
  })

  test('males are hemizygous on Y and females are never hemizygous', () => {
    expect(probandGenotype({ ...xVariant(20000000), chrom: 'Y' }).alleles).toEqual('G/-')
    expect(probandGenotype(xVariant(50000000), { proband: { ...PROBAND, sex: 'F' } })).toEqual(
      { alleles: 'G/G', isHemiX: false, warning: 'Potential UPD/ Hemizygosity' },
    )
  })

  test('warns about sex aneuploidy on sex chromosomes only', () => {
    const proband = { ...PROBAND, sex: 'XXY' }
    expect(probandGenotype(xVariant(50000000), { proband }).warning).toEqual('Sex Aneuploidy - XXY')
    expect(probandGenotype({ ...xVariant(50000000), chrom: '3' }, { proband }).warning).toEqual(
      'Potential UPD/ Hemizygosity',
    )
  })
})

describe('inheritance warnings', () => {
  const warning = (genotypes, options) => probandGenotype({ ...SNV, genotypes }, options).warning

  test('warns of possible UPD or hemizygosity when a homozygous call is absent from an unaffected parent', () => {
    expect(warning(genotypesFor({ numAlt: 2 }, { numAlt: 1 }, { numAlt: 0 }))).toEqual('Potential UPD/ Hemizygosity')
    expect(warning(genotypesFor({ numAlt: 2 }, { numAlt: 1 }, { numAlt: 1 }))).toEqual('')
    expect(warning(genotypesFor({ numAlt: 1 }, { numAlt: 1 }, { numAlt: 0 }))).toEqual('')
    expect(warning(genotypesFor({ numAlt: 2 }, { numAlt: 1 }))).toEqual('')
    expect(warning(genotypesFor({ numAlt: 2 }, { numAlt: 1 }, { numAlt: 0, affected: 'A' }))).toEqual('')
  })

  test('warns when a compound het variant is absent from both parents', () => {
    const deNovo = genotypesFor({ numAlt: 1 }, { numAlt: 0 }, { numAlt: 0 })
    expect(warning(deNovo, { isCompoundHet: true })).toEqual('Variant absent in parents')
    expect(warning(deNovo)).toEqual('')
    expect(warning(genotypesFor({ numAlt: 1 }, { numAlt: 1 }, { numAlt: 0 }), { isCompoundHet: true })).toEqual('')
  })

  test('warns about contamination and common low heteroplasmy for mitochondrial calls', () => {
    const genotypes = genotypesFor({ numAlt: 1, hl: 0.05, contamination: 0.02 })
    expect(warning(genotypes)).toEqual('Contamination (0.02) > 0')
    expect(probandGenotype({ ...SNV, chrom: 'M', commonLowHeteroplasmy: true, genotypes }).warning).toEqual(
      'Contamination (0.02) > 0. Common low heteroplasmy',
    )
  })
})

describe('SV genotype display', () => {
  const svGenotype = (genotype, variant = SV, options) => probandGenotype(
    { ...variant, genotypes: genotypesFor(genotype) }, options,
  )

  test('shows genotype and copy number', () => {
    expect(svGenotype({ numAlt: 1, cn: 1 })).toEqual({ alleles: 'ref/altCN:  1', isHemiX: false, warning: '' })
    expect(svGenotype({ numAlt: 2, cn: 0 }).alleles).toEqual('alt/altCN:  0')
    expect(svGenotype({ numAlt: 0, cn: 2 }).alleles).toEqual('ref/refCN:  2')
    expect(svGenotype({ numAlt: 1 }).alleles).toEqual('ref/alt')
    expect(svGenotype({ numAlt: -1, cn: 3 }, { ...SV, svType: 'DUP' }).alleles).toEqual('CN:  3')
  })

  test('warns when the copy number contradicts the call type', () => {
    const callTypeWarning = 'Copy Number does not match Call Type. Copy number calling may be unreliable for small events'
    expect(svGenotype({ numAlt: -1, cn: 3 }).warning).toEqual(callTypeWarning)
    expect(svGenotype({ numAlt: 1, cn: 1 }, { ...SV, svType: 'DUP' }).warning).toEqual(
      `${callTypeWarning}, however genotype call is likely accurate`,
    )
    expect(svGenotype({ numAlt: -1, cn: 3 }, { ...SV, svType: 'DUP' }).warning).toEqual('')
  })

  test('warns when the copy number contradicts the genotype', () => {
    const genotypeWarning = 'Copy number does not match genotype. Copy number calling may be unreliable for small events, however genotype call is likely accurate'
    expect(svGenotype({ numAlt: 1, cn: 2 }).warning).toEqual(genotypeWarning)
    expect(svGenotype({ numAlt: 0, cn: 1 }).warning).toEqual(genotypeWarning)
    expect(svGenotype({ numAlt: 0, cn: 2 }).warning).toEqual('')
  })

  test('uses a reference copy number of one for hemizygous males', () => {
    const xDeletion = { ...SV, chrom: 'X', pos: 50000000 }
    expect(svGenotype({ numAlt: 1, cn: 0 }, xDeletion)).toEqual(
      { alleles: 'ref/altCN:  0', isHemiX: true, warning: '' },
    )
    expect(svGenotype({ numAlt: 2, cn: 0 }, xDeletion).alleles).toEqual('ref/altCN:  0')
    expect(svGenotype({ numAlt: 0, cn: 1 }, xDeletion).warning).toEqual('')
    expect(svGenotype({ numAlt: 0, cn: 2 }, xDeletion).warning).toContain('Copy Number does not match Call Type')
  })
})

describe('genotypes from multiple sample types', () => {
  test('shows the genome call first with quality per sample type and flags discordant calls', () => {
    const wrapper = renderIndividuals({
      ...SNV,
      genotypes: genotypesFor([
        { sampleType: 'WES', numAlt: 1, gq: 30, ab: 0.3 },
        { sampleType: 'WGS', numAlt: 2, gq: 99, ab: 1 },
      ]),
    })
    const alleles = wrapper.find(Alleles).first()
    expect(alleles.text()).toEqual('G/G')
    expect(wrapper.text()).toContain('WGS: 99, 1.0WES: 30, 0.30')

    const warning = mount(alleles.prop('warning'))
    expect(warning.text()).toContain('Genotypes differ across sample types')
    expect(warning.find(Alleles).map(a => a.text())).toEqual(['G/G', 'A/G'])
  })

  test('does not warn when sample types agree and attributes warnings to their sample type', () => {
    const concordant = genotypesFor([{ sampleType: 'WES', numAlt: 1, gq: 30 }, { sampleType: 'WGS', numAlt: 1, gq: 99 }])
    expect(probandGenotype({ ...SNV, genotypes: concordant }).warning).toBe(false)

    const contaminated = genotypesFor([
      { sampleType: 'WES', numAlt: 1, contamination: 0.1 }, { sampleType: 'WGS', numAlt: 1 },
    ])
    const warning = mount(probandGenotype({ ...SNV, genotypes: contaminated }).warning)
    expect(warning.text()).toEqual('Contamination (0.1) > 0 (WES)')
  })
})
