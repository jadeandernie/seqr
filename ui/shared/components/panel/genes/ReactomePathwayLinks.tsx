import React from 'react'

type ReactomePathway = {
  pathwayId: string
  name: string
}

type Props = {
  pathways: ReactomePathway[]
}

const ReactomePathwayLinks = ({ pathways }: Props) => (
  <span>
    {pathways.map(({ pathwayId, name }, i) => (
      <span key={pathwayId}>
        {i > 0 && ', '}
        <a href={`https://reactome.org/content/detail/${pathwayId}`} target="_blank" rel="noreferrer">{name}</a>
      </span>
    ))}
  </span>
)

export default ReactomePathwayLinks
