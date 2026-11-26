import copy

from django.test import SimpleTestCase, TestCase, override_settings

from clinvar_submission.clinvar_utils import build_submission_content, build_deletion_content, map_classification, \
    validate_submission_content, validate_fields, get_clinvar_mode, get_api_key, get_assertion_criteria, \
    get_config_error, get_variant_context, get_default_fields, SV_ERROR, MITO_ERROR
from clinvar_submission.constants import GERMLINE_CLASSIFICATIONS
from seqr.models import SavedVariant, Family, Individual

CONTEXT = {
    'datasetType': 'SNV_INDEL',
    'svType': None,
    'chrom': '1',
    'pos': 248367227,
    'ref': 'TC',
    'alt': 'T',
    'genomeVersion': '38',
    'hgvsc': 'ENST00000262738.3:c.3955del',
    'acmgClassification': 'Likely Pathogenic',
    'conditionOptions': ['MONDO:0044970', 'OMIM:615123'],
    'pubmedIds': ['34415322'],
    'observation': {'affectedCarriers': 2, 'unaffectedCarriers': 1, 'zygosity': {'heterozygous': 2}},
}
FIELDS = {
    'condition_id': 'MONDO:0044970',
    'mode_of_inheritance': 'Autosomal recessive inheritance',
    'collection_method': 'research',
    'affected_status': 'yes',
    'allele_origin': 'germline',
    'citations': ['34415322'],
}
ASSERTION_CRITERIA = {'db': 'PubMed', 'id': '25741868'}
EXPECTED_CONTENT = {
    'clinvarSubmissionReleaseStatus': 'public',
    'assertionCriteria': ASSERTION_CRITERIA,
    'germlineSubmission': [{
        'recordStatus': 'novel',
        'localKey': 'CS0000001_clinvar',
        'germlineClassification': {
            'germlineClassificationDescription': 'Likely pathogenic',
            'modeOfInheritance': 'Autosomal recessive inheritance',
            'citation': [{'db': 'PubMed', 'id': '34415322'}],
        },
        'conditionSet': {'condition': [{'db': 'MONDO', 'id': 'MONDO:0044970'}]},
        'observedIn': [{
            'affectedStatus': 'yes', 'alleleOrigin': 'germline', 'collectionMethod': 'research', 'numberOfIndividuals': 2,
        }],
        'variantSet': {'variant': [{'chromosomeCoordinates': {
            'assembly': 'GRCh38', 'chromosome': '1', 'start': 248367227, 'stop': 248367228, 'referenceAllele': 'TC',
            'alternateAllele': 'T',
        }}]},
    }],
}


def _build(context_update=None, fields_update=None, **kwargs):
    kwargs = {'assertion_criteria': ASSERTION_CRITERIA, **kwargs}
    return build_submission_content(
        {**CONTEXT, **(context_update or {})}, {**FIELDS, **(fields_update or {})}, 'CS0000001_clinvar', **kwargs)


class ClinvarUtilsTest(SimpleTestCase):

    def test_build_novel_record(self):
        content, errors = _build()
        self.assertListEqual(errors, [])
        self.assertDictEqual(content, EXPECTED_CONTENT)

    def test_every_acmg_classification(self):
        expected = {
            'Pathogenic': 'Pathogenic',
            'Likely Pathogenic': 'Likely pathogenic',
            'Uncertain': 'Uncertain significance',
            'Likely Benign': 'Likely benign',
            'Benign': 'Benign',
        }
        for acmg, clinvar in expected.items():
            self.assertTupleEqual(map_classification(acmg), (clinvar, None))
            self.assertIn(clinvar, GERMLINE_CLASSIFICATIONS)
            content, errors = _build({'acmgClassification': acmg})
            self.assertListEqual(errors, [])
            self.assertEqual(
                content['germlineSubmission'][0]['germlineClassification']['germlineClassificationDescription'], clinvar)

        no_classification_error = \
            'The variant has no ACMG classification in seqr: classify it before drafting a ClinVar submission'
        for acmg in [None, '', 'Unknown']:
            self.assertTupleEqual(map_classification(acmg), (None, no_classification_error))
            self.assertTupleEqual(_build({'acmgClassification': acmg}), (None, [no_classification_error]))

        for acmg in ['Conflicting', 'pathogenic', 'Likely pathogenic', 'VUS']:
            error = f'The seqr ACMG classification "{acmg}" has no ClinVar equivalent'
            self.assertTupleEqual(map_classification(acmg), (None, error))
            self.assertTupleEqual(_build({'acmgClassification': acmg}), (None, [error]))

    def test_condition(self):
        content, errors = _build(fields_update={'condition_id': 'OMIM:615123'})
        self.assertListEqual(errors, [])
        self.assertDictEqual(
            content['germlineSubmission'][0]['conditionSet'], {'condition': [{'db': 'OMIM', 'id': '615123'}]})

        required_error = 'A condition is required: set a MONDO id or post-discovery OMIM number on the family'
        self.assertTupleEqual(_build(fields_update={'condition_id': None}), (None, [required_error]))
        self.assertTupleEqual(
            _build({'conditionOptions': []}, {'condition_id': ''}),
            (None, [required_error]))
        self.assertTupleEqual(
            _build(fields_update={'condition_id': 'MONDO:0000001'}),
            (None, ['Condition "MONDO:0000001" is not one of the family\'s MONDO or OMIM ids']))

    def test_sv_and_mito_rejected(self):
        for update in [
            {'datasetType': 'SV_WGS', 'ref': None, 'alt': None, 'svType': 'DEL'},
            {'datasetType': 'SV_WES', 'ref': None, 'alt': None, 'svType': 'DUP'},
            {'datasetType': None, 'svType': 'DEL'},
            {'datasetType': None, 'ref': None, 'alt': None},
        ]:
            self.assertTupleEqual(_build(update), (None, [SV_ERROR]))
        for update in [{'datasetType': 'MITO', 'chrom': 'M'}, {'datasetType': None, 'chrom': 'M'}, {'datasetType': 'MITO'}]:
            self.assertTupleEqual(_build(update), (None, [MITO_ERROR]))

    def test_variant_location(self):
        content, _ = _build({'genomeVersion': '37'})
        coordinates = content['germlineSubmission'][0]['variantSet']['variant'][0]['chromosomeCoordinates']
        self.assertEqual(coordinates['assembly'], 'GRCh37')
        content, _ = _build({'genomeVersion': '38', 'chrom': 'X', 'ref': 'G', 'alt': 'A', 'pos': 100})
        self.assertDictEqual(content['germlineSubmission'][0]['variantSet']['variant'][0], {'chromosomeCoordinates': {
            'assembly': 'GRCh38', 'chromosome': 'X', 'start': 100, 'stop': 100, 'referenceAllele': 'G',
            'alternateAllele': 'A',
        }})
        self.assertTupleEqual(_build({'genomeVersion': 'T2T'}), (None, ['Unsupported genome build "T2T"']))
        self.assertTupleEqual(
            _build({'alt': 'N'}), (None, ['The reference and alternate alleles must only contain A, C, G and T']))
        self.assertTupleEqual(_build({'ref': 'A' * 51}), (None, [
            'ClinVar accepts alleles of up to 50 nt as chromosome coordinates and this variant has no RefSeq HGVS']))

        content, errors = _build({'hgvsc': 'NM_000059.4:c.3955del', 'ref': 'A' * 51})
        self.assertListEqual(errors, [])
        self.assertDictEqual(
            content['germlineSubmission'][0]['variantSet']['variant'][0], {'hgvs': 'NM_000059.4:c.3955del'})

    def test_observation_and_optional_fields(self):
        content, errors = _build(fields_update={
            'affected_status': 'unknown', 'mode_of_inheritance': None, 'citations': [], 'allele_origin': 'de novo',
            'collection_method': 'clinical testing',
        }, assertion_criteria=None)
        self.assertListEqual(errors, [])
        record = content['germlineSubmission'][0]
        self.assertListEqual(record['observedIn'], [
            {'affectedStatus': 'unknown', 'alleleOrigin': 'de novo', 'collectionMethod': 'clinical testing'}])
        self.assertDictEqual(record['germlineClassification'], {'germlineClassificationDescription': 'Likely pathogenic'})
        self.assertNotIn('assertionCriteria', content)

        self.assertTupleEqual(
            _build({'observation': {'affectedCarriers': 0, 'unaffectedCarriers': 1, 'zygosity': {}}}),
            (None, ['No affected individual in the family carries this variant']))

    def test_field_validation(self):
        self.assertListEqual(validate_fields(CONTEXT, FIELDS), [])
        self.assertListEqual(validate_fields(CONTEXT, {}), [])
        invalid_fields = {
            'condition_id': {'db': 'MONDO'}, 'mode_of_inheritance': 'dominant', 'collection_method': 'Research',
            'affected_status': True, 'allele_origin': 'germ line', 'citations': ['PMID:123', 34415322, 'x y'],
        }
        expected_errors = [
            'Condition "{\'db\': \'MONDO\'}" is not one of the family\'s MONDO or OMIM ids',
            'Mode of inheritance "dominant" is not a value accepted by ClinVar',
            'Collection method "Research" is not a value accepted by ClinVar',
            'Affected status "True" is not a value accepted by ClinVar',
            'Allele origin "germ line" is not a value accepted by ClinVar',
            'Invalid PubMed id(s): PMID:123, x y',
        ]
        self.assertListEqual(validate_fields(CONTEXT, invalid_fields), expected_errors)
        self.assertListEqual(validate_fields(CONTEXT, {'citations': '34415322'}), ['Invalid PubMed id(s): 34415322'])
        self.assertTupleEqual(_build(fields_update=invalid_fields), (None, expected_errors))

        self.assertTupleEqual(
            _build(fields_update={'collection_method': None, 'affected_status': '', 'allele_origin': None}),
            (None, ['Collection method is required', 'Affected status is required', 'Allele origin is required']))

    def test_novel_vs_update(self):
        content, errors = _build(scv_accession='SCV000123456')
        self.assertListEqual(errors, [])
        record = content['germlineSubmission'][0]
        self.assertEqual(record['recordStatus'], 'update')
        self.assertEqual(record['clinvarAccession'], 'SCV000123456')
        self.assertDictEqual(content, {**EXPECTED_CONTENT, 'germlineSubmission': [
            {**EXPECTED_CONTENT['germlineSubmission'][0], 'recordStatus': 'update', 'clinvarAccession': 'SCV000123456'},
        ]})

        self.assertTupleEqual(_build(scv_accession='RCV000123456'), (None, ['Invalid ClinVar accession "RCV000123456"']))

        novel, _ = _build()
        self.assertEqual(novel['germlineSubmission'][0]['recordStatus'], 'novel')
        self.assertNotIn('clinvarAccession', novel['germlineSubmission'][0])

    def test_assertion_criteria(self):
        self.assertTupleEqual(_build(assertion_criteria=None, require_assertion_criteria=True), (None, [
            'CLINVAR_ASSERTION_CRITERIA is not configured: ClinVar requires an assertion criteria citation']))
        self.assertTupleEqual(_build(assertion_criteria={'db': 'Wikipedia', 'id': 'a; b'}), (None, [
            'content.assertionCriteria.db: "Wikipedia" is not an allowed value',
            'content.assertionCriteria.id: "a; b" is not valid',
        ]))

    def test_deletion_record(self):
        self.assertDictEqual(
            build_deletion_content('SCV000123456'),
            {'clinvarDeletion': {'accessionSet': [{'accession': 'SCV000123456'}]}})
        for accession in [None, '', 'SCV123', 'RCV000123456', 'SCV000123456.1']:
            with self.assertRaises(ValueError) as cm:
                build_deletion_content(accession)
            self.assertEqual(
                str(cm.exception), f'content.clinvarDeletion.accessionSet[0].accession: "{accession}" is not valid')

    def _assert_invalid(self, expected_errors, update):
        content = copy.deepcopy(EXPECTED_CONTENT)
        update(content)
        self.assertListEqual(validate_submission_content(content), expected_errors)

    def test_validate_submission_content(self):
        self.assertListEqual(validate_submission_content(EXPECTED_CONTENT), [])
        self.assertListEqual(validate_submission_content([]), ['content: expected an object'])
        self.assertListEqual(validate_submission_content({}), [
            'content: exactly one of germlineSubmission or clinvarDeletion is required'])
        self.assertListEqual(validate_submission_content({
            **EXPECTED_CONTENT, 'clinvarDeletion': {'accessionSet': [{'accession': 'SCV000123456'}]},
        }), ['content: exactly one of germlineSubmission or clinvarDeletion is required'])
        self.assertListEqual(validate_submission_content({'clinvarDeletion': {'accessionSet': []}}), [
            'content.clinvarDeletion.accessionSet: expected a list with exactly one item'])
        self.assertListEqual(validate_submission_content({'clinvarDeletion': {}}), [
            'content.clinvarDeletion: missing field(s) accessionSet'])
        self.assertListEqual(
            validate_submission_content({'clinvarDeletion': {'accessionSet': [{'accession': 'SCV000123456', 'reason': 'x'}]}}),
            ['content.clinvarDeletion.accessionSet[0]: unexpected field(s) reason'])

        record_path = 'content.germlineSubmission[0]'
        self._assert_invalid(
            ['content: unexpected field(s) behalfOrgID', 'content.clinvarSubmissionReleaseStatus: "hold" is not an allowed value'],
            lambda c: c.update({'behalfOrgID': 1, 'clinvarSubmissionReleaseStatus': 'hold'}))
        self._assert_invalid(['content.assertionCriteria: missing field(s) id'], lambda c: c['assertionCriteria'].pop('id'))
        self._assert_invalid(
            ['content.germlineSubmission: expected a list with exactly one item'],
            lambda c: c['germlineSubmission'].append({}))
        self._assert_invalid(
            [f'{record_path}: unexpected field(s) comment', f'{record_path}: missing field(s) localKey'],
            lambda c: (c['germlineSubmission'][0].pop('localKey'), c['germlineSubmission'][0].update({'comment': 'Patient X'})))
        self._assert_invalid(
            [f'{record_path}.recordStatus: "new" is not an allowed value'],
            lambda c: c['germlineSubmission'][0].update({'recordStatus': 'new'}))
        accession_error = f'{record_path}: clinvarAccession is required for an update and not allowed for a novel record'
        self._assert_invalid([accession_error], lambda c: c['germlineSubmission'][0].update({'recordStatus': 'update'}))
        self._assert_invalid(
            [f'{record_path}.clinvarAccession: "SCV1" is not valid', accession_error],
            lambda c: c['germlineSubmission'][0].update({'clinvarAccession': 'SCV1'}))

        classification_path = f'{record_path}.germlineClassification'
        self._assert_invalid([
            f'{classification_path}: unexpected field(s) comment',
            f'{classification_path}.germlineClassificationDescription: "Likely Pathogenic" is not an allowed value',
            f'{classification_path}.modeOfInheritance: "AD" is not an allowed value',
            f'{classification_path}.citation[0].db: "DOI" is not an allowed value',
            f'{classification_path}.citation[0].id: "10.1/x" is not valid',
            f'{classification_path}.citation[1]: expected an object',
        ], lambda c: c['germlineSubmission'][0]['germlineClassification'].update({
            'comment': 'free text', 'germlineClassificationDescription': 'Likely Pathogenic', 'modeOfInheritance': 'AD',
            'citation': [{'db': 'DOI', 'id': '10.1/x'}, '123'],
        }))

        self._assert_invalid(
            [f'{record_path}.conditionSet: unexpected field(s) multipleConditionExplanation',
             f'{record_path}.conditionSet.condition: expected a list with exactly one item'],
            lambda c: c['germlineSubmission'][0]['conditionSet'].update({
                'multipleConditionExplanation': 'Uncertain', 'condition': 'MONDO:0044970'}))
        self._assert_invalid(
            [f'{record_path}.conditionSet.condition[0].db: "HP" is not an allowed value',
             f'{record_path}.conditionSet.condition[0].id: "0044970" is not valid'],
            lambda c: c['germlineSubmission'][0]['conditionSet'].update({'condition': [{'db': 'HP', 'id': '0044970'}]}))
        self._assert_invalid(
            [f'{record_path}.conditionSet.condition[0].id: "MONDO:0044970" is not valid'],
            lambda c: c['germlineSubmission'][0]['conditionSet'].update({'condition': [{'db': 'OMIM', 'id': 'MONDO:0044970'}]}))
        self._assert_invalid(
            [f'{record_path}.conditionSet.condition[0].id: "44970" is not valid'],
            lambda c: c['germlineSubmission'][0]['conditionSet'].update({'condition': [{'db': 'MONDO', 'id': '44970'}]}))

        observation_path = f'{record_path}.observedIn[0]'
        self._assert_invalid([
            f'{observation_path}.affectedStatus: "affected" is not an allowed value',
            f'{observation_path}.alleleOrigin: "denovo" is not an allowed value',
            f'{observation_path}.collectionMethod: "clinical" is not an allowed value',
            f'{observation_path}.numberOfIndividuals: expected a positive integer',
        ], lambda c: c['germlineSubmission'][0]['observedIn'][0].update({
            'affectedStatus': 'affected', 'alleleOrigin': 'denovo', 'collectionMethod': 'clinical', 'numberOfIndividuals': 0,
        }))
        self._assert_invalid(
            [f'{observation_path}.numberOfIndividuals: expected a positive integer'],
            lambda c: c['germlineSubmission'][0]['observedIn'][0].update({'numberOfIndividuals': True}))
        self._assert_invalid(
            [f'{record_path}.observedIn: expected a list with exactly one item'],
            lambda c: c['germlineSubmission'][0].update({'observedIn': []}))

        variant_path = f'{record_path}.variantSet.variant[0]'
        self._assert_invalid(
            [f'{record_path}.variantSet.variant: expected a list with exactly one item'],
            lambda c: c['germlineSubmission'][0]['variantSet'].update({'variant': []}))
        self._assert_invalid(
            [f'{variant_path}: expected an object'],
            lambda c: c['germlineSubmission'][0]['variantSet'].update({'variant': ['1-2-A-C']}))
        self._assert_invalid(
            [f'{variant_path}: exactly one of hgvs or chromosomeCoordinates is required'],
            lambda c: c['germlineSubmission'][0]['variantSet']['variant'][0].update({'hgvs': 'NM_000059.4:c.3955del'}))
        self._assert_invalid(
            [f'{variant_path}.hgvs: "ENST00000262738.3:c.3955del" is not valid'],
            lambda c: c['germlineSubmission'][0]['variantSet'].update({'variant': [{'hgvs': 'ENST00000262738.3:c.3955del'}]}))
        self._assert_invalid([
            f'{variant_path}.chromosomeCoordinates.assembly: "hg38" is not an allowed value',
            f'{variant_path}.chromosomeCoordinates.chromosome: "MT" is not an allowed value',
            f'{variant_path}.chromosomeCoordinates.start: expected a positive integer',
            f'{variant_path}.chromosomeCoordinates.stop: expected a positive integer',
            f'{variant_path}.chromosomeCoordinates.referenceAllele: "tc" is not valid',
            f'{variant_path}.chromosomeCoordinates.alternateAllele: "None" is not valid',
        ], lambda c: c['germlineSubmission'][0]['variantSet']['variant'][0]['chromosomeCoordinates'].update({
            'assembly': 'hg38', 'chromosome': 'MT', 'start': '248367227', 'stop': -1, 'referenceAllele': 'tc',
            'alternateAllele': None,
        }))
        self._assert_invalid(
            [f'{variant_path}.chromosomeCoordinates: missing field(s) stop'],
            lambda c: c['germlineSubmission'][0]['variantSet']['variant'][0]['chromosomeCoordinates'].pop('stop'))

    def test_settings(self):
        self.assertEqual(get_clinvar_mode(), 'disabled')
        self.assertIsNone(get_api_key())
        self.assertIsNone(get_assertion_criteria())
        self.assertEqual(get_config_error(), 'ClinVar submission is not enabled (CLINVAR_SUBMISSION_MODE is "disabled")')

        with override_settings(CLINVAR_SUBMISSION_MODE='production'):
            self.assertEqual(get_clinvar_mode(), 'disabled')

        for mode in ['test', 'live']:
            with override_settings(CLINVAR_SUBMISSION_MODE=mode, CLINVAR_API_KEY=''):
                self.assertEqual(get_clinvar_mode(), mode)
                self.assertEqual(
                    get_config_error(),
                    f'CLINVAR_SUBMISSION_MODE is "{mode}" but CLINVAR_API_KEY is not configured: refusing to operate')
            with override_settings(CLINVAR_SUBMISSION_MODE=mode, CLINVAR_API_KEY='k' * 64):
                self.assertIsNone(get_config_error())
                self.assertEqual(get_api_key(), 'k' * 64)

        with override_settings(CLINVAR_SUBMISSION_MODE='dry_run', CLINVAR_ASSERTION_CRITERIA='PubMed:25741868'):
            self.assertEqual(get_clinvar_mode(), 'dry_run')
            self.assertIsNone(get_config_error())
            self.assertDictEqual(get_assertion_criteria(), ASSERTION_CRITERIA)
        with override_settings(CLINVAR_ASSERTION_CRITERIA='25741868'):
            self.assertIsNone(get_assertion_criteria())


class ClinvarVariantContextTest(TestCase):
    fixtures = ['users', '1kg_project']

    def test_get_variant_context(self):
        saved_variant = SavedVariant.objects.get(guid='SV0000002_1248367227_r0390_100')
        expected_context = {
            'datasetType': 'SNV_INDEL', 'svType': None, 'chrom': '1', 'pos': 248367227, 'ref': 'TC', 'alt': 'T',
            'genomeVersion': '37', 'hgvsc': None, 'acmgClassification': None,
            'conditionOptions': ['MONDO:0044970', 'MONDO:0044976', 'OMIM:615123'], 'pubmedIds': [],
            'observation': {'affectedCarriers': 1, 'unaffectedCarriers': 1, 'zygosity': {'homozygous': 1}},
        }
        self.assertDictEqual(get_variant_context(saved_variant), expected_context)
        self.assertDictEqual(get_default_fields(expected_context), {
            'condition_id': 'MONDO:0044970', 'mode_of_inheritance': None, 'collection_method': 'research',
            'affected_status': 'yes', 'allele_origin': 'germline', 'citations': [],
        })

        saved_variant.acmg_classification = {'classify': 'Pathogenic', 'score': 12, 'criteria': ['PVS1']}
        saved_variant.genotypes = {
            'I000004_hg00731': {'numAlt': 1}, 'I000005_hg00732': {'numAlt': 0}, 'I000006_hg00733': {'numAlt': None},
        }
        saved_variant.xpos = 23000000100
        Individual.objects.filter(guid='I000004_hg00731').update(sex='M')
        context = get_variant_context(saved_variant)
        self.assertEqual(context['acmgClassification'], 'Pathogenic')
        self.assertEqual(context['chrom'], 'X')
        self.assertDictEqual(
            context['observation'], {'affectedCarriers': 1, 'unaffectedCarriers': 0, 'zygosity': {'hemizygous': 1}})

        saved_variant.genotypes = {'I000005_hg00732': {'numAlt': 1}}
        context = get_variant_context(saved_variant)
        self.assertDictEqual(context['observation'], {'affectedCarriers': 0, 'unaffectedCarriers': 1, 'zygosity': {}})
        self.assertEqual(get_default_fields(context)['affected_status'], 'no')

        saved_variant.genotypes = {}
        context = get_variant_context(saved_variant)
        self.assertEqual(get_default_fields(context)['affected_status'], 'unknown')

        # Family 12 stores its MONDO id without a prefix and has no pre-discovery id
        saved_variant = SavedVariant.objects.get(guid='SV0000006_1248367227_r0003_tes')
        context = get_variant_context(saved_variant)
        self.assertListEqual(context['conditionOptions'], ['MONDO:0008788', 'OMIM:616126'])
        self.assertEqual(context['hgvsc'], 'ENST00000262738.3:c.3955G>A')
        Individual.objects.filter(family__guid='F000012_12').update(affected='U')
        self.assertDictEqual(
            get_variant_context(saved_variant)['observation'],
            {'affectedCarriers': 0, 'unaffectedCarriers': 0, 'zygosity': {}})

        Family.objects.filter(guid='F000012_12').update(
            post_discovery_mondo_id=None, post_discovery_omim_numbers=[], pubmed_ids=['123'])
        saved_variant.refresh_from_db()
        context = get_variant_context(saved_variant)
        self.assertListEqual(context['conditionOptions'], [])
        self.assertIsNone(get_default_fields(context)['condition_id'])
        self.assertListEqual(get_default_fields(context)['citations'], ['123'])
