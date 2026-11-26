import json
import tomllib
import unittest

from seqr.utils.talos_export_utils import APPROXIMATED, DROPPED, EXPORTED, TALOS_COMMIT, TALOS_VERSION, \
    TALOS_VERSION_LABEL, build_talos_export, dumps_toml, get_talos_moi, parse_locus_items, render_talos_toml

AU_PANEL_GUID = 'LL00001_kidney'
OTHER_AU_PANEL_GUID = 'LL00002_cardiac'
UK_PANEL_GUID = 'LL00003_uk_panel'
CUSTOM_LIST_GUID = 'LL00004_custom'
LOCUS_LISTS = {
    AU_PANEL_GUID: {'name': 'Kidneyome', 'paSource': 'AU', 'panelAppId': 275, 'geneMois': {}},
    OTHER_AU_PANEL_GUID: {'name': 'Cardiac', 'paSource': 'AU', 'panelAppId': 30, 'geneMois': {}},
    UK_PANEL_GUID: {'name': 'UK renal', 'paSource': 'UK', 'panelAppId': 9, 'geneMois': {
        'ENSG00000000001': 'BIALLELIC, autosomal or pseudoautosomal',
        'ENSG00000000002': 'MONOALLELIC, autosomal or pseudoautosomal, NOT imprinted',
        'ENSG00000000003': 'Unknown',
        'ENSG00000000004': 'MONOALLELIC, autosomal or pseudoautosomal, imprinted status unknown',
    }},
    CUSTOM_LIST_GUID: {'name': 'My genes', 'paSource': None, 'panelAppId': None, 'geneMois': {}},
}
GENE_IDS_BY_SYMBOL = {'PKD1': 'ENSG00000000001', 'PKD2': 'ENSG00000000002', 'NPHS1': 'ENSG00000000003'}
GENES_BY_ID = {
    'ENSG00000000001': {'symbol': 'PKD1', 'chrom': '16'},
    'ENSG00000000002': {'symbol': 'PKD2', 'chrom': '4'},
    'ENSG00000000003': {'symbol': 'NPHS1', 'chrom': '19'},
    'ENSG00000000004': {'symbol': 'OFD1', 'chrom': 'X'},
}


def _query(search, name='Query 1'):
    return {'guid': f'WSQ_{name}', 'name': name, 'worksheet': 'Sheet', 'search': search}


def _export(*searches):
    queries = [_query(search, name=f'Query {i + 1}') for i, search in enumerate(searches)]
    return build_talos_export(
        queries, locus_lists=LOCUS_LISTS, gene_ids_by_symbol=GENE_IDS_BY_SYMBOL, genes_by_id=GENES_BY_ID)


def _rows(export):
    return [(
        row['query'], row['parameter'], row['value'], row['outcome'], row.get('talosKey'),
    ) for row in export['report']]


class TalosExportTest(unittest.TestCase):

    maxDiff = None

    def _assert_single_query(self, search, config, rows):
        export = _export(search)
        self.assertDictEqual(export['config'], config)
        self.assertListEqual(_rows(export), [('Query 1', *row) for row in rows])
        for row in export['report']:
            self.assertTrue(row['note'], row)
            self.assertDictEqual(
                {key: row[key] for key in ['queryGuid', 'worksheet']}, {'queryGuid': 'WSQ_Query 1', 'worksheet': 'Sheet'})
        # The configuration always serializes to TOML that reads back as the same configuration
        self.assertDictEqual(tomllib.loads(render_talos_toml(config, 'Workbook')), config)

    def test_mapped_parameters(self):
        cases = [
            (
                {'freqs': {'gnomad_genomes': {'af': 0.001, 'ac': None}}},
                {'ValidateMOI': {'gnomad_max_af': 0.001}},
                [('freqs.gnomad_genomes.af', 0.001, APPROXIMATED, 'ValidateMOI.gnomad_max_af')],
            ),
            (
                {'freqs': {'gnomad_exomes': {'af': '0.02', 'hh': 3}}},
                {'ValidateMOI': {'gnomad_max_af': 0.02, 'gnomad_max_homozygotes': 3, 'gnomad_max_hemizygotes': 3}},
                [
                    ('freqs.gnomad_exomes.af', '0.02', APPROXIMATED, 'ValidateMOI.gnomad_max_af'),
                    ('freqs.gnomad_exomes.hh', 3, APPROXIMATED, 'ValidateMOI.gnomad_max_homozygotes'),
                    ('freqs.gnomad_exomes.hh', 3, APPROXIMATED, 'ValidateMOI.gnomad_max_hemizygotes'),
                ],
            ),
            (
                # One Talos threshold for the genomes and exomes thresholds of seqr: the most permissive
                {'freqs': {'gnomad_genomes': {'af': 0.001}, 'gnomad_exomes': {'af': 0.01}}},
                {'ValidateMOI': {'gnomad_max_af': 0.01}},
                [
                    ('freqs.gnomad_genomes.af', 0.001, APPROXIMATED, 'ValidateMOI.gnomad_max_af'),
                    ('freqs.gnomad_exomes.af', 0.01, APPROXIMATED, 'ValidateMOI.gnomad_max_af'),
                ],
            ),
            (
                {'freqs': {'callset': {'af': 0.05}, 'gnomad_svs': {'af': 0.001}, 'sv_callset': {'af': 0.02}}},
                {'ValidateMOI': {'callset_max_af': 0.05, 'gnomad_sv_max_af': 0.001, 'callset_sv_max_af': 0.02}},
                [
                    ('freqs.callset.af', 0.05, APPROXIMATED, 'ValidateMOI.callset_max_af'),
                    ('freqs.gnomad_svs.af', 0.001, APPROXIMATED, 'ValidateMOI.gnomad_sv_max_af'),
                    ('freqs.sv_callset.af', 0.02, APPROXIMATED, 'ValidateMOI.callset_sv_max_af'),
                ],
            ),
            (
                # Talos requires a float for a frequency
                {'freqs': {'callset': {'af': 0}}},
                {'ValidateMOI': {'callset_max_af': 0.0}},
                [('freqs.callset.af', 0, APPROXIMATED, 'ValidateMOI.callset_max_af')],
            ),
            (
                {'in_silico': {'splice_ai': '0.5', 'alphamissense': 0.9, 'cadd': None}},
                {'RunHailFiltering': {'spliceai': 0.5, 'am_pathogenicity': 0.9}},
                [
                    ('in_silico.splice_ai', '0.5', APPROXIMATED, 'RunHailFiltering.spliceai'),
                    ('in_silico.alphamissense', 0.9, APPROXIMATED, 'RunHailFiltering.am_pathogenicity'),
                ],
            ),
            (
                {'annotations': {'splice_ai': '0.2', 'synonymous': []}},
                {'RunHailFiltering': {'spliceai': 0.2}},
                [('annotations.splice_ai', '0.2', APPROXIMATED, 'RunHailFiltering.spliceai')],
            ),
            (
                {'inheritance': {'mode': 'de_novo'}, 'qualityFilter': {'min_gq': 30, 'min_ab': 20, 'min_qs': 0}},
                {'RunHailFiltering': {'de_novo': {'min_proband_gq': 30, 'min_child_ab': 0.2}}},
                [
                    ('inheritance.mode', 'de_novo', DROPPED, None),
                    ('qualityFilter.min_gq', 30, APPROXIMATED, 'RunHailFiltering.de_novo.min_proband_gq'),
                    ('qualityFilter.min_ab', 20, APPROXIMATED, 'RunHailFiltering.de_novo.min_child_ab'),
                ],
            ),
            (
                {'annotations': {
                    'nonsense': ['stop_gained'], 'frameshift': ['frameshift_variant'],
                    'essential_splice_site': ['splice_donor_variant', 'splice_acceptor_variant'],
                    'missense': ['stop_lost', 'start_lost', 'protein_altering_variant', 'missense_variant'],
                    'in_frame': ['inframe_insertion', 'inframe_deletion'],
                    'other': ['transcript_ablation', '5_prime_UTR_variant', 'non_coding_transcript_exon_variant__canonical'],
                    'structural': ['gCNV_DEL', 7],
                }},
                {'RunHailFiltering': {
                    'critical_csq': [
                        'frameshift', 'splice_acceptor', 'splice_donor', 'start_lost', 'stop_gained', 'stop_lost',
                        'transcript_ablation',
                    ],
                    'additional_csq': ['inframe_deletion', 'inframe_insertion', 'missense'],
                }},
                [
                    ('annotations.nonsense', ['stop_gained'], APPROXIMATED, 'RunHailFiltering.critical_csq'),
                    ('annotations.frameshift', ['frameshift_variant'], APPROXIMATED, 'RunHailFiltering.critical_csq'),
                    ('annotations.essential_splice_site', ['splice_donor_variant', 'splice_acceptor_variant'],
                     APPROXIMATED, 'RunHailFiltering.critical_csq'),
                    ('annotations.missense', ['stop_lost', 'start_lost'], APPROXIMATED, 'RunHailFiltering.critical_csq'),
                    ('annotations.missense', ['missense_variant'], APPROXIMATED, 'RunHailFiltering.additional_csq'),
                    ('annotations.missense', ['protein_altering_variant'], DROPPED, None),
                    ('annotations.in_frame', ['inframe_insertion', 'inframe_deletion'], APPROXIMATED,
                     'RunHailFiltering.additional_csq'),
                    ('annotations.other', ['transcript_ablation'], APPROXIMATED, 'RunHailFiltering.critical_csq'),
                    ('annotations.other', ['5_prime_UTR_variant', 'non_coding_transcript_exon_variant__canonical'],
                     DROPPED, None),
                    ('annotations.structural', ['gCNV_DEL', 7], DROPPED, None),
                ],
            ),
            (
                {'locus': {
                    'locusListGuid': AU_PANEL_GUID, 'rawItems': 'PKD1, PKD2',
                    'panelAppItems': {'green': 'PKD1', 'amber': 'PKD2'}, 'selectedMOIs': ['BIALLELIC'],
                }},
                {'GeneratePanelData': {'forced_panels': [275]}},
                [
                    ('locus.selectedMOIs', ['BIALLELIC'], DROPPED, None),
                    ('locus.locusListGuid', 'Kidneyome (PanelApp AU panel 275)', EXPORTED,
                     'GeneratePanelData.forced_panels'),
                    ('locus.panelAppItems', {'green': 'PKD1', 'amber': 'PKD2'}, DROPPED, None),
                ],
            ),
            (
                {'locus': {'locusListGuid': AU_PANEL_GUID, 'rawItems': 'PKD1, PKD2', 'selectedMOIs': []}},
                {'GeneratePanelData': {'forced_panels': [275]}},
                [('locus.locusListGuid', 'Kidneyome (PanelApp AU panel 275)', EXPORTED,
                  'GeneratePanelData.forced_panels')],
            ),
            (
                # A panel of another PanelApp instance: only its genes with a mode of inheritance are exported
                {'locus': {
                    'locusListGuid': UK_PANEL_GUID,
                    'rawItems': 'PKD1, PKD2\nNPHS1 ENSG00000000004 ENSG00000000009 NOTAGENE chr2:100-200 PKD1',
                }},
                {
                    'GeneratePanelData': {'manual_overrides': [
                        {'ensg': 'ENSG00000000001', 'moi': 'Biallelic', 'symbol': 'PKD1'},
                        {'ensg': 'ENSG00000000002', 'moi': 'Monoallelic', 'symbol': 'PKD2'},
                        {'ensg': 'ENSG00000000004', 'moi': 'Hemi_Mono_In_Female', 'symbol': 'OFD1'},
                    ]},
                    'PanelApp': {'manual_overrides': [
                        {'ensg': 'ENSG00000000001', 'moi': 'Biallelic', 'symbol': 'PKD1'},
                        {'ensg': 'ENSG00000000002', 'moi': 'Monoallelic', 'symbol': 'PKD2'},
                        {'ensg': 'ENSG00000000004', 'moi': 'Hemi_Mono_In_Female', 'symbol': 'OFD1'},
                    ]},
                },
                [
                    ('locus.locusListGuid', 'UK renal (PanelApp UK panel 9)', DROPPED, None),
                    ('locus.rawItems', ['chr2:100-200'], DROPPED, None),
                    ('locus.rawItems', ['NOTAGENE'], DROPPED, None),
                    ('locus.rawItems', ['OFD1 (Hemi_Mono_In_Female)', 'PKD1 (Biallelic)', 'PKD2 (Monoallelic)'],
                     APPROXIMATED, 'PanelApp.manual_overrides, GeneratePanelData.manual_overrides'),
                    ('locus.rawItems', ['ENSG00000000009', 'NPHS1'], DROPPED, None),
                ],
            ),
            (
                # The genes of a panel are taken from the colour fields when the query has no gene text
                {'locus': {'locusListGuid': UK_PANEL_GUID, 'panelAppItems': {'green': 'PKD1', 'red': None}}},
                {
                    'GeneratePanelData': {'manual_overrides': [
                        {'ensg': 'ENSG00000000001', 'moi': 'Biallelic', 'symbol': 'PKD1'}]},
                    'PanelApp': {'manual_overrides': [{'ensg': 'ENSG00000000001', 'moi': 'Biallelic', 'symbol': 'PKD1'}]},
                },
                [
                    ('locus.locusListGuid', 'UK renal (PanelApp UK panel 9)', DROPPED, None),
                    ('locus.rawItems', ['PKD1 (Biallelic)'], APPROXIMATED,
                     'PanelApp.manual_overrides, GeneratePanelData.manual_overrides'),
                ],
            ),
        ]
        for search, config, rows in cases:
            with self.subTest(search=search):
                self._assert_single_query(search, config, rows)

    def test_dropped_parameters(self):
        cases = [
            ({'inheritance': {'mode': 'recessive', 'filter': {'A': None, 'N': None}}}, [
                ('inheritance.mode', 'recessive', DROPPED, None),
            ]),
            ({'inheritance': {'filter': {'affected': {'I1': 'A'}, 'genotype': {'I1': 'ref_alt'}}}}, [
                ('inheritance.filter', {'affected': {'I1': 'A'}, 'genotype': {'I1': 'ref_alt'}}, DROPPED, None),
            ]),
            ({'inheritance': {'annotationSecondary': True, 'future': 'x'}}, [
                ('inheritance.annotationSecondary', True, DROPPED, None),
                ('inheritance.future', 'x', DROPPED, None),
            ]),
            ({'pathogenicity': {'clinvar': ['pathogenic'], 'hgmd': ['disease_causing'], 'clinvarMinStars': 2}}, [
                ('pathogenicity.clinvar', ['pathogenic'], DROPPED, None),
                ('pathogenicity.hgmd', ['disease_causing'], DROPPED, None),
                ('pathogenicity.clinvarMinStars', 2, DROPPED, None),
            ]),
            ({'annotations_secondary': {'nonsense': ['stop_gained']}}, [
                ('annotations_secondary', {'nonsense': ['stop_gained']}, DROPPED, None),
            ]),
            ({'annotations': {'nonsense': 'stop_gained', 'splice_ai': 'high'}}, [
                ('annotations.nonsense', 'stop_gained', DROPPED, None),
                ('annotations.splice_ai', 'high', DROPPED, None),
            ]),
            ({'freqs': {
                'topmed': {'af': 0.01}, 'gnomad_mito': {'af': 1, 'ac': None}, 'gnomad_genomes': {'ac': 5, 'af': 1},
                'callset': {'ac': 3000, 'hh': 2, 'af': 2}, 'gnomad_svs': 0.5, 'sv_callset': {'af': True, 'het': 3},
                'gnomad_exomes': {'hh': 2.5, 'af': 'rare'},
            }}, [
                ('freqs.topmed', {'af': 0.01}, DROPPED, None),
                ('freqs.gnomad_genomes.ac', 5, DROPPED, None),
                ('freqs.callset.ac', 3000, DROPPED, None),
                ('freqs.callset.hh', 2, DROPPED, None),
                ('freqs.gnomad_svs', 0.5, DROPPED, None),
                ('freqs.sv_callset.af', True, DROPPED, None),
                ('freqs.sv_callset.het', 3, DROPPED, None),
                ('freqs.gnomad_exomes.hh', 2.5, DROPPED, None),
                ('freqs.gnomad_exomes.hh', 2.5, DROPPED, None),
                ('freqs.gnomad_exomes.af', 'rare', DROPPED, None),
            ]),
            ({'in_silico': {'cadd': '25', 'revel': 0.5, 'requireScore': True, 'splice_ai': [0.5]}}, [
                ('in_silico.cadd', '25', DROPPED, None),
                ('in_silico.revel', 0.5, DROPPED, None),
                ('in_silico.requireScore', True, DROPPED, None),
                ('in_silico.splice_ai', [0.5], DROPPED, None),
            ]),
            ({'inheritance': {'mode': 'recessive'}, 'qualityFilter': {
                'min_gq': 30, 'min_ab': 20, 'vcf_filter': 'pass', 'affected_only': True, 'min_qs': 50, 'min_gq_sv': 5,
                'min_hl': 10, 'min_dp': 8,
            }}, [
                ('inheritance.mode', 'recessive', DROPPED, None),
                ('qualityFilter.min_gq', 30, DROPPED, None),
                ('qualityFilter.min_ab', 20, DROPPED, None),
                ('qualityFilter.vcf_filter', 'pass', DROPPED, None),
                ('qualityFilter.affected_only', True, DROPPED, None),
                ('qualityFilter.min_qs', 50, DROPPED, None),
                ('qualityFilter.min_gq_sv', 5, DROPPED, None),
                ('qualityFilter.min_hl', 10, DROPPED, None),
                ('qualityFilter.min_dp', 8, DROPPED, None),
            ]),
            ({'inheritance': {'mode': 'de_novo'}, 'qualityFilter': {'min_gq': 30.5}}, [
                ('inheritance.mode', 'de_novo', DROPPED, None),
                ('qualityFilter.min_gq', 30.5, DROPPED, None),
            ]),
            ({'exclude': {'clinvar': ['benign'], 'previousSearch': True, 'rawItems': 'chr1:1-200', 'other': 'x'}}, [
                ('exclude.clinvar', ['benign'], DROPPED, None),
                ('exclude.previousSearch', True, DROPPED, None),
                ('exclude.rawItems', ['chr1:1-200'], DROPPED, None),
                ('exclude.other', 'x', DROPPED, None),
            ]),
            ({'locus': {'rawVariantItems': '1-1000-A-T', 'rawItems': None, 'future': 1}}, [
                ('locus.rawVariantItems', '1-1000-A-T', DROPPED, None),
                ('locus.future', 1, DROPPED, None),
            ]),
            # Custom genes have no mode of inheritance in seqr, so they are not written as manual overrides
            ({'locus': {'locusListGuid': CUSTOM_LIST_GUID, 'rawItems': 'PKD1 ENSG00000000002'}}, [
                ('locus.rawItems', ['PKD2', 'PKD1'], DROPPED, None),
            ]),
            ({'locus': {'rawItems': 'PKD1'}}, [('locus.rawItems', ['PKD1'], DROPPED, None)]),
            ({'locus': {'locusListGuid': CUSTOM_LIST_GUID}}, [('locus.locusListGuid', 'My genes', DROPPED, None)]),
            ({'locus': {'locusListGuid': 'LL_no_access'}}, [('locus.locusListGuid', 'LL_no_access', DROPPED, None)]),
            ({'locus': {'locusListGuid': UK_PANEL_GUID}}, [
                ('locus.locusListGuid', 'UK renal (PanelApp UK panel 9)', DROPPED, None),
            ]),
        ]
        for search, rows in cases:
            with self.subTest(search=search):
                self._assert_single_query(search, {}, rows)

    def test_unknown_parameters(self):
        export = _export({'futureFilter': {'a': 1}, 'emptyFuture': None, 'freqs': ['x'], 'locus': 'PKD1'})
        self.assertDictEqual(export['config'], {})
        self.assertListEqual(_rows(export), [
            ('Query 1', 'freqs', ['x'], DROPPED, None),
            ('Query 1', 'locus', 'PKD1', DROPPED, None),
            ('Query 1', 'futureFilter', {'a': 1}, DROPPED, None),
            ('Query 1', 'emptyFuture', None, DROPPED, None),
        ])
        self.assertEqual(
            export['report'][2]['note'],
            'Unknown search parameter "futureFilter": seqr does not know how to export it.')
        self.assertEqual(export['report'][0]['note'], 'Not exported: "freqs" does not have the format of a seqr search.')

        for search in [None, 'de_novo', ['x']]:
            with self.subTest(search=search):
                export = _export(search)
                self.assertDictEqual(export['config'], {})
                self.assertListEqual(_rows(export), [('Query 1', 'search', search, DROPPED, None)])

    def test_no_op_values_have_no_rows(self):
        self._assert_single_query({
            'freqs': {'gnomad_genomes': {'af': 1, 'ac': None}, 'topmed': {'af': 1, 'ac': None}, 'callset': {}},
            'annotations': {'structural': [], 'splice_ai': None}, 'inheritance': {'mode': None, 'filter': {}},
            'qualityFilter': {'min_gq': 0, 'min_ab': None, 'vcf_filter': None, 'affected_only': False},
            'pathogenicity': {'clinvar': [], 'hgmd': []}, 'in_silico': {'requireScore': False, 'cadd': ''},
            'locus': {'rawItems': '', 'rawVariantItems': None}, 'exclude': {'clinvar': [], 'rawItems': None},
            'annotations_secondary': {'nonsense': []},
        }, {}, [])

    def test_empty_workbook(self):
        export = build_talos_export([])
        self.assertDictEqual(export, {'config': {}, 'report': [], 'talosVersion': TALOS_VERSION_LABEL})
        self.assertEqual(TALOS_VERSION_LABEL, '12.3.2 (commit d279709d4c)')

        toml = render_talos_toml(export['config'], 'Empty')
        self.assertDictEqual(tomllib.loads(toml), {})
        self.assertTrue(all(line.startswith('#') for line in toml.strip().split('\n')))
        self.assertIn('# No parameter of this workbook could be exported.', toml)

    def test_merge_thresholds(self):
        export = _export(
            {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.001, 'hh': 0}},
             'in_silico': {'splice_ai': 0.5}, 'qualityFilter': {'min_gq': 40, 'min_ab': 25}},
            {'inheritance': {'mode': 'de_novo'}, 'freqs': {'gnomad_genomes': {'af': 0.01, 'hh': 5}},
             'annotations': {'splice_ai': '0.2'}, 'qualityFilter': {'min_gq': 20, 'min_ab': 10}},
            {'inheritance': {'mode': 'recessive'}},
        )
        self.assertDictEqual(export['config'], {
            'ValidateMOI': {'gnomad_max_af': 0.01, 'gnomad_max_homozygotes': 5, 'gnomad_max_hemizygotes': 5},
            'RunHailFiltering': {'spliceai': 0.2, 'de_novo': {'min_proband_gq': 20, 'min_child_ab': 0.1}},
        })
        self.assertSetEqual({row[3] for row in _rows(export) if row[4]}, {APPROXIMATED})
        notes = {(row['query'], row['parameter'], row.get('talosKey')): row['note'] for row in export['report']}
        other_queries = ' Talos also applies it to the variants of the queries that do not set it: "Query 3".'

        note = notes[('Query 1', 'freqs.gnomad_genomes.af', 'ValidateMOI.gnomad_max_af')]
        self.assertTrue(note.startswith('Talos has one gnomAD 4.1 combined threshold'))
        self.assertTrue(
            note.endswith(f' Merged: Talos gets 0.01, the highest value of the workbook, not 0.001.{other_queries}'))
        note = notes[('Query 2', 'freqs.gnomad_genomes.af', 'ValidateMOI.gnomad_max_af')]
        self.assertNotIn('Merged', note)
        self.assertTrue(note.endswith(f'raise it by hand if this value is higher.{other_queries}'))

        self.assertIn(
            'Merged: Talos gets 5, the highest value of the workbook, not 0.',
            notes[('Query 1', 'freqs.gnomad_genomes.hh', 'ValidateMOI.gnomad_max_hemizygotes')])
        self.assertIn(
            'Merged: Talos gets 0.2, the lowest value of the workbook, not 0.5.',
            notes[('Query 1', 'in_silico.splice_ai', 'RunHailFiltering.spliceai')])
        self.assertNotIn('Merged', notes[('Query 2', 'annotations.splice_ai', 'RunHailFiltering.spliceai')])
        self.assertIn(
            'Merged: Talos gets 20, the lowest value of the workbook, not 40.',
            notes[('Query 1', 'qualityFilter.min_gq', 'RunHailFiltering.de_novo.min_proband_gq')])
        self.assertIn(
            'Merged: Talos gets 0.1, the lowest value of the workbook, not 0.25.',
            notes[('Query 1', 'qualityFilter.min_ab', 'RunHailFiltering.de_novo.min_child_ab')])

        # No note about other queries when every query sets the parameter
        export = _export({'freqs': {'callset': {'af': 0.01}}}, {'freqs': {'callset': {'af': 0.01}}})
        self.assertDictEqual(export['config'], {'ValidateMOI': {'callset_max_af': 0.01}})
        for row in export['report']:
            self.assertTrue(row['note'].endswith('keep their own Talos thresholds.'), row['note'])

    def test_merge_consequences(self):
        export = _export(
            {'annotations': {'nonsense': ['stop_gained'], 'missense': ['missense_variant']}},
            {'annotations': {'frameshift': ['frameshift_variant']}},
            {'annotations': {'frameshift': ['frameshift_variant'], 'nonsense': ['stop_gained']}},
        )
        self.assertDictEqual(export['config'], {'RunHailFiltering': {
            'critical_csq': ['frameshift', 'stop_gained'], 'additional_csq': ['missense'],
        }})
        notes = {(row['query'], row['parameter']): row['note'] for row in export['report']}
        self.assertTrue(notes[('Query 1', 'annotations.nonsense')].endswith(
            ' Merged: Talos gets the terms of all queries (frameshift, stop_gained).'))
        self.assertTrue(notes[('Query 2', 'annotations.frameshift')].endswith(
            ' Merged: Talos gets the terms of all queries (frameshift, stop_gained).'))
        self.assertTrue(notes[('Query 1', 'annotations.missense')].endswith(
            'needs the VEP spellings. Talos also applies it to the variants of the queries that do not set it: '
            '"Query 2", "Query 3".'))

    def test_merge_genes(self):
        export = _export(
            {'locus': {'locusListGuid': AU_PANEL_GUID}, 'exclude': {'rawItems': 'PKD1, PKD2, chr1:5-10%20'}},
            {'locus': {'locusListGuid': OTHER_AU_PANEL_GUID}, 'exclude': {'rawItems': 'ENSG00000000001 NPHS1 XYZ'}},
            {'locus': {'locusListGuid': AU_PANEL_GUID}, 'exclude': {'rawItems': 'PKD1'}},
        )
        self.assertDictEqual(export['config'], {'GeneratePanelData': {
            'forced_panels': [30, 275], 'forbidden_genes': ['ENSG00000000001'],
        }})
        self.assertListEqual([row for row in _rows(export) if row[1].startswith('exclude')], [
            ('Query 1', 'exclude.rawItems', ['chr1:5-10%20'], DROPPED, None),
            ('Query 1', 'exclude.rawItems', ['PKD1'], EXPORTED, 'GeneratePanelData.forbidden_genes'),
            ('Query 1', 'exclude.rawItems', ['PKD2'], DROPPED, None),
            ('Query 2', 'exclude.rawItems', ['XYZ'], DROPPED, None),
            ('Query 2', 'exclude.rawItems', ['PKD1'], EXPORTED, 'GeneratePanelData.forbidden_genes'),
            ('Query 2', 'exclude.rawItems', ['NPHS1'], DROPPED, None),
            ('Query 3', 'exclude.rawItems', ['PKD1'], EXPORTED, 'GeneratePanelData.forbidden_genes'),
        ])

        # A gene is only forbidden in Talos if every query of the workbook excludes it
        export = _export({'exclude': {'rawItems': 'PKD1'}}, {'inheritance': {'mode': 'de_novo'}})
        self.assertDictEqual(export['config'], {})
        self.assertListEqual(_rows(export), [
            ('Query 1', 'exclude.rawItems', ['PKD1'], DROPPED, None),
            ('Query 2', 'inheritance.mode', 'de_novo', DROPPED, None),
        ])

        # The most lenient mode of inheritance is used for a gene with several
        locus_lists = {
            'LL1': {'paSource': 'UK', 'panelAppId': 1, 'name': 'A', 'geneMois': {'ENSG01': 'BIALLELIC', 'ENSG02': 'BIALLELIC'}},
            'LL2': {'paSource': 'UK', 'panelAppId': 2, 'name': 'B', 'geneMois': {
                'ENSG01': 'MONOALLELIC', 'ENSG02': 'X-LINKED: hemizygous mutation in males, biallelic mutations in females',
            }},
        }
        export = build_talos_export([
            _query({'locus': {'locusListGuid': guid, 'rawItems': 'ENSG01 ENSG02'}}, name=guid) for guid in locus_lists
        ], locus_lists=locus_lists)
        self.assertListEqual(export['config']['PanelApp']['manual_overrides'], [
            {'ensg': 'ENSG01', 'moi': 'Mono_And_Biallelic'}, {'ensg': 'ENSG02', 'moi': 'Hemi_Bi_In_Female'},
        ])
        self.assertListEqual(
            export['config']['GeneratePanelData']['manual_overrides'], export['config']['PanelApp']['manual_overrides'])

    def test_fixture_saved_searches(self):
        with open('seqr/fixtures/variant_searches.json') as f:
            searches = [model['fields'] for model in json.load(f)]
        export = build_talos_export([
            {'guid': f'WSQ{i}', 'name': search['name'], 'worksheet': 'Saved', 'search': search['search']}
            for i, search in enumerate(searches)
        ])
        self.assertSetEqual(set(export['config'].keys()), {'ValidateMOI', 'RunHailFiltering'})
        self.assertDictEqual(export['config']['ValidateMOI'], {
            'gnomad_max_af': 0.01, 'gnomad_sv_max_af': 0.01, 'gnomad_max_homozygotes': 5, 'gnomad_max_hemizygotes': 5,
        })
        self.assertEqual(export['config']['RunHailFiltering']['spliceai'], 0.1)
        self.assertDictEqual(export['config']['RunHailFiltering']['de_novo'], {'min_proband_gq': 30, 'min_child_ab': 0.1})
        self.assertSetEqual({row['query'] for row in export['report']}, {search['name'] for search in searches})
        self.assertSetEqual({row['outcome'] for row in export['report']}, {APPROXIMATED, DROPPED})
        self.assertFalse([row for row in export['report'] if 'Unknown search parameter' in row['note']])
        self.assertDictEqual(tomllib.loads(render_talos_toml(export['config'], 'Saved')), export['config'])

    def test_parse_locus_items(self):
        self.assertDictEqual(parse_locus_items(None), {'geneIds': [], 'symbols': [], 'intervals': []})
        self.assertDictEqual(parse_locus_items('PKD1,ensg0001  PKD1\nchr1:10-20, 2:5-9%10 X\t100\t200 GENE:1 A\tB'), {
            'geneIds': ['ensg0001'], 'symbols': ['PKD1', 'GENE:1', 'AB'], 'intervals': ['chr1:10-20', '2:5-9%10', 'X 100 200'],
        })

    def test_get_talos_moi(self):
        cases = [
            ('BIALLELIC, autosomal or pseudoautosomal', '1', 'Biallelic'),
            ('MONOALLELIC, autosomal or pseudoautosomal, NOT imprinted', '1', 'Monoallelic'),
            ('MONOALLELIC, autosomal or pseudoautosomal, NOT imprinted', 'X', 'Hemi_Mono_In_Female'),
            ('BOTH monoallelic and biallelic, autosomal or pseudoautosomal', '1', 'Mono_And_Biallelic'),
            ('X-LINKED: hemizygous mutation in males, biallelic mutations in females', 'X', 'Hemi_Bi_In_Female'),
            ('X-LINKED: hemizygous mutation in males, monoallelic mutations in females may cause disease', 'X',
             'Hemi_Mono_In_Female'),
            ('MITOCHONDRIAL', 'M', 'Mitochondrial'),
            ('Mitochondrial or other', 'M', None),
            ('Unknown', '1', None),
            ('Other - please specifiy in evaluation comments', '1', None),
            ('', '1', None),
            (None, None, None),
        ]
        for moi, chrom, expected in cases:
            with self.subTest(moi=moi, chrom=chrom):
                self.assertEqual(get_talos_moi(moi, chrom), expected)


HOSTILE_STRINGS = [
    '', 'plain', 'quote " and \\ backslash', 'new\nline\r\nand\ttab', '"""', "'''", '\\u0041', '[table]\nkey = 1',
    '# not a comment', 'control \x00\x01\x1f\x7f\b\f', 'unicode é 漢字 \U0001f9ec', '${injection} = "x"', ' = ', '\\',
]


class TomlSerializerTest(unittest.TestCase):

    maxDiff = None

    def test_round_trip(self):
        config = {
            'top': 'value',
            'singletons': False,
            'flag': True,
            'GeneratePanelData': {
                'forced_panels': [1, 2, 3],
                'empty': [],
                'forbidden_genes': ['ENSG1', 'ENSG2'],
                'nested': [[1, 2], ['a']],
                'inline': [1, {'a': 'b', 'odd key': [1.5]}],
                'manual_overrides': [{'ensg': 'ENSG1', 'moi': 'Biallelic', 'sub': {'x': 1}}, {'ensg': 'ENSG2'}],
            },
            'ValidateMOI': {
                'gnomad_max_af': 0.01, 'tiny': 0.00001, 'whole': 1.0, 'negative': -2, 'big': 10 ** 12,
                'inf': float('inf'), 'negative_inf': float('-inf'),
            },
            'RunHailFiltering': {'de_novo': {'min_child_ab': 0.2}, 'spliceai': 0.5, 'empty_table': {}},
            'key with spaces': 1,
            'dotted.key': {'in"ner': 'x'},
            '': 'empty key',
        }
        toml = dumps_toml(config)
        self.assertDictEqual(tomllib.loads(toml), config)
        self.assertIsInstance(tomllib.loads(toml)['ValidateMOI']['whole'], float)
        self.assertIn('[RunHailFiltering.de_novo]\nmin_child_ab = 0.2\n', toml)
        self.assertIn('[[GeneratePanelData.manual_overrides]]\nensg = "ENSG1"\n', toml)
        self.assertIn('["dotted.key"]\n"in\\"ner" = "x"\n', toml)
        self.assertTrue(toml.endswith('\n'))

        nan_toml = dumps_toml({'value': float('nan')})
        self.assertEqual(nan_toml, 'value = nan\n')
        self.assertNotEqual(tomllib.loads(nan_toml)['value'], tomllib.loads(nan_toml)['value'])

        self.assertEqual(dumps_toml({}), '\n')
        self.assertDictEqual(tomllib.loads(dumps_toml({})), {})

    def test_hostile_strings(self):
        for value in HOSTILE_STRINGS:
            with self.subTest(value=value):
                config = {'value': value, 'list': [value, value], value: 'as key', 'table': {value: {'key': value}},
                          'tables': [{value: value}]}
                self.assertDictEqual(tomllib.loads(dumps_toml(config)), config)

        # A lone surrogate can not be written to a file: it is replaced
        self.assertDictEqual(tomllib.loads(dumps_toml({'value': 'a\ud800b'})), {'value': 'a�b'})

    def test_unsupported_values(self):
        for config in [{'value': None}, {'value': {1, 2}}, {'list': [None]}, {1: 'x'}, {'table': {2: 'x'}}, ['x'], None]:
            with self.subTest(config=config):
                with self.assertRaises(TypeError):
                    dumps_toml(config)

    def test_render_talos_toml(self):
        config = {'GeneratePanelData': {'forced_panels': [275]}}
        toml = render_talos_toml(config, 'Kidney')
        self.assertListEqual(toml.split('\n'), [
            '# Talos configuration fragment exported from the seqr workbook "Kidney"',
            f'# Written for Talos {TALOS_VERSION}, commit {TALOS_COMMIT}',
            '# This is a starting configuration and NOT an equivalent of the seqr queries: see the fidelity report in seqr.',
            '# Talos reads one complete TOML file: merge these keys into your Talos configuration by hand.',
            '',
            '[GeneratePanelData]',
            'forced_panels = [275]',
            '',
        ])

        # A workbook name can not break out of the header comment
        for name in HOSTILE_STRINGS + ['x\n[GeneratePanelData]\nforced_panels = [1]', 'a\ud800b']:
            with self.subTest(name=name):
                toml = render_talos_toml(config, name)
                toml.encode('utf-8')
                self.assertDictEqual(tomllib.loads(toml), config)
                self.assertEqual(len(toml.split('\n')), 8)
