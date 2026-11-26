import {
  getPubmedUrl, getClinvarUrl, getMatchVariantPath, getRequestErrors, KnownVariantMatch,
} from './knownVariantUtils'

const MATCH = {
  matchGuid: 'KVM0000001_1_1',
  familyGuid: 'F000001_1',
  projectGuid: 'R0001_1kg',
  variantId: '1-248367227-TC-T',
  savedVariantGuid: null,
} as KnownVariantMatch

test('getPubmedUrl only links valid PubMed ids', () => {
  expect(getPubmedUrl('12345678')).toEqual('https://pubmed.ncbi.nlm.nih.gov/12345678/')
  expect(getPubmedUrl(null)).toBeNull()
  expect(getPubmedUrl(undefined)).toBeNull()
  expect(getPubmedUrl('')).toBeNull()
  expect(getPubmedUrl('PMID:123')).toBeNull()
  expect(getPubmedUrl('123/../../evil')).toBeNull()
  expect(getPubmedUrl('javascript:alert(1)')).toBeNull()
})

test('getClinvarUrl only links valid ClinVar accessions', () => {
  expect(getClinvarUrl('VCV000012345')).toEqual('https://www.ncbi.nlm.nih.gov/clinvar/?term=VCV000012345')
  expect(getClinvarUrl('RCV000012345.2')).toEqual('https://www.ncbi.nlm.nih.gov/clinvar/?term=RCV000012345.2')
  expect(getClinvarUrl('SCV000012345')).toEqual('https://www.ncbi.nlm.nih.gov/clinvar/?term=SCV000012345')
  expect(getClinvarUrl(null)).toBeNull()
  expect(getClinvarUrl('12345')).toBeNull()
  expect(getClinvarUrl('VCV000012345&x=<script>')).toBeNull()
  expect(getClinvarUrl('https://evil.example.com/VCV000012345')).toBeNull()
})

test('getMatchVariantPath links to the saved variant if there is one, and to the variant in the family otherwise', () => {
  expect(getMatchVariantPath(MATCH)).toEqual('/variant_search/variant/1-248367227-TC-T/family/F000001_1')
  expect(getMatchVariantPath({ ...MATCH, savedVariantGuid: 'SV0000002_1248367227_r0390_100' })).toEqual(
    '/project/R0001_1kg/saved_variants/variant/SV0000002_1248367227_r0390_100',
  )
})

test('getRequestErrors returns the validation errors, or the request error message', () => {
  expect(getRequestErrors({ body: { errors: ['Invalid verdict', 'Invalid status'] }, message: 'bad request (400)' })).toEqual(
    ['Invalid verdict', 'Invalid status'],
  )
  expect(getRequestErrors({ body: { errors: [] }, message: 'Permission Denied' })).toEqual(['Permission Denied'])
  expect(getRequestErrors({ body: {}, message: 'not found (404)' })).toEqual(['not found (404)'])
  expect(getRequestErrors(new Error('Failed to fetch'))).toEqual(['Failed to fetch'])
  expect(getRequestErrors(undefined)).toEqual(['An unknown error occurred'])
})
