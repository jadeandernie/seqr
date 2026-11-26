import os

from django.core import serializers
from django.test import SimpleTestCase

from seqr.models import VariantTagType

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'variant_tag_types.json')


class VariantTagTypeFixtureTest(SimpleTestCase):

    def test_global_variant_tag_types(self):
        with open(FIXTURE_PATH) as f:
            tag_types = [deserialized.object for deserialized in serializers.deserialize('json', f)]

        self.assertTrue(all(isinstance(tag_type, VariantTagType) for tag_type in tag_types))
        self.assertTrue(all(tag_type.project_id is None for tag_type in tag_types))
        for field in ['pk', 'guid', 'name', 'order']:
            values = [getattr(tag_type, field) for tag_type in tag_types]
            self.assertEqual(len(values), len(set(values)), field)

        tag_types = sorted(tag_types, key=lambda tag_type: tag_type.order)
        tag_names = [tag_type.name for tag_type in tag_types]
        index = tag_names.index('Hypomorphic')
        self.assertListEqual(
            tag_names[index - 1:index + 2], ['Confident AR one hit', 'Hypomorphic', 'Multi-Nucleotide Variant'],
        )
        hypomorphic = tag_types[index]
        self.assertEqual(hypomorphic.guid, 'VTT_hypomorphic')
        self.assertEqual(hypomorphic.category, 'Collaboration')
        self.assertEqual(hypomorphic.color, '#a68b2c')
