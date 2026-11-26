import mock
import os
import tempfile

from google.api_core.exceptions import Forbidden, NotFound
from google.auth.exceptions import DefaultCredentialsError
from unittest import TestCase

from seqr.utils import google_storage_utils
from seqr.utils.google_storage_utils import does_gs_file_exist, get_gs_files, get_gs_wildcard_match_files, \
    mv_file_to_gs, cp_file_from_gs, google_bucket_file_stream, google_bucket_read_bytes, get_gs_access_token
from seqr.views.utils.test_utils import MockGoogleStorage


class GoogleStorageUtilsTest(TestCase):

    def setUp(self):
        self.mock_gcs = MockGoogleStorage().start(self)
        for path in [
            'gs://bucket/data/callset.vcf', 'gs://bucket/data/sharded/part-1.vcf', 'gs://bucket/data/sharded/part-2.vcf',
            'gs://bucket/data/empty_folder/', 'gs://bucket/database/file.txt', 'gs://fc-secure-bucket/sample.cram',
        ]:
            self.mock_gcs.add_file(path, f'content of {path}')
        patcher = mock.patch('seqr.utils.google_storage_utils.logger')
        self.mock_logger = patcher.start()
        self.addCleanup(patcher.stop)

    def test_shared_client(self):
        with mock.patch('seqr.utils.google_storage_utils.storage.Client') as mock_client:
            does_gs_file_exist('gs://bucket/data/callset.vcf')
            does_gs_file_exist('gs://other-bucket/data/callset.vcf')
            get_gs_files('gs://bucket/data')
            mock_client.assert_called_once_with()

    def test_invalid_path(self):
        for func in [
            get_gs_files, lambda path: mv_file_to_gs('/local/file', path), lambda path: cp_file_from_gs(path, '/local'),
            lambda path: google_bucket_read_bytes(path, 0, 10), lambda path: google_bucket_file_stream(False)(path, 'r'),
        ]:
            with self.assertRaises(Exception) as cm:
                func('/local/path')
            self.assertEqual(str(cm.exception), 'A Google Storage path is expected.')
        self.mock_gcs.assert_calls(self, [])

    def test_does_gs_file_exist(self):
        self.assertTrue(does_gs_file_exist('gs://bucket/data/callset.vcf'))
        self.mock_gcs.assert_calls(self, [mock.call.exists('gs://bucket/data/callset.vcf')])

        # Folders exist if they contain any files
        self.assertTrue(does_gs_file_exist('gs://bucket/data'))
        self.mock_gcs.assert_calls(self, [
            mock.call.exists('gs://bucket/data'),
            mock.call.list_blobs('gs://bucket', prefix='data/', max_results=1),
        ])
        self.assertTrue(does_gs_file_exist('gs://bucket/data/sharded/'))
        self.mock_gcs.assert_calls(self, [mock.call.list_blobs('gs://bucket', prefix='data/sharded/', max_results=1)])

        # The bucket itself exists if it is accessible
        for bucket_path in ['gs://bucket', 'gs://bucket/', 'gs://empty-bucket']:
            self.assertTrue(does_gs_file_exist(bucket_path))
            self.mock_gcs.assert_calls(self, [mock.call.list_blobs(bucket_path.rstrip('/'), max_results=1)])

        # Requester pays buckets are billed to the anvil project
        self.assertTrue(does_gs_file_exist('gs://fc-secure-bucket/sample.cram'))
        self.mock_gcs.assert_calls(self, [
            mock.call.exists('gs://fc-secure-bucket/sample.cram', user_project='anvil-datastorage'),
        ])
        self.mock_logger.warning.assert_not_called()

        # A partial name match is not a folder
        self.assertFalse(does_gs_file_exist('gs://bucket/data/call'))
        self.mock_gcs.assert_calls(self, [
            mock.call.exists('gs://bucket/data/call'),
            mock.call.list_blobs('gs://bucket', prefix='data/call/', max_results=1),
        ])
        self.mock_logger.warning.assert_called_with(
            'Unable to access gs://bucket/data/call: One or more URLs matched no objects.', None)

    def test_does_gs_file_exist_errors(self):
        self.assertFalse(does_gs_file_exist('/local/path'))
        self.mock_logger.warning.assert_called_with(
            'Unable to access /local/path: A Google Storage path is expected.', None)

        errors = {
            'private-bucket': Forbidden('user does not have storage.objects.get access'),
            'missing-bucket': NotFound('The specified bucket does not exist.'),
            'no-credentials': DefaultCredentialsError('Your default credentials were not found.'),
        }
        self.mock_gcs.bucket_errors.update(errors)
        for bucket, error in errors.items():
            for path in [f'gs://{bucket}/sample.cram', f'gs://{bucket}/folder/', f'gs://{bucket}']:
                self.assertFalse(does_gs_file_exist(path))
                self.mock_logger.warning.assert_called_with(f'Unable to access {path}: {error}', None)

    def test_get_gs_files(self):
        self.assertListEqual(get_gs_files('gs://bucket/data'), [
            'gs://bucket/data/callset.vcf', 'gs://bucket/data/sharded/part-1.vcf', 'gs://bucket/data/sharded/part-2.vcf',
        ])
        self.mock_gcs.assert_calls(self, [mock.call.list_blobs('gs://bucket', prefix='data/')])
        self.assertListEqual(get_gs_files('gs://bucket/data/sharded/'), [
            'gs://bucket/data/sharded/part-1.vcf', 'gs://bucket/data/sharded/part-2.vcf',
        ])
        self.mock_gcs.assert_calls(self, [mock.call.list_blobs('gs://bucket', prefix='data/sharded/')])

        # Bucket root paths list the whole bucket
        for bucket_path in ['gs://bucket', 'gs://bucket/']:
            self.assertListEqual(get_gs_files(bucket_path), [
                'gs://bucket/data/callset.vcf', 'gs://bucket/data/sharded/part-1.vcf',
                'gs://bucket/data/sharded/part-2.vcf', 'gs://bucket/database/file.txt',
            ])
            self.mock_gcs.assert_calls(self, [mock.call.list_blobs('gs://bucket')])

        self.assertListEqual(get_gs_files('gs://empty-bucket'), [])
        self.assertListEqual(get_gs_files('gs://fc-secure-bucket'), ['gs://fc-secure-bucket/sample.cram'])
        self.mock_gcs.assert_calls(self, [
            mock.call.list_blobs('gs://empty-bucket'),
            mock.call.list_blobs('gs://fc-secure-bucket', user_project='anvil-datastorage'),
        ])

        self.mock_gcs.bucket_errors['private-bucket'] = Forbidden('no access')
        with self.assertRaises(Forbidden):
            get_gs_files('gs://private-bucket')

    def test_get_gs_wildcard_match_files(self):
        self.assertListEqual(get_gs_wildcard_match_files('gs://bucket/data/sharded/part-*.vcf'), [
            'gs://bucket/data/sharded/part-1.vcf', 'gs://bucket/data/sharded/part-2.vcf',
        ])
        self.mock_gcs.assert_calls(self, [
            mock.call.list_blobs('gs://bucket', prefix='data/sharded/part-', match_glob='data/sharded/part-*.vcf'),
        ])

        # Wildcards do not match across folders
        self.assertListEqual(get_gs_wildcard_match_files('gs://bucket/data/*.vcf'), ['gs://bucket/data/callset.vcf'])
        self.assertListEqual(get_gs_wildcard_match_files('gs://bucket/*/*/*.vcf'), [
            'gs://bucket/data/sharded/part-1.vcf', 'gs://bucket/data/sharded/part-2.vcf',
        ])
        self.assertListEqual(get_gs_wildcard_match_files('gs://bucket/data/*'), ['gs://bucket/data/callset.vcf'])
        self.assertListEqual(get_gs_wildcard_match_files('gs://bucket/*.vcf'), [])
        self.mock_gcs.assert_calls(self, [
            mock.call.list_blobs('gs://bucket', prefix='data/', match_glob='data/*.vcf'),
            mock.call.list_blobs('gs://bucket', match_glob='*/*/*.vcf'),
            mock.call.list_blobs('gs://bucket', prefix='data/', match_glob='data/*'),
            mock.call.list_blobs('gs://bucket', match_glob='*.vcf'),
        ])
        self.mock_logger.info.assert_not_called()

        self.assertListEqual(get_gs_wildcard_match_files('gs://fc-secure-bucket/*.cram'), ['gs://fc-secure-bucket/sample.cram'])
        self.mock_gcs.assert_calls(self, [
            mock.call.list_blobs('gs://fc-secure-bucket', match_glob='*.cram', user_project='anvil-datastorage'),
        ])

        # Inaccessible paths have no matches
        self.mock_gcs.bucket_errors['private-bucket'] = Forbidden('no access')
        self.assertListEqual(get_gs_wildcard_match_files('gs://private-bucket/*.vcf'), [])
        self.mock_logger.info.assert_called_with('Unable to list gs://private-bucket/*.vcf: 403 no access', None)

    def test_read_files(self):
        with google_bucket_file_stream(no_project=False)('gs://bucket/data/callset.vcf', 'r') as f:
            self.assertEqual(f.read(), 'content of gs://bucket/data/callset.vcf')
        with google_bucket_file_stream(no_project=False)('gs://fc-secure-bucket/sample.cram', 'rb') as f:
            self.assertEqual(f.read(), b'content of gs://fc-secure-bucket/sample.cram')
        with google_bucket_file_stream(no_project=True)('gs://fc-secure-bucket/sample.cram', 'rb') as f:
            self.assertEqual(f.read(), b'content of gs://fc-secure-bucket/sample.cram')
        self.mock_gcs.assert_calls(self, [
            mock.call.open('gs://bucket/data/callset.vcf', 'r'),
            mock.call.open('gs://fc-secure-bucket/sample.cram', 'rb', user_project='anvil-datastorage'),
            mock.call.open('gs://fc-secure-bucket/sample.cram', 'rb'),
        ])

        # Byte ranges are inclusive
        self.assertEqual(google_bucket_read_bytes('gs://bucket/data/callset.vcf', 0, 6), b'content')
        self.assertEqual(google_bucket_read_bytes('gs://fc-secure-bucket/sample.cram', 8, 9), b'of')
        self.mock_gcs.assert_calls(self, [
            mock.call.download_as_bytes('gs://bucket/data/callset.vcf', start=0, end=6),
            mock.call.download_as_bytes('gs://fc-secure-bucket/sample.cram', start=8, end=9, user_project='anvil-datastorage'),
        ])

        with self.assertRaises(NotFound):
            google_bucket_read_bytes('gs://bucket/missing.vcf', 0, 6)

    def test_mv_and_cp_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_path = os.path.join(temp_dir, 'upload.json.gz')
            with open(local_path, 'w') as f:
                f.write('uploaded content')
            mv_file_to_gs(local_path, 'gs://bucket/uploads/upload.json.gz')
            self.assertFalse(os.path.exists(local_path))
            self.assertEqual(self.mock_gcs.files['gs://bucket/uploads/upload.json.gz'], b'uploaded content')

            cp_file_from_gs('gs://bucket/uploads/upload.json.gz', temp_dir)
            with open(local_path) as f:
                self.assertEqual(f.read(), 'uploaded content')
            self.assertIn('gs://bucket/uploads/upload.json.gz', self.mock_gcs.files)

            self.mock_gcs.assert_calls(self, [
                mock.call.upload_from_filename('gs://bucket/uploads/upload.json.gz', local_path),
                mock.call.download_to_filename('gs://bucket/uploads/upload.json.gz', local_path),
            ])

            # Local files are not removed if the upload fails
            self.mock_gcs.bucket_errors['private-bucket'] = Forbidden('no access')
            with self.assertRaises(Forbidden):
                mv_file_to_gs(local_path, 'gs://private-bucket/upload.json.gz')
            self.assertTrue(os.path.exists(local_path))

            with self.assertRaises(NotFound):
                cp_file_from_gs('gs://bucket/uploads/missing.json.gz', temp_dir)

    @mock.patch('seqr.utils.google_storage_utils._READ_CREDENTIALS', None)
    @mock.patch('seqr.utils.google_storage_utils.google.auth.transport.requests.Request')
    @mock.patch('seqr.utils.google_storage_utils.google.auth.default')
    def test_get_gs_access_token(self, mock_auth_default, mock_request):
        mock_auth_default.side_effect = DefaultCredentialsError('Your default credentials were not found.')
        with self.assertRaises(Exception) as cm:
            get_gs_access_token()
        self.assertEqual(
            str(cm.exception), 'Unable to authenticate to Google Storage: Your default credentials were not found.')
        mock_auth_default.assert_called_with(scopes=['https://www.googleapis.com/auth/devstorage.read_only'])

        mock_credentials = mock.Mock(valid=False, token=None)

        def _refresh(request):
            mock_credentials.valid = True
            mock_credentials.token = 'ya29.token'
        mock_credentials.refresh.side_effect = _refresh
        mock_auth_default.side_effect = None
        mock_auth_default.return_value = (mock_credentials, 'project')
        self.assertEqual(get_gs_access_token(), 'ya29.token')
        mock_credentials.refresh.assert_called_once_with(mock_request.return_value)

        # Valid credentials are reused without refreshing
        mock_auth_default.reset_mock()
        self.assertEqual(get_gs_access_token(), 'ya29.token')
        mock_auth_default.assert_not_called()
        mock_credentials.refresh.assert_called_once()

        # Expired credentials are refreshed
        mock_credentials.valid = False
        self.assertEqual(get_gs_access_token(), 'ya29.token')
        self.assertEqual(mock_credentials.refresh.call_count, 2)
        self.assertIs(google_storage_utils._READ_CREDENTIALS, mock_credentials)
