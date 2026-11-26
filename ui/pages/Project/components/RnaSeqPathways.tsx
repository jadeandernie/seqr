import React from 'react'
import { Button, Header, Message, Segment, Table } from 'semantic-ui-react'

import StateDataLoader from '../../../shared/components/StateDataLoader'

export type RnaSeqPathway = {
  pathwayId: string
  name: string
  numGenes: number
  numMeasured: number
  numOutliers: number
  outlierGeneIds: string[]
  measuredGeneIds: string[]
  medianZScore: number
}

type PathwayData = {
  hasReferenceData: boolean
  pathwaysBySampleType: Record<string, RnaSeqPathway[]>
}

type PathwayResponse = {
  rnaSeqPathways?: Record<string, PathwayData>
}

type GenesById = Record<string, { geneSymbol?: string }>

type SortDirection = 'ascending' | 'descending'

type SortColumn = 'name' | 'numOutliers' | 'numMeasured' | 'numGenes' | 'medianZScore'

type PanelProps = {
  sampleType: string
  genesById: GenesById
  selectedPathway?: RnaSeqPathway | null
  onSelect: (pathway: RnaSeqPathway | null) => void
}

type TableProps = PanelProps & { pathwayData?: PathwayData }

type Props = PanelProps & { individualGuid: string }

const REACTOME_URL = 'https://reactome.org/content/detail/'

const COLUMNS: { name: SortColumn, content: string, defaultDirection: SortDirection }[] = [
  { name: 'name', content: 'Pathway', defaultDirection: 'ascending' },
  { name: 'numOutliers', content: 'Outlier Genes', defaultDirection: 'descending' },
  { name: 'numMeasured', content: 'Measured Genes', defaultDirection: 'descending' },
  { name: 'numGenes', content: 'Pathway Size', defaultDirection: 'descending' },
  { name: 'medianZScore', content: 'Median Z-Score', defaultDirection: 'descending' },
]

const TABLE_CONTAINER_STYLE = { maxHeight: '400px', overflowY: 'auto' as const }

const comparePathways = (column: SortColumn) => (a: RnaSeqPathway, b: RnaSeqPathway): number => (
  column === 'name' ? a.name.localeCompare(b.name) : a[column] - b[column]
)

export const sortPathways = (
  pathways: RnaSeqPathway[], column: SortColumn | null, direction: SortDirection,
): RnaSeqPathway[] => {
  if (!column) {
    return pathways
  }
  const sorted = [...pathways].sort(comparePathways(column))
  return direction === 'descending' ? sorted.reverse() : sorted
}

const getEmptyMessage = (pathwayData?: PathwayData, pathways?: RnaSeqPathway[]): string | null => {
  if (!pathways) {
    return 'No expression outlier data is available for this sample.'
  }
  if (!pathwayData.hasReferenceData) {
    return 'Reactome pathway reference data has not been loaded in this seqr installation.'
  }
  if (!pathways.length) {
    return 'None of the significant expression outliers for this sample are in a Reactome pathway.'
  }
  return null
}

export const RnaSeqPathwayTable = ({ pathwayData, sampleType, genesById, selectedPathway, onSelect }: TableProps) => {
  const [sort, setSort] = React.useState<{ column: SortColumn | null, direction: SortDirection }>(
    { column: null, direction: 'descending' },
  )

  const pathways = pathwayData?.pathwaysBySampleType[sampleType]
  const emptyMessage = getEmptyMessage(pathwayData, pathways)
  if (emptyMessage) {
    return <Message content={emptyMessage} />
  }

  const selectedPathwayId = selectedPathway?.pathwayId
  const sortedPathways = sortPathways(pathways, sort.column, sort.direction)

  const onSort = (column: SortColumn, defaultDirection: SortDirection) => () => {
    const toggled = sort.direction === 'ascending' ? 'descending' : 'ascending'
    setSort({ column, direction: sort.column === column ? toggled : defaultDirection })
  }

  return (
    <div>
      <p>
        Reactome pathways containing at least one significant expression outlier for this sample. Measured genes are
        the pathway genes with any expression outlier result for this sample. These are descriptive counts, not an
        enrichment test.
      </p>
      {selectedPathway && (
        <Message info>
          <Message.Header>{selectedPathway.name}</Message.Header>
          <p>
            {`Outlier genes: ${selectedPathway.outlierGeneIds.map(geneId => genesById[geneId]?.geneSymbol || geneId).join(', ')}`}
          </p>
          <p>
            {`The ${selectedPathway.numMeasured} measured genes in this pathway are highlighted in the expression outlier plot.`}
          </p>
          <Button size="small" content="Clear selection" onClick={() => onSelect(null)} />
        </Message>
      )}
      <div style={TABLE_CONTAINER_STYLE}>
        <Table sortable selectable compact>
          <Table.Header>
            <Table.Row>
              {COLUMNS.map(({ name, content, defaultDirection }) => (
                <Table.HeaderCell
                  key={name}
                  content={content}
                  sorted={sort.column === name ? sort.direction : null}
                  onClick={onSort(name, defaultDirection)}
                />
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sortedPathways.map(pathway => (
              <Table.Row
                key={pathway.pathwayId}
                active={pathway.pathwayId === selectedPathwayId}
                onClick={() => onSelect(pathway.pathwayId === selectedPathwayId ? null : pathway)}
              >
                <Table.Cell>
                  <a href={`${REACTOME_URL}${pathway.pathwayId}`} target="_blank" rel="noreferrer">{pathway.name}</a>
                </Table.Cell>
                <Table.Cell content={pathway.numOutliers} />
                <Table.Cell content={pathway.numMeasured} />
                <Table.Cell content={pathway.numGenes} />
                <Table.Cell content={pathway.medianZScore.toFixed(2)} />
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </div>
  )
}

const RnaSeqPathways = ({ individualGuid, ...props }: Props) => {
  const parseResponse = React.useCallback(
    (responseJson: PathwayResponse) => ({ pathwayData: (responseJson.rnaSeqPathways || {})[individualGuid] }),
    [individualGuid],
  )
  return (
    <Segment basic>
      <Header content="Pathways" textAlign="center" />
      <StateDataLoader
        url={`/api/individual/${individualGuid}/rna_seq_pathways`}
        childComponent={RnaSeqPathwayTable}
        parseResponse={parseResponse}
        errorHeader="Unable to load pathways"
        {...props}
      />
    </Segment>
  )
}

export default RnaSeqPathways
