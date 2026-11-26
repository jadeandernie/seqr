// Dictionary based extraction of HPO terms from free text. Everything here is a pure function that runs
// in the browser: clinical notes must never be sent to the server.

export type HpoVocabularyTerm = [id: string, name: string, parentId: string | null, synonyms: string[]]

export type HpoHitStatus = 'present' | 'absent' | 'family' | 'uncertain'

export const PRESENT: HpoHitStatus = 'present'
export const ABSENT: HpoHitStatus = 'absent'
export const FAMILY: HpoHitStatus = 'family'
export const UNCERTAIN: HpoHitStatus = 'uncertain'

export interface HpoHit {
  id: string
  label: string
  matchedText: string
  start: number
  end: number
  status: HpoHitStatus
  cue: string | null
}

export interface HpoTermSummary {
  id: string
  label: string
  status: HpoHitStatus
  conflicting: boolean
  matchedTexts: string[]
  cues: string[]
}

export interface TextSegment {
  text: string
  hit?: HpoHit
}

interface TrieEntry {
  id: string
  isName: boolean
}

interface TrieNode {
  children: Map<string, TrieNode>
  entry?: TrieEntry
}

export interface HpoIndex {
  root: TrieNode
  labels: Map<string, string>
  size: number
}

interface Token {
  raw: string
  norm: string
  start: number
  end: number
  gap: string
}

const WORD_REGEX = /[A-Za-z0-9\u00C0-\u024F]+/g
const DIACRITICS_REGEX = /[\u0300-\u036f]/g
const NON_ASCII_REGEX = /[^a-z0-9]/
const APOSTROPHES = ['\'', '\u2019']
const SKIPPED_WORD = 'the'
const MAX_ANCESTOR_DEPTH = 50

const IRREGULAR_WORDS = new Map<string, string>(Object.entries({
  feet: 'foot',
  teeth: 'tooth',
  vertebrae: 'vertebra',
  naevi: 'nevus',
  nevi: 'nevus',
  calculi: 'calculus',
  testes: 'testis',
  children: 'child',
  grey: 'gray',
  ageing: 'aging',
}))

// Maps plural and British spellings onto one form. It is applied to both the vocabulary and the text, so
// the result only has to be consistent, not a real word.
const foldWord = (word: string): string => {
  const lower = word.toLowerCase()
  return NON_ASCII_REGEX.test(lower) ? lower.normalize('NFD').replace(DIACRITICS_REGEX, '') : lower
}

export const normaliseWord = (word: string): string => {
  let w = foldWord(word)
  if (IRREGULAR_WORDS.has(w)) {
    return IRREGULAR_WORDS.get(w)
  }
  if (w.length < 4 || /^\d/.test(w)) {
    return w
  }
  if (w.length > 4 && w.endsWith('ies')) {
    w = `${w.slice(0, -3)}y`
  } else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) {
    w = w.slice(0, -1)
  }
  w = w.replace(/ae(?=[a-z])/g, 'e').replace(/oe(?=[a-z])/g, 'e').replace(/^leuc(?=o)/, 'leuk').replace(/sulph/g, 'sulf')
  if (w.length > 4) {
    w = w.replace(/our(al|ed|ing)?$/, 'or$1')
  }
  w = w.replace(/is(e|ed|ing|ation)$/, 'iz$1').replace(/ys(e|ed|ing)$/, 'yz$1').replace(/([tb])re$/, '$1er')
  if (w.length > 3 && w.endsWith('e')) {
    w = w.slice(0, -1)
  }
  return w
}

// Vocabulary words repeat heavily, so their normal forms are cached while an index is built. Words from
// clinical notes are never cached.
const cachedNormaliseWord = (word: string, cache?: Map<string, string>): string => {
  if (!cache) {
    return normaliseWord(word)
  }
  if (!cache.has(word)) {
    cache.set(word, normaliseWord(word))
  }
  return cache.get(word)
}

const tokenise = (text: string, cache?: Map<string, string>): Token[] => {
  const tokens: Token[] = []
  let previousEnd = 0
  WORD_REGEX.lastIndex = 0
  let match = WORD_REGEX.exec(text)
  while (match) {
    const start = match.index
    const end = start + match[0].length
    const previous = tokens[tokens.length - 1]
    const isPossessive = previous && previous.end === start - 1 && match[0].toLowerCase() === 's' &&
      APOSTROPHES.includes(text[start - 1])
    if (isPossessive) {
      previous.end = end
    } else {
      const raw = foldWord(match[0])
      tokens.push({ raw, norm: cachedNormaliseWord(raw, cache), start, end, gap: text.slice(previousEnd, start) })
    }
    previousEnd = end
    match = WORD_REGEX.exec(text)
  }
  return tokens
}

const gapAfter = (text: string, tokens: Token[], index: number): string => (
  index + 1 < tokens.length ? tokens[index + 1].gap : text.slice(tokens[index].end)
)

// Words of one phrase may be separated by spaces, hyphens, slashes, apostrophes and a single line break
const isPhraseGap = (gap: string): boolean => /^[ \t\r\n\-/'\u2019]*$/.test(gap) && gap.split('\n').length < 3

const isCueGap = (gap: string): boolean => /^[ \t\-/'\u2019]*$/.test(gap)

const SENTENCE_BOUNDARY_REGEX = /[.;!?()\n]/

const getLabelKeys = (label: string, cache: Map<string, string>): string[][] => {
  const tokens = tokenise(label, cache).filter(({ raw }) => raw !== SKIPPED_WORD)
  const key = tokens.map(({ norm }) => norm)
  if (!tokens.some(({ gap }, i) => i > 0 && gap === '-')) {
    return [key]
  }
  const joined = tokens.reduce((acc, token, i) => {
    if (i > 0 && token.gap === '-') {
      acc[acc.length - 1] += token.raw
    } else {
      acc.push(token.raw)
    }
    return acc
  }, [] as string[]).map(word => normaliseWord(word))
  return [key, joined]
}

const isDescendant = (id: string, ancestorId: string, parents: Map<string, string | null>): boolean => {
  let current = parents.get(id)
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (current === ancestorId) {
      return true
    }
    current = parents.get(current)
  }
  return false
}

// When two terms share a label, the term it names wins over a term it is a synonym of, then the more specific term
const isPreferredEntry = (entry: TrieEntry, existing: TrieEntry, parents: Map<string, string | null>): boolean => {
  if (entry.isName !== existing.isName) {
    return entry.isName
  }
  if (isDescendant(entry.id, existing.id, parents)) {
    return true
  }
  return !isDescendant(existing.id, entry.id, parents) && entry.id < existing.id
}

const MIN_SINGLE_WORD_SYNONYM_LENGTH = 3

export const buildHpoIndex = (terms: HpoVocabularyTerm[]): HpoIndex => {
  const root: TrieNode = { children: new Map() }
  const labels = new Map<string, string>()
  const parents = new Map<string, string | null>()
  terms.forEach(([id, name, parentId]) => {
    labels.set(id, name)
    parents.set(id, parentId)
  })

  const insert = (key: string[], entry: TrieEntry) => {
    if (!key.length || (!entry.isName && key.length === 1 && key[0].length < MIN_SINGLE_WORD_SYNONYM_LENGTH)) {
      return
    }
    const node = key.reduce((acc, word) => {
      if (!acc.children.has(word)) {
        acc.children.set(word, { children: new Map() })
      }
      return acc.children.get(word)
    }, root)
    if (!node.entry || (node.entry.id !== entry.id && isPreferredEntry(entry, node.entry, parents))) {
      node.entry = entry
    }
  }

  const cache = new Map<string, string>()
  terms.forEach(([id, name, , synonyms]) => {
    getLabelKeys(name, cache).forEach(key => insert(key, { id, isName: true }))
    ;(synonyms || []).forEach(
      synonym => getLabelKeys(synonym, cache).forEach(key => insert(key, { id, isName: false })),
    )
  })

  return { root, labels, size: terms.length }
}

interface TokenMatch {
  entry: TrieEntry
  endToken: number
}

const findLongestMatch = (tokens: Token[], startToken: number, root: TrieNode): TokenMatch | null => {
  let best: TokenMatch | null = null
  const walk = (node: TrieNode, index: number) => {
    if (node.entry && (!best || index > best.endToken)) {
      best = { entry: node.entry, endToken: index }
    }
    if (index >= tokens.length || (index > startToken && !isPhraseGap(tokens[index].gap))) {
      return
    }
    const token = tokens[index]
    const child = node.children.get(token.norm)
    if (child) {
      walk(child, index + 1)
    }
    if (index > startToken && token.raw === SKIPPED_WORD) {
      walk(node, index + 1)
    }
    const next = tokens[index + 1]
    if (next && next.gap === '-') {
      const joinedChild = node.children.get(normaliseWord(token.raw + next.raw))
      if (joinedChild) {
        walk(joinedChild, index + 2)
      }
    }
  }
  walk(root, startToken)
  return best
}

const NEGATION = 'negation'
const FAMILY_CUE = 'family'
const UNCERTAINTY = 'uncertainty'
const TERMINATOR = 'terminator'
const ASSERTION = 'assertion'
const SUBJECT = 'subject'
const PSEUDO = 'pseudo'

const FORWARD = 'forward'
const BACKWARD = 'backward'
// Applies backward when it ends its clause ("seizures ruled out."), otherwise forward ("ruled out seizures")
const EITHER = 'either'

type CueType = typeof NEGATION | typeof FAMILY_CUE | typeof UNCERTAINTY | typeof TERMINATOR |
  typeof ASSERTION | typeof SUBJECT | typeof PSEUDO
type CueDirection = typeof FORWARD | typeof BACKWARD | typeof EITHER

interface Cue {
  type: CueType
  direction: CueDirection
}

interface CueNode {
  children: Map<string, CueNode>
  cue?: Cue
}

const NEGATED_AUXILIARIES = [
  'not', 'never', 'hasn t', 'haven t', 'hadn t', 'doesn t', 'don t', 'didn t', 'isn t', 'wasn t', 'aren t', 'weren t',
  'has not', 'have not', 'had not', 'does not', 'do not', 'did not', 'has never', 'have never', 'had never',
]
const NEGATED_AUXILIARY_VERBS = ['had', 'have', 'been', 'got', 'ever had', 'shown', 'show', 'developed', 'develop']

const CUE_PHRASES: [CueType, CueDirection, string[]][] = [
  [NEGATION, FORWARD, [
    'no', 'without', 'denies', 'denied', 'deny', 'negative for', 'no evidence of', 'no evidence for', 'no sign of',
    'no signs of', 'no history of', 'no h o', 'no hx of', 'no previous', 'no prior', 'absence of', 'free of',
    'lack of', 'lacks', 'neither', 'nor', 'no longer', 'no longer has', 'no longer had', 'rules out',
    ...NEGATED_AUXILIARIES,
    ...NEGATED_AUXILIARIES.reduce((acc, aux) => [...acc, ...NEGATED_AUXILIARY_VERBS.map(verb => `${aux} ${verb}`)], []),
  ]],
  [NEGATION, EITHER, ['absent', 'negative', 'ruled out', 'excluded', 'nil', 'none']],
  [NEGATION, BACKWARD, [
    'not present', 'not seen', 'not detected', 'not observed', 'not noted', 'not reported', 'not identified',
    'not found', 'was ruled out', 'were ruled out', 'has been ruled out', 'have been ruled out', 'was excluded',
    'were excluded', 'is absent', 'are absent', 'was absent', 'were absent', 'was negative', 'were negative',
  ]],
  [UNCERTAINTY, FORWARD, [
    'possibly', 'probably', 'query', 'rule out', 'r o', 'to exclude', 'may have', 'might have', 'may be', 'might be',
    'could be', 'could have', 'concern for', 'concerns for', 'concern about', 'concerns about', 'risk of',
    'at risk of', 'at risk for', 'screen for', 'screening for', 'investigate for', 'evaluate for', 'assess for',
    'monitor for', 'watch for', 'awaiting', 'differential', 'cannot exclude', 'can t exclude', 'unclear if',
    'unclear whether', 'unsure if', 'unsure whether', 'not certain', 'not sure', 'if', 'in case of', 'suspicion of',
    'suspicious for', 'suggestive of',
  ]],
  [UNCERTAINTY, EITHER, [
    'possible', 'probable', 'suspected', 'queried', 'questionable', 'uncertain', 'likely', 'unlikely', 'unconfirmed',
  ]],
  [UNCERTAINTY, BACKWARD, [
    'not ruled out', 'not excluded', 'not been ruled out', 'not been excluded', 'cannot be excluded',
    'cannot be ruled out', 'can t be excluded', 'can t be ruled out', 'not confirmed', 'is possible', 'are possible',
    'is suspected', 'are suspected', 'is unlikely', 'are unlikely',
  ]],
  [FAMILY_CUE, FORWARD, [
    'family history', 'family hx', 'fam hx', 'fhx', 'fh', 'mother', 'father', 'mum', 'mom', 'dad', 'brother',
    'brothers', 'sister', 'sisters', 'sibling', 'siblings', 'sib', 'sibs', 'aunt', 'aunts', 'uncle', 'uncles',
    'cousin', 'cousins', 'grandmother', 'grandfather', 'grandparent', 'grandparents', 'grandma', 'grandpa', 'parent',
    'parents', 'maternal', 'paternal', 'relative', 'relatives', 'nephew', 'niece',
  ]],
  [TERMINATOR, FORWARD, [
    'but', 'however', 'although', 'though', 'except', 'yet', 'whereas', 'apart from', 'aside from', 'other than',
  ]],
  [ASSERTION, FORWARD, ['has', 'had', 'does have', 'presents with', 'presented with', 'developed']],
  [SUBJECT, FORWARD, ['patient', 'proband']],
  [PSEUDO, FORWARD, [
    'no increase', 'no change', 'no significant change', 'not only', 'no doubt', 'without doubt', 'gram negative',
  ]],
]

const CUE_ROOT: CueNode = { children: new Map() }
CUE_PHRASES.forEach(([type, direction, phrases]) => phrases.forEach((phrase) => {
  const node = phrase.split(' ').reduce((acc, word) => {
    if (!acc.children.has(word)) {
      acc.children.set(word, { children: new Map() })
    }
    return acc.children.get(word)
  }, CUE_ROOT)
  node.cue = { type, direction }
}))

// A relative who is the source of the information is not the subject of it: "mother reports seizures"
const REPORTING_WORDS = new Set([
  'report', 'reports', 'reported', 'reporting', 'say', 'says', 'said', 'notice', 'notices', 'noticed', 'note', 'notes',
  'noted', 'describe', 'describes', 'described', 'state', 'states', 'stated', 'concerned', 'worried', 'feel', 'feels',
  'felt', 'think', 'thinks', 'thought', 'observed', 'observes', 'mention', 'mentions', 'mentioned', 'deny', 'denies',
  'denied', 'recall', 'recalls', 'recalled', 'brought',
])
const REPORTING_PREPOSITIONS = new Set(['per', 'by', 'from', 'with'])
const REPORTING_LOOKAHEAD = 2

interface CueMatch {
  cue: Cue
  endToken: number
}

const findCue = (tokens: Token[], startToken: number, covered: boolean[]): CueMatch | null => {
  let best: CueMatch | null = null
  let node = CUE_ROOT
  for (let index = startToken; index < tokens.length; index += 1) {
    if (covered[index] || (index > startToken && !isCueGap(tokens[index].gap))) {
      break
    }
    node = node.children.get(tokens[index].raw)
    if (!node) {
      break
    }
    if (node.cue) {
      best = { cue: node.cue, endToken: index + 1 }
    }
  }
  return best
}

interface Scope {
  [NEGATION]: string | null
  [FAMILY_CUE]: string | null
  [UNCERTAINTY]: string | null
}

type ScopeType = keyof Scope

interface PendingHit extends Scope {
  id: string
  startToken: number
  endToken: number
}

const emptyScope = (): Scope => ({ [NEGATION]: null, [FAMILY_CUE]: null, [UNCERTAINTY]: null })

const isReportingRelative = (tokens: Token[], startToken: number, endToken: number): boolean => (
  (startToken > 0 && isCueGap(tokens[startToken].gap) && REPORTING_PREPOSITIONS.has(tokens[startToken - 1].raw)) ||
  tokens.slice(endToken, endToken + REPORTING_LOOKAHEAD).some(
    (token, i) => REPORTING_WORDS.has(token.raw) && tokens.slice(endToken, endToken + i + 1).every(t => isCueGap(t.gap)),
  )
)

const QUESTION_PREFIX_REGEX = /(^|[\s(])\?+\s?$/

const getStatus = (hit: Scope): [HpoHitStatus, string | null] => {
  if (hit[FAMILY_CUE]) {
    return [FAMILY, hit[FAMILY_CUE]]
  }
  if (hit[UNCERTAINTY]) {
    return [UNCERTAIN, hit[UNCERTAINTY]]
  }
  if (hit[NEGATION]) {
    return [ABSENT, hit[NEGATION]]
  }
  return [PRESENT, null]
}

export const extractHpoTerms = (text: string, index: HpoIndex): HpoHit[] => {
  const tokens = tokenise(text)

  const hits: PendingHit[] = []
  const covered: boolean[] = tokens.map(() => false)
  const hitByStartToken = new Map<number, PendingHit>()
  for (let i = 0; i < tokens.length;) {
    const match = findLongestMatch(tokens, i, index.root)
    if (match) {
      const hit = { id: match.entry.id, startToken: i, endToken: match.endToken, ...emptyScope() }
      hits.push(hit)
      hitByStartToken.set(i, hit)
      covered.fill(true, i, match.endToken)
      i = match.endToken
    } else {
      i += 1
    }
  }

  let scope = emptyScope()
  let clauseStartToken = 0
  const applyBackward = (type: ScopeType, cueText: string, cueToken: number) => {
    for (let h = hits.length - 1; h >= 0; h -= 1) {
      if (hits[h].endToken <= cueToken) {
        if (hits[h].startToken < clauseStartToken) {
          break
        }
        hits[h][type] = cueText
      }
    }
  }

  for (let i = 0; i < tokens.length;) {
    const { gap } = tokens[i]
    if (SENTENCE_BOUNDARY_REGEX.test(gap)) {
      scope = emptyScope()
      clauseStartToken = i
    } else if (gap.includes(',')) {
      scope[UNCERTAINTY] = null
      clauseStartToken = i
    }

    const hit = hitByStartToken.get(i)
    const cueMatch = !hit && findCue(tokens, i, covered)
    if (hit) {
      Object.assign(hit, {
        [NEGATION]: hit[NEGATION] || scope[NEGATION],
        [FAMILY_CUE]: hit[FAMILY_CUE] || scope[FAMILY_CUE],
        [UNCERTAINTY]: hit[UNCERTAINTY] || scope[UNCERTAINTY],
      })
      const isSuffixOfPrevious = i > 0 && gap.startsWith('?')
      if (gapAfter(text, tokens, hit.endToken - 1).startsWith('?') ||
        (!isSuffixOfPrevious && QUESTION_PREFIX_REGEX.test(gap))) {
        hit[UNCERTAINTY] = '?'
      }
      i = hit.endToken
    } else if (cueMatch) {
      const { cue: { type, direction }, endToken } = cueMatch
      const cueText = text.slice(tokens[i].start, tokens[endToken - 1].end)
      const followingGap = gapAfter(text, tokens, endToken - 1)
      const endsClause = endToken === tokens.length || SENTENCE_BOUNDARY_REGEX.test(followingGap) ||
        followingGap.includes(',')
      // "Seizures: no" answers the heading before the colon instead of negating what follows
      const isAnswer = type === NEGATION && endsClause && gap.includes(':')
      if (type === TERMINATOR) {
        scope = emptyScope()
        clauseStartToken = endToken
      } else if (type === ASSERTION) {
        scope[NEGATION] = null
      } else if (type === SUBJECT) {
        scope[FAMILY_CUE] = null
      } else if (type === FAMILY_CUE) {
        if (!isReportingRelative(tokens, i, endToken)) {
          scope[FAMILY_CUE] = cueText
        }
      } else if (type !== PSEUDO) {
        if (direction === BACKWARD || isAnswer || (direction === EITHER && endsClause)) {
          applyBackward(type, cueText, i)
        } else {
          scope[type] = cueText
        }
      }
      i = endToken
    } else {
      i += 1
    }
  }

  return hits.map(({ id, startToken, endToken, ...hitScope }) => {
    const start = tokens[startToken].start
    const { end } = tokens[endToken - 1]
    const [status, cue] = getStatus(hitScope)
    return { id, label: index.labels.get(id), matchedText: text.slice(start, end), start, end, status, cue }
  })
}

const summariseStatus = (statuses: Set<HpoHitStatus>): [HpoHitStatus, boolean] => {
  if (statuses.has(PRESENT) && statuses.has(ABSENT)) {
    return [UNCERTAIN, true]
  }
  const status = [PRESENT, ABSENT, UNCERTAIN, FAMILY].find(s => statuses.has(s))
  return [status === ABSENT && statuses.has(UNCERTAIN) ? UNCERTAIN : status, false]
}

// One entry per term, in order of first mention. Mentions about relatives are ignored when the term is
// also mentioned for the patient, and a term that is both asserted and negated needs the reviewer to decide.
export const summariseHits = (hits: HpoHit[]): HpoTermSummary[] => {
  const hitsById = hits.reduce((acc, hit) => acc.set(hit.id, [...(acc.get(hit.id) || []), hit]), new Map<string, HpoHit[]>())
  return Array.from(hitsById.values()).map((termHits) => {
    const [status, conflicting] = summariseStatus(new Set(termHits.map(hit => hit.status)))
    return {
      id: termHits[0].id,
      label: termHits[0].label,
      status,
      conflicting,
      matchedTexts: Array.from(new Set(termHits.map(({ matchedText }) => matchedText))),
      cues: Array.from(new Set(termHits.filter(({ cue }) => cue).map(({ cue }) => cue))),
    }
  })
}

export const getTextSegments = (text: string, hits: HpoHit[]): TextSegment[] => {
  const segments: TextSegment[] = []
  let position = 0
  hits.forEach((hit) => {
    if (hit.start > position) {
      segments.push({ text: text.slice(position, hit.start) })
    }
    segments.push({ text: text.slice(hit.start, hit.end), hit })
    position = hit.end
  })
  if (position < text.length) {
    segments.push({ text: text.slice(position) })
  }
  return segments
}
