import reducers, {
  openExternalResourceFlyout, setExternalResourceFlyoutTab, closeExternalResourceFlyout, getExternalResourceFlyout,
  FlyoutContext,
} from './externalResourceFlyoutReducer'

const { externalResourceFlyout: reducer } = reducers

const CONTEXT: FlyoutContext = {
  entity: 'gene',
  title: 'TTN',
  geneId: 'ENSG00000155657',
  links: [{ key: 'gnomad', label: 'gnomAD', url: 'https://gnomad.broadinstitute.org/gene/ENSG00000155657', frameable: true }],
}

test('flyout is closed by default and ignores unrelated actions', () => {
  expect(reducer(undefined, { type: 'OTHER' } as never)).toBeNull()
  expect(reducer(null, setExternalResourceFlyoutTab('gnomad'))).toBeNull()
  expect(getExternalResourceFlyout({})).toBeNull()
})

test('flyout opens at a resource, switches tab and closes', () => {
  const opened = reducer(null, openExternalResourceFlyout(CONTEXT, 'gnomad'))
  expect(opened).toEqual({ ...CONTEXT, activeKey: 'gnomad' })
  expect(getExternalResourceFlyout({ externalResourceFlyout: opened })).toBe(opened)

  expect(reducer(opened, setExternalResourceFlyoutTab('summary'))).toEqual({ ...CONTEXT, activeKey: 'summary' })

  const other = { ...CONTEXT, title: 'OR4F5' }
  expect(reducer(opened, openExternalResourceFlyout(other, 'summary'))).toEqual({ ...other, activeKey: 'summary' })

  expect(reducer(opened, closeExternalResourceFlyout())).toBeNull()
})
