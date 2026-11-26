import gzip
import mock
import os
import random
import string
import tempfile

from unittest import TestCase

from seqr.utils.file_utils import does_file_exist, list_files, list_wildcard_match_files, file_iter, file_bytes_iter
from seqr.views.utils.test_utils import MockGoogleStorage

# Random content does not compress well, so the first 64KB of the compressed files is only part of the gzip stream
RANDOM = random.Random(0)
LINES = [f'##line{i}\t{"".join(RANDOM.choices(string.ascii_letters, k=100))}ç\n' for i in range(4000)]
CONTENT = ''.join(LINES).encode('utf-8')
# bgzip files are made up of many concatenated gzip members
BGZIP_CONTENT = b''.join([gzip.compress(''.join(LINES[i:i + 50]).encode('utf-8')) for i in range(0, len(LINES), 50)])
GZIP_CONTENT = gzip.compress(CONTENT, compresslevel=1)
FILES = {
    'data/callset.vcf': CONTENT,
    'data/callset.vcf.gz': GZIP_CONTENT,
    'data/callset.vcf.bgz': BGZIP_CONTENT,
    'data/invalid.vcf.gz': CONTENT,
    'data/sharded/part-1.vcf': b'',
    'data/sharded/part-2.vcf': b'',
    'database/file.txt': b'',
}


class FileUtilsTest(object):

    ROOT = None

    def _path(self, path):
        return f'{self.ROOT}/{path}'

    def test_does_file_exist(self):
        self.assertTrue(does_file_exist(self._path('data/callset.vcf')))
        self.assertFalse(does_file_exist(self._path('data/missing.vcf')))

    def test_list_files(self):
        self.assertListEqual(sorted(list_files(self._path('data'))), [self._path(path) for path in [
            'data/callset.vcf', 'data/callset.vcf.bgz', 'data/callset.vcf.gz', 'data/invalid.vcf.gz',
            'data/sharded/part-1.vcf', 'data/sharded/part-2.vcf',
        ]])
        self.assertListEqual(
            sorted(list_files(self._path('data/sharded/'))),
            [self._path('data/sharded/part-1.vcf'), self._path('data/sharded/part-2.vcf')],
        )
        self.assertListEqual(list_files(self._path('missing')), [])

    def test_list_wildcard_match_files(self):
        self.assertListEqual(
            sorted(list_wildcard_match_files(self._path('data/sharded/part-*.vcf'))),
            [self._path('data/sharded/part-1.vcf'), self._path('data/sharded/part-2.vcf')],
        )
        # Wildcards do not match across folders
        self.assertListEqual(list_wildcard_match_files(self._path('data/*.vcf')), [self._path('data/callset.vcf')])
        self.assertListEqual(list_wildcard_match_files(self._path('*/*.txt')), [self._path('database/file.txt')])
        self.assertListEqual(list_wildcard_match_files(self._path('*.txt')), [])
        self.assertListEqual(list_wildcard_match_files(self._path('data/sharded*')), [])

    def test_file_iter(self):
        for path in ['data/callset.vcf', 'data/callset.vcf.gz', 'data/callset.vcf.bgz']:
            self.assertListEqual(list(file_iter(self._path(path))), LINES)
            # Raw content is never decompressed or decoded
            self.assertEqual(b''.join(file_iter(self._path(path), raw_content=True)), FILES[path])

        with self.assertRaises(gzip.BadGzipFile):
            next(file_iter(self._path('data/invalid.vcf.gz')))

        with self.assertRaises(FileNotFoundError) as cm:
            next(file_iter(self._path('data/missing.vcf')))
        self.assertEqual(str(cm.exception), f'Could not access file {self._path("data/missing.vcf")}')

    def test_file_bytes_iter(self):
        lines = list(file_bytes_iter(self._path('data/callset.vcf'), 0, 65536))
        self.assertEqual(''.join(lines).encode('utf-8'), CONTENT[:65537])
        self.assertListEqual(lines[:-1], LINES[:len(lines) - 1])
        self.assertFalse(lines[-1].endswith('\n'))

        # Ranges are inclusive and can start anywhere in the file
        self.assertListEqual(list(file_bytes_iter(self._path('data/callset.vcf'), 2, 20)), [LINES[0][2:21]])
        offset = len(LINES[0].encode('utf-8')) - 3
        self.assertListEqual(
            list(file_bytes_iter(self._path('data/callset.vcf'), offset, offset + 9)), ['ç\n', '##line1'])

        # Byte ranges of compressed files end part way through the compressed stream
        self.assertGreater(len(GZIP_CONTENT), 65537)
        self.assertGreater(len(BGZIP_CONTENT), 65537)
        for path in ['data/callset.vcf.gz', 'data/callset.vcf.bgz']:
            lines = list(file_bytes_iter(self._path(path), 0, 65536))
            self.assertGreater(len(lines), 100)
            self.assertLess(len(lines), len(LINES))
            self.assertListEqual(lines[:-1], LINES[:len(lines) - 1])
            self.assertTrue(LINES[len(lines) - 1].startswith(lines[-1]))

            # Raw content is never decompressed or decoded
            self.assertListEqual(
                list(file_bytes_iter(self._path(path), 100, 65536, raw_content=True)), [FILES[path][100:65537]])

            # Ranges larger than the file include the whole file
            self.assertListEqual(list(file_bytes_iter(self._path(path), 0, len(FILES[path]) + 100)), LINES)

        self.assertListEqual(
            list(file_bytes_iter(self._path('data/callset.vcf'), 0, 9, raw_content=True)), [CONTENT[:10]])

        with self.assertRaises(gzip.BadGzipFile):
            next(file_bytes_iter(self._path('data/invalid.vcf.gz'), 0, 65536))

        # Ranges ending part way through a character are valid, invalid characters are not
        offset = len(LINES[0].encode('utf-8')) - 3
        self.assertListEqual(list(file_bytes_iter(self._path('data/callset.vcf'), offset - 1, offset)), [LINES[0][-3]])
        with self.assertRaises(UnicodeDecodeError):
            next(file_bytes_iter(self._path('data/callset.vcf'), offset + 1, offset + 5))

        with self.assertRaises(FileNotFoundError) as cm:
            next(file_bytes_iter(self._path('data/missing.vcf.gz'), 0, 65536))
        self.assertEqual(str(cm.exception), f'Could not access file {self._path("data/missing.vcf.gz")}')


class LocalFileUtilsTest(FileUtilsTest, TestCase):

    def setUp(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.ROOT = temp_dir.name
        for path, content in FILES.items():
            os.makedirs(os.path.dirname(self._path(path)), exist_ok=True)
            with open(self._path(path), 'wb') as f:
                f.write(content)

    def test_does_file_exist(self):
        super().test_does_file_exist()
        self.assertFalse(does_file_exist(self._path('data')))


class GoogleStorageFileUtilsTest(FileUtilsTest, TestCase):

    ROOT = 'gs://bucket'

    def setUp(self):
        self.mock_gcs = MockGoogleStorage().start(self)
        for path, content in FILES.items():
            self.mock_gcs.add_file(self._path(path), content)

    def test_does_file_exist(self):
        super().test_does_file_exist()
        self.assertTrue(does_file_exist(self._path('data')))
        self.assertTrue(does_file_exist(self.ROOT))

    def test_list_files(self):
        super().test_list_files()
        self.assertEqual(len(list_files(self.ROOT)), len(FILES))

    def test_file_iter(self):
        super().test_file_iter()
        self.mock_gcs.add_file('gs://fc-secure-bucket/table.tsv', 'a\tb\n')
        self.mock_gcs.calls.reset_mock()
        self.assertListEqual(list(file_iter('gs://fc-secure-bucket/table.tsv')), ['a\tb\n'])
        self.assertListEqual(list(file_iter('gs://fc-secure-bucket/table.tsv', no_project=True)), ['a\tb\n'])
        self.mock_gcs.assert_calls(self, [
            mock.call.exists('gs://fc-secure-bucket/table.tsv', user_project='anvil-datastorage'),
            mock.call.open('gs://fc-secure-bucket/table.tsv', 'r', user_project='anvil-datastorage'),
            mock.call.exists('gs://fc-secure-bucket/table.tsv', user_project='anvil-datastorage'),
            mock.call.open('gs://fc-secure-bucket/table.tsv', 'r'),
        ])

    def test_file_bytes_iter(self):
        super().test_file_bytes_iter()
        self.mock_gcs.calls.reset_mock()
        next(file_bytes_iter(self._path('data/callset.vcf.gz'), 0, 65536))
        self.mock_gcs.assert_calls(self, [
            mock.call.exists(self._path('data/callset.vcf.gz')),
            mock.call.download_as_bytes(self._path('data/callset.vcf.gz'), start=0, end=65536),
        ])
