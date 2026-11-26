import React from 'react'
import PropTypes from 'prop-types'
import { Header } from 'semantic-ui-react'

import { extent } from 'd3-array'
import { scaleLinear, scaleLog } from 'd3-scale'
import { select } from 'd3-selection'

import { GeneSearchLink } from 'shared/components/buttons/SearchResultsLink'
import { initializeD3 } from 'shared/components/graph/d3Utils'
import { camelcaseToTitlecase } from 'shared/utils/stringUtils'

const GRAPH_HEIGHT = 400
const GRAPH_WIDTH = 600
const GRAPH_MARGIN = { top: 10, bottom: 40, right: 30, left: 45 }
const HIGHLIGHT_COLOR = '#2185d0'

class RnaSeqOutliersGraph extends React.PureComponent {

  static propTypes = {
    data: PropTypes.arrayOf(PropTypes.object),
    genesById: PropTypes.object,
    xField: PropTypes.string.isRequired,
    yField: PropTypes.string,
    highlightGeneIds: PropTypes.arrayOf(PropTypes.string),
  }

  componentDidMount() {
    this.initPlot()
  }

  componentDidUpdate(prevProp) {
    const { data, highlightGeneIds } = this.props
    if (data !== prevProp.data || highlightGeneIds !== prevProp.highlightGeneIds) {
      select(this.container).selectAll('*').remove()
      this.initPlot()
    }
  }

  initPlot = () => {
    const { data, genesById, xField, yField = 'pValue', highlightGeneIds } = this.props

    // Highlighted points are drawn last so they are not covered by the other points
    const highlighted = new Set(highlightGeneIds || [])
    const isHighlighted = d => highlighted.has(d.geneId)
    const dataArray = highlighted.size ? [...data.filter(d => !isHighlighted(d)), ...data.filter(isHighlighted)] : data

    const x = scaleLinear().domain(extent(dataArray.map(d => d[xField]))).range([0, GRAPH_WIDTH])
    const y = scaleLog().domain(extent(dataArray.map(d => d[yField]))).range([0, GRAPH_HEIGHT])

    const svg = initializeD3(
      select(this.container), { width: GRAPH_WIDTH, height: GRAPH_HEIGHT }, GRAPH_MARGIN, { x, y }, {
        x: { text: camelcaseToTitlecase(xField).replace(' ', '-'), transform: xAxis => xAxis.tickSizeOuter(0) },
        y: { text: `-log(${camelcaseToTitlecase(yField).replace(' ', '-')})`, transform: yAxis => yAxis.tickSizeOuter(0).ticks(5, val => -Math.log10(val)) },
      },
    )

    // scatterplot
    const dataPoints = svg.append('g').selectAll('dot').data(dataArray).enter()
      .append('g')

    dataPoints.append('circle')
      .attr('cx', d => x(d[xField]))
      .attr('cy', d => y(d[yField]))
      .attr('r', d => (isHighlighted(d) ? 5 : 3))
      .style('fill', d => (isHighlighted(d) ? HIGHLIGHT_COLOR : 'None'))
      .style('stroke', d => (d.isSignificant ? 'red' : 'lightgrey'))

    dataPoints.append('text')
      .text(d => (d.isSignificant ? (genesById[d.geneId] || {}).geneSymbol : null))
      .attr('text-anchor', d => (x(d[xField]) > GRAPH_WIDTH - 100 ? 'end' : 'start'))
      .attr('x', (d) => {
        const xPos = x(d[xField])
        return xPos + (5 * (xPos > GRAPH_WIDTH - 100 ? -1 : 1))
      })
      .attr('y', d => y(d[yField]))
      .style('fill', 'red')
      .style('font-weight', 'bold')
  }

  setContainerElement = (element) => {
    this.container = element
  }

  render() {
    return (
      <div ref={this.setContainerElement} />
    )
  }

}

const RnaSeqOutliers = React.memo(({ rnaSeqData, familyGuid, getLocation, searchType, title, ...props }) => (
  <div>
    <Header content={title} textAlign="center" />
    <GeneSearchLink
      buttonText={`Search for variants in outlier ${searchType}`}
      icon="search"
      location={rnaSeqData.filter(({ isSignificant }) => isSignificant).map(getLocation).join(',')}
      familyGuid={familyGuid}
      floated="right"
    />
    <RnaSeqOutliersGraph data={rnaSeqData} {...props} />
  </div>
))

RnaSeqOutliers.propTypes = {
  familyGuid: PropTypes.string.isRequired,
  rnaSeqData: PropTypes.arrayOf(PropTypes.object).isRequired,
  genesById: PropTypes.object,
  getLocation: PropTypes.func,
  searchType: PropTypes.string,
  title: PropTypes.string,
}

export { RnaSeqOutliersGraph }
export default RnaSeqOutliers
