import React, { useCallback, useEffect, useState } from 'react'
import { connect } from 'react-redux'
import { Button, Checkbox, Form, Header, Icon, Label, List, Menu, Message, Segment, TextArea } from 'semantic-ui-react'

import { updateIndividual } from '../../../../redux/rootReducer'
import { getSortedIndividualsByFamily } from '../../../../redux/selectors'
import { setModalConfirm } from '../../../../redux/utils/modalReducer'
import { HpoTermSelector } from '../HpoTerms'
import {
  ABSENT, FAMILY, HpoHit, HpoHitStatus, HpoIndex, PRESENT, UNCERTAIN, extractHpoTerms, getTextSegments, summariseHits,
} from './hpoExtractor'
import { loadHpoIndex } from './hpoVocabulary'

interface Feature {
  id: string
  label?: string
  notes?: string
  qualifiers?: unknown[]
}

export interface ImportIndividual {
  individualGuid: string
  familyGuid: string
  displayName?: string
  individualId?: string
  features?: Feature[] | null
  absentFeatures?: Feature[] | null
  nonstandardFeatures?: Feature[] | null
  absentNonstandardFeatures?: Feature[] | null
}

type Assertion = typeof PRESENT | typeof ABSENT

interface Proposal {
  id: string
  label: string
  status: HpoHitStatus
  conflicting: boolean
  manual: boolean
  matchedTexts: string[]
  cues: string[]
  selected: boolean
  assertion: Assertion
}

const PASTE = 'paste'
const REVIEW = 'review'
const APPLIED = 'applied'

interface ImportState {
  stage: typeof PASTE | typeof REVIEW | typeof APPLIED
  text: string
  hits: HpoHit[]
  proposals: Proposal[]
  showPicker: boolean
  saving: boolean
  error: string | null
  notice: string | null
  appliedPresent: number
  appliedAbsent: number
}

const EMPTY_STATE: ImportState = {
  stage: PASTE,
  text: '',
  hits: [],
  proposals: [],
  showPicker: false,
  saving: false,
  error: null,
  notice: null,
  appliedPresent: 0,
  appliedAbsent: 0,
}

const PRIVACY_MESSAGE = 'Paste clinical notes — the text stays in your browser and is never sent to seqr or stored'
const CONFIRM_CLOSE_MESSAGE = 'The pasted notes and any terms that have not been applied will be discarded. Are you sure you want to close?'

const STATUS_LABELS: Record<HpoHitStatus, string> = {
  present: 'present',
  absent: 'absent',
  family: 'family history',
  uncertain: 'unconfirmed',
}

// Each status has its own border style and a text tag, so that it can be told apart without colour
const STATUS_STYLES: Record<HpoHitStatus, React.CSSProperties> = {
  present: { backgroundColor: '#d5f0d5', borderBottom: '2px solid #1e561f' },
  absent: { backgroundColor: '#f9d6d5', borderBottom: '2px dashed #912d2b' },
  family: { backgroundColor: '#e3e4e6', borderBottom: '2px dotted #4a4a4a' },
  uncertain: { backgroundColor: '#fdf2c5', borderBottom: '4px double #7a5c00' },
}

const NOTE_STYLE: React.CSSProperties = { whiteSpace: 'pre-wrap', maxHeight: '18em', overflowY: 'auto' }
const TAG_STYLE: React.CSSProperties = { fontSize: '0.75em', fontWeight: 'bold' }
const BASIS_STYLE: React.CSSProperties = { color: '#666', fontSize: '0.9em' }
const TEXT_AREA_STYLE: React.CSSProperties = { fontFamily: 'monospace' }

const PROPOSAL_GROUPS: { key: string, title: string, statuses: HpoHitStatus[] }[] = [
  { key: 'confident', title: 'Proposed terms', statuses: [PRESENT, ABSENT] },
  {
    key: UNCERTAIN,
    title: 'Unconfirmed in the notes — tick a term to include it',
    statuses: [UNCERTAIN],
  },
  {
    key: FAMILY,
    title: 'Mentioned for relatives — tick a term only if it also applies to this individual',
    statuses: [FAMILY],
  },
]

const getDisplayName = (individual: ImportIndividual): string => individual.displayName || individual.individualId

const getFeatureIds = (features?: Feature[] | null): Set<string> => new Set((features || []).map(({ id }) => id))

// The save endpoint replaces all four feature lists, so everything already recorded is sent back unchanged
const parseRecordedFeatures = (features?: Feature[] | null): Feature[] => (features || []).map(
  ({ id, notes, qualifiers }) => ({ id, ...(notes ? { notes } : {}), ...(qualifiers ? { qualifiers } : {}) }),
)

const quote = (texts: string[]): string => texts.map(text => `“${text}”`).join(', ')

const getBasis = ({ manual, matchedTexts, cues, conflicting }: Proposal): string => {
  if (manual) {
    return 'added by you'
  }
  return [
    `found as ${quote(matchedTexts)}`,
    cues.length > 0 && `context: ${quote(cues)}`,
    conflicting && 'both stated and negated in the notes',
  ].filter(part => part).join(' · ')
}

const HighlightedNote = React.memo(({ text, hits }: { text: string, hits: HpoHit[] }) => (
  <Segment style={NOTE_STYLE} className="hpo-import-note">
    {getTextSegments(text, hits).map(({ text: segmentText, hit }, i) => (hit ? (
      <mark
        // eslint-disable-next-line react/no-array-index-key
        key={i}
        style={STATUS_STYLES[hit.status]}
        data-status={hit.status}
        title={`${hit.label} (${hit.id}) — ${STATUS_LABELS[hit.status]}`}
      >
        {segmentText}
        <sup style={TAG_STYLE}>{` [${STATUS_LABELS[hit.status]}]`}</sup>
      </mark>
    // eslint-disable-next-line react/no-array-index-key
    ) : <span key={i}>{segmentText}</span>))}
  </Segment>
))

const Legend = React.memo(() => (
  <div className="hpo-import-legend">
    {Object.entries(STATUS_STYLES).map(([status, style]) => (
      <Label key={status} basic size="small" style={style} content={`[${STATUS_LABELS[status as HpoHitStatus]}]`} />
    ))}
  </div>
))

interface ProposalRowProps {
  proposal: Proposal
  onToggle: (id: string) => void
  onFlip: (id: string) => void
  onRemove: (id: string) => void
}

const ProposalRow = React.memo(({ proposal, onToggle, onFlip, onRemove }: ProposalRowProps) => {
  const { id, label, selected, assertion } = proposal
  const otherAssertion = assertion === PRESENT ? ABSENT : PRESENT
  return (
    <List.Item className="hpo-import-proposal" data-term={id}>
      <List.Content floated="right">
        <Button
          type="button"
          size="mini"
          basic
          className="hpo-import-flip"
          icon="exchange"
          content={`Change to ${otherAssertion}`}
          onClick={() => onFlip(id)}
        />
        <Button
          type="button"
          size="mini"
          basic
          className="hpo-import-remove"
          icon="remove"
          aria-label={`Remove ${label}`}
          onClick={() => onRemove(id)}
        />
      </List.Content>
      <List.Content>
        <Checkbox
          checked={selected}
          onChange={() => onToggle(id)}
          label={`${label} (${id})`}
        />
        <Label
          size="tiny"
          basic
          className="hpo-import-assertion"
          color={assertion === PRESENT ? 'green' : 'red'}
          icon={assertion === PRESENT ? 'plus' : 'minus'}
          content={assertion === PRESENT ? 'Present' : 'Not present'}
        />
        <div style={BASIS_STYLE}>{getBasis(proposal)}</div>
      </List.Content>
    </List.Item>
  )
})

interface IndividualImportProps {
  individual: ImportIndividual
  state: ImportState
  index: HpoIndex | null
  update: (individualGuid: string, getUpdates: (state: ImportState) => Partial<ImportState>) => void
  save: (values: Record<string, unknown>) => Promise<unknown>
}

const IndividualImport = ({ individual, state, index, update, save }: IndividualImportProps) => {
  const { individualGuid } = individual
  const { stage, text, hits, proposals, showPicker, saving, error, notice, appliedPresent, appliedAbsent } = state
  const name = getDisplayName(individual)
  const set = useCallback(
    (getUpdates: (state: ImportState) => Partial<ImportState>) => update(individualGuid, getUpdates),
    [update, individualGuid],
  )
  const updateProposal = useCallback((id: string, getUpdates: (proposal: Proposal) => Partial<Proposal>) => set(
    prev => ({ proposals: prev.proposals.map(p => (p.id === id ? { ...p, ...getUpdates(p) } : p)) }),
  ), [set])

  const onTextChange = useCallback(
    (e: React.SyntheticEvent, data: { value?: string | number }) => set(() => ({ text: `${data.value}` })), [set],
  )
  const extract = useCallback(() => set((prev) => {
    const newHits = extractHpoTerms(prev.text, index)
    return {
      stage: REVIEW,
      hits: newHits,
      notice: null,
      error: null,
      showPicker: false,
      proposals: summariseHits(newHits).map(summary => ({
        ...summary,
        manual: false,
        selected: !summary.conflicting && (summary.status === PRESENT || summary.status === ABSENT),
        assertion: summary.status === ABSENT ? ABSENT : PRESENT,
      })),
    }
  }), [set, index])
  const editNotes = useCallback(() => set(() => ({ stage: PASTE, hits: [], proposals: [], error: null })), [set])
  const discard = useCallback(() => set(() => EMPTY_STATE), [set])
  const onToggle = useCallback((id: string) => updateProposal(id, p => ({ selected: !p.selected })), [updateProposal])
  const onFlip = useCallback(
    (id: string) => updateProposal(id, p => ({ assertion: p.assertion === PRESENT ? ABSENT : PRESENT })),
    [updateProposal],
  )
  const onRemove = useCallback(
    (id: string) => set(prev => ({ proposals: prev.proposals.filter(p => p.id !== id) })), [set],
  )
  const togglePicker = useCallback(() => set(prev => ({ showPicker: !prev.showPicker })), [set])

  const recordedPresent = getFeatureIds(individual.features)
  const recordedAbsent = getFeatureIds(individual.absentFeatures)
  const isRecorded = (id: string) => recordedPresent.has(id) || recordedAbsent.has(id)

  const addTerm = useCallback(({ id, label }: { id: string, label: string }) => set((prev) => {
    if (recordedPresent.has(id) || recordedAbsent.has(id)) {
      return { showPicker: false, notice: `${label} (${id}) is already recorded for ${name}` }
    }
    const added = {
      id, label, status: PRESENT, conflicting: false, manual: true, matchedTexts: [], cues: [], selected: true, assertion: PRESENT,
    } as Proposal
    return {
      showPicker: false,
      notice: null,
      proposals: prev.proposals.some(p => p.id === id) ?
        prev.proposals.map(p => (p.id === id ? { ...p, selected: true } : p)) : [...prev.proposals, added],
    }
  }), [set, individual, name])

  const newProposals = proposals.filter(({ id }) => !isRecorded(id))
  const recordedProposals = proposals.filter(({ id }) => isRecorded(id))
  const confirmed = newProposals.filter(({ selected }) => selected)

  const apply = () => {
    const present = confirmed.filter(({ assertion }) => assertion === PRESENT)
    const absent = confirmed.filter(({ assertion }) => assertion === ABSENT)
    set(() => ({ saving: true, error: null }))
    save({
      individualGuid,
      individualField: 'hpo_terms',
      features: [...parseRecordedFeatures(individual.features), ...present.map(({ id }) => ({ id }))],
      absentFeatures: [...parseRecordedFeatures(individual.absentFeatures), ...absent.map(({ id }) => ({ id }))],
      nonstandardFeatures: parseRecordedFeatures(individual.nonstandardFeatures),
      absentNonstandardFeatures: parseRecordedFeatures(individual.absentNonstandardFeatures),
    }).then(
      () => set(() => ({ ...EMPTY_STATE, stage: APPLIED, appliedPresent: present.length, appliedAbsent: absent.length })),
      (e: Error) => set(() => ({ saving: false, error: e.message })),
    )
  }

  if (stage === APPLIED) {
    return (
      <div>
        <Message
          success
          header={`Added ${appliedPresent + appliedAbsent} HPO terms to ${name}`}
          content={`${appliedPresent} present and ${appliedAbsent} not present. The pasted notes have been discarded.`}
        />
        <Button type="button" content={`Import more notes for ${name}`} onClick={discard} />
      </div>
    )
  }

  if (stage === PASTE) {
    return (
      <Form>
        <TextArea
          rows={12}
          style={TEXT_AREA_STYLE}
          value={text}
          onChange={onTextChange}
          placeholder={PRIVACY_MESSAGE}
          aria-label={`Clinical notes for ${name}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-gramm="false"
        />
        <Button
          type="button"
          primary
          className="hpo-import-extract"
          content="Extract HPO terms"
          disabled={!index || !text.trim()}
          onClick={extract}
        />
      </Form>
    )
  }

  return (
    <div>
      <Header size="small" content={`Review the terms found in the notes for ${name}`} />
      <Legend />
      <HighlightedNote text={text} hits={hits} />
      {proposals.length === 0 && (
        <Message warning content="No HPO terms were recognised in the notes. You can edit the notes or add terms yourself." />
      )}
      {PROPOSAL_GROUPS.map(({ key, title, statuses }) => {
        const groupProposals = newProposals.filter(({ status, conflicting }) => (
          key === UNCERTAIN ? (conflicting || statuses.includes(status)) : (!conflicting && statuses.includes(status))
        ))
        return groupProposals.length > 0 && (
          <div key={key} className={`hpo-import-group-${key}`}>
            <Header size="tiny" content={title} />
            <List divided relaxed>
              {groupProposals.map(proposal => (
                <ProposalRow key={proposal.id} proposal={proposal} onToggle={onToggle} onFlip={onFlip} onRemove={onRemove} />
              ))}
            </List>
          </div>
        )
      })}
      {recordedProposals.length > 0 && (
        <div className="hpo-import-recorded">
          <Header size="tiny" content="Already recorded — these will not be changed" />
          <List>
            {recordedProposals.map(({ id, label, status }) => {
              const recordedAs = recordedPresent.has(id) ? PRESENT : ABSENT
              const differs = (status === PRESENT || status === ABSENT) && status !== recordedAs
              return (
                <List.Item key={id} data-term={id}>
                  <Icon name="check" color="grey" />
                  {`${label} (${id}) — already recorded as ${recordedAs === PRESENT ? 'present' : 'not present'}`}
                  {differs && `, but the notes suggest ${STATUS_LABELS[status]}. Use Manual import to change it.`}
                </List.Item>
              )
            })}
          </List>
        </div>
      )}
      {notice && <Message info content={notice} />}
      {showPicker ? <HpoTermSelector addItem={addTerm} /> : (
        <Button type="button" basic size="small" icon="plus" className="hpo-import-add" content="Add another term" onClick={togglePicker} />
      )}
      {error && <Message error header="The terms were not saved" content={error} />}
      <Segment basic textAlign="right">
        <Button type="button" content="Edit notes" className="hpo-import-edit" onClick={editNotes} disabled={saving} />
        <Button type="button" content="Discard" className="hpo-import-discard" onClick={discard} disabled={saving} />
        <Button
          type="button"
          primary
          className="hpo-import-apply"
          content={`Apply ${confirmed.length} ${confirmed.length === 1 ? 'term' : 'terms'} to ${name}`}
          disabled={confirmed.length === 0 || saving}
          loading={saving}
          onClick={apply}
        />
      </Segment>
    </div>
  )
}

const isDirty = ({ stage, text }: ImportState): boolean => stage === REVIEW || text.trim().length > 0

interface AutomaticHpoImportProps {
  individual: ImportIndividual
  modalName: string
  individuals?: ImportIndividual[]
  save?: (values: Record<string, unknown>) => Promise<unknown>
  setConfirm?: (modalName: string, message: string | null) => void
}

const BaseAutomaticHpoImport = ({ individual, individuals, modalName, save, setConfirm }: AutomaticHpoImportProps) => {
  const [index, setIndex] = useState<HpoIndex | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeGuid, setActiveGuid] = useState(individual.individualGuid)
  // Notes are only ever held here, so they are gone as soon as the dialog is closed
  const [states, setStates] = useState<Record<string, ImportState>>({})

  const load = useCallback(() => {
    setLoadError(null)
    loadHpoIndex().then(setIndex, (e: Error) => setLoadError(e.message))
  }, [])
  useEffect(load, [load])

  const update = useCallback(
    (individualGuid: string, getUpdates: (state: ImportState) => Partial<ImportState>) => setStates((prev) => {
      const state = prev[individualGuid] || EMPTY_STATE
      return { ...prev, [individualGuid]: { ...state, ...getUpdates(state) } }
    }), [],
  )

  const dirty = Object.values(states).some(isDirty)
  useEffect(() => {
    setConfirm(modalName, dirty ? CONFIRM_CLOSE_MESSAGE : null)
  }, [dirty, modalName, setConfirm])

  const familyIndividuals = individuals && individuals.length > 0 ? individuals : [individual]
  const activeIndividual = familyIndividuals.find(({ individualGuid }) => individualGuid === activeGuid)

  return (
    <div className="hpo-automatic-import">
      <Message info icon="lock" header={PRIVACY_MESSAGE} content="HPO terms are matched in your browser and proposed for your review. Nothing is saved until you apply the terms you have confirmed." />
      {loadError && (
        <Message error>
          <Message.Header>The HPO vocabulary could not be loaded</Message.Header>
          <p>{loadError}</p>
          <Button type="button" size="small" content="Try again" onClick={load} />
        </Message>
      )}
      {!index && !loadError && <Message icon={<Icon name="circle notched" loading />} content="Loading the HPO vocabulary…" />}
      {familyIndividuals.length > 1 && (
        <Menu pointing secondary>
          {familyIndividuals.map((familyIndividual) => {
            const { stage } = states[familyIndividual.individualGuid] || EMPTY_STATE
            return (
              <Menu.Item
                key={familyIndividual.individualGuid}
                name={familyIndividual.individualGuid}
                active={familyIndividual.individualGuid === activeGuid}
                onClick={() => setActiveGuid(familyIndividual.individualGuid)}
              >
                {getDisplayName(familyIndividual)}
                {stage === REVIEW && <Label size="mini" color="yellow" content="in review" />}
                {stage === APPLIED && <Label size="mini" color="green" content="applied" />}
              </Menu.Item>
            )
          })}
        </Menu>
      )}
      <IndividualImport
        key={activeGuid}
        individual={activeIndividual}
        state={states[activeGuid] || EMPTY_STATE}
        index={index}
        update={update}
        save={save}
      />
    </div>
  )
}

const mapStateToProps = (
  state: Record<string, unknown>, ownProps: AutomaticHpoImportProps,
): Partial<AutomaticHpoImportProps> => ({
  individuals: getSortedIndividualsByFamily(state)[ownProps.individual.familyGuid],
})

const mapDispatchToProps = {
  save: updateIndividual,
  setConfirm: setModalConfirm,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default connect(mapStateToProps, mapDispatchToProps as any)(BaseAutomaticHpoImport)
