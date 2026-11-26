import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'

import Predictions from './Predictions'
import { STATE1 } from '../fixtures'

configure({ adapter: new Adapter() })

const GENE_ID = 'ENSG00000228198'
const DARK_RED = '#8b0000'

const SNV = {
  variantId: '1-248367227-C-T',
  chrom: '1',
  pos: 248367227,
  ref: 'C',
  alt: 'T',
  genomeVersion: '38',
  mainTranscriptId: 'ENST00000456743',
  transcripts: { [GENE_ID]: [{ transcriptId: 'ENST00000456743' }] },
}

const mountPredictions = (variant, genesById = {}) => mount(
  <Provider store={configureStore()({ ...STATE1, genesById })}>
    <Predictions variant={variant} />
  </Provider>,
)

const getRows = wrapper => wrapper.find('Prediction').map((row) => {
  const [title, ...valueParts] = row.find('div').first().children().map(node => node.text())
    .filter(text => text)
  return {
    title,
    value: valueParts.join(''),
    color: row.findWhere(node => (node.prop('name') || '').endsWith('circle')).first().prop('color'),
    href: row.find('a').length ? row.find('a').prop('href') : null,
    row,
  }
})

const getRow = (wrapper, title) => getRows(wrapper).find(row => row.title === title)

const getLegend = (row) => {
  const legend = mount(row.find('Popup').findWhere(node => !!node.prop('hoverable')).first().prop('content'))
  return legend.find('div').slice(1).map(line => ({
    color: line.findWhere(node => node.prop('name') === 'circle').first().prop('color'),
    range: line.text().trim(),
  }))
}

const predictorRow = (field, title, score, genesById) => getRow(
  mountPredictions({ ...SNV, predictions: { [field]: score } }, genesById), title,
)

// Colour bands: green/olive = benign evidence, grey = indeterminate, yellow/red/dark red = increasing
// pathogenic evidence. Each row is [score, expected colour] on either side of a threshold.
const COLOR_BANDS = [
  ['cadd', 'CADD', [
    [0.15, 'green'], [0.151, 'olive'], [22.7, 'olive'], [22.8, 'grey'], [25.2, 'grey'], [25.3, 'yellow'],
    [28, 'yellow'], [28.1, 'red'], [45, 'red'],
  ]],
  ['revel', 'REVEL', [
    [0, 'green'], [0.016, 'green'], [0.0161, 'olive'], [0.29, 'olive'], [0.291, 'grey'], [0.643, 'grey'],
    [0.644, 'yellow'], [0.772, 'yellow'], [0.773, 'red'], [0.931, 'red'], [0.932, DARK_RED], [1, DARK_RED],
  ]],
  ['alphagenome', 'AlphaGenome', [
    [17.9, 'olive'], [18, 'grey'], [22.9, 'grey'], [23, 'yellow'], [26.9, 'yellow'], [27, 'red'],
  ]],
  ['mpc', 'MPC', [[0.2, 'grey'], [1.359, 'grey'], [1.36, 'yellow'], [1.827, 'yellow'], [1.828, 'red']]],
  ['splice_ai', 'SpliceAI', [[0, 'grey'], [0.49, 'grey'], [0.5, 'yellow'], [0.79, 'yellow'], [0.8, 'red'], [1, 'red']]],
  ['absplice', 'AbSplice', [
    [0.049, 'green'], [0.05, 'grey'], [0.099, 'grey'], [0.1, 'yellow'], [0.199, 'yellow'], [0.2, 'red'],
  ]],
  ['promoter_ai', 'PromoterAI', [
    [0.199, 'grey'], [0.2, 'yellow'], [0.499, 'yellow'], [0.5, 'red'],
    [-0.199, 'grey'], [-0.2, 'yellow'], [-0.499, 'yellow'], [-0.5, 'red'],
  ]],
  ['vest', 'VEST', [
    [0.449, 'olive'], [0.45, 'grey'], [0.763, 'grey'], [0.764, 'yellow'], [0.86, 'yellow'], [0.861, 'red'],
    [0.964, 'red'], [0.965, DARK_RED],
  ]],
  ['mut_pred', 'MutPred', [
    [0.01, 'green'], [0.0101, 'olive'], [0.391, 'olive'], [0.392, 'grey'], [0.736, 'grey'], [0.737, 'yellow'],
    [0.828, 'yellow'], [0.829, 'red'], [0.931, 'red'], [0.932, DARK_RED],
  ]],
  ['primate_ai', 'PrimateAI', [
    [0.483, 'olive'], [0.484, 'grey'], [0.789, 'grey'], [0.79, 'yellow'], [0.866, 'yellow'], [0.867, 'red'],
  ]],
  ['eigen', 'Eigen', [[0.99, 'grey'], [1, 'yellow'], [1.99, 'yellow'], [2, 'red']]],
  ['strvctvre', 'Strvctvre', [[0.49, 'grey'], [0.5, 'yellow'], [0.74, 'yellow'], [0.75, 'red']]],
  ['polyphen', 'PolyPhen', [
    [0.113, 'olive'], [0.114, 'grey'], [0.977, 'grey'], [0.978, 'yellow'], [0.998, 'yellow'], [0.999, 'red'],
  ]],
  ['apogee', 'Apogee', [[0.49, 'grey'], [0.5, 'red']]],
  ['gnomad_noncoding', 'gnomAD Constraint', [[2.17, 'grey'], [2.18, 'yellow'], [3.99, 'yellow'], [4, 'red']]],
  ['hmtvar', 'HmtVar', [[0.34, 'grey'], [0.35, 'red']]],
  ['mlc', 'MLC', [[0.49, 'olive'], [0.5, 'yellow'], [0.74, 'yellow'], [0.75, 'red']]],
].reduce((acc, [field, title, bands]) => [...acc, ...bands.map(([score, color]) => [title, score, color, field])], [])

describe('predictor colour bands', () => {
  test.each(COLOR_BANDS)('%s score %s is %s', (title, score, color, field) => {
    const row = predictorRow(field, title, score)
    expect(row.color).toEqual(color)
    expect(row.value).toEqual(score.toPrecision(3))
  })

  // Pejaver et al. 2022 (PMID 36413997) Table 2. Lower scores are more damaging for both tools.
  // SIFT: PP3 moderate = 0, PP3 supporting (0, 0.001], BP4 supporting/moderate >= 0.080
  // FATHMM: PP3 moderate <= -5.04, PP3 supporting (-5.04, -4.14], BP4 supporting/moderate >= 3.32
  test.each([
    ['sift', 'SIFT', 0, 'red'],
    ['sift', 'SIFT', 0.001, 'yellow'],
    ['sift', 'SIFT', 0.002, 'grey'],
    ['sift', 'SIFT', 0.05, 'grey'],
    ['sift', 'SIFT', 0.079, 'grey'],
    ['sift', 'SIFT', 0.08, 'olive'],
    ['sift', 'SIFT', 0.327, 'olive'],
    ['sift', 'SIFT', 1, 'olive'],
    ['fathmm', 'FATHMM', -7.2, 'red'],
    ['fathmm', 'FATHMM', -5.04, 'red'],
    ['fathmm', 'FATHMM', -5.03, 'yellow'],
    ['fathmm', 'FATHMM', -4.14, 'yellow'],
    ['fathmm', 'FATHMM', -4.13, 'grey'],
    ['fathmm', 'FATHMM', 3.31, 'grey'],
    ['fathmm', 'FATHMM', 3.32, 'olive'],
    ['fathmm', 'FATHMM', 6, 'olive'],
  ])('%s (lower is more damaging) %s score %s is %s', (field, title, score, color) => {
    expect(predictorRow(field, title, score).color).toEqual(color)
  })

  test('scores sent by the API as strings are banded like numbers', () => {
    const row = predictorRow('cadd', 'CADD', '27.2')
    expect(row.color).toEqual('yellow')
    expect(row.value).toEqual('27.2')
  })

  test('PEXT shows an expression category instead of the score', () => {
    expect(predictorRow('pext', 'PEXT', 0)).toMatchObject({ color: 'green', value: 'Not Expressed' })
    expect(predictorRow('pext', 'PEXT', 0.01)).toMatchObject({ color: 'olive', value: 'Low Expression' })
    expect(predictorRow('pext', 'PEXT', 0.199)).toMatchObject({ color: 'olive', value: 'Low Expression' })
    expect(predictorRow('pext', 'PEXT', 0.2)).toMatchObject({ color: 'grey', value: 'Expressed' })
    expect(predictorRow('pext', 'PEXT', 1)).toMatchObject({ color: 'grey', value: 'Expressed' })
  })

  test('PrimateAI uses the gene-specific percentiles when the gene has them', () => {
    const genesById = { [GENE_ID]: { geneId: GENE_ID, primateAi: { percentile25: 0.5512, percentile75: 0.8104 } } }
    expect(predictorRow('primate_ai', 'PrimateAI', 0.3, genesById).color).toEqual('grey')
    expect(predictorRow('primate_ai', 'PrimateAI', 0.55, genesById).color).toEqual('grey')
    expect(predictorRow('primate_ai', 'PrimateAI', 0.551, genesById).color).toEqual('yellow')
    expect(predictorRow('primate_ai', 'PrimateAI', 0.809, genesById).color).toEqual('yellow')
    expect(predictorRow('primate_ai', 'PrimateAI', 0.81, genesById).color).toEqual('red')

    const row = predictorRow('primate_ai', 'PrimateAI', 0.6, genesById)
    expect(getLegend(row.row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'grey < 0.551', 'yellow 0.551 - 0.810', 'red >= 0.810',
    ])
  })

  test('PrimateAI falls back to the ClinGen thresholds for a gene without percentiles', () => {
    const genesById = { [GENE_ID]: { geneId: GENE_ID } }
    expect(predictorRow('primate_ai', 'PrimateAI', 0.6, genesById).color).toEqual('grey')
    expect(predictorRow('primate_ai', 'PrimateAI', 0.3, genesById).color).toEqual('olive')
  })
})

describe('categorical predictors', () => {
  test.each([
    ['mut_taster', 'MutTaster', 'D', 'red', 'disease causing'],
    ['mut_taster', 'MutTaster', 'A', 'red', 'disease causing automatic'],
    ['mut_taster', 'MutTaster', 'N', 'green', 'polymorphism'],
    ['mut_taster', 'MutTaster', 'P', 'green', 'polymorphism automatic'],
    ['mitotip', 'MitoTIP', 'likely_pathogenic', 'red', 'likely pathogenic'],
    ['mitotip', 'MitoTIP', 'possibly_pathogenic', 'red', 'possibly pathogenic'],
    ['mitotip', 'MitoTIP', 'possibly_benign', 'green', 'possibly benign'],
    ['mitotip', 'MitoTIP', 'likely_benign', 'green', 'likely benign'],
  ])('%s %s %s is %s "%s"', (field, title, score, color, value) => {
    expect(predictorRow(field, title, score)).toMatchObject({ color, value })
  })

  test('haplogroup defining variants are flagged in green', () => {
    expect(predictorRow('haplogroup_defining', 'Haplogroup Defining', true)).toMatchObject({ color: 'green', value: '' })
    expect(predictorRow('haplogroup_defining', 'Haplogroup Defining', false)).toBeUndefined()
  })

  test('an unrecognised category is not shown', () => {
    expect(predictorRow('mut_taster', 'MutTaster', 'X')).toBeUndefined()
  })
})

describe('colour range legend', () => {
  test('REVEL lists every band from benign to pathogenic with its citation', () => {
    const { row } = predictorRow('revel', 'REVEL', 0.5)
    expect(getLegend(row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'green < 0.0161',
      'olive 0.0161 - 0.291',
      'grey 0.291 - 0.644',
      'yellow 0.644 - 0.773',
      'red 0.773 - 0.932',
      `${DARK_RED} >= 0.932`,
    ])
    const popup = row.find('Popup').findWhere(node => !!node.prop('hoverable')).first()
    expect(popup.prop('header')).toEqual('REVEL Color Ranges')
    const legend = mount(popup.prop('content'))
    expect(legend.find('small').text()).toEqual('Based on 2022 ClinGen recommendations (PMID: 36413997)')
    expect(legend.find('a').prop('href')).toEqual('https://pubmed.ncbi.nlm.nih.gov/36413997')
  })

  test('SIFT lists bands from pathogenic (low scores) to benign (high scores)', () => {
    const { row } = predictorRow('sift', 'SIFT', 0.05)
    expect(getLegend(row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'red < 0.001',
      'yellow 0.001 - 0.002',
      'grey 0.002 - 0.08',
      'olive >= 0.08',
    ])
  })

  test('PromoterAI describes both directions of effect', () => {
    const { row } = predictorRow('promoter_ai', 'PromoterAI', -0.3)
    expect(getLegend(row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'grey < 0.2',
      'yellow 0.2 - 0.5, -0.5 - -0.2',
      'red >= 0.5, <= -0.5',
    ])
  })

  test('PEXT labels each band with its expression category', () => {
    const { row } = predictorRow('pext', 'PEXT', 0.1)
    expect(getLegend(row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'green Not Expressed: < 0',
      'olive Low Expression: 0 - 0.2',
      'grey Expressed: >= 0.2',
    ])
  })

  test('bands with no score range are left out', () => {
    const { row } = predictorRow('mlc', 'MLC', 0.6)
    expect(getLegend(row).map(({ color, range }) => `${color} ${range}`)).toEqual([
      'olive < 0.5', 'yellow 0.5 - 0.75', 'red >= 0.75',
    ])
  })
})

describe('SpliceAI', () => {
  test('links the score to the SpliceAI lookup for the variant and its genome build', () => {
    const row = getRow(mountPredictions({ ...SNV, predictions: { splice_ai: 0.83 } }), 'SpliceAI')
    expect(row).toMatchObject({
      value: '0.830',
      color: 'red',
      href: 'https://spliceailookup.broadinstitute.org/#variant=1-248367227-C-T&hg=38&distance=1000&mask=0',
    })

    const row37 = getRow(mountPredictions({ ...SNV, genomeVersion: '37', predictions: { splice_ai: 0.1 } }), 'SpliceAI')
    expect(row37.href).toEqual(
      'https://spliceailookup.broadinstitute.org/#variant=1-248367227-C-T&hg=37&distance=1000&mask=0',
    )
  })

  test('shows the predicted consequence in a popup on the indicator', () => {
    const { row } = getRow(mountPredictions({
      ...SNV, predictions: { splice_ai: 0.61, splice_ai_consequence: 'Donor gain' },
    }), 'SpliceAI')
    const info = row.find('Popup').findWhere(node => node.prop('header') === 'Predicted Consequence').first()
    expect(info.prop('content')).toEqual('Donor gain')
    expect(info.prop('trigger').props).toMatchObject({ name: 'question circle', color: 'yellow' })
  })

  test('a score of 0 is shown as a score, not as missing', () => {
    const row = getRow(mountPredictions({ ...SNV, predictions: { splice_ai: 0 } }), 'SpliceAI')
    expect(row).toMatchObject({ value: '0.00', color: 'grey' })
  })

  test('a SNV without a SpliceAI score shows "?" linked to the lookup', () => {
    const rows = getRows(mountPredictions({ ...SNV, predictions: { cadd: 12 } }))
    expect(rows.map(({ title, value }) => `${title} ${value}`)).toEqual(['CADD 12.0', 'SpliceAI ?'])
    expect(rows[1].color).toEqual('grey')
    expect(rows[1].href).toEqual(
      'https://spliceailookup.broadinstitute.org/#variant=1-248367227-C-T&hg=38&distance=1000&mask=0',
    )
  })
})

describe('AlphaMissense', () => {
  const amVariant = (pathogenicity, predictions = {}) => ({
    ...SNV,
    predictions,
    transcripts: {
      [GENE_ID]: [
        { transcriptId: 'ENST00000000001', alphamissense: { pathogenicity: 0.01 } },
        { transcriptId: 'ENST00000456743', alphamissense: { pathogenicity } },
      ],
    },
  })

  test.each([
    [0.07, 'green'], [0.071, 'olive'], [0.169, 'olive'], [0.17, 'grey'], [0.791, 'grey'], [0.792, 'yellow'],
    [0.905, 'yellow'], [0.906, 'red'], [0.989, 'red'], [0.99, DARK_RED],
  ])('main transcript score %s is %s', (score, color) => {
    const row = getRow(mountPredictions(amVariant(score)), 'AlphaMissense')
    expect(row).toMatchObject({ color, value: score.toPrecision(3) })
  })

  test('uses the score of the main transcript, not of another transcript', () => {
    const variant = { ...amVariant(0.95), selectedMainTranscriptId: 'ENST00000000001' }
    expect(getRow(mountPredictions(variant), 'AlphaMissense')).toMatchObject({ color: 'green', value: '0.0100' })
  })

  test('is not shown when the main transcript has no score', () => {
    const variant = { ...SNV, predictions: { cadd: 20 } }
    expect(getRow(mountPredictions(variant), 'AlphaMissense')).toBeUndefined()
  })

  test('cites the 2025 ClinGen SVI recommendations', () => {
    const { row } = getRow(mountPredictions(amVariant(0.5)), 'AlphaMissense')
    const legend = mount(row.find('Popup').findWhere(node => !!node.prop('hoverable')).first().prop('content'))
    expect(legend.find('small').text()).toEqual('Based on 2025 ClinGen SVI recommendations (PMID: 40084623)')
  })
})

describe('which predictors are shown', () => {
  const ALL_PREDICTIONS = {
    cadd: 30,
    revel: 0.9,
    alphagenome: 20,
    mpc: 1.5,
    splice_ai: 0.2,
    absplice: 0.01,
    promoter_ai: 0.1,
    pext: 0.5,
    vest: 0.5,
    mut_pred: 0.5,
    primate_ai: 0.5,
    eigen: 0.5,
    polyphen: 0.5,
    sift: 0.5,
    mut_taster: 'D',
    fathmm: 0.5,
    gnomad_noncoding: 1,
  }

  test('renders nothing for a variant without predictions', () => {
    expect(mountPredictions({ ...SNV, predictions: null }).find('Predictions').html()).toBeNull()
    expect(mountPredictions({ ...SNV }).find('Predictions').html()).toBeNull()
  })

  test('only predictors with a score are shown; null and undefined are missing but 0 is a score', () => {
    const rows = getRows(mountPredictions({
      ...SNV, predictions: { cadd: null, revel: undefined, polyphen: 0, splice_ai: 0.3 },
    }))
    expect(rows.map(({ title, value }) => `${title} ${value}`)).toEqual(['SpliceAI 0.300', 'PolyPhen 0.00'])
    expect(rows[1].color).toEqual('olive')
  })

  test('a structural variant shows its StrVCTVRE score', () => {
    const variant = {
      variantId: 'batch_123_DEL',
      chrom: '1',
      pos: 248367227,
      end: 248369100,
      svType: 'DEL',
      genomeVersion: '38',
      predictions: { strvctvre: '0.272' },
      transcripts: { [GENE_ID]: [] },
    }
    expect(getRow(mountPredictions(variant), 'Strvctvre')).toMatchObject({ value: '0.272', color: 'grey' })
  })

  test('a mitochondrial variant shows the mitochondrial predictors', () => {
    const rows = getRows(mountPredictions({
      ...SNV,
      chrom: 'M',
      predictions: { apogee: 0.7, haplogroup_defining: true, mitotip: 'likely_benign', hmtvar: 0.2, mlc: 0.8 },
    })).filter(({ title }) => title !== 'SpliceAI')
    expect(rows.map(({ title, value, color }) => `${title}|${value}|${color}`)).toEqual([
      'Apogee|0.700|red',
      'Haplogroup Defining||green',
      'MitoTIP|likely benign|green',
      'HmtVar|0.200|grey',
      'MLC|0.800|red',
    ])
  })

  test('the first six predictors are shown and the rest expand and collapse', () => {
    const wrapper = mountPredictions({ ...SNV, predictions: ALL_PREDICTIONS })
    const firstSix = ['CADD', 'REVEL', 'AlphaGenome', 'MPC', 'SpliceAI', 'AbSplice']
    expect(getRows(wrapper).map(({ title }) => title)).toEqual(firstSix)
    expect(wrapper.find('ButtonLink').text()).toEqual('show more...')

    wrapper.find('ButtonLink').simulate('click')
    expect(getRows(wrapper).map(({ title }) => title)).toEqual([
      ...firstSix, 'PromoterAI', 'PEXT', 'VEST', 'MutPred', 'PrimateAI', 'Eigen', 'PolyPhen', 'SIFT', 'MutTaster',
      'FATHMM', 'gnomAD Constraint',
    ])
    expect(wrapper.find('ButtonLink').text()).toEqual('hide')

    wrapper.find('ButtonLink').simulate('click')
    expect(wrapper.find('ButtonLink').text()).toEqual('show more...')
  })

  test('there is no expand control when six or fewer predictors have scores', () => {
    const { cadd, revel, alphagenome, mpc, splice_ai: spliceAi, absplice } = ALL_PREDICTIONS
    const wrapper = mountPredictions({
      ...SNV, predictions: { cadd, revel, alphagenome, mpc, splice_ai: spliceAi, absplice },
    })
    expect(getRows(wrapper)).toHaveLength(6)
    expect(wrapper.find('ButtonLink')).toHaveLength(0)
  })

  test('AlphaGenome links to the variant in the AlphaGenome atlas', () => {
    expect(predictorRow('alphagenome', 'AlphaGenome', 25).href).toEqual(
      'https://deepmind.google.com/science/alphagenome/atlas?q=chr1:248367227:C%3ET&m=variant',
    )
  })
})
