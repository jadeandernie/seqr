import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import configureStore from 'redux-mock-store'
import thunk from 'redux-thunk'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'

import { flushAll } from 'shared/utils/testHelpers'
import VariantGenes, { VariantGene, GeneDetails } from './VariantGene'

configure({ adapter: new Adapter() })

const FAMILY_GUID = 'F011652_1'
const GENE_ID = 'ENSG00000000001'

const makeGene = (n, overrides = {}) => ({
  geneId: `ENSG0000000000${n}`,
  geneSymbol: `GENE${n}`,
  startGrch38: 1000 * n,
  constraints: { misZ: 0.52, misZRank: 9100, louef: 0.92, louefRank: 9200, pli: 0.01, totalGenes: 19000 },
  cnSensitivity: {},
  sHet: {},
  omimPhenotypes: [],
  locusListGuids: [],
  ...overrides,
})

const GENE = makeGene(1)

const OMIM_PHENOTYPES = [
  { phenotypeDescription: 'Leigh syndrome', phenotypeInheritance: 'Autosomal recessive', phenotypeMimNumber: 256000 },
  { phenotypeDescription: 'Cardiomyopathy, dilated', phenotypeInheritance: null, phenotypeMimNumber: 115200 },
]

const LOCUS_LISTS = {
  LL_plain: { locusListGuid: 'LL_plain', name: 'Zebrafish candidates', description: 'Candidate genes from the lab' },
  LL_other: { locusListGuid: 'LL_other', name: 'Ataxia genes', description: '' },
  LL_pa_green: {
    locusListGuid: 'LL_pa_green',
    name: 'Mitochondrial disease',
    description: 'PanelApp_AU_203_0.850',
    paLocusList: { source: 'AU', panelAppId: 203 },
  },
  LL_pa_amber: {
    locusListGuid: 'LL_pa_amber',
    name: 'Intellectual disability',
    description: 'PanelApp_UK_285_3.2',
    paLocusList: { source: 'UK', panelAppId: 285 },
  },
}

const VARIANT = {
  variantId: '1-248367227-C-T',
  familyGuids: [FAMILY_GUID],
  transcripts: { [GENE_ID]: [{ transcriptId: 'ENST00000000001', majorConsequence: 'missense_variant' }] },
}

const makeState = (genes, overrides = {}) => ({
  genesById: genes.reduce((acc, gene) => ({ ...acc, [gene.geneId]: gene }), {}),
  locusListsByGuid: LOCUS_LISTS,
  familiesByGuid: { [FAMILY_GUID]: { familyGuid: FAMILY_GUID } },
  individualsByGuid: {
    I1: { individualGuid: 'I1', familyGuid: FAMILY_GUID, displayName: 'NA19675' },
    I2: { individualGuid: 'I2', familyGuid: FAMILY_GUID, displayName: 'NA19678' },
    I3: { individualGuid: 'I3', familyGuid: 'F_other', displayName: 'HG00731' },
  },
  rnaSeqDataByIndividual: {},
  phenotypeGeneScoresByIndividual: {},
  modal: {},
  ...overrides,
})

const mountWithStore = (element, state) => {
  const store = configureStore([thunk])(state)
  const wrapper = mount(<Provider store={store}><MemoryRouter>{element}</MemoryRouter></Provider>)
  return { wrapper, store, state }
}

const mountGene = (gene, props = {}, stateOverrides = {}) => mountWithStore(
  <VariantGene geneId={gene.geneId} variant={VARIANT} {...props} />, makeState([gene], stateOverrides),
)

const clean = text => text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const textOf = node => clean(node.findWhere(n => n.type() === undefined).map(n => n.text()).join(' '))

const getLabels = wrapper => wrapper.find('GeneLabelContent').map(node => node.prop('label'))

const getLabel = (wrapper, label) => wrapper.find('GeneLabelContent').filterWhere(node => node.prop('label') === label)

const getDetail = ({ wrapper, state }, header) => {
  const popup = wrapper.find('Popup').filterWhere(node => node.prop('header') === header).first()
  return mountWithStore(<div>{popup.prop('content')}</div>, state).wrapper
}

describe('constraint labels', () => {
  const constraints = values => ({ constraints: { ...GENE.constraints, ...values } })

  test.each([
    ['no label for an unconstrained gene', {}, []],
    ['missense z-score at the threshold of 3', constraints({ misZ: 3 }), []],
    ['missense z-score above 3', constraints({ misZ: 3.01 }), ['MISSENSE CONSTR']],
    ['missense rank 1000', constraints({ misZRank: 1000 }), []],
    ['missense rank within the top 999', constraints({ misZRank: 999 }), ['MISSENSE CONSTR']],
    ['missing missense z-score loaded as -100', constraints({ misZ: -100, misZRank: 19000 }), []],
    ['LOEUF at the threshold of 0.35', constraints({ louef: 0.35 }), []],
    ['LOEUF below 0.35', constraints({ louef: 0.349 }), ['LOF CONSTR']],
    ['LOEUF of 0', constraints({ louef: 0 }), ['LOF CONSTR']],
    ['missing LOEUF loaded as 100', constraints({ louef: 100 }), []],
    ['haploinsufficiency score at the threshold of 0.86', { cnSensitivity: { phi: 0.86 } }, []],
    ['haploinsufficiency score above 0.86', { cnSensitivity: { phi: 0.861 } }, ['LOF CONSTR']],
    ['Shet at the threshold of 0.1', { sHet: { postMean: 0.1 } }, []],
    ['Shet above 0.1', { sHet: { postMean: 0.101 } }, ['LOF CONSTR']],
    ['triplosensitivity score at the threshold of 0.94', { cnSensitivity: { pts: 0.94 } }, []],
    ['triplosensitivity score above 0.94', { cnSensitivity: { pts: 0.941 } }, ['TS']],
    [
      'every constraint met',
      {
        constraints: { ...GENE.constraints, misZ: 4.2, louef: 0.1 },
        cnSensitivity: { phi: 0.99, pts: 0.99 },
        sHet: { postMean: 0.4 },
      },
      ['MISSENSE CONSTR', 'LOF CONSTR', 'TS'],
    ],
  ])('%s', (name, overrides, expected) => {
    const { wrapper } = mountGene(makeGene(1, overrides))
    expect(getLabels(wrapper)).toEqual(expected)
    expected.forEach(label => expect(getLabel(wrapper, label).prop('color')).toEqual('red'))
  })

  test('a gene without constraint scores has no constraint labels', () => {
    const { wrapper } = mountGene(makeGene(1, { constraints: {} }))
    expect(getLabels(wrapper)).toEqual([])
  })

  test('the missense detail gives the rank and z-score', () => {
    const mounted = mountGene(makeGene(1, { constraints: { ...GENE.constraints, misZ: 4.21678, misZRank: 212 } }))
    expect(clean(mounted.wrapper.find('Popup').filterWhere(
      node => node.prop('header') === 'Missense Constraint',
    ).first().prop('content'))).toContain(
      'This gene ranks 212 most constrained out of 19000 genes under study in terms of missense constraint (z-score: 4.217)',
    )
  })

  test('the LoF detail lists only the criteria the gene meets', () => {
    const loeufOnly = getDetail(mountGene(makeGene(1, {
      constraints: { ...GENE.constraints, louef: 0.1234, louefRank: 310, pli: 0.9987 },
      cnSensitivity: { phi: 0.5 },
      sHet: { postMean: 0.05 },
    })), 'Loss of Function Constraint')
    expect(loeufOnly.find('ListItem').map(item => clean(item.text()))).toEqual([
      'This gene ranks as 310 most intolerant of LoF mutations out of 19000 genes under study (louef: 0.1234, pLi: 0.9987) Karczewski (2020)',
    ])

    const scoresOnly = getDetail(mountGene(makeGene(1, {
      cnSensitivity: { phi: 0.912345 }, sHet: { postMean: 0.23456 },
    })), 'Loss of Function Constraint')
    expect(scoresOnly.find('ListItem').map(item => clean(item.text()))).toEqual([
      'This gene has a Shet score of 0.2346 Zeng (2023)',
      'This gene has a haploinsufficiency (HI) score of 0.9123 Collins (2022)',
    ])
  })

  test('the triplosensitivity detail gives the score and threshold', () => {
    const { wrapper } = mountGene(makeGene(1, { cnSensitivity: { pts: 0.98765 } }))
    const detail = clean(
      wrapper.find('Popup').filterWhere(node => node.prop('header') === 'TriploSensitive').first().prop('content'),
    )
    expect(detail).toContain('Scores >0.94 are considered to have high likelihood to be triplosensitive')
    expect(detail).toContain('This gene has a score of 0.9877.')
  })
})

describe('disease labels', () => {
  test('OMIM phenotypes are listed in full next to the gene with links to OMIM', () => {
    const { wrapper } = mountGene(makeGene(1, { omimPhenotypes: OMIM_PHENOTYPES }))
    expect(getLabels(wrapper)).toEqual([])
    const omim = wrapper.find('SegmentGroup')
    expect(omim.find('Label').prop('content')).toEqual('OMIM')
    expect(omim.find('ListItem').map(item => [item.text(), item.prop('href')])).toEqual([
      ['Leigh syndrome (Autosomal recessive)', 'https://www.omim.org/entry/256000'],
      ['Cardiomyopathy, dilated', 'https://www.omim.org/entry/115200'],
    ])
  })

  test('OMIM is collapsed to an IN OMIM label when expansion is turned off', () => {
    const mounted = mountGene(makeGene(1, { omimPhenotypes: OMIM_PHENOTYPES }), { noExpand: true })
    expect(mounted.wrapper.find('SegmentGroup')).toHaveLength(0)
    expect(getLabels(mounted.wrapper)).toEqual(['IN OMIM'])
    expect(getLabel(mounted.wrapper, 'IN OMIM').prop('color')).toEqual('orange')
    expect(getDetail(mounted, 'Disease Phenotypes').find('ListItem').map(item => item.text())).toEqual([
      'Leigh syndrome (Autosomal recessive)', 'Cardiomyopathy, dilated',
    ])
  })

  test('a gene without OMIM phenotypes has no OMIM section', () => {
    const { wrapper } = mountGene(GENE, { noExpand: true })
    expect(wrapper.find('SegmentGroup')).toHaveLength(0)
    expect(getLabels(wrapper)).toEqual([])
  })

  test('GenCC classifications are listed newest first and link to the GenCC gene page', () => {
    const mounted = mountGene(makeGene(1, {
      genCc: {
        hgncId: 'HGNC:1100',
        classifications: [
          { classification: 'Limited', disease: 'Ovarian cancer', moi: 'Autosomal dominant', date: '2019-03-01', submitter: 'Orphanet' },
          { classification: 'Definitive', disease: 'Fanconi anemia', moi: 'Autosomal recessive', date: '2022-06-12', submitter: 'ClinGen' },
        ],
      },
    }))
    expect(getLabels(mounted.wrapper)).toEqual(['GENCC'])
    expect(getLabel(mounted.wrapper, 'GENCC').prop('color')).toEqual('violet')
    const detail = getDetail(mounted, 'GenCC')
    expect(textOf(detail)).toEqual(
      'Definitive ClinGen (2022): Fanconi anemia (Autosomal recessive) ' +
      'Limited Orphanet (2019): Ovarian cancer (Autosomal dominant)',
    )
    expect(detail.find('a').first().prop('href')).toEqual('https://search.thegencc.org/genes/HGNC:1100')
  })

  test('a gene with an empty GenCC record has no GenCC label', () => {
    expect(getLabels(mountGene(makeGene(1, { genCc: {} })).wrapper)).toEqual([])
  })

  test('ClinGen dosage sensitivity shows the curated haploinsufficiency and triplosensitivity', () => {
    const href = 'https://dosage.clinicalgenome.org/clingen_gene.cgi?sym=GENE1'
    const mounted = mountGene(makeGene(1, {
      clinGen: { haploinsufficiency: 'Sufficient Evidence', triplosensitivity: 'No Evidence', href },
    }))
    expect(getLabels(mounted.wrapper)).toEqual(['ClinGen'])
    expect(getLabel(mounted.wrapper, 'ClinGen').prop('color')).toEqual('purple')
    const detail = getDetail(mounted, 'ClinGen Dosage Sensitivity')
    expect(detail.find('TableRow').map(row => [
      row.find('Label').prop('content'), row.find('Label').prop('color'), row.find('a').text(), row.find('a').prop('href'),
    ])).toEqual([
      ['Sufficient Evidence', 'green', 'Haploinsufficiency', href],
      ['No Evidence', 'grey', 'Triplosensitivity', href],
    ])

    const hiOnly = getDetail(mountGene(makeGene(1, {
      clinGen: { haploinsufficiency: 'Little Evidence', href },
    })), 'ClinGen Dosage Sensitivity')
    expect(hiOnly.find('TableRow').map(row => row.find('a').text())).toEqual(['Haploinsufficiency'])
  })
})

describe('gene list labels', () => {
  const geneWithLists = makeGene(1, {
    locusListGuids: ['LL_plain', 'LL_pa_amber', 'LL_other', 'LL_pa_green'],
    panelAppDetail: {
      LL_pa_green: { confidence: '3', moi: 'BIALLELIC, autosomal or pseudoautosomal' },
      LL_pa_amber: {
        confidence: '2',
        moi: 'BOTH monoallelic and biallelic, autosomal or pseudoautosomal',
      },
    },
  })

  test('each gene list has a label, PanelApp lists first by confidence then others by name', () => {
    const { wrapper } = mountGene(geneWithLists)
    expect(getLabels(wrapper)).toEqual([
      'Mitochondrial disease', 'Intellectual disability', 'Ataxia genes', 'Zebrafish candidates',
    ])
  })

  test('PanelApp lists are coloured by confidence and show the mode of inheritance initials', () => {
    const { wrapper } = mountGene(geneWithLists)
    expect(wrapper.find('GeneLabelContent').map(
      node => [node.prop('label'), node.prop('customColor') || node.prop('color'), node.prop('detail')],
    )).toEqual([
      ['Mitochondrial disease', '#21a926', 'AR'],
      ['Intellectual disability', '#f5d55c', 'AD, AR'],
      ['Ataxia genes', 'teal', false],
      ['Zebrafish candidates', 'teal', false],
    ])
  })

  test('the PanelApp hover links to the gene in the panel and explains confidence and inheritance', () => {
    const detail = getDetail(mountGene(geneWithLists), 'Mitochondrial disease')
    expect(detail.find('a').prop('href')).toEqual('https://panelapp-aus.org/panels/203/gene/GENE1')
    expect(textOf(detail)).toEqual(
      'PanelApp_AU_203_0.850 PanelApp gene confidence: Green, highest level of confidence; a gene from 3 or 4 sources. ' +
      'PanelApp mode of inheritance: AR BIALLELIC, autosomal or pseudoautosomal',
    )

    const ukDetail = getDetail(mountGene(geneWithLists), 'Intellectual disability')
    expect(ukDetail.find('a').prop('href')).toEqual('https://panelapp.genomicsengland.co.uk/panels/285/gene/GENE1')
    expect(clean(ukDetail.text())).toContain('Amber, intermediate; a gene from 2 sources')
  })

  test('a PanelApp list without details for the gene is labelled like any other gene list', () => {
    const { wrapper } = mountGene(makeGene(1, { locusListGuids: ['LL_pa_green'] }))
    expect(wrapper.find('GeneLabelContent').map(
      node => [node.prop('label'), node.prop('customColor') || node.prop('color'), node.prop('detail')],
    )).toEqual([['Mitochondrial disease', 'teal', false]])
  })

  test('a PanelApp gene with an unrecognised mode of inheritance shows no initials', () => {
    const { wrapper } = mountGene(makeGene(1, {
      locusListGuids: ['LL_pa_green'], panelAppDetail: { LL_pa_green: { confidence: '1', moi: 'Other' } },
    }))
    expect(wrapper.find('GeneLabelContent').map(
      node => [node.prop('label'), node.prop('customColor'), node.prop('detail')],
    )).toEqual([['Mitochondrial disease', '#eaa8a8', null]])
  })

  test('a plain gene list shows its description on hover', () => {
    const { wrapper } = mountGene(geneWithLists)
    const popup = wrapper.find('Popup').filterWhere(node => node.prop('header') === 'Zebrafish candidates').first()
    expect(popup.prop('content')).toEqual('Candidate genes from the lab')
  })

  test('gene lists are left out when hidden or when the gene is in none', () => {
    expect(getLabels(mountGene(geneWithLists, { hideLocusLists: true }).wrapper)).toEqual([])
    expect(getLabels(mountGene(makeGene(1, { locusListGuids: undefined })).wrapper)).toEqual([])
  })

  test('the compact gene details name the gene lists in one section', () => {
    const props = { gene: { ...geneWithLists, omimPhenotypes: OMIM_PHENOTYPES } }
    const { wrapper } = mountWithStore(
      <GeneDetails {...props} compact showLocusLists />,
      makeState([geneWithLists]),
    )
    expect(wrapper.find('Label').map(label => label.prop('content'))).toEqual([
      'Gene Lists:', 'OMIM Disease Phenotypes:',
    ])
    expect(wrapper.find('List').first().prop('items')).toEqual([
      'Mitochondrial disease', 'Intellectual disability', 'Ataxia genes', 'Zebrafish candidates',
    ])
  })
})

describe('RNA-seq and phenotype prioritisation labels', () => {
  const outlier = values => ({ isSignificant: true, zScore: -4.9812, pValue: 0.000012345, pAdjust: 0.0412, ...values })

  test('a gene with a significant expression outlier in the family is labelled with the sample details', () => {
    const mounted = mountGene(GENE, {}, {
      rnaSeqDataByIndividual: {
        I1: { outliers: { [GENE_ID]: [outlier()], ENSG00000000009: [outlier()] } },
        I2: { outliers: { [GENE_ID]: [outlier({ zScore: 3.2, pValue: 0.0031, pAdjust: 0.049 })] } },
      },
    })
    expect(getLabels(mounted.wrapper)).toEqual(['RNA expression'])
    expect(getLabel(mounted.wrapper, 'RNA expression').prop('color')).toEqual('pink')
    const detail = getDetail(mounted, 'RNA-Seq Expression Outlier')
    expect(detail.text()).toContain('This gene is flagged as an outlier for RNA-Seq in the following samples')
    expect(detail.find('th').map(cell => cell.text())).toEqual(['', 'Z-Score', 'P-Value', 'P-Adjust'])
    expect(detail.find('tbody tr').map(row => row.find('td').map(cell => cell.text()))).toEqual([
      ['NA19675', '-4.98', '0.0000123', '0.0412'],
      ['NA19678', '3.20', '0.00310', '0.0490'],
    ])
  })

  test('outliers in another gene or another family do not label the gene', () => {
    const { wrapper } = mountGene(GENE, {}, {
      rnaSeqDataByIndividual: {
        I1: { outliers: { ENSG00000000009: [outlier()] } },
        I3: { outliers: { [GENE_ID]: [outlier()] } },
      },
    })
    expect(getLabels(wrapper)).toEqual([])
  })

  test('a variant without a family has no RNA-seq label', () => {
    const { wrapper } = mountGene(GENE, { variant: { ...VARIANT, familyGuids: undefined } }, {
      rnaSeqDataByIndividual: { I1: { outliers: { [GENE_ID]: [outlier()] } } },
    })
    expect(getLabels(wrapper)).toEqual([])
  })

  test('each phenotype prioritisation tool that ranked the gene gets a label with its scores', () => {
    const mounted = mountGene(GENE, {}, {
      phenotypeGeneScoresByIndividual: {
        I1: {
          [GENE_ID]: {
            lirical: [{ diseaseId: 'OMIM:256000', diseaseName: 'Leigh syndrome', rank: 2, scores: { postTestProbability: 0.81234, compositeLR: 12.3456 } }],
            exomiser: [{ diseaseId: 'OMIM:115200', diseaseName: 'Cardiomyopathy', rank: 7, scores: { exomiserScore: 0.9712 } }],
          },
        },
      },
    })
    expect(getLabels(mounted.wrapper)).toEqual(['LIRICAL', 'EXOMISER'])
    const detail = mountWithStore(<div>{getLabel(mounted.wrapper, 'LIRICAL').closest('Popup').prop('content')}</div>, mounted.state).wrapper
    expect(detail.find('tbody tr').map(row => row.find('td').map(cell => clean(cell.text())))).toEqual([
      ['NA19675', 'Leigh syndromeOMIM:256000', '2', 'Composite LR: 12.3Post Test Probability: 0.812'],
    ])
  })
})

describe('gene summary', () => {
  test('a gene missing from the loaded genes is shown by its ID with the variant consequence', () => {
    const { wrapper } = mountWithStore(<VariantGene geneId={GENE_ID} variant={VARIANT} />, makeState([]))
    expect(wrapper.find('Header').prop('content')).toEqual(GENE_ID)
    expect(wrapper.find('Header').prop('subheader')).toEqual('missense variant')
    expect(wrapper.find('ShowGeneModal')).toHaveLength(0)
  })

  test('the full display links to Decipher, saved variants and a gene search in the family', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => {})
    const { wrapper, store } = mountGene(GENE)
    expect(wrapper.find('ShowGeneModal').find('ButtonLink').text()).toEqual('GENE1')
    expect(wrapper.find('ShowGeneModal').prop('modalId')).toEqual('1-248367227-C-T')
    expect(wrapper.find('a').filterWhere(a => a.text() === 'Decipher').prop('href')).toEqual(
      `https://www.deciphergenomics.org/gene/${GENE_ID}/overview/protein-genomic-info`,
    )
    expect(wrapper.find('NavLink').prop('to')).toEqual(`/summary_data/saved_variants/ALL/${GENE_ID}`)

    const searchLink = wrapper.find('SearchResultsLink')
    expect(searchLink.text()).toEqual('Gene Search')
    searchLink.find('ButtonLink').simulate('click')
    await flushAll()
    const [{ updatesById: { searchesByHash } }] = store.getActions()
    const [[searchHash, search]] = Object.entries(searchesByHash)
    expect(search.projectFamilies).toEqual([{ familyGuids: [FAMILY_GUID] }])
    expect(search.search.locus).toEqual({ rawItems: GENE_ID })
    expect(search.search.qualityFilter).toEqual({ min_gq: 20, min_ab: 10 })
    expect(search.search.freqs.gnomad_genomes).toEqual({ af: 0.03 })
    expect(open).toHaveBeenCalledWith(`/variant_search/results/${searchHash}`, '_blank')
    open.mockRestore()
  })

  test('there is no gene search link for a variant without a family', () => {
    const { wrapper } = mountGene(GENE, { variant: { ...VARIANT, familyGuids: [] } })
    expect(wrapper.find('SearchResultsLink')).toHaveLength(0)
    expect(wrapper.find('a').filterWhere(a => a.text() === 'Decipher')).toHaveLength(1)
  })

  test('the compound het toggle is rendered for the gene', () => {
    const compoundHetToggle = jest.fn(geneId => <span id="toggle">{`toggle ${geneId}`}</span>)
    const { wrapper } = mountGene(GENE, { compoundHetToggle })
    expect(wrapper.find('#toggle').text()).toEqual(`toggle ${GENE_ID}`)
  })

  test('gene expression can be opened only for genes with TPM data in the family', () => {
    const tpmState = genes => ({ familiesByGuid: { [FAMILY_GUID]: { familyGuid: FAMILY_GUID, tpmGenes: genes } } })
    const withTpm = mountGene(GENE, {}, tpmState([GENE_ID])).wrapper
    expect(withTpm.find('Button').filterWhere(b => b.prop('content') === 'Show Gene Expression')).toHaveLength(1)
    expect(withTpm.findWhere(node => node.prop('title') === 'GENE1 Expression').first().prop('modalName'))
      .toEqual(`1-248367227-C-T-${GENE_ID}-tpm`)

    const otherGene = mountGene(GENE, {}, tpmState(['ENSG00000000009'])).wrapper
    expect(otherGene.find('Button').filterWhere(b => b.prop('content') === 'Show Gene Expression')).toHaveLength(0)
    expect(mountGene(GENE).wrapper.find('Button').filterWhere(b => b.prop('content') === 'Show Gene Expression'))
      .toHaveLength(0)
  })
})

describe('all genes of a variant', () => {
  const GENES = [1, 2, 3, 4, 5, 6, 7].map(n => makeGene(n))
  const transcriptsFor = (genes, consequences = {}) => genes.reduce((acc, gene, i) => ({
    ...acc,
    [gene.geneId]: [{ transcriptId: `ENST0000000000${i}`, majorConsequence: consequences[gene.geneId] || 'intron_variant' }],
  }), {})
  const mountGenes = (variant, props = {}, genes = GENES, stateOverrides = {}) => {
    const allProps = { ...props, variant: { variantId: 'var1', familyGuids: [FAMILY_GUID], ...variant } }
    return mountWithStore(<VariantGenes {...allProps} />, makeState(genes, stateOverrides))
  }
  const getSymbols = wrapper => wrapper.find('ShowGeneModal').map(node => node.prop('gene').geneSymbol)

  test('up to five genes are each shown with their consequence and labels, ordered by position', () => {
    const genes = [
      makeGene(3, { startGrch38: 100, omimPhenotypes: OMIM_PHENOTYPES }),
      makeGene(1, { startGrch38: 300, constraints: { ...GENE.constraints, louef: 0.2 } }),
      makeGene(2, { startGrch38: 200 }),
    ]
    const { wrapper } = mountGenes({
      transcripts: {
        ...transcriptsFor(genes, { ENSG00000000003: 'splice_donor_variant', ENSG00000000001: 'stop_gained' }),
        null: [{ transcriptId: 'ENST00000009999' }],
      },
    }, {}, genes)
    expect(getSymbols(wrapper)).toEqual(['GENE3', 'GENE2', 'GENE1'])
    expect(wrapper.find('ShowGeneModal').map(node => textOf(node.parents('div').first()))).toEqual([
      'GENE3 splice donor variant OMIM Leigh syndrome (Autosomal recessive) Cardiomyopathy, dilated',
      'GENE2 intron variant',
      'GENE1 stop gained LOF CONSTR',
    ])
    expect(wrapper.find('SearchResultsLink').last().prop('location')).toEqual(
      'ENSG00000000003,ENSG00000000001,ENSG00000000002',
    )
  })

  test('with a main gene, the other genes are listed with their details in a hover', () => {
    const genes = [makeGene(1), makeGene(2, { omimPhenotypes: OMIM_PHENOTYPES, locusListGuids: ['LL_plain'] })]
    const mounted = mountGenes({ transcripts: transcriptsFor(genes) }, { mainGeneId: GENE_ID }, genes)
    expect(getSymbols(mounted.wrapper)).toEqual(['GENE2'])
    expect(getLabels(mounted.wrapper)).toEqual([])
    expect(mounted.wrapper.find('SearchResultsLink')).toHaveLength(0)

    const details = getDetail(mounted, 'Gene Details')
    expect(details.find('Label').map(label => label.prop('content'))).toEqual([
      'Gene Lists:', 'OMIM Disease Phenotypes:',
    ])
    expect(details.find('List').first().prop('items')).toEqual(['Zebrafish candidates'])
  })

  test('the main gene is included when asked for', () => {
    const genes = [makeGene(1), makeGene(2)]
    const { wrapper } = mountGenes(
      { transcripts: transcriptsFor(genes) }, { mainGeneId: GENE_ID, showMainGene: true }, genes,
    )
    expect(getSymbols(wrapper)).toEqual(['GENE1', 'GENE2'])
  })

  test('a variant without transcripts shows no genes and no search link', () => {
    const { wrapper } = mountGenes({})
    expect(getSymbols(wrapper)).toEqual([])
    expect(wrapper.find('SearchResultsLink')).toHaveLength(0)
  })

  test('six or more genes are collapsed to a count with the distinct consequences', () => {
    const genes = GENES.slice(0, 6)
    const { wrapper } = mountGenes({
      transcripts: transcriptsFor(genes, { ENSG00000000002: 'copy_gain', ENSG00000000005: 'copy_gain', ENSG00000000004: 'lof' }),
    })
    expect(getSymbols(wrapper)).toEqual([])
    expect(clean(wrapper.find('ButtonLink').first().text())).toEqual('6 Genes')
    expect(wrapper.text()).toContain('intron variant, copy gain, lof')
    expect(wrapper.find('SearchResultsLink').prop('location')).toEqual(genes.map(({ geneId }) => geneId).join(','))
    expect(wrapper.find('SearchResultsLink').prop('familyGuids')).toEqual([FAMILY_GUID])
  })

  test('five genes are not collapsed', () => {
    const genes = GENES.slice(0, 5)
    const { wrapper } = mountGenes({ transcripts: transcriptsFor(genes) })
    expect(getSymbols(wrapper)).toEqual(['GENE1', 'GENE2', 'GENE3', 'GENE4', 'GENE5'])
  })

  test('the collapsed summary labels which of the spanned genes are constrained or disease associated', () => {
    const genes = [
      makeGene(1, { omimPhenotypes: OMIM_PHENOTYPES }),
      makeGene(2, { constraints: { ...GENE.constraints, louef: 0.11, louefRank: 40 } }),
      makeGene(3),
      makeGene(4, { cnSensitivity: { pts: 0.99 }, constraints: { ...GENE.constraints, louef: 0.3, louefRank: 900 } }),
      makeGene(5),
      makeGene(6),
    ]
    const mounted = mountGenes({ transcripts: transcriptsFor(genes) }, {}, genes)
    expect(getLabels(mounted.wrapper)).toEqual(['IN OMIM', 'LOF CONSTR', 'TS'])

    const lof = getDetail(mounted, 'Loss of Function Constraint')
    expect(lof.find('Header').map(header => header.prop('content'))).toEqual(['GENE2', 'GENE4'])
    expect(clean(lof.text())).toContain('This gene ranks as 40 most intolerant of LoF mutations')
    const omim = getDetail(mounted, 'Disease Phenotypes')
    expect(omim.find('Header').map(header => header.prop('content'))).toEqual(['GENE1'])
    expect(getDetail(mounted, 'TriploSensitive').find('Header').map(header => header.prop('content'))).toEqual(['GENE4'])
  })

  test('the collapsed summary has no labels when a main gene is shown elsewhere', () => {
    const genes = GENES.slice(0, 6).map(gene => ({ ...gene, omimPhenotypes: OMIM_PHENOTYPES }))
    const { wrapper } = mountGenes({ transcripts: transcriptsFor(genes) }, { mainGeneId: GENE_ID }, genes)
    expect(clean(wrapper.find('ButtonLink').first().text())).toEqual('6 Genes')
    expect(getLabels(wrapper)).toEqual([])
    expect(wrapper.find('SearchResultsLink')).toHaveLength(0)
  })

  test('clicking the gene count lists every gene', () => {
    const { wrapper } = mountGenes({ transcripts: transcriptsFor(GENES) })
    expect(clean(wrapper.find('ButtonLink').first().text())).toEqual('7 Genes')
    wrapper.find('ButtonLink').first().simulate('click')
    expect(getSymbols(wrapper)).toEqual(['GENE1', 'GENE2', 'GENE3', 'GENE4', 'GENE5', 'GENE6', 'GENE7'])
  })

  test('RNA-seq outliers label the affected gene in the per-gene list', () => {
    const genes = GENES.slice(0, 2)
    const { wrapper } = mountGenes({ transcripts: transcriptsFor(genes) }, {}, genes, {
      rnaSeqDataByIndividual: {
        I1: { outliers: { ENSG00000000002: [{ isSignificant: true, zScore: 5, pValue: 0.001, pAdjust: 0.01 }] } },
      },
    })
    expect(wrapper.find('ShowGeneModal').map(node => textOf(node.parents('div').first()))).toEqual([
      'GENE1 intron variant',
      'GENE2 intron variant RNA expression',
    ])
  })
})
