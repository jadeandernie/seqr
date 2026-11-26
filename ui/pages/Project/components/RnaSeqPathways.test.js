import React from 'react'
import { mount, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'

import { mockFetchResponse, mockFetchRejection, flushAll, getLastFetchUrl } from 'shared/utils/testHelpers'
import RnaSeqPathways, { sortPathways } from './RnaSeqPathways'

configure({ adapter: new Adapter() })

const INDIVIDUAL_GUID = 'I021476_na19678_1'

const MANNOSE_PATHWAY = {
  pathwayId: 'R-HSA-162699',
  name: 'Synthesis of dolichyl-phosphate mannose',
  numGenes: 4,
  numMeasured: 3,
  numOutliers: 2,
  outlierGeneIds: ['ENSG00000228198', 'ENSG00000999999'],
  measuredGeneIds: ['ENSG00000164458', 'ENSG00000228198', 'ENSG00000999999'],
  medianZScore: 7.08,
}
const NEUTROPHIL_PATHWAY = {
  pathwayId: 'R-HSA-6798695',
  name: 'Neutrophil degranulation',
  numGenes: 480,
  numMeasured: 1,
  numOutliers: 1,
  outlierGeneIds: ['ENSG00000228198'],
  measuredGeneIds: ['ENSG00000228198'],
  medianZScore: 7.31,
}
const RHOA_PATHWAY = {
  pathwayId: 'R-HSA-8980692',
  name: 'RHOA GTPase cycle',
  numGenes: 150,
  numMeasured: 2,
  numOutliers: 1,
  outlierGeneIds: ['ENSG00000228198'],
  measuredGeneIds: ['ENSG00000164458', 'ENSG00000228198'],
  medianZScore: -1.5,
}
const PATHWAYS = [MANNOSE_PATHWAY, NEUTROPHIL_PATHWAY, RHOA_PATHWAY]

const GENES_BY_ID = { ENSG00000228198: { geneSymbol: 'OR2M3' }, ENSG00000164458: { geneSymbol: 'TBXT' } }

const pathwayResponse = (pathwaysBySampleType, hasReferenceData = true) => (
  { rnaSeqPathways: { [INDIVIDUAL_GUID]: { hasReferenceData, pathwaysBySampleType } } }
)

const mountPathways = async (response, props) => {
  mockFetchResponse(response)
  const onSelect = jest.fn()
  const wrapper = mount(
    <RnaSeqPathways
      individualGuid={INDIVIDUAL_GUID}
      sampleType="M-T"
      genesById={GENES_BY_ID}
      onSelect={onSelect}
      {...props}
    />,
  )
  await flushAll()
  wrapper.update()
  return { wrapper, onSelect }
}

const getRows = wrapper => wrapper.find('TableBody').find('TableRow').map(
  row => row.find('TableCell').map(cell => cell.text()),
)

const getPathwayNames = wrapper => getRows(wrapper).map(row => row[0])

const clickHeader = (wrapper, content) => {
  wrapper.find('TableHeaderCell').filterWhere(cell => cell.prop('content') === content).simulate('click')
  wrapper.update()
}

test('loads and shows the pathways for the selected sample type in the order returned by the server', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'M-T': PATHWAYS, 'F-W': [RHOA_PATHWAY] }))

  expect(getLastFetchUrl()).toEqual(`/api/individual/${INDIVIDUAL_GUID}/rna_seq_pathways?`)
  expect(wrapper.find('Header').first().prop('content')).toEqual('Pathways')
  expect(wrapper.find('TableHeaderCell').map(cell => cell.text())).toEqual(
    ['Pathway', 'Outlier Genes', 'Measured Genes', 'Pathway Size', 'Median Z-Score'],
  )
  expect(getRows(wrapper)).toEqual([
    ['Synthesis of dolichyl-phosphate mannose', '2', '3', '4', '7.08'],
    ['Neutrophil degranulation', '1', '1', '480', '7.31'],
    ['RHOA GTPase cycle', '1', '2', '150', '-1.50'],
  ])
  expect(wrapper.find('TableHeaderCell').map(cell => cell.prop('sorted'))).toEqual([null, null, null, null, null])
  expect(wrapper.text()).toContain('not an enrichment test')

  const link = wrapper.find('TableBody').find('a').first()
  expect(link.prop('href')).toEqual('https://reactome.org/content/detail/R-HSA-162699')
  expect(link.prop('target')).toEqual('_blank')

  wrapper.setProps({ sampleType: 'F-W' })
  wrapper.update()
  expect(getPathwayNames(wrapper)).toEqual(['RHOA GTPase cycle'])
})

test('sorts by a clicked column and reverses the order when it is clicked again', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'M-T': PATHWAYS }))

  clickHeader(wrapper, 'Pathway')
  expect(getPathwayNames(wrapper)).toEqual(
    ['Neutrophil degranulation', 'RHOA GTPase cycle', 'Synthesis of dolichyl-phosphate mannose'],
  )
  expect(wrapper.find('TableHeaderCell').first().prop('sorted')).toEqual('ascending')

  clickHeader(wrapper, 'Pathway')
  expect(getPathwayNames(wrapper)).toEqual(
    ['Synthesis of dolichyl-phosphate mannose', 'RHOA GTPase cycle', 'Neutrophil degranulation'],
  )
  expect(wrapper.find('TableHeaderCell').first().prop('sorted')).toEqual('descending')

  clickHeader(wrapper, 'Pathway')
  expect(wrapper.find('TableHeaderCell').first().prop('sorted')).toEqual('ascending')

  clickHeader(wrapper, 'Pathway Size')
  expect(getRows(wrapper).map(row => row[3])).toEqual(['480', '150', '4'])
  expect(wrapper.find('TableHeaderCell').map(cell => cell.prop('sorted'))).toEqual(
    [null, null, null, 'descending', null],
  )

  clickHeader(wrapper, 'Median Z-Score')
  expect(getRows(wrapper).map(row => row[4])).toEqual(['7.31', '7.08', '-1.50'])

  clickHeader(wrapper, 'Median Z-Score')
  expect(getRows(wrapper).map(row => row[4])).toEqual(['-1.50', '7.08', '7.31'])

  clickHeader(wrapper, 'Measured Genes')
  expect(getRows(wrapper).map(row => row[2])).toEqual(['3', '2', '1'])

  clickHeader(wrapper, 'Outlier Genes')
  expect(getRows(wrapper).map(row => row[1])).toEqual(['2', '1', '1'])
})

test('sortPathways leaves the input order untouched', () => {
  const sorted = sortPathways(PATHWAYS, 'numGenes', 'ascending')
  expect(sorted.map(({ numGenes }) => numGenes)).toEqual([4, 150, 480])
  expect(PATHWAYS.map(({ numGenes }) => numGenes)).toEqual([4, 480, 150])
  expect(sortPathways(PATHWAYS, null, 'descending')).toBe(PATHWAYS)
})

test('selects a pathway when its row is clicked', async () => {
  const { wrapper, onSelect } = await mountPathways(pathwayResponse({ 'M-T': PATHWAYS }))

  expect(wrapper.find('TableBody').find('TableRow').map(row => row.prop('active'))).toEqual([false, false, false])
  expect(wrapper.find('Button').exists()).toBe(false)

  wrapper.find('TableBody').find('TableRow').at(2).simulate('click')
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(RHOA_PATHWAY)
})

test('shows the outlier genes of the selected pathway and clears the selection', async () => {
  const { wrapper, onSelect } = await mountPathways(
    pathwayResponse({ 'M-T': PATHWAYS }), { selectedPathway: MANNOSE_PATHWAY },
  )

  expect(wrapper.find('TableBody').find('TableRow').map(row => row.prop('active'))).toEqual([true, false, false])
  const selection = wrapper.find('Message').first()
  expect(selection.find('MessageHeader').text()).toEqual('Synthesis of dolichyl-phosphate mannose')
  // Genes are shown by symbol, falling back to the gene id for a gene that is not loaded
  expect(selection.text()).toContain('Outlier genes: OR2M3, ENSG00000999999')
  expect(selection.text()).toContain('The 3 measured genes in this pathway are highlighted in the expression outlier plot.')

  wrapper.find('Button').simulate('click')
  expect(onSelect).toHaveBeenLastCalledWith(null)

  wrapper.find('TableBody').find('TableRow').at(0).simulate('click')
  expect(onSelect).toHaveBeenCalledTimes(2)
  expect(onSelect).toHaveBeenLastCalledWith(null)

  wrapper.find('TableBody').find('TableRow').at(1).simulate('click')
  expect(onSelect).toHaveBeenLastCalledWith(NEUTROPHIL_PATHWAY)
})

test('explains when the sample has no expression outlier data', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'F-W': PATHWAYS }, false))

  expect(wrapper.find('Table').exists()).toBe(false)
  expect(wrapper.find('Message').text()).toEqual('No expression outlier data is available for this sample.')
})

test('explains when the individual is missing from the response', async () => {
  const { wrapper } = await mountPathways({})

  expect(wrapper.find('Table').exists()).toBe(false)
  expect(wrapper.find('Message').text()).toEqual('No expression outlier data is available for this sample.')
})

test('explains when the pathway reference data is not loaded', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'M-T': [] }, false))

  expect(wrapper.find('Table').exists()).toBe(false)
  expect(wrapper.find('Message').text()).toEqual(
    'Reactome pathway reference data has not been loaded in this seqr installation.',
  )
})

test('explains when no outlier is in a pathway', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'M-T': [] }))

  expect(wrapper.find('Table').exists()).toBe(false)
  expect(wrapper.find('Message').text()).toEqual(
    'None of the significant expression outliers for this sample are in a Reactome pathway.',
  )
})

test('shows an error when the request fails', async () => {
  mockFetchRejection(new Error('pathway request failed'))
  const wrapper = mount(
    <RnaSeqPathways individualGuid={INDIVIDUAL_GUID} sampleType="M-T" genesById={GENES_BY_ID} onSelect={jest.fn()} />,
  )
  await flushAll()
  wrapper.update()

  expect(wrapper.find('Table').exists()).toBe(false)
  expect(wrapper.find('Message').prop('header')).toEqual('Unable to load pathways')
  expect(wrapper.find('Message').prop('content')).toEqual('pathway request failed')
})

test('reloads the pathways when the individual changes', async () => {
  const { wrapper } = await mountPathways(pathwayResponse({ 'M-T': PATHWAYS }))
  expect(getPathwayNames(wrapper)).toHaveLength(3)

  mockFetchResponse({ rnaSeqPathways: { I021474_na19679_1: { hasReferenceData: true, pathwaysBySampleType: { 'M-T': [RHOA_PATHWAY] } } } })
  wrapper.setProps({ individualGuid: 'I021474_na19679_1' })
  await flushAll()
  wrapper.update()

  expect(getLastFetchUrl()).toEqual('/api/individual/I021474_na19679_1/rna_seq_pathways?')
  expect(getPathwayNames(wrapper)).toEqual(['RHOA GTPase cycle'])
})
