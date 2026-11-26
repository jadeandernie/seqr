import React from 'react'
import { connect } from 'react-redux'
import { Link } from 'react-router-dom'
import { Button, Confirm, Label, Loader, Message, Table } from 'semantic-ui-react'

import { HttpRequestHelper } from '../../../shared/utils/httpRequestHelper'
import { KnownVariantCheck, getRequestErrors } from '../../../shared/utils/knownVariantUtils'
import KnownVariantCheckForm from '../../../shared/components/panel/known-variants/KnownVariantCheckForm'
import { VerdictLabel, ReferenceLinks } from '../../../shared/components/panel/known-variants/KnownVariantDisplay'

type ChecksByGuid = Record<string, KnownVariantCheck | null>
type ChecksResponse = { knownVariantChecksByGuid?: ChecksByGuid }

type CheckRowProps = {
  check: KnownVariantCheck
  onEdit: (check: KnownVariantCheck) => void
  onDelete: (check: KnownVariantCheck) => void
  onUpdate: (check: KnownVariantCheck, update: Record<string, unknown>) => void
}

const CheckRow = ({ check, onEdit, onDelete, onUpdate }: CheckRowProps) => {
  const edit = () => onEdit(check)
  const remove = () => onDelete(check)
  const toggleActive = () => onUpdate(check, { isActive: !check.isActive })
  return (
    <Table.Row disabled={!check.isActive}>
      <Table.Cell>
        {check.variantId}
        <br />
        {`GRCh${check.genomeVersion} ${check.datasetType === 'MITO' ? 'Mitochondrial' : 'SNV / indel'}`}
      </Table.Cell>
      <Table.Cell content={check.geneNames.join(', ')} />
      <Table.Cell>
        <VerdictLabel verdict={check.verdict} />
      </Table.Cell>
      <Table.Cell>
        <ReferenceLinks pubmedId={check.pubmedId} clinvarAccession={check.clinvarAccession} />
      </Table.Cell>
      <Table.Cell>
        {check.createdBy}
        {check.sourceProjectGuid && (
          <div>
            <Link to={`/project/${check.sourceProjectGuid}/project_page`}>{check.sourceProjectName}</Link>
          </div>
        )}
      </Table.Cell>
      <Table.Cell content={`${check.numMatches} (${check.numNewMatches} new)`} />
      <Table.Cell>
        <Label size="small" basic content={check.isActive ? 'Active' : 'Inactive'} />
        {check.isGlobal && <Label size="small" basic color="blue" content="All projects" />}
      </Table.Cell>
      <Table.Cell collapsing>
        {check.canEdit && (
          <span>
            <Button compact size="mini" content="Edit" onClick={edit} />
            <Button compact size="mini" content={check.isActive ? 'Deactivate' : 'Activate'} onClick={toggleActive} />
            <Button compact size="mini" negative content="Delete" onClick={remove} />
          </span>
        )}
      </Table.Cell>
    </Table.Row>
  )
}

export const BaseKnownVariants = ({ isAnalyst }: { isAnalyst: boolean }) => {
  const [checksByGuid, setChecksByGuid] = React.useState<ChecksByGuid>({})
  const [loading, setLoading] = React.useState(true)
  const [errors, setErrors] = React.useState<string[]>([])
  const [editCheck, setEditCheck] = React.useState<KnownVariantCheck | null>(null)
  const [deleteCheck, setDeleteCheck] = React.useState<KnownVariantCheck | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)

  const onSuccess = (response: ChecksResponse) => {
    setErrors([])
    setLoading(false)
    setChecksByGuid(prevChecks => ({ ...prevChecks, ...(response.knownVariantChecksByGuid || {}) }))
  }
  const onError = (exception: unknown) => {
    setLoading(false)
    setErrors(getRequestErrors(exception))
  }

  React.useEffect(() => {
    new HttpRequestHelper('/api/known_variant_checks', onSuccess, onError).get()
  }, [])

  const onUpdate = (check: KnownVariantCheck, update: Record<string, unknown>) => {
    new HttpRequestHelper(`/api/known_variant_checks/${check.checkGuid}/update`, onSuccess, onError).post(update)
  }
  const closeEdit = () => setEditCheck(null)
  const openCreate = () => setIsCreating(true)
  const closeCreate = () => setIsCreating(false)
  const cancelDelete = () => setDeleteCheck(null)
  const confirmDelete = () => {
    new HttpRequestHelper(`/api/known_variant_checks/${deleteCheck.checkGuid}/delete`, onSuccess, onError).post()
    setDeleteCheck(null)
  }

  if (loading) {
    return <Loader inline active />
  }

  const checks = Object.values(checksByGuid).filter(check => check)

  return (
    <div>
      <p>
        Known variants are variants recorded with a verdict, by you or shared with you. Newly loaded families are
        automatically checked for them, and matches are listed on the project and family pages. Deactivate or delete
        a known variant once it is covered by routine testing.
      </p>
      {isAnalyst && <Button primary size="small" content="Add Known Variant" onClick={openCreate} />}
      {errors.length > 0 && <Message error list={errors} />}
      {checks.length > 0 ? (
        <Table compact size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell content="Variant" />
              <Table.HeaderCell content="Gene" />
              <Table.HeaderCell content="Verdict" />
              <Table.HeaderCell content="References" />
              <Table.HeaderCell content="Recorded By" />
              <Table.HeaderCell content="Matches" />
              <Table.HeaderCell content="Status" />
              <Table.HeaderCell content="" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {checks.map(check => (
              <CheckRow
                key={check.checkGuid}
                check={check}
                onEdit={setEditCheck}
                onDelete={setDeleteCheck}
                onUpdate={onUpdate}
              />
            ))}
          </Table.Body>
        </Table>
      ) : <Message content="No known variants have been recorded" />}
      {editCheck && (
        <KnownVariantCheckForm
          title={`Edit known variant ${editCheck.variantId}`}
          submitUrl={`/api/known_variant_checks/${editCheck.checkGuid}/update`}
          initialValues={{
            verdict: editCheck.verdict,
            pubmedId: editCheck.pubmedId || '',
            clinvarAccession: editCheck.clinvarAccession || '',
            ...(isAnalyst ? { isGlobal: editCheck.isGlobal } : {}),
          }}
          showGlobal={isAnalyst}
          onSuccess={onSuccess}
          onClose={closeEdit}
        />
      )}
      {isCreating && (
        <KnownVariantCheckForm
          title="Add known variant"
          submitUrl="/api/known_variant_checks/create"
          showVariantFields
          showGlobal
          onSuccess={onSuccess}
          onClose={closeCreate}
        />
      )}
      <Confirm
        open={!!deleteCheck}
        content={`Delete known variant ${deleteCheck ? deleteCheck.variantId : ''} and its matches?`}
        confirmButton="Delete"
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

const mapStateToProps = (state: { user?: { isAnalyst?: boolean } }) => ({
  isAnalyst: !!(state.user && state.user.isAnalyst),
})

export default connect(mapStateToProps)(BaseKnownVariants)
