from copy import deepcopy
import json
import os

from clickhouse_backend import models
from django.test import SimpleTestCase
import mock

from clickhouse_search.filter_registry import get_filter_schema, get_filter_schemas, get_filter_registry, \
    parse_dynamic_filters, validate_dynamic_filters, apply_dynamic_filters
from clickhouse_search.managers import BaseEntriesManager, InvalidSearchException
from clickhouse_search.models.search_models import EntriesSnvIndel, EntriesMito, VariantsGatkSv

UI_SCHEMA_FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'pages', 'Search', 'filterSchemaFixture.json',
)

# The search keys the hard-coded UI panels submit (ui/pages/Search/components/VariantSearchFormPanelConfigs.jsx)
LEGACY_IN_SILICO_KEYS = {
    'cadd', 'revel', 'alphagenome', 'alphamissense', 'mpc', 'splice_ai', 'absplice', 'promoter_ai', 'pext', 'vest',
    'mut_pred', 'primate_ai', 'eigen', 'strvctvre', 'polyphen', 'sift', 'mut_taster', 'fathmm', 'apogee', 'hmtvar',
    'mlc',
}
# Offered by the UI in silico panel but not filtered on by any query builder, so absent from the registry
LEGACY_IN_SILICO_KEYS_WITHOUT_QUERY_SUPPORT = {'haplogroup_defining', 'mitotip'}
LEGACY_FREQUENCY_KEYS = {
    'gnomad_genomes_af', 'gnomad_genomes_ac', 'gnomad_genomes_hh', 'gnomad_exomes_af', 'gnomad_exomes_ac',
    'gnomad_exomes_hh', 'topmed_af', 'topmed_ac', 'callset_ac', 'callset_hh', 'gnomad_mito_af', 'gnomad_mito_ac',
    'gnomad_svs_af', 'gnomad_svs_ac', 'sv_callset_ac',
}
LEGACY_QUALITY_KEYS = {'vcf_filter', 'min_gq', 'min_ab', 'min_hl', 'min_qs', 'min_gq_sv'}


def _fake_dict_rel(base_fields):
    rel = mock.MagicMock()
    rel.rel.related_model.base_fields.return_value = base_fields
    return rel


class FilterRegistryTest(SimpleTestCase):

    @staticmethod
    def _by_key(schema, group):
        return {field['key']: field for field in schema if field['group'] == group}

    def test_schema_matches_ui_fixture(self):
        # The UI tests render the search form from this file, regenerate it when the models change:
        # json.dump(get_filter_schemas(), open('ui/pages/Search/filterSchemaFixture.json', 'w'), indent=1)
        with open(UI_SCHEMA_FIXTURE) as f:
            self.assertDictEqual(json.loads(json.dumps(get_filter_schemas())), json.load(f))

    def test_schema_by_genome_version_and_dataset_type(self):
        schemas = get_filter_schemas()
        self.assertSetEqual(set(schemas.keys()), {'37', '38'})
        self.assertListEqual(schemas['38'], get_filter_schema('38'))
        for schema in schemas.values():
            self.assertListEqual(
                [field['group'] for field in schema],
                sorted([field['group'] for field in schema], key=['in_silico', 'frequency', 'quality'].index),
            )

        self.assertSetEqual({dt for field in schemas['37'] for dt in field['datasetTypes']}, {'SNV_INDEL'})
        self.assertSetEqual(set(self._by_key(schemas['37'], 'in_silico')), {
            'splice_ai', 'cadd', 'fathmm', 'mpc', 'mut_pred', 'mut_taster', 'polyphen', 'primate_ai', 'revel', 'sift',
            'vest', 'eigen',
        })
        self.assertSetEqual(set(self._by_key(schemas['37'], 'quality')), {'min_gq', 'min_ab', 'vcf_filter'})

        in_silico = self._by_key(schemas['38'], 'in_silico')
        self.assertSetEqual(set(in_silico), {
            'splice_ai', 'cadd', 'fathmm', 'mpc', 'mut_pred', 'mut_taster', 'polyphen', 'primate_ai', 'revel', 'sift',
            'vest', 'eigen', 'absplice', 'alphagenome', 'pext', 'promoter_ai', 'gnomad_noncoding', 'alphamissense',
            'apogee', 'hmtvar', 'mlc', 'strvctvre',
        })
        self.assertListEqual(in_silico['sift']['datasetTypes'], ['SNV_INDEL', 'MITO'])
        self.assertListEqual(in_silico['apogee']['datasetTypes'], ['MITO'])
        self.assertListEqual(in_silico['strvctvre']['datasetTypes'], ['SV'])
        self.assertListEqual(in_silico['gnomad_noncoding']['datasetTypes'], ['SNV_INDEL'])
        # Companion fields of a prediction dictionary are not scores
        self.assertNotIn('consequence_id', in_silico)
        self.assertNotIn('splice_ai_consequence', in_silico)

        frequency = self._by_key(schemas['38'], 'frequency')
        self.assertSetEqual(set(frequency), {
            'gnomad_exomes_af', 'gnomad_exomes_ac', 'gnomad_exomes_hh', 'gnomad_genomes_af', 'gnomad_genomes_ac',
            'gnomad_genomes_hh', 'topmed_af', 'topmed_ac', 'topmed_hh', 'callset_ac', 'callset_hh', 'gnomad_mito_af',
            'gnomad_mito_ac', 'gnomad_mito_heteroplasmy_af', 'gnomad_mito_heteroplasmy_ac', 'helix_af', 'helix_ac',
            'helix_heteroplasmy_af', 'helix_heteroplasmy_ac', 'gnomad_svs_af', 'gnomad_svs_ac', 'sv_callset_ac',
            'sv_callset_hh', 'sv_callset_af',
        })
        self.assertListEqual(frequency['callset_ac']['datasetTypes'], ['SNV_INDEL', 'MITO'])
        # There are no homozygote counts in the mitochondrial seqr stats
        self.assertListEqual(frequency['callset_hh']['datasetTypes'], ['SNV_INDEL'])
        self.assertListEqual(frequency['sv_callset_af']['datasetTypes'], ['SV'])

        quality = self._by_key(schemas['38'], 'quality')
        self.assertSetEqual(set(quality), {
            'min_gq', 'min_ab', 'vcf_filter', 'min_hl', 'min_mitoCn', 'min_gq_sv', 'min_qs',
        })
        self.assertListEqual(quality['vcf_filter']['datasetTypes'], ['SNV_INDEL', 'MITO', 'SV'])
        self.assertListEqual(quality['min_hl']['datasetTypes'], ['MITO'])
        self.assertListEqual(quality['min_qs']['datasetTypes'], ['SV'])

    def test_field_definitions(self):
        registry = get_filter_registry()
        self.assertDictEqual(registry['in_silico']['cadd'], {
            'key': 'cadd', 'group': 'in_silico', 'kind': 'min', 'scope': 'variant', 'label': 'CADD', 'help': None,
            'integer': False, 'min': 1, 'max': 99, 'step': 1, 'datasetTypes': ['SNV_INDEL'],
            'legacyPath': ['in_silico', 'cadd'],
        })
        self.assertDictEqual(registry['in_silico']['mut_taster'], {
            'key': 'mut_taster', 'group': 'in_silico', 'kind': 'enum', 'scope': 'variant', 'label': 'MutTaster',
            'help': None, 'datasetTypes': ['SNV_INDEL'], 'legacyPath': ['in_silico', 'mut_taster'], 'options': [
                {'value': 'D', 'text': 'disease causing'}, {'value': 'A', 'text': 'disease causing automatic'},
                {'value': 'N', 'text': 'polymorphism'}, {'value': 'P', 'text': 'polymorphism automatic'},
            ],
        })
        self.assertDictEqual(registry['in_silico']['gnomad_noncoding'], {
            'key': 'gnomad_noncoding', 'group': 'in_silico', 'kind': 'min', 'scope': 'variant',
            'label': 'gnomAD Constraint', 'integer': False, 'min': None, 'max': None, 'step': 0.1,
            'help': 'Minimum gnomAD non-coding constraint z-score of the genomic region containing the variant',
            'datasetTypes': ['SNV_INDEL'], 'legacyPath': ['in_silico', 'gnomad_noncoding'],
        })
        self.assertDictEqual(registry['frequency']['gnomad_genomes_af'], {
            'key': 'gnomad_genomes_af', 'group': 'frequency', 'kind': 'max', 'scope': 'variant',
            'label': 'gnomAD genomes AF', 'help': 'Maximum allele frequency', 'integer': False, 'min': 0, 'max': 1,
            'step': 0.0001, 'datasetTypes': ['SNV_INDEL'], 'legacyPath': ['freqs', 'gnomad_genomes', 'af'],
        })
        self.assertDictEqual(registry['frequency']['sv_callset_hh'], {
            'key': 'sv_callset_hh', 'group': 'frequency', 'kind': 'max', 'scope': 'variant', 'label': 'seqr SV H/H',
            'help': 'Maximum homozygous/hemizygous count', 'integer': True, 'min': 0, 'max': None, 'step': 1,
            'datasetTypes': ['SV'], 'legacyPath': ['freqs', 'sv_callset', 'hh'],
        })
        self.assertDictEqual(registry['quality']['min_ab'], {
            'key': 'min_ab', 'group': 'quality', 'kind': 'min', 'scope': 'call', 'label': 'Allele Balance',
            'help': 'Percentage (0-100)', 'integer': False, 'min': 0, 'max': 50, 'step': 5,
            'datasetTypes': ['SNV_INDEL'], 'legacyPath': ['qualityFilter', 'min_ab'],
        })
        self.assertDictEqual(registry['quality']['min_gq_sv'], {
            'key': 'min_gq_sv', 'group': 'quality', 'kind': 'min', 'scope': 'call', 'label': 'WGS SV Genotype Quality',
            'help': None, 'integer': True, 'min': 0, 'max': 100, 'step': 5, 'datasetTypes': ['SV'],
            'legacyPath': ['qualityFilter', 'min_gq_sv'],
        })
        self.assertDictEqual(registry['quality']['vcf_filter'], {
            'key': 'vcf_filter', 'group': 'quality', 'kind': 'bool', 'scope': 'variant', 'label': 'Pass Variants Only',
            'help': 'Only return variants that passed the variant quality filters applied when the data was processed',
            'datasetTypes': ['SNV_INDEL'], 'legacyPath': ['qualityFilter', 'vcf_filter'],
        })

    def test_legacy_ui_filters_in_registry(self):
        registry = get_filter_registry()
        self.assertSetEqual(LEGACY_IN_SILICO_KEYS - set(registry['in_silico']), set())
        self.assertSetEqual(LEGACY_FREQUENCY_KEYS - set(registry['frequency']), set())
        self.assertSetEqual(LEGACY_QUALITY_KEYS - set(registry['quality']), set())
        self.assertSetEqual(LEGACY_IN_SILICO_KEYS_WITHOUT_QUERY_SUPPORT & set(registry['in_silico']), set())

        # Every registry field translates to the search key the hard-coded panel for its group submits
        for group, legacy_key in {'in_silico': 'in_silico', 'frequency': 'freqs', 'quality': 'qualityFilter'}.items():
            for key, field in registry[group].items():
                self.assertEqual(field['legacyPath'][0], legacy_key)
                self.assertEqual('_'.join(field['legacyPath'][1:]), key)

        # Filters the query builders support that no hard-coded panel offers
        self.assertSetEqual(set(registry['in_silico']) - LEGACY_IN_SILICO_KEYS, {'gnomad_noncoding'})
        self.assertSetEqual(set(registry['frequency']) - LEGACY_FREQUENCY_KEYS, {
            'topmed_hh', 'gnomad_mito_heteroplasmy_af', 'gnomad_mito_heteroplasmy_ac', 'helix_af', 'helix_ac',
            'helix_heteroplasmy_af', 'helix_heteroplasmy_ac', 'sv_callset_af', 'sv_callset_hh',
        })
        self.assertSetEqual(set(registry['quality']) - LEGACY_QUALITY_KEYS, {'min_mitoCn'})

    def test_new_model_fields_are_registered(self):
        new_filters = {
            'in_silico': {'methylation': 0.4, 'outlier_count': 3}, 'frequency': {'methylation_cohort_af': 0.01},
            'quality': {'min_dp': 10},
        }
        for group, group_filters in new_filters.items():
            key = next(iter(group_filters))
            with self.assertRaises(InvalidSearchException) as cm:
                parse_dynamic_filters({group: group_filters})
            self.assertEqual(str(cm.exception), f'Unknown dynamic {group} filter "{key}"')

        methylation_dict = _fake_dict_rel([
            ('score', models.DecimalField(max_digits=9, decimal_places=5)),
            ('outlier_count', models.UInt16Field()),
            ('tissue', models.StringField()),
            ('is_outlier', models.BoolField()),
        ])
        methylation_cohort_dict = _fake_dict_rel([
            ('af', models.DecimalField(max_digits=9, decimal_places=5)), ('an', models.UInt32Field()),
        ])
        with mock.patch.dict(EntriesSnvIndel.PREDICTIONS, {'methylation': {}}), \
                mock.patch.object(EntriesSnvIndel, 'methylation', methylation_dict, create=True), \
                mock.patch.object(EntriesMito, 'POPULATIONS', EntriesMito.POPULATIONS + ['methylation_cohort']), \
                mock.patch.object(EntriesMito, 'methylation_cohort', methylation_cohort_dict, create=True), \
                mock.patch.dict(BaseEntriesManager.QUALITY_FILTERS, {'dp': {}}):
            self.assertNotIn('methylation', {field['key'] for field in get_filter_schema('37')})
            schema = get_filter_schema('38')
            in_silico = self._by_key(schema, 'in_silico')
            self.assertDictEqual(in_silico['methylation'], {
                'key': 'methylation', 'group': 'in_silico', 'kind': 'min', 'scope': 'variant', 'label': 'Methylation',
                'help': None, 'integer': False, 'min': None, 'max': None, 'step': 0.05, 'datasetTypes': ['SNV_INDEL'],
                'legacyPath': ['in_silico', 'methylation'],
            })
            self.assertEqual(in_silico['outlier_count']['label'], 'Outlier Count')
            self.assertTrue(in_silico['outlier_count']['integer'])
            # Text and boolean fields with no declared options are never filterable
            self.assertNotIn('tissue', in_silico)
            self.assertNotIn('is_outlier', in_silico)

            frequency = self._by_key(schema, 'frequency')
            self.assertEqual(frequency['methylation_cohort_af']['label'], 'Methylation Cohort AF')
            self.assertListEqual(frequency['methylation_cohort_af']['datasetTypes'], ['MITO'])
            self.assertListEqual(frequency['methylation_cohort_af']['legacyPath'], ['freqs', 'methylation_cohort', 'af'])
            self.assertNotIn('methylation_cohort_ac', frequency)
            self.assertNotIn('methylation_cohort_hh', frequency)

            self.assertDictEqual(self._by_key(schema, 'quality')['min_dp'], {
                'key': 'min_dp', 'group': 'quality', 'kind': 'min', 'scope': 'call', 'label': 'Minimum DP',
                'help': None, 'integer': True, 'min': 0, 'max': None, 'step': 1, 'datasetTypes': ['SNV_INDEL', 'MITO'],
                'legacyPath': ['qualityFilter', 'min_dp'],
            })
            self.assertListEqual(
                self._by_key(get_filter_schema('37'), 'quality')['min_dp']['datasetTypes'], ['SNV_INDEL'])

            self.assertDictEqual(apply_dynamic_filters({'dynamic': new_filters}), {
                'in_silico': {'methylation': 0.4, 'outlier_count': 3},
                'freqs': {'methylation_cohort': {'af': 0.01}},
                'qualityFilter': {'min_dp': 10},
            })

        self.assertNotIn('min_dp', get_filter_registry()['quality'])

    def test_sv_population_without_allele_count(self):
        population_fields = [('external_svs', VariantsGatkSv.POPULATION_FIELDS[0][1].__class__([
            ('af', models.DecimalField(max_digits=9, decimal_places=8)), ('het', models.UInt32Field()),
        ]))]
        with mock.patch.object(VariantsGatkSv, 'POPULATION_FIELDS', population_fields):
            frequency = self._by_key(get_filter_schema('38'), 'frequency')
        self.assertIn('external_svs_af', frequency)
        self.assertNotIn('external_svs_ac', frequency)
        self.assertNotIn('gnomad_svs_af', frequency)

    def _assert_invalid(self, dynamic, error):
        with self.assertRaises(InvalidSearchException) as cm:
            parse_dynamic_filters(dynamic)
        self.assertEqual(str(cm.exception), error)
        with self.assertRaises(InvalidSearchException):
            validate_dynamic_filters({'dynamic': dynamic})
        with self.assertRaises(InvalidSearchException):
            apply_dynamic_filters({'dynamic': dynamic})

    def test_invalid_dynamic_filters(self):
        self._assert_invalid(['cadd'], 'Invalid dynamic filters: expected filters grouped by type')
        self._assert_invalid('cadd', 'Invalid dynamic filters: expected filters grouped by type')
        self._assert_invalid(
            {'annotations': {'cadd': 1}},
            'Unknown dynamic filter group "annotations". Available groups: in_silico, frequency, quality',
        )
        self._assert_invalid(
            {'in_silico\r\nSet-Cookie: x': {}},
            'Unknown dynamic filter group "in_silico\\r\\nSet-Cookie: x". Available groups: in_silico, frequency, quality',
        )
        self._assert_invalid({'in_silico': 20}, 'Invalid dynamic in_silico filters: expected values keyed by filter')
        self._assert_invalid({'in_silico': {'not_a_score': 20}}, 'Unknown dynamic in_silico filter "not_a_score"')
        self._assert_invalid(
            {'in_silico': {"cadd' OR 1=1 --": 20}}, 'Unknown dynamic in_silico filter "cadd\' OR 1=1 --"')
        # Keys are only valid in their own group
        self._assert_invalid({'quality': {'cadd': 20}}, 'Unknown dynamic quality filter "cadd"')
        self._assert_invalid({'frequency': {'gnomad_genomes': {'af': 0.1}}}, 'Unknown dynamic frequency filter "gnomad_genomes"')

        for value in ['high', '', True, [20], {'min': 20}, float('nan'), float('inf'), 'nan', '-inf']:
            self._assert_invalid({'in_silico': {'cadd': value}}, 'Invalid value for CADD (cadd): expected a number')
        self._assert_invalid(
            {'in_silico': {'cadd': "20; DROP TABLE x"}}, 'Invalid value for CADD (cadd): expected a number')
        self._assert_invalid({'in_silico': {'cadd': 0.5}}, 'Invalid value for CADD (cadd): must be at least 1')
        self._assert_invalid({'in_silico': {'cadd': '100'}}, 'Invalid value for CADD (cadd): must be at most 99')
        self._assert_invalid(
            {'frequency': {'gnomad_genomes_af': 1.5}},
            'Invalid value for gnomAD genomes AF (gnomad_genomes_af): must be at most 1',
        )
        self._assert_invalid(
            {'frequency': {'gnomad_genomes_ac': -1}},
            'Invalid value for gnomAD genomes AC (gnomad_genomes_ac): must be at least 0',
        )
        for value in [1.5, '1.5']:
            self._assert_invalid(
                {'frequency': {'gnomad_genomes_ac': value}},
                'Invalid value for gnomAD genomes AC (gnomad_genomes_ac): expected a whole number',
            )
        self._assert_invalid(
            {'quality': {'min_gq': 105}}, 'Invalid value for Genotype Quality (min_gq): must be at most 100')

        for value in ['X', 'd', 1, True, ['D']]:
            self._assert_invalid(
                {'in_silico': {'mut_taster': value}},
                'Invalid value for MutTaster (mut_taster): expected one of D, A, N, P',
            )
        for value in ['pass', 'true', 1, 0]:
            self._assert_invalid(
                {'quality': {'vcf_filter': value}},
                'Invalid value for Pass Variants Only (vcf_filter): expected true or false',
            )

    def test_parse_dynamic_filters(self):
        self.assertListEqual(parse_dynamic_filters(None), [])
        self.assertListEqual(parse_dynamic_filters({}), [])
        self.assertListEqual(parse_dynamic_filters({'in_silico': {}, 'frequency': {'gnomad_genomes_af': None}}), [])
        validate_dynamic_filters(None)
        validate_dynamic_filters({'in_silico': {'cadd': 'not validated outside of the dynamic key'}})

        parsed = parse_dynamic_filters({
            'in_silico': {'cadd': '20', 'revel': '0.5', 'mpc': 2, 'gnomad_noncoding': -1.5, 'mut_taster': 'N'},
            'frequency': {'gnomad_genomes_af': 1, 'gnomad_genomes_ac': '7', 'callset_hh': 2.0},
            'quality': {'min_gq': 40.0, 'min_ab': 12.5, 'vcf_filter': False},
        })
        self.assertListEqual([(field['group'], field['key'], value) for field, value in parsed], [
            ('in_silico', 'cadd', 20), ('in_silico', 'revel', 0.5), ('in_silico', 'mpc', 2),
            ('in_silico', 'gnomad_noncoding', -1.5), ('in_silico', 'mut_taster', 'N'),
            ('frequency', 'gnomad_genomes_af', 1), ('frequency', 'gnomad_genomes_ac', 7), ('frequency', 'callset_hh', 2),
            ('quality', 'min_gq', 40), ('quality', 'min_ab', 12.5), ('quality', 'vcf_filter', False),
        ])
        self.assertListEqual(
            [type(value) for _, value in parsed], [int, float, int, float, str, int, int, int, int, float, bool])

    def test_apply_dynamic_filters(self):
        self.assertDictEqual(apply_dynamic_filters({}), {})
        legacy_search = {
            'inheritance': {'mode': 'de_novo'},
            'in_silico': {'cadd': 20, 'mut_taster': 'N', 'requireScore': True},
            'freqs': {'callset': {'ac': 1000, 'hh': 2}, 'gnomad_genomes': {'af': 0.03}, 'sv_callset': {'ac': 50}},
            'qualityFilter': {'min_gq': 40, 'min_qs': 30, 'vcf_filter': 'pass', 'affected_only': True},
        }
        self.assertDictEqual(apply_dynamic_filters(legacy_search), legacy_search)
        self.assertDictEqual(apply_dynamic_filters({**legacy_search, 'dynamic': None}), legacy_search)

        search = {
            'inheritance': {'mode': 'de_novo'},
            'in_silico': {'requireScore': True},
            'freqs': {'callset': {'ac': 1000}},
            'qualityFilter': {'affected_only': True},
            'dynamic': {
                'in_silico': {'cadd': 20, 'mut_taster': 'N'},
                'frequency': {'callset_hh': 2, 'gnomad_genomes_af': 0.03, 'sv_callset_ac': 50},
                'quality': {'min_gq': 40, 'min_qs': 30, 'vcf_filter': True},
            },
        }
        original_search = deepcopy(search)
        self.assertDictEqual(apply_dynamic_filters(search), legacy_search)
        self.assertDictEqual(search, original_search)

        self.assertDictEqual(apply_dynamic_filters({
            'in_silico': None, 'qualityFilter': None, 'freqs': {'callset': None, 'gnomad_genomes': {'af': None, 'ac': ''}},
            'dynamic': {
                'in_silico': {'cadd': 20}, 'quality': {'vcf_filter': False, 'min_gq': None},
                'frequency': {'callset_ac': 5, 'gnomad_genomes_af': 0.03, 'gnomad_genomes_ac': 10},
            },
        }), {
            'in_silico': {'cadd': 20}, 'qualityFilter': None,
            'freqs': {'callset': {'ac': 5}, 'gnomad_genomes': {'af': 0.03, 'ac': 10}},
        })

        # The same filter can be set by both the legacy and the dynamic key only if the values agree
        self.assertDictEqual(apply_dynamic_filters({
            'in_silico': {'cadd': 20}, 'qualityFilter': {'vcf_filter': 'pass'},
            'dynamic': {'in_silico': {'cadd': 20}, 'quality': {'vcf_filter': True}},
        }), {'in_silico': {'cadd': 20}, 'qualityFilter': {'vcf_filter': 'pass'}})
        with self.assertRaises(InvalidSearchException) as cm:
            apply_dynamic_filters({'in_silico': {'cadd': 20}, 'dynamic': {'in_silico': {'cadd': 25}}})
        self.assertEqual(
            str(cm.exception), 'CADD (cadd) is set to different values by the dynamic and in_silico.cadd filters')
        with self.assertRaises(InvalidSearchException) as cm:
            apply_dynamic_filters({
                'freqs': {'gnomad_genomes': {'af': 0.01}}, 'dynamic': {'frequency': {'gnomad_genomes_af': 0.03}},
            })
        self.assertEqual(str(cm.exception), (
            'gnomAD genomes AF (gnomad_genomes_af) is set to different values by the dynamic and '
            'freqs.gnomad_genomes.af filters'
        ))
