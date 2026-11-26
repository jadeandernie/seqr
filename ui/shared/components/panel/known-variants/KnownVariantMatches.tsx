import React from 'react'
import { Link } from 'react-router-dom'
import { Button, Label, Loader, Message, Table } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../utils/httpRequestHelper'
import {
  KnownVariantMatch,
  MATCH_STATUS_NEW,
  MATCH_STATUS_RELEVANT,
  MATCH_STATUS_DISMISSED,
  MATCH_STATUS_LABELS,
  getMatchVariantPath,
  getRequestErrors,
} from '../../../utils/knownVariantUtils'
import { VerdictLabel, ReferenceLinks } from './KnownVariantDisplay'

type Props = {
  familyGuid?: string
  projectGuid?: string
  hideEmpty?: boolean
}

type MatchesResponse = { knownVariantMatchesByGuid?: Record<string, KnownVariantMatch> }

type MatchRowProps = {
  match: KnownVariantMatch
  showFamily: boolean
  updateStatus: (matchGuid: string, status: string) => void
}

const MatchRow = ({ match, showFamily, updateStatus }: MatchRowProps) => {
  const setStatus = (status: string) => () => updateStatus(match.matchGuid, status)
  return (
    <Table.Row>
      {showFamily && (
        <Table.Cell>
          <Link to={`/project/${match.projectGuid}/family_page/${match.familyGuid}`}>{match.familyGuid}</Link>
        </Table.Cell>
      )}
      <Table.Cell>
        <Link to={getMatchVariantPath(match)}>{match.variantId}</Link>
      </Table.Cell>
      <Table.Cell content={match.geneNames.join(', ')} />
      <Table.Cell>
        <VerdictLabel verdict={match.verdict} />
      </Table.Cell>
      <Table.Cell>
        <ReferenceLinks pubmedId={match.pubmedId} clinvarAccession={match.clinvarAccession} />
      </Table.Cell>
      <Table.Cell content={match.createdBy} />
      <Table.Cell content={match.firstSeen} />
      <Table.Cell collapsing>
        {match.status === MATCH_STATUS_NEW ? (
          <span>
            <Button compact size="mini" color="green" content="Relevant" onClick={setStatus(MATCH_STATUS_RELEVANT)} />
            <Button compact size="mini" content="Dismiss" onClick={setStatus(MATCH_STATUS_DISMISSED)} />
          </span>
        ) : (
          <span>
            {`${MATCH_STATUS_LABELS[match.status] || match.status}${match.reviewedBy ? ` (${match.reviewedBy})` : ''} `}
            <Button compact size="mini" basic content="Undo" onClick={setStatus(MATCH_STATUS_NEW)} />
          </span>
        )}
      </Table.Cell>
    </Table.Row>
  )
}

const KnownVariantMatches = ({ familyGuid, projectGuid, hideEmpty }: Props) => {
  const [matchesByGuid, setMatchesByGuid] = React.useState<Record<string, KnownVariantMatch>>({})
  const [loading, setLoading] = React.useState(true)
  const [errors, setErrors] = React.useState<string[]>([])
  const [showReviewed, setShowReviewed] = React.useState(false)

  const onSuccess = (response: MatchesResponse) => {
    setErrors([])
    setLoading(false)
    setMatchesByGuid(prevMatches => ({ ...prevMatches, ...(response.knownVariantMatchesByGuid || {}) }))
  }
  const onError = (exception: unknown) => {
    setLoading(false)
    setErrors(getRequestErrors(exception))
  }

  const url = familyGuid ? `/api/family/${familyGuid}/known_variant_matches` : `/api/project/${projectGuid}/known_variant_matches`
  React.useEffect(() => {
    setMatchesByGuid({})
    setLoading(true)
    new HttpRequestHelper(url, onSuccess, onError).get()
  }, [url])

  const updateStatus = (matchGuid: string, status: string) => {
    new HttpRequestHelper(`/api/known_variant_matches/${matchGuid}/update`, onSuccess, onError).post({ status })
  }
  const toggleShowReviewed = () => setShowReviewed(prevShow => !prevShow)

  if (loading) {
    return <Loader inline active size="small" />
  }

  const matches = Object.values(matchesByGuid)
  const newMatches = matches.filter(({ status }) => status === MATCH_STATUS_NEW)
  const numReviewed = matches.length - newMatches.length
  if (hideEmpty && matches.length < 1 && errors.length < 1) {
    return null
  }
  const displayMatches = showReviewed ? matches : newMatches

  return (
    <div>
      <b>Known variant matches </b>
      <Label size="small" color={newMatches.length > 0 ? 'orange' : undefined} content={`${newMatches.length} new`} />
      {numReviewed > 0 && (
        <Button
          basic
          compact
          size="mini"
          content={showReviewed ? 'Hide reviewed' : `Show ${numReviewed} reviewed`}
          onClick={toggleShowReviewed}
        />
      )}
      {errors.length > 0 && <Message error list={errors} />}
      {displayMatches.length > 0 && (
        <Table compact="very" size="small">
          <Table.Header>
            <Table.Row>
              {!familyGuid && <Table.HeaderCell content="Family" />}
              <Table.HeaderCell content="Variant" />
              <Table.HeaderCell content="Gene" />
              <Table.HeaderCell content="Verdict" />
              <Table.HeaderCell content="References" />
              <Table.HeaderCell content="Recorded By" />
              <Table.HeaderCell content="First Seen" />
              <Table.HeaderCell content="Review" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {displayMatches.map(match => (
              <MatchRow key={match.matchGuid} match={match} showFamily={!familyGuid} updateStatus={updateStatus} />
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  )
}

export default KnownVariantMatches
