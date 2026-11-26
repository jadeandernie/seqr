import { act } from 'react-dom/test-utils'

export const TEMPLATES_RESPONSE = {
  reportTemplatesByGuid: {
    RT0000001_family_analysis_summ: {
      reportTemplateGuid: 'RT0000001_family_analysis_summ',
      projectGuid: null,
      name: 'Family analysis summary',
      description: 'Research summary of a family',
      audience: 'researcher',
      body: '# {{family.displayName}}',
    },
    RT0000002_findings_summary: {
      reportTemplateGuid: 'RT0000002_findings_summary',
      projectGuid: null,
      name: 'Findings summary',
      description: null,
      audience: 'clinician',
      body: 'Findings for {{family.displayName}}',
    },
    RT0000003_candidates: {
      reportTemplateGuid: 'RT0000003_candidates',
      projectGuid: 'R0237_1000_genomes_demo',
      name: 'Candidate variants',
      description: 'Project specific summary',
      audience: 'researcher',
      body: '{{#variants}}{{variant.genes}}{{/variants}}',
    },
  },
  placeholders: [
    { placeholder: '{{family.displayName}}', description: 'Family display name' },
    { placeholder: '{{#variants}}...{{/variants}}', description: 'Repeats its content for each saved variant' },
    { placeholder: '{{variant.genes}}', description: 'Gene symbol(s)', block: 'variants' },
  ],
  audiences: [{ value: 'researcher', text: 'Researcher' }, { value: 'clinician', text: 'Clinician' }],
  researchUseLine: 'Research use only — not a clinical report',
  canEditProjectTemplates: true,
  canEditGlobalTemplates: false,
}

export const REPORT = {
  familyGuid: 'F011652_1',
  markdown: '> **Research use only — not a clinical report**\n\n# 1\n\n> **Research use only — not a clinical report**\n',
  usedData: ['family.displayName'],
  warnings: [],
}

// Routes are matched by the longest url prefix, so a specific route takes priority over a general one
export const mockFetch = (routes) => {
  const fetchMock = jest.fn((url) => {
    const path = Object.keys(routes).filter(route => url.startsWith(route)).sort((a, b) => b.length - a.length)[0]
    const { status = 200, body } = routes[path]
    return Promise.resolve({
      ok: status === 200, status, statusText: 'Bad Request', json: () => Promise.resolve(body),
    })
  })
  global.fetch = fetchMock
  return fetchMock
}

export const flush = async (wrapper) => {
  await act(async () => {
    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve()
    }
  })
  wrapper.update()
}

export const postedBody = (fetchMock, url) => {
  const call = fetchMock.mock.calls.filter(([callUrl]) => callUrl === url).pop()
  return JSON.parse(call[1].body)
}
