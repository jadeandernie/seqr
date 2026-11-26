import React, { useCallback, useEffect, useState } from 'react'
import { connect } from 'react-redux'
import {
  Button, Header, Loader, Message, Segment, Statistic, Table,
} from 'semantic-ui-react'
import styled from 'styled-components'

import { getCellKey, loadGroupSummary } from './reducers'
import {
  getCellGroupSummary, getFamiliesByGuid, getGenesById, getGroupSummaryIsLoading,
} from './selectors'
import { HPO_CATEGORY_NAMES, SearchResultsLink } from './sharedComponents'
import {
  ByGuid, GeneRecurrence, GroupSummaryState, NamedEntity, PhenotypeCount, TargetDisplay, Workbook,
  WorkbookReduxState, WorksheetQuery,
} from './types'

const DESCRIPTIVE_NOTE = 'These counts are descriptive. They are not statistical tests and do not show whether a ' +
  'pattern is more common than expected by chance, and small groups are easy to over-read. Phenotypes are the HPO ' +
  'terms recorded for affected individuals: notes and other free text are not used.'

const VARIANT_LIST_NOTE = 'The variant list can not be filtered to a gene or to families, so it shows all the ' +
  'results of the group. The search opens in a new tab and is restricted to this gene in these families.'

const UNCATEGORIZED = 'Terms without a category'

const Section = styled.div`
  margin-top: 2em;
`

const ProportionBar = styled.progress`
  width: 8em;
  margin-right: 0.5em;
  vertical-align: middle;
`

const Note = styled.p`
  color: #555;
`

interface SummaryTableProps {
  label: string
  headers: string[]
  emptyContent: string
  shown: number
  total: number
  children: React.ReactNode
}

const SummaryTable = ({ label, headers, emptyContent, shown, total, children }: SummaryTableProps) => (
  <div>
    <Table compact="very" basic="very" aria-label={label}>
      <Table.Header>
        <Table.Row>{headers.map(header => <Table.HeaderCell key={header} content={header} />)}</Table.Row>
      </Table.Header>
      <Table.Body>
        {shown > 0 ? children : (
          <Table.Row><Table.Cell colSpan={headers.length} content={emptyContent} /></Table.Row>
        )}
      </Table.Body>
    </Table>
    {total > shown && <Note>{`Showing the ${shown} with the most families of ${total}`}</Note>}
  </div>
)

interface GeneRowProps {
  gene: GeneRecurrence
  symbol: string
  numFamilies: number
  selected: boolean
  onSelect: (geneId: string) => void
}

const GeneRow = ({ gene, symbol, numFamilies, selected, onSelect }: GeneRowProps) => {
  const select = useCallback(() => onSelect(gene.geneId), [onSelect, gene.geneId])
  return (
    <Table.Row active={selected}>
      <Table.Cell>
        <Button
          toggle
          compact
          size="tiny"
          content={symbol}
          active={selected}
          aria-label={`Restrict the phenotype counts to ${symbol}`}
          onClick={select}
        />
      </Table.Cell>
      <Table.Cell content={`${gene.numFamilies} of ${numFamilies}`} />
      <Table.Cell content={gene.numVariants} />
    </Table.Row>
  )
}

interface PhenotypeTableProps {
  label: string
  rows: PhenotypeCount[]
  total: number
  resultsHeader: string
  getName: (row: PhenotypeCount) => string
}

const PhenotypeTable = ({ label, rows, total, resultsHeader, getName }: PhenotypeTableProps) => (
  <SummaryTable
    label={label}
    headers={[label, 'Families with the phenotype', resultsHeader]}
    emptyContent="No HPO terms are recorded for the affected individuals of this group"
    shown={rows.length}
    total={total}
  >
    {rows.map((row) => {
      const proportion = `${row.numFamiliesWithResults} of ${row.numFamilies}`
      const percent = Math.round((100 * row.numFamiliesWithResults) / row.numFamilies)
      const name = getName(row)
      return (
        <Table.Row key={`${row.id}`}>
          <Table.Cell content={name} />
          <Table.Cell content={row.numFamilies} />
          <Table.Cell>
            <ProportionBar
              value={row.numFamiliesWithResults}
              max={row.numFamilies}
              aria-label={`${name}: ${proportion} families`}
            />
            {`${proportion} (${percent}%)`}
          </Table.Cell>
        </Table.Row>
      )
    })}
  </SummaryTable>
)

const getCategoryName = ({ id }: PhenotypeCount) => (id ? (HPO_CATEGORY_NAMES[id] || id) : UNCATEGORIZED)

const getTermName = ({ id, name }: PhenotypeCount) => (name ? `${name} (${id})` : id)

interface OwnProps {
  workbook: Workbook
  target: TargetDisplay
  query: WorksheetQuery
  onRun: () => void
  onShowVariants: () => void
}

interface GroupPatternsProps extends OwnProps, GroupSummaryState {
  loading: boolean
  genesById: ByGuid<{ geneSymbol?: string }>
  familiesByGuid: ByGuid<NamedEntity>
  load: (workbookGuid: string, worksheetQueryGuid: string, workbookTargetGuid: string, geneId?: string) => void
}

const GroupPatterns = ({
  workbook, target, query, summary, error, resultsNotLoaded, loading, genesById, familiesByGuid, load, onRun,
  onShowVariants,
}: GroupPatternsProps) => {
  const [geneId, setGeneId] = useState<string>(null)
  const clearGene = useCallback(() => setGeneId(null), [])
  const { workbookGuid } = workbook
  const { worksheetQueryGuid } = query
  const { workbookTargetGuid } = target
  useEffect(() => {
    load(workbookGuid, worksheetQueryGuid, workbookTargetGuid, geneId)
  }, [load, workbookGuid, worksheetQueryGuid, workbookTargetGuid, geneId])

  if (resultsNotLoaded) {
    return (
      <Message warning>
        <p>{error}</p>
        <Button size="small" content="Run again" onClick={onRun} />
      </Message>
    )
  }
  if (error) {
    return <Message error content={error} />
  }
  if (!summary) {
    return <Loader inline="centered" active />
  }

  const getSymbol = (id: string) => genesById[id]?.geneSymbol || id
  const selectedGene = summary.genes.find(gene => gene.geneId === geneId)
  const resultsHeader = summary.phenotypeGeneId ?
    `Of those, families with a result in ${getSymbol(summary.phenotypeGeneId)}` :
    'Of those, families with at least one result'
  return (
    <div>
      <Message info size="small" content={DESCRIPTIVE_NOTE} />
      <Statistic.Group size="mini" widths={4}>
        <Statistic label="Families in the group" value={summary.numFamilies} />
        <Statistic label="Families with at least one result" value={summary.numFamiliesWithResults} />
        <Statistic label="Variants found" value={summary.totalVariants} />
        <Statistic label="Families with HPO terms" value={summary.numFamiliesWithPhenotypes} />
      </Statistic.Group>

      <Section>
        <Header as="h4" content="Genes by number of families" subheader="Select a gene to restrict the phenotype counts to it" />
        <SummaryTable
          label="Genes"
          headers={['Gene', 'Families with a result', 'Variants']}
          emptyContent="No results in any gene"
          shown={summary.genes.length}
          total={summary.totalGenes}
        >
          {summary.genes.map(gene => (
            <GeneRow
              key={gene.geneId}
              gene={gene}
              symbol={getSymbol(gene.geneId)}
              numFamilies={summary.numFamilies}
              selected={gene.geneId === geneId}
              onSelect={setGeneId}
            />
          ))}
        </SummaryTable>
        {selectedGene && (
          <Segment aria-label="Selected gene">
            <Header
              as="h5"
              content={`${getSymbol(geneId)}: results in ${selectedGene.numFamilies} of ${summary.numFamilies} families`}
              subheader={selectedGene.familyGuids.map(guid => familiesByGuid[guid]?.displayName || guid).join(', ')}
            />
            <Button size="small" content="Show all variants" onClick={onShowVariants} />
            <Button size="small" basic content="Clear gene" onClick={clearGene} />
            <SearchResultsLink
              buttonText={`Search ${getSymbol(geneId)} in these families`}
              location={geneId}
              familyGuids={selectedGene.familyGuids}
              initialSearch={query.search}
            />
            <Note>{VARIANT_LIST_NOTE}</Note>
          </Segment>
        )}
      </Section>

      <Section>
        <Header as="h4" content="Variants found in 2 or more families" />
        <SummaryTable
          label="Recurrent variants"
          headers={['Variant', 'Genes', 'Families with the variant']}
          emptyContent="No variant was found in more than one family"
          shown={summary.recurrentVariants.length}
          total={summary.totalRecurrentVariants}
        >
          {summary.recurrentVariants.map(variant => (
            <Table.Row key={variant.variantId}>
              <Table.Cell content={variant.variantId} />
              <Table.Cell content={variant.geneIds.map(getSymbol).join(', ')} />
              <Table.Cell content={`${variant.numFamilies} of ${summary.numFamilies}`} />
            </Table.Row>
          ))}
        </SummaryTable>
      </Section>

      <Section>
        <Header
          as="h4"
          content="Phenotypes"
          subheader="Families are counted once per category or term, from the HPO terms of their affected individuals"
        />
        {loading && <Loader inline active size="small" />}
        <PhenotypeTable
          label="HPO category"
          rows={summary.phenotypeCategories}
          total={summary.phenotypeCategories.length}
          resultsHeader={resultsHeader}
          getName={getCategoryName}
        />
        <PhenotypeTable
          label="HPO term"
          rows={summary.phenotypeTerms}
          total={summary.totalPhenotypeTerms}
          resultsHeader={resultsHeader}
          getName={getTermName}
        />
      </Section>
    </div>
  )
}

const mapStateToProps = (state: WorkbookReduxState, { query, target }: OwnProps) => ({
  ...getCellGroupSummary(state, getCellKey(query.worksheetQueryGuid, target.workbookTargetGuid)),
  loading: getGroupSummaryIsLoading(state),
  genesById: getGenesById(state),
  familiesByGuid: getFamiliesByGuid(state),
})

const mapDispatchToProps = { load: loadGroupSummary }

export default connect(mapStateToProps, mapDispatchToProps)(GroupPatterns)
