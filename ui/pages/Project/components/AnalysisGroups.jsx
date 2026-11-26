import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { Popup, Icon } from 'semantic-ui-react'
import { connect } from 'react-redux'

import { getAnalysisGroupIsLoading } from 'redux/selectors'
import OptionFieldView from 'shared/components/panel/view-fields/OptionFieldView'
import DataLoader from 'shared/components/DataLoader'
import { HelpIcon, SectionHeader } from 'shared/components/StyledComponents'
import { ANVIL_URL, FAMILY_FIELD_NAME_LOOKUP, CATEGORY_FAMILY_FILTERS } from 'shared/utils/constants'
import { compareObjects } from 'shared/utils/sortUtils'
import { loadCurrentProjectAnalysisGroups } from '../reducers'
import { getProjectAnalysisGroupsByGuid, getProjectGuid } from '../selectors'
import { UpdateAnalysisGroupButton, DeleteAnalysisGroupButton } from './AnalysisGroupButtons'

const AnalysisGroup = ({ ag, projectGuid }) => (
  <div>
    {ag.criteria && <Icon name="sync" size="small" />}
    <Link to={`/project/${projectGuid}/analysis_group/${ag.analysisGroupGuid}`}>{ag.name}</Link>
    <Popup
      position="right center"
      trigger={<HelpIcon />}
      content={ag.criteria ? Object.keys(ag.criteria).map(category => (
        <OptionFieldView
          key={category}
          field={category}
          initialValues={ag.criteria}
          fieldName={FAMILY_FIELD_NAME_LOOKUP[category]}
          tagOptions={CATEGORY_FAMILY_FILTERS[category]}
          multiple
        />
      )) : (
        <div>
          <b>{`${ag.familyGuids?.length} Families`}</b>
          <br />
          <i>{ag.description}</i>
          {ag.workspaceName && (
            <div>
              Access Control Workspace:&nbsp;
              <a href={`${ANVIL_URL}/#workspaces/${ag.workspaceNamespace}/${ag.workspaceName}`} target="_blank" rel="noreferrer">
                {`${ag.workspaceNamespace}/${ag.workspaceName}`}
              </a>
            </div>
          )}
        </div>
      )}
      size="tiny"
    />
    <UpdateAnalysisGroupButton analysisGroup={ag} iconOnly />
    <DeleteAnalysisGroupButton analysisGroup={ag} iconOnly size="tiny" />
  </div>
)

AnalysisGroup.propTypes = {
  ag: PropTypes.object.isRequired,
  projectGuid: PropTypes.string,
}

const AnalysisGroupsList = ({ analysisGroupsByGuid, projectGuid }) => {
  const allGroups = Object.values(analysisGroupsByGuid).sort(compareObjects('name'))
  const accessGroups = allGroups.filter(({ workspaceName }) => workspaceName)
  const mainGroups = allGroups.filter(({ workspaceName }) => !workspaceName)
  return (
    <div>
      {mainGroups.map(ag => <AnalysisGroup key={ag.name} ag={ag} projectGuid={projectGuid} />)}
      {accessGroups.length > 0 && <SectionHeader>Access Groups</SectionHeader>}
      {accessGroups.map(ag => <AnalysisGroup key={ag.name} ag={ag} projectGuid={projectGuid} />)}
    </div>
  )
}

AnalysisGroupsList.propTypes = {
  analysisGroupsByGuid: PropTypes.object.isRequired,
  projectGuid: PropTypes.string,
}

const AnalysisGroups = React.memo(({ load, loading, analysisGroupsByGuid, analysisGroupGuid, projectGuid }) => (
  <DataLoader load={load} loading={loading} content={analysisGroupsByGuid}>
    {analysisGroupsByGuid[analysisGroupGuid] ?
      <AnalysisGroup ag={analysisGroupsByGuid[analysisGroupGuid]} projectGuid={projectGuid} /> :
      <AnalysisGroupsList analysisGroupsByGuid={analysisGroupsByGuid} projectGuid={projectGuid} />}
  </DataLoader>
))

AnalysisGroups.propTypes = {
  analysisGroupGuid: PropTypes.string,
  analysisGroupsByGuid: PropTypes.object.isRequired,
  projectGuid: PropTypes.string,
  loading: PropTypes.bool,
  load: PropTypes.func,
}

const mapStateToProps = state => ({
  analysisGroupsByGuid: getProjectAnalysisGroupsByGuid(state),
  projectGuid: getProjectGuid(state),
  loading: getAnalysisGroupIsLoading(state),
})

const mapDispatchToProps = {
  load: loadCurrentProjectAnalysisGroups,
}

export default connect(mapStateToProps, mapDispatchToProps)(AnalysisGroups)
