import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import { Provider } from 'react-redux'

import { GNOMAD_SV_CRITERIA_MESSAGE, SV_CALLSET_CRITERIA_MESSAGE } from 'shared/utils/constants'
import Frequencies from './Frequencies'

configure({ adapter: new Adapter() })

const GENE_ID = 'ENSG00000228198'

const SNV = {
  variantId: '1-248367227-C-T',
  chrom: '1',
  pos: 248367227,
  ref: 'C',
  alt: 'T',
  genomeVersion: '38',
  liftedOverGenomeVersion: '37',
  liftedOverChrom: '1',
  liftedOverPos: 248203925,
  mainTranscriptId: 'ENST00000456743',
  transcripts: { [GENE_ID]: [{ transcriptId: 'ENST00000456743' }] },
}

const SV = {
  variantId: 'batch_123_DEL',
  chrom: '1',
  pos: 248367227,
  end: 248369227,
  svType: 'DEL',
  genomeVersion: '38',
  transcripts: { [GENE_ID]: [] },
}

const TOTAL_SAMPLE_COUNTS = {
  SNV_INDEL: { WES: 5200, WGS: 1300 },
  MITO: { WGS: 900 },
  SV: { WGS: 1100 },
}

const clean = text => text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const mountFrequencies = (variant, totalSampleCounts = {}) => mount(
  <Provider store={configureStore()({ totalSampleCounts })}>
    <Frequencies variant={variant} />
  </Provider>,
)

const getRows = wrapper => wrapper.find('div').first().children().map(row => row)
  .filter(row => row.html())
  .map(row => ({
    text: clean(row.findWhere(node => node.type() === undefined).map(node => node.text()).join(' ')),
    af: row.find('b').length ? row.find('b').text() : null,
    links: row.find('a').map(a => a.prop('href')),
    lowCoverage: row.find('Label').length > 0 ? row.find('Label').prop('content') : null,
    row,
  }))

const getRow = (wrapper, title) => getRows(wrapper).find(({ text }) => text.startsWith(title))

const snvRow = (field, title, population, variant = SNV) => getRow(
  mountFrequencies({ ...variant, populations: { seqr: { ac: 1, an: 100 }, [field]: population } }), title,
)

const getPopupLines = (wrapper) => {
  const popup = wrapper.find('Popup').filterWhere(node => node.prop('wide') === 'very')
  if (!popup.length) {
    return null
  }
  return mount(<div>{popup.prop('children')}</div>).find('div').first().children()
    .map(node => clean(node.text()))
    .filter(text => text)
}

describe('populations shown by variant type', () => {
  test('a SNV shows seqr, gnomAD exomes and genomes, and TopMed, in that order', () => {
    const wrapper = mountFrequencies({
      ...SNV,
      populations: {
        seqr: { af: 0.0012, ac: 16, an: 13000, hom: 1 },
        seqr_affected: { af: 0.002, ac: 9, an: 4500, hom: 1 },
        gnomad_exomes: { af: 0.00034, filter_af: 0.0011, ac: 480, an: 1400000, hom: 2, hemi: 5 },
        gnomad_genomes: { af: 0.00051234, ac: 78, an: 152000, hom: 0, hemi: 0 },
        topmed: { af: 0.00021, ac: 26, an: 125568 },
      },
    })
    expect(getRows(wrapper).map(({ text }) => text)).toEqual([
      'seqr 0.0012 Hom=1 AC=16 out of 13000',
      'seqr affected 0.0020 Hom=1 AC=9 out of 4500',
      'gnomAD v4 exomes 0.0011 Hom=2 Het=476',
      'gnomAD v4 genomes 0.000512 Hom=0 Het=78',
      'TopMed 0.000210',
    ].map(clean))
  })

  test('a structural variant shows the SV callset and gnomAD SV frequencies', () => {
    const wrapper = mountFrequencies({
      ...SV,
      populations: {
        sv_seqr: { af: 0.0031, ac: 7, an: 2200, hom: 1 },
        sv_seqr_affected: { af: 0.004, ac: 4, an: 1000, hom: 0 },
        gnomad_svs: { af: 0.00679, id: 'gnomAD-SV_v3_DEL_chr1_1a2b3c4d' },
        gnomad_exomes: {},
        gnomad_genomes: {},
        topmed: {},
      },
    }, TOTAL_SAMPLE_COUNTS)
    expect(getRows(wrapper).map(({ text }) => text)).toEqual([
      'seqr 0.0031 Hom=1 AC=7 out of 2200',
      'seqr affected 0.0040 Hom=0 AC=4 out of 1000',
      'gnomAD SVs 0.00679',
    ])
    expect(getPopupLines(wrapper)).toEqual([
      'Allele Counts',
      'seqr: 7 out of 2200',
      'seqr affected: 4 out of 1000',
      SV_CALLSET_CRITERIA_MESSAGE,
      GNOMAD_SV_CRITERIA_MESSAGE,
    ])
  })

  test('a mitochondrial variant shows homoplasmy and heteroplasmy separately', () => {
    const wrapper = mountFrequencies({
      ...SNV,
      chrom: 'M',
      pos: 3243,
      ref: 'A',
      alt: 'G',
      populations: {
        seqr: { af: 0.0011, ac: 1, an: 900 },
        seqr_affected: { af: 0.0025, ac: 1, an: 400 },
        seqr_heteroplasmy: { af: 0.0044, ac: 4, an: 900 },
        seqr_heteroplasmy_affected: { af: 0.0075, ac: 3, an: 400 },
        gnomad_mito: { af: 0.00001772, ac: 1, an: 56434 },
        gnomad_mito_heteroplasmy: { af: 0.00030124, ac: 17, an: 56434, max_hl: 0.9124 },
        helix: { af: 0, ac: 0, an: 195983 },
        helix_heteroplasmy: { af: 0.00012756, ac: 25, an: 195983, max_hl: 0.5 },
      },
    }, TOTAL_SAMPLE_COUNTS)
    expect(getRows(wrapper).map(({ text }) => text)).toEqual([
      'seqr homoplasmy 0.0011 AC=1 out of 900',
      'seqr affected homoplasmy 0.0025 AC=1 out of 400',
      'seqr heteroplasmy 0.0044 AC=4 out of 900',
      'seqr affected heteroplasmy 0.0075 AC=3 out of 400',
      'gnomAD mito homoplasmy 0.0000177',
      'gnomAD mito heteroplasmy 0.000301',
      'Helix mito homoplasmy 0.0',
      'Helix mito heteroplasmy 0.000128',
    ])
    expect(getRow(wrapper, 'gnomAD mito homoplasmy').links).toEqual([
      'http://gnomad.broadinstitute.org/variant/M-3243-A-G?dataset=gnomad_r4',
    ])
    expect(getRow(wrapper, 'Helix mito heteroplasmy').links).toEqual([])
    expect(getPopupLines(wrapper)).toEqual([
      'seqr Global ACs',
      expect.stringContaining('WGS: Total=900'),
      'Homoplasmy',
      'seqr: 1 out of 900',
      'seqr affected: 1 out of 400',
      'gnomAD mito: 1 out of 56434',
      'Heteroplasmy',
      'seqr: 4 out of 900',
      'seqr affected: 3 out of 400',
      'gnomAD mito: 17 out of 56434',
      'gnomAD mito max observed heteroplasmy: 0.912',
      'Helix mito: 25 out of 195983',
      'Helix mito max observed heteroplasmy: 0.500',
    ])
  })

  test('nothing is shown for a variant without population data', () => {
    expect(getRows(mountFrequencies({ ...SNV, populations: {} }))).toEqual([])
    expect(getRows(mountFrequencies({ ...SNV }))).toEqual([])
    expect(getRows(mountFrequencies({
      ...SNV, populations: { gnomad_exomes: {}, gnomad_genomes: { af: null, ac: null, an: null }, topmed: {} },
    }))).toEqual([])
  })
})

describe('allele frequency display', () => {
  test.each([
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.000123456, '0.00012'],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.5, '0.50'],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.0995, '0.10'],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.999, '1.0'],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.0000012, '0.0000012'],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0.00000068412, '6.8e-7'],
    ['gnomad_genomes', 'gnomAD v4 genomes', 0.000123456, '0.000123'],
    ['gnomad_genomes', 'gnomAD v4 genomes', 0.00000656, '0.00000656'],
    ['gnomad_genomes', 'gnomAD v4 genomes', 0.000000656, '6.56e-7'],
    ['gnomad_genomes', 'gnomAD v4 genomes', 1, '1.00'],
    ['topmed', 'TopMed', 0.0123456, '0.0123'],
    ['seqr', 'seqr', 0.0123456, '0.012'],
  ])('%s %s AF %s is shown as %s', (field, title, af, expected) => {
    expect(snvRow(field, title, { af }).af).toEqual(expected)
  })

  test('the popmax AF is shown in place of the global AF, which moves to the hover detail', () => {
    const wrapper = mountFrequencies({
      ...SNV,
      populations: {
        gnomad_exomes: { af: 0.00034, filter_af: 0.0011 },
        gnomad_genomes: { af: 0.00051234, filter_af: 0.00051234 },
      },
    })
    expect(getRow(wrapper, 'gnomAD v4 exomes').af).toEqual('0.0011')
    expect(getRow(wrapper, 'gnomAD v4 genomes').af).toEqual('0.000512')
    expect(getPopupLines(wrapper)).toEqual(['Global AFs', 'gnomAD exomes: 0.00034'])
  })

  test.each([[undefined], [null], [0]])('the global AF is shown when the popmax AF is %s', (filterAf) => {
    const wrapper = mountFrequencies({
      ...SNV, populations: { gnomad_exomes: { af: 0.00034, filter_af: filterAf } },
    })
    expect(getRow(wrapper, 'gnomAD v4 exomes').af).toEqual('0.00034')
    expect(getPopupLines(wrapper)).toBeNull()
  })

  test('an AF of 0 is shown as 0.0, not treated as missing', () => {
    const row = snvRow('gnomad_genomes', 'gnomAD v4 genomes', { af: 0, ac: 0, an: 152000, hom: 0 })
    expect(row.text).toEqual('gnomAD v4 genomes 0.0 Hom=0 Het=0')
  })

  test('a population with counts but no AF shows the counts only', () => {
    const row = snvRow('seqr_affected', 'seqr affected', { ac: 3, hom: 1 })
    expect(row.af).toBeNull()
    expect(row.text).toEqual('seqr affected Hom=1 AC=3')
  })
})

describe('allele counts', () => {
  test('seqr shows AC out of AN and the homozygote count', () => {
    expect(snvRow('seqr', 'seqr', { af: 0.0012, ac: 16, an: 13000, hom: 2 }).text).toEqual(
      'seqr 0.0012 Hom=2 AC=16 out of 13000',
    )
    expect(snvRow('seqr', 'seqr', { af: 0, ac: 0, an: 13000, hom: 0 }).text).toEqual(
      'seqr 0.0 Hom=0 AC=0 out of 13000',
    )
    expect(snvRow('seqr', 'seqr', { af: 0.0012, ac: 16 }).text).toEqual('seqr 0.0012 AC=16')
  })

  test('gnomAD shows homozygotes and the heterozygote count derived from AC', () => {
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01, ac: 480, an: 1400000, hom: 20 }).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20 Het=440',
    )
  })

  test('a heterozygote count from the data is used as is', () => {
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01, ac: 480, hom: 20, het: 7 }).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20 Het=7',
    )
  })

  test('no heterozygote count is shown when it cannot be derived', () => {
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01, hom: 20 }).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20',
    )
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01, ac: 480, hom: null }).text).toEqual(
      'gnomAD v4 exomes 0.010',
    )
  })

  test('hemizygotes are shown for X chromosome variants only', () => {
    const population = { af: 0.01, ac: 480, an: 1000000, hom: 20, hemi: 31 }
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', population, { ...SNV, chrom: 'X' }).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20 Het=440 Hemi=31',
    )
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { ...population, hemi: 0 }, { ...SNV, chrom: 'X' }).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20 Het=440 Hemi=0',
    )
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', population).text).toEqual(
      'gnomAD v4 exomes 0.010 Hom=20 Het=440',
    )
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { ...population, hemi: null }, { ...SNV, chrom: 'X' }).text)
      .toEqual('gnomAD v4 exomes 0.010 Hom=20 Het=440')
  })

  test('the hover detail lists AC out of AN for each population that has both', () => {
    const wrapper = mountFrequencies({
      ...SNV,
      populations: {
        seqr: { af: 0.0012, ac: 16, an: 13000, hom: 1 },
        gnomad_exomes: { af: 0.00034, ac: 480, an: 1400000 },
        gnomad_genomes: { af: 0.0005, ac: 78 },
        topmed: { af: 0.00021, ac: 26, an: 125568 },
      },
    })
    expect(getPopupLines(wrapper)).toEqual([
      'Allele Counts',
      'seqr: 16 out of 13000',
      'gnomAD exomes: 480 out of 1400000',
      'TopMed: 26 out of 125568',
    ])
  })

  test('the seqr global AC hover breaks counts down by sample type against the samples loaded', () => {
    const wrapper = mountFrequencies({
      ...SNV,
      populations: {
        seqr: { af: 0.0012, ac: 16, an: 13000, hom: 1, ac_wes: 12, hom_wes: 1, ac_wgs: 4, hom_wgs: 0 },
      },
    }, TOTAL_SAMPLE_COUNTS)
    const lines = getPopupLines(wrapper)
    expect(lines[0]).toEqual('seqr Global ACs')
    expect(lines[1]).toContain('WES: Hom=1 AC=12 Total=5200')
    expect(lines[1]).toContain('WGS: Hom=0 AC=4 Total=1300')
    expect(lines.slice(2)).toEqual(['Allele Counts', 'seqr: 16 out of 13000'])
  })

  test('there is no seqr global AC hover without loaded sample counts or without a seqr count', () => {
    const seqr = { af: 0.0012, ac: 16, hom: 1 }
    expect(getPopupLines(mountFrequencies({ ...SNV, populations: { seqr } }, {}))).toBeNull()
    expect(getPopupLines(mountFrequencies(
      { ...SNV, populations: { gnomad_exomes: { af: 0.1 } } }, TOTAL_SAMPLE_COUNTS,
    ))).toBeNull()
  })
})

describe('gnomAD low coverage warning', () => {
  test.each([
    ['gnomad_exomes', 'gnomAD v4 exomes', 5, 730946, true],
    ['gnomad_exomes', 'gnomAD v4 exomes', 5, 730947, false],
    ['gnomad_exomes', 'gnomAD v4 exomes', 5, 1461894, false],
    ['gnomad_exomes', 'gnomAD v4 exomes', 5, 0, true],
    ['gnomad_exomes', 'gnomAD v4 exomes', 0, 1000, false],
    ['gnomad_exomes', 'gnomAD v4 exomes', 5, undefined, false],
    ['gnomad_genomes', 'gnomAD v4 genomes', 5, 76214, true],
    ['gnomad_genomes', 'gnomAD v4 genomes', 5, 76215, false],
    ['gnomad_genomes', 'gnomAD v4 genomes', 5, 152430, false],
    ['gnomad_genomes', 'gnomAD v4 genomes', 0, 1000, false],
  ])('%s %s with AC %s and AN %s warns: %s', (field, title, ac, an, expected) => {
    const row = snvRow(field, title, { af: 0.001, ac, an })
    expect(row.lowCoverage).toEqual(expected ? 'low cov.' : null)
  })

  test('the warning explains that fewer than half of individuals are covered', () => {
    const { row } = snvRow('gnomad_genomes', 'gnomAD v4 genomes', { af: 0.001, ac: 5, an: 40000 })
    expect(row.find('Popup').prop('content')).toEqual(
      'This variant is covered in fewer than 50% of individuals in gnomAD genomes. This may indicate a low-quality site.',
    )
  })

  test('other populations never show the warning', () => {
    expect(snvRow('topmed', 'TopMed', { af: 0.001, ac: 5, an: 10 }).lowCoverage).toBeNull()
    expect(snvRow('seqr', 'seqr', { af: 0.001, ac: 5, an: 10 }).lowCoverage).toBeNull()
  })
})

describe('links', () => {
  const GNOMAD_GENE = `http://gnomad.broadinstitute.org/gene/${GENE_ID}`
  const GNOMAD_VARIANT = 'http://gnomad.broadinstitute.org/variant/1-248367227-C-T'
  const SNV_37 = { ...SNV, genomeVersion: '37', liftedOverGenomeVersion: '38' }
  const gnomadRows = (variant, withSeqr) => {
    const wrapper = mountFrequencies({
      ...variant,
      populations: {
        ...(withSeqr ? { seqr: { ac: 1 } } : {}), gnomad_exomes: { af: 0.01 }, gnomad_genomes: { af: 0.02 },
      },
    })
    return ['gnomAD v4 exomes', 'gnomAD v4 genomes'].map(title => getRow(wrapper, title).links)
  }
  const gnomadVariantLinks = variant => gnomadRows(variant, false).map(links => links[1])

  test('GRCh38 variants link the gene and the variant to gnomAD v4', () => {
    expect(gnomadRows(SNV, true)).toEqual([
      [`${GNOMAD_GENE}?dataset=gnomad_r4`, `${GNOMAD_VARIANT}?dataset=gnomad_r4`],
      [`${GNOMAD_GENE}?dataset=gnomad_r4`, `${GNOMAD_VARIANT}?dataset=gnomad_r4`],
    ])
  })

  test('GRCh37 variants link to gnomAD v2.1 at their own coordinates, not the lifted over ones', () => {
    expect(gnomadRows(SNV_37, true)).toEqual([
      [`${GNOMAD_GENE}?dataset=gnomad_r2_1`, `${GNOMAD_VARIANT}?dataset=gnomad_r2_1`],
      [`${GNOMAD_GENE}?dataset=gnomad_r2_1`, `${GNOMAD_VARIANT}?dataset=gnomad_r2_1`],
    ])
  })

  test('variants without seqr counts link GRCh38 genomes to gnomAD v3 and GRCh37 exomes to v2.1', () => {
    expect(gnomadVariantLinks(SNV)).toEqual([GNOMAD_VARIANT, `${GNOMAD_VARIANT}?dataset=gnomad_r3`])
    expect(gnomadVariantLinks(SNV_37)).toEqual([`${GNOMAD_VARIANT}?dataset=gnomad_r2_1`, GNOMAD_VARIANT])
  })

  test('the gene link uses the gene of the selected main transcript', () => {
    const variant = {
      ...SNV,
      selectedMainTranscriptId: 'ENST00000000002',
      transcripts: { ...SNV.transcripts, ENSG00000164458: [{ transcriptId: 'ENST00000000002' }] },
    }
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01 }, variant).links[0]).toEqual(
      'http://gnomad.broadinstitute.org/gene/ENSG00000164458?dataset=gnomad_r4',
    )
  })

  test('the gnomAD title is not a link when the variant has no main gene', () => {
    const variant = { ...SNV, mainTranscriptId: null, transcripts: {} }
    const row = snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.01 }, variant)
    expect(row.text).toEqual('gnomAD v4 exomes 0.010')
    expect(row.links).toEqual([`${GNOMAD_VARIANT}?dataset=gnomad_r4`])
  })

  test('an AF of 0 links to the gnomAD region around the variant instead of a variant page', () => {
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0, ac: 0, an: 1400000 }).links[1]).toEqual(
      'http://gnomad.broadinstitute.org/region/1-248367127-248367327?dataset=gnomad_r4',
    )
    expect(snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0 }, { ...SNV, pos: 40 }).links[1]).toEqual(
      'http://gnomad.broadinstitute.org/region/1-1-140?dataset=gnomad_r4',
    )
  })

  test('the link goes to the variant page when a popmax AF is shown', () => {
    const row = snvRow('gnomad_exomes', 'gnomAD v4 exomes', { af: 0.00034, filter_af: 0.0011 })
    expect(row.links[1]).toEqual(`${GNOMAD_VARIANT}?dataset=gnomad_r4`)
  })

  test('TopMed links to the Bravo freeze for the genome build', () => {
    expect(snvRow('topmed', 'TopMed', { af: 0.002 }).links).toEqual([
      'http://bravo.sph.umich.edu/freeze5/hg38/variant/1-248367227-C-T',
    ])
    expect(snvRow('topmed', 'TopMed', { af: 0.002 }, SNV_37).links).toEqual([
      'http://bravo.sph.umich.edu/freeze3a/hg19/variant/1-248367227-C-T',
    ])
  })

  test('seqr frequencies are not links', () => {
    expect(snvRow('seqr', 'seqr', { af: 0.002, ac: 4, an: 2000 }).links).toEqual([])
  })

  test('gnomAD SVs link to the gnomAD v4 SV by its ID', () => {
    const wrapper = mountFrequencies({
      ...SV, populations: { gnomad_svs: { af: 0.00679, id: 'gnomAD-SV_v3_DEL_chr1_1a2b3c4d' } },
    })
    expect(getRow(wrapper, 'gnomAD SVs').links).toEqual([
      'http://gnomad.broadinstitute.org/variant/DEL_chr1_1a2b3c4d?dataset=gnomad_sv_r4',
    ])
  })

  test('a GRCh37 SV absent from gnomAD links to the lifted over GRCh38 region it spans', () => {
    const wrapper = mountFrequencies({
      ...SV,
      genomeVersion: '37',
      liftedOverGenomeVersion: '38',
      liftedOverChrom: '1',
      liftedOverPos: 248203925,
      populations: { gnomad_svs: { af: 0 } },
    })
    expect(getRow(wrapper, 'gnomAD SVs')).toMatchObject({
      af: '0.0',
      links: ['http://gnomad.broadinstitute.org/region/1-248203825-248206025?dataset=gnomad_sv_r4'],
    })
  })
})
