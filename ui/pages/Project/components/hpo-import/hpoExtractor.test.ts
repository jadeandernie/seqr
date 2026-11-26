import {
  HpoVocabularyTerm, buildHpoIndex, extractHpoTerms, getTextSegments, normaliseWord, summariseHits,
} from './hpoExtractor'

const TERMS: HpoVocabularyTerm[] = [
  ['HP:0000252', 'Microcephaly', 'HP:0000240', ['Small head', 'Decreased head circumference']],
  ['HP:0000365', 'Hearing impairment', 'HP:0000364', ['Hearing loss', 'Deafness']],
  ['HP:0000407', 'Sensorineural hearing impairment', 'HP:0000365', ['Sensorineural hearing loss']],
  ['HP:0000518', 'Cataract', 'HP:0000517', []],
  ['HP:0000750', 'Delayed speech and language development', 'HP:0002463', ['Speech delay']],
  ['HP:0000853', 'Goiter', 'HP:0000820', []],
  ['HP:0000872', 'Hashimoto thyroiditis', 'HP:0100646', []],
  ['HP:0000957', 'Cafe-au-lait spot', 'HP:0001000', ['Café-au-lait macule']],
  ['HP:0000969', 'Edema', 'HP:0001574', []],
  ['HP:0001047', 'Atopic dermatitis', 'HP:0011123', ['Eczema']],
  ['HP:0001249', 'Intellectual disability', 'HP:0012759', []],
  ['HP:0001250', 'Seizure', 'HP:0012638', ['Seizures', 'Epileptic seizure']],
  ['HP:0001252', 'Hypotonia', 'HP:0003808', ['Muscular hypotonia', 'Low muscle tone']],
  ['HP:0001263', 'Global developmental delay', 'HP:0012758', []],
  ['HP:0001290', 'Generalized hypotonia', 'HP:0001252', []],
  ['HP:0001344', 'Absent speech', 'HP:0002167', ['Non-verbal', 'Lack of speech']],
  ['HP:0001513', 'Obesity', 'HP:0004324', []],
  ['HP:0001629', 'Ventricular septal defect', 'HP:0001671', []],
  ['HP:0001631', 'Atrial septal defect', 'HP:0001671', ['Defect in the atrial septum']],
  ['HP:0001636', 'Tetralogy of Fallot', 'HP:0001627', []],
  ['HP:0001671', 'Abnormal cardiac septum morphology', 'HP:0001627', ['Septal defect']],
  ['HP:0001903', 'Anemia', 'HP:0001871', []],
  ['HP:0002121', 'Generalized non-motor (absence) seizure', 'HP:0001250', ['Absence seizure']],
  ['HP:0002315', 'Headache', 'HP:0012638', []],
  ['HP:0002376', 'Developmental regression', 'HP:0012759', []],
  ['HP:0002650', 'Scoliosis', 'HP:0002943', []],
  ['HP:0002664', 'Neoplasm', 'HP:0000118', ['Tumor']],
  ['HP:0004322', 'Short stature', 'HP:0000002', ['Small stature']],
  ['HP:0009800', 'Maternal diabetes', 'HP:0002686', []],
  ['HP:0010864', 'Intellectual disability, severe', 'HP:0001249', ['Severe intellectual disability']],
  ['HP:0012758', 'Neurodevelopmental delay', 'HP:0012759', ['Developmental delay']],
  ['HP:0100033', 'Tics', 'HP:0100022', []],
  ['HP:0100543', 'Cognitive impairment', 'HP:0011446', ['ID']],
  ['HP:9000001', 'Abnormal gait', 'HP:0001288', ['Wobbly walking']],
  ['HP:9000002', 'Gait ataxia', 'HP:9000001', ['Wobbly walking']],
  ['HP:9000003', 'Sneezing', 'HP:0000118', []],
  ['HP:9000004', 'Paroxysmal sneezing', 'HP:9000003', ['Sneezing']],
  ['HP:9000005', 'Abnormal blinking', 'HP:0000118', ['Blinking oddly']],
  ['HP:9000006', 'Excessive blinking', 'HP:9000007', ['Blinking oddly']],
]

const INDEX = buildHpoIndex(TERMS)

const extract = (text: string) => extractHpoTerms(text, INDEX).map(
  ({ id, matchedText, status }) => [id, matchedText, status],
)

const statuses = (text: string) => extractHpoTerms(text, INDEX).reduce(
  (acc, { matchedText, status }) => ({ ...acc, [matchedText.toLowerCase()]: status }), {},
)

describe('normaliseWord', () => {
  test.each([
    ['Seizures', 'seizur'], ['seizure', 'seizur'],
    ['anomalies', 'anomaly'], ['anomaly', 'anomaly'],
    ['headaches', 'headach'], ['headache', 'headach'],
    ['patches', 'patch'], ['patch', 'patch'],
    ['abscesses', 'abscess'], ['abscess', 'abscess'],
    ['anaemia', 'anemia'], ['anemia', 'anemia'], ['Haemoglobin', 'hemoglobin'],
    ['oedema', 'edema'], ['diarrhoea', 'diarrhea'], ['coeliac', 'celiac'],
    ['tumours', 'tumor'], ['tumor', 'tumor'], ['behavioural', 'behavioral'],
    ['generalised', 'generalized'], ['paralysed', 'paralyzed'], ['mineralisation', 'mineralization'],
    ['goitre', 'goiter'], ['fibres', 'fiber'], ['centre', 'center'],
    ['leucopenia', 'leukopenia'], ['sulphate', 'sulfat'],
    ['café', 'caf'], ['feet', 'foot'], ['teeth', 'tooth'], ['naevi', 'nevus'], ['grey', 'gray'],
  ])('maps %s to %s', (word, expected) => {
    expect(normaliseWord(word)).toEqual(expected)
  })

  test.each(['ptosis', 'nevus', 'loss', 'pes', 'toe', 'eye', 'hour', 'four', '3rd', '53s'])(
    'leaves %s unchanged', (word) => {
      expect(normaliseWord(word)).toEqual(word)
    },
  )
})

describe('dictionary matching', () => {
  test('matches term names case-insensitively and reports the term, label, text and offsets', () => {
    const text = 'Presented with HYPOTONIA and seizure.'
    expect(extractHpoTerms(text, INDEX)).toEqual([
      { id: 'HP:0001252', label: 'Hypotonia', matchedText: 'HYPOTONIA', start: 15, end: 24, status: 'present', cue: null },
      { id: 'HP:0001250', label: 'Seizure', matchedText: 'seizure', start: 29, end: 36, status: 'present', cue: null },
    ])
  })

  test('offsets always index the original text', () => {
    const text = '  Café-au-lait  macules;\n\tsevere  intellectual\ndisability (tumours), Fallot’s tetralogy'
    const hits = extractHpoTerms(text, INDEX)
    expect(hits.map(({ id }) => id)).toEqual(['HP:0000957', 'HP:0010864', 'HP:0002664'])
    hits.forEach((hit) => {
      expect(text.slice(hit.start, hit.end)).toEqual(hit.matchedText)
    })
    expect(hits.map(({ matchedText }) => matchedText)).toEqual([
      'Café-au-lait  macules', 'severe  intellectual\ndisability', 'tumours',
    ])
  })

  test('keeps only the longest match so nested terms are not reported twice', () => {
    expect(extract('atrial septal defect')).toEqual([['HP:0001631', 'atrial septal defect', 'present']])
    expect(extract('septal defect')).toEqual([['HP:0001671', 'septal defect', 'present']])
    expect(extract('a ventricular septal defect and hearing loss')).toEqual([
      ['HP:0001629', 'ventricular septal defect', 'present'],
      ['HP:0000365', 'hearing loss', 'present'],
    ])
  })

  test('prefers the more specific term when a longer span matches it', () => {
    expect(extract('severe intellectual disability')).toEqual([
      ['HP:0010864', 'severe intellectual disability', 'present'],
    ])
    expect(extract('intellectual disability')).toEqual([['HP:0001249', 'intellectual disability', 'present']])
    expect(extract('sensorineural hearing loss')).toEqual([['HP:0000407', 'sensorineural hearing loss', 'present']])
    expect(extract('generalised hypotonia')).toEqual([['HP:0001290', 'generalised hypotonia', 'present']])
    expect(extract('global developmental delay')).toEqual([['HP:0001263', 'global developmental delay', 'present']])
    expect(extract('developmental delay')).toEqual([['HP:0012758', 'developmental delay', 'present']])
  })

  test('resolves a label shared by several terms', () => {
    // synonym of a parent and its child: the child is more specific
    expect(extract('wobbly walking')).toEqual([['HP:9000002', 'wobbly walking', 'present']])
    // name of one term and synonym of another: the term it names
    expect(extract('sneezing')).toEqual([['HP:9000003', 'sneezing', 'present']])
    // unrelated terms: stable choice
    expect(extract('blinking oddly')).toEqual([['HP:9000005', 'blinking oddly', 'present']])
    const reversedIndex = buildHpoIndex([...TERMS].reverse())
    expect(extractHpoTerms('wobbly walking, sneezing, blinking oddly', reversedIndex).map(({ id }) => id)).toEqual(
      ['HP:9000002', 'HP:9000003', 'HP:9000005'],
    )
  })

  test('matches synonyms', () => {
    expect(extract('low muscle tone, eczema and a small head')).toEqual([
      ['HP:0001252', 'low muscle tone', 'present'],
      ['HP:0001047', 'eczema', 'present'],
      ['HP:0000252', 'small head', 'present'],
    ])
  })

  test('matches British spellings of American term names', () => {
    expect(extract('Anaemia with oedema, goitre and a tumour')).toEqual([
      ['HP:0001903', 'Anaemia', 'present'],
      ['HP:0000969', 'oedema', 'present'],
      ['HP:0000853', 'goitre', 'present'],
      ['HP:0002664', 'tumour', 'present'],
    ])
  })

  test('matches plural and singular forms in both directions', () => {
    expect(extract('cataracts, headaches, tumours, absence seizures')).toEqual([
      ['HP:0000518', 'cataracts', 'present'],
      ['HP:0002315', 'headaches', 'present'],
      ['HP:0002664', 'tumours', 'present'],
      ['HP:0002121', 'absence seizures', 'present'],
    ])
    expect(extract('one tic')).toEqual([['HP:0100033', 'tic', 'present']])
  })

  test('treats hyphens, slashes, possessives, accents and "the" as insignificant', () => {
    expect(extract('cafe au lait spots')).toEqual([['HP:0000957', 'cafe au lait spots', 'present']])
    expect(extract('café-au-lait macules')).toEqual([['HP:0000957', 'café-au-lait macules', 'present']])
    expect(extract('nonverbal')).toEqual([['HP:0001344', 'nonverbal', 'present']])
    expect(extract('non verbal')).toEqual([['HP:0001344', 'non verbal', 'present']])
    expect(extract('micro-cephaly')).toEqual([['HP:0000252', 'micro-cephaly', 'present']])
    expect(extract('hearing-loss')).toEqual([['HP:0000365', 'hearing-loss', 'present']])
    expect(extract('Hashimoto\'s thyroiditis')).toEqual([['HP:0000872', 'Hashimoto\'s thyroiditis', 'present']])
    expect(extract('defect in atrial septum')).toEqual([['HP:0001631', 'defect in atrial septum', 'present']])
    expect(extract('a defect in the atrial septum')).toEqual([['HP:0001631', 'defect in the atrial septum', 'present']])
    expect(extract('tetralogy of the Fallot')).toEqual([['HP:0001636', 'tetralogy of the Fallot', 'present']])
  })

  test('does not match inside longer words', () => {
    expect(extract('arthritic antiseizure medication, cataractous, hypotonicity, tumorigenic, seizurelike')).toEqual([])
    expect(extract('tics')).toEqual([['HP:0100033', 'tics', 'present']])
  })

  test('does not match a term across punctuation or a paragraph break', () => {
    expect(extract('hearing. Loss of weight')).toEqual([])
    expect(extract('short, stature normal')).toEqual([])
    expect(extract('hearing\n\nloss')).toEqual([])
    expect(extract('hearing\nloss')).toEqual([['HP:0000365', 'hearing\nloss', 'present']])
  })

  test('ignores very short single-word synonyms but keeps short names', () => {
    expect(extract('ID bracelet')).toEqual([])
    expect(extract('cognitive impairment')).toEqual([['HP:0100543', 'cognitive impairment', 'present']])
  })

  test('returns nothing for empty text or an empty vocabulary', () => {
    expect(extract('')).toEqual([])
    expect(extract('   \n ')).toEqual([])
    expect(extractHpoTerms('seizures', buildHpoIndex([]))).toEqual([])
    expect(buildHpoIndex([['HP:1', '-', null, null]]).size).toEqual(1)
  })

  test('misses paraphrases and reordered wording that have no synonym', () => {
    expect(extract('he is very floppy and has fits')).toEqual([])
    expect(extract('delay in development')).toEqual([])
    expect(extract('the septum of the atrium has a defect')).toEqual([])
  })
})

describe('negation', () => {
  test.each([
    'No seizures', 'no evidence of seizures', 'No history of seizures', 'no h/o seizures', 'Denies seizures',
    'denied any seizures', 'without seizures', 'negative for seizures', 'never had seizures', 'has never had seizures',
    'has not had seizures', 'hasn\'t had seizures', 'does not have seizures', 'doesn\'t have seizures',
    'did not develop seizures', 'not seizures', 'absent seizures', 'absence of seizures', 'ruled out seizures',
    'seizures ruled out', 'seizures were ruled out', 'seizures have been ruled out', 'Seizures absent',
    'Seizures: absent', 'Seizures: no', 'Seizures: none', 'Seizures - negative', 'seizures not present',
    'seizures were not seen', 'seizures not reported', 'seizures excluded', 'free of seizures', 'no longer has seizures',
    'no sign of seizures', 'nil seizures',
  ])('"%s" is absent', (text) => {
    expect(extract(text).map(([id, , status]) => [id, status])).toEqual([['HP:0001250', 'absent']])
  })

  test('reports the cue that negated a term', () => {
    expect(extractHpoTerms('There is no evidence of seizures', INDEX)[0].cue).toEqual('no evidence of')
    expect(extractHpoTerms('Seizures were Ruled Out', INDEX)[0].cue).toEqual('were Ruled Out')
  })

  test('scope covers a comma separated list up to the end of the sentence', () => {
    expect(statuses('No seizures, hypotonia or microcephaly. Scoliosis noted')).toEqual({
      seizures: 'absent', hypotonia: 'absent', microcephaly: 'absent', scoliosis: 'present',
    })
  })

  test.each([
    ['No seizures but hypotonia'],
    ['No seizures, however hypotonia'],
    ['No seizures although hypotonia'],
    ['No seizures though hypotonia'],
    ['No seizures except hypotonia'],
    ['No seizures apart from hypotonia'],
    ['No seizures; hypotonia'],
    ['No seizures. Hypotonia'],
    ['No seizures\nHypotonia'],
    ['No seizures (hypotonia)'],
    ['No seizures! Hypotonia'],
    ['No seizures, has hypotonia'],
    ['No seizures and presents with hypotonia'],
    ['No seizures, he had hypotonia'],
    ['No seizures yet hypotonia'],
  ])('scope is terminated in "%s"', (text) => {
    expect(statuses(text)).toEqual({ seizures: 'absent', hypotonia: 'present' })
  })

  test('backward cues only reach back to the start of their clause', () => {
    expect(statuses('Hypotonia, seizures absent')).toEqual({ hypotonia: 'present', seizures: 'absent' })
    expect(statuses('Hypotonia. Seizures ruled out. Scoliosis')).toEqual({
      hypotonia: 'present', seizures: 'absent', scoliosis: 'present',
    })
    expect(statuses('Hypotonia but seizures excluded')).toEqual({ hypotonia: 'present', seizures: 'absent' })
    expect(statuses('Seizures and hypotonia: absent')).toEqual({ seizures: 'absent', hypotonia: 'absent' })
  })

  test('an answer after a colon does not negate the next item', () => {
    expect(statuses('Seizures: no, Hypotonia: yes, Scoliosis: none\nMicrocephaly: present')).toEqual({
      seizures: 'absent', hypotonia: 'present', scoliosis: 'absent', microcephaly: 'present',
    })
    expect(statuses('Exam: no microcephaly')).toEqual({ microcephaly: 'absent' })
  })

  test('a negation word inside a term name is part of the term', () => {
    expect(extract('absent speech')).toEqual([['HP:0001344', 'absent speech', 'present']])
    expect(extract('non-verbal')).toEqual([['HP:0001344', 'non-verbal', 'present']])
    expect(extract('lack of speech')).toEqual([['HP:0001344', 'lack of speech', 'present']])
    expect(extract('absence seizures')).toEqual([['HP:0002121', 'absence seizures', 'present']])
    expect(extract('no absence seizures')).toEqual([['HP:0002121', 'absence seizures', 'absent']])
  })

  test('pseudo negations are ignored', () => {
    expect(statuses('No change in seizures')).toEqual({ seizures: 'present' })
    expect(statuses('not only seizures')).toEqual({ seizures: 'present' })
    expect(statuses('no increase in seizures')).toEqual({ seizures: 'present' })
  })

  test('negation carries across a line break only within a wrapped term', () => {
    expect(statuses('No hearing\nloss\nseizures')).toEqual({ 'hearing\nloss': 'absent', seizures: 'present' })
  })
})

describe('family history', () => {
  test.each([
    'Mother has seizures', 'family history of seizures', 'Family history: seizures', 'FHx seizures',
    'sibling with seizures', 'Maternal uncle with seizures', 'Brother: seizures', 'his father had seizures',
    'paternal grandmother - seizures', 'no family history of seizures', 'Two cousins have had seizures',
  ])('"%s" is not about the patient', (text) => {
    expect(extract(text).map(([id, , status]) => [id, status])).toEqual([['HP:0001250', 'family']])
  })

  test('reports the relative as the cue', () => {
    expect(extractHpoTerms('Her Mother has seizures', INDEX)[0].cue).toEqual('Mother')
    expect(extractHpoTerms('no family history of seizures', INDEX)[0].cue).toEqual('family history')
  })

  test('scope runs to the end of the sentence, including lists', () => {
    expect(statuses('Hypotonia. Mother has seizures, scoliosis and obesity. Microcephaly')).toEqual({
      hypotonia: 'present', seizures: 'family', scoliosis: 'family', obesity: 'family', microcephaly: 'present',
    })
    expect(statuses('Hypotonia in sister')).toEqual({ hypotonia: 'present' })
  })

  test('scope ends when the subject returns to the patient', () => {
    expect(statuses('Mother has seizures but he has hypotonia')).toEqual({ seizures: 'family', hypotonia: 'present' })
    expect(statuses('Father has seizures, patient has hypotonia')).toEqual({ seizures: 'family', hypotonia: 'present' })
    expect(statuses('Father has seizures whereas the proband has no hypotonia')).toEqual({
      seizures: 'family', hypotonia: 'absent',
    })
  })

  test('a relative who reports the history is not its subject', () => {
    expect(statuses('Mother reports seizures')).toEqual({ seizures: 'present' })
    expect(statuses('Parents have noticed seizures')).toEqual({ seizures: 'present' })
    expect(statuses('Mother denies seizures')).toEqual({ seizures: 'absent' })
    expect(statuses('Seizures per mother. Hypotonia')).toEqual({ seizures: 'present', hypotonia: 'present' })
    expect(statuses('Lives with mother, has seizures')).toEqual({ seizures: 'present' })
    expect(statuses('Mother. Reports seizures')).toEqual({ seizures: 'present' })
    expect(statuses('Mother, who reports nothing, has seizures')).toEqual({ seizures: 'family' })
  })

  test('a relative inside a term name is part of the term', () => {
    expect(extract('maternal diabetes')).toEqual([['HP:0009800', 'maternal diabetes', 'present']])
  })
})

describe('uncertainty', () => {
  test.each([
    'possible seizures', 'Possibly seizures', 'probable seizures', 'suspected seizures', '?seizures', '? seizures',
    '??seizures', 'seizures?', 'query seizures', 'r/o seizures', 'rule out seizures', 'may have seizures',
    'concern for seizures', 'at risk of seizures', 'seizures suspected', 'seizures not ruled out',
    'seizures cannot be excluded', 'cannot exclude seizures', 'seizures are possible', 'likely seizures',
    'seizures unlikely', 'if seizures occur', 'differential includes seizures', 'awaiting EEG for seizures',
    '(?seizures)', 'possibly no seizures', 'no definite but possible seizures',
  ])('"%s" is unconfirmed', (text) => {
    expect(extract(text).map(([id, , status]) => [id, status])).toEqual([['HP:0001250', 'uncertain']])
  })

  test('reports the cue', () => {
    expect(extractHpoTerms('Possible seizures', INDEX)[0].cue).toEqual('Possible')
    expect(extractHpoTerms('?seizures', INDEX)[0].cue).toEqual('?')
  })

  test('scope ends at a comma, a terminator or the end of the sentence', () => {
    expect(statuses('possible seizures, hypotonia')).toEqual({ seizures: 'uncertain', hypotonia: 'present' })
    expect(statuses('possible seizures and hypotonia')).toEqual({ seizures: 'uncertain', hypotonia: 'uncertain' })
    expect(statuses('possible seizures but hypotonia')).toEqual({ seizures: 'uncertain', hypotonia: 'present' })
    expect(statuses('possible seizures. Hypotonia')).toEqual({ seizures: 'uncertain', hypotonia: 'present' })
  })

  test('a question mark only applies to the term it is attached to', () => {
    expect(statuses('Seizures? Hypotonia')).toEqual({ seizures: 'uncertain', hypotonia: 'present' })
    expect(statuses('Seizures ?hypotonia')).toEqual({ seizures: 'present', hypotonia: 'uncertain' })
    expect(statuses('Seizures, ? hypotonia, scoliosis')).toEqual({
      seizures: 'present', hypotonia: 'uncertain', scoliosis: 'present',
    })
    expect(statuses('Any concerns? Seizures')).toEqual({ seizures: 'present' })
  })

  test('family history takes precedence over uncertainty and negation', () => {
    expect(statuses('possible seizures in mother, sister has no hypotonia')).toEqual({
      seizures: 'uncertain', hypotonia: 'family',
    })
    expect(statuses('Mother has possible seizures')).toEqual({ seizures: 'family' })
  })
})

describe('summariseHits', () => {
  const summarise = (text: string) => summariseHits(extractHpoTerms(text, INDEX))

  test('returns one entry per term in order of first mention', () => {
    expect(summarise('Seizures from birth. Hypotonia. Further seizure at 2y, no scoliosis')).toEqual([
      {
        id: 'HP:0001250', label: 'Seizure', status: 'present', conflicting: false, matchedTexts: ['Seizures', 'seizure'], cues: [],
      },
      {
        id: 'HP:0001252', label: 'Hypotonia', status: 'present', conflicting: false, matchedTexts: ['Hypotonia'], cues: [],
      },
      {
        id: 'HP:0002650', label: 'Scoliosis', status: 'absent', conflicting: false, matchedTexts: ['scoliosis'], cues: ['no'],
      },
    ])
  })

  test.each([
    ['Seizures. No seizures', 'uncertain', true],
    ['No seizures. No seizures', 'absent', false],
    ['Possible seizures. Seizures', 'present', false],
    ['Possible seizures. No seizures', 'uncertain', false],
    ['Mother has seizures. Seizures', 'present', false],
    ['Mother has seizures. No seizures', 'absent', false],
    ['Mother has seizures. Father has seizures', 'family', false],
    ['Mother has seizures. ?seizures', 'uncertain', false],
  ])('"%s" is summarised as %s', (text, status, conflicting) => {
    expect(summarise(text).map(term => [term.status, term.conflicting])).toEqual([[status, conflicting]])
  })

  test('returns nothing without hits', () => {
    expect(summariseHits([])).toEqual([])
  })
})

describe('getTextSegments', () => {
  test('splits the text into plain and matched segments that rebuild the original text', () => {
    const text = 'Has seizures and no hypotonia.'
    const hits = extractHpoTerms(text, INDEX)
    const segments = getTextSegments(text, hits)
    expect(segments).toEqual([
      { text: 'Has ' },
      { text: 'seizures', hit: hits[0] },
      { text: ' and no ' },
      { text: 'hypotonia', hit: hits[1] },
      { text: '.' },
    ])
    expect(segments.map(segment => segment.text).join('')).toEqual(text)
  })

  test('handles text that starts or ends with a match, and text without matches', () => {
    const hits = extractHpoTerms('seizures', INDEX)
    expect(getTextSegments('seizures', hits)).toEqual([{ text: 'seizures', hit: hits[0] }])
    expect(getTextSegments('nothing here', [])).toEqual([{ text: 'nothing here' }])
    expect(getTextSegments('', [])).toEqual([])
  })
})

describe('performance', () => {
  const VOCABULARY_SIZE = 20000
  const NOTE_LENGTH = 20000
  const MAX_MILLISECONDS = 1000

  test('extracts from a 20,000 character note against a 20,000 term vocabulary well within a second', () => {
    const vocabulary: HpoVocabularyTerm[] = [...TERMS]
    for (let i = 0; i < VOCABULARY_SIZE; i += 1) {
      vocabulary.push([
        `HP:8${i}`, `Abnormality of region ${i} morphology`, 'HP:0000118', [`Region ${i} anomaly`, `Malformed part ${i}`],
      ])
    }
    const largeIndex = buildHpoIndex(vocabulary)
    expect(largeIndex.size).toEqual(VOCABULARY_SIZE + TERMS.length)

    const sentence = 'The patient has seizures and severe intellectual disability, no hearing loss; mother has ' +
      'scoliosis. Possible region 17 anomaly, abnormality of region 4321 morphology noted but not microcephaly.\n'
    const note = sentence.repeat(Math.ceil(NOTE_LENGTH / sentence.length))
    expect(note.length).toBeGreaterThanOrEqual(NOTE_LENGTH)

    extractHpoTerms(note, largeIndex)
    const durations = [1, 2, 3].map(() => {
      const start = Date.now()
      const hits = extractHpoTerms(note, largeIndex)
      const duration = Date.now() - start
      expect(hits.length).toEqual(7 * Math.ceil(NOTE_LENGTH / sentence.length))
      return duration
    })
    expect(Math.min(...durations)).toBeLessThan(MAX_MILLISECONDS)

    expect(summariseHits(extractHpoTerms(sentence, largeIndex)).map(({ id, status }) => [id, status])).toEqual([
      ['HP:0001250', 'present'], ['HP:0010864', 'present'], ['HP:0000365', 'absent'], ['HP:0002650', 'family'],
      ['HP:817', 'uncertain'], ['HP:84321', 'present'], ['HP:0000252', 'absent'],
    ])
  })
})
