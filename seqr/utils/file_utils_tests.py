from datetime import datetime, timedelta, timezone
import gzip
import io
import mock

from botocore.exceptions import ClientError, NoCredentialsError
from botocore.response import StreamingBody
from unittest import TestCase
from seqr.utils.file_utils import mv_file_to_gs, does_file_exist, file_iter, is_s3_file_path

S3_ROLE_ARN = 'arn:aws:iam::123456789012:role/seqr-reads'
S3_ACCESS_ERROR = ClientError({'Error': {
    'Code': 'AccessDenied',
    'Message': f'User: {S3_ROLE_ARN} is not authorized to perform: s3:GetObject',
}}, 'GetObject')
S3_ACCESS_ERROR_MESSAGE = f'An error occurred (AccessDenied) when calling the GetObject operation: User: {S3_ROLE_ARN} is not authorized to perform: s3:GetObject'
S3_FILE_LINES = [b'#Sample\tAffected\n', b'NA19675\tTrue\n', b'NA19678\tFalse']


def _s3_body(content):
    return {'Body': StreamingBody(io.BytesIO(content), len(content))}


class FileUtilsTest(TestCase):

    @mock.patch('seqr.utils.file_utils.subprocess')
    @mock.patch('seqr.utils.file_utils.logger')
    def test_mv_file_to_gs(self, mock_logger, mock_subproc):
        with self.assertRaises(Exception) as ee:
            mv_file_to_gs('/temp_path', '/another_path', user=None)
        self.assertEqual(str(ee.exception),  'A Google Storage path is expected.')

        process = mock_subproc.Popen.return_value
        process.wait.return_value = -1
        process.stdout = [b'-bash: gsutil: command not found.\n', b'Please check the path.\n']
        with self.assertRaises(Exception) as ee:
            mv_file_to_gs('/temp_path', 'gs://bucket/target_path', user=None)
        self.assertEqual(str(ee.exception), 'Run command failed: -bash: gsutil: command not found. Please check the path.')
        mock_subproc.Popen.assert_called_with('gsutil mv /temp_path gs://bucket/target_path', stdout=mock_subproc.PIPE, stderr=mock_subproc.STDOUT, shell=True)  # nosec
        mock_logger.info.assert_called_with('==> gsutil mv /temp_path gs://bucket/target_path', None)
        process.wait.assert_called_with()

        mock_subproc.reset_mock()
        mock_logger.reset_mock()
        process.wait.return_value = 0
        mv_file_to_gs('/temp_path', 'gs://bucket/target_path', user=None)
        mock_subproc.Popen.assert_called_with('gsutil mv /temp_path gs://bucket/target_path', stdout=mock_subproc.PIPE, stderr=mock_subproc.STDOUT, shell=True)  # nosec
        mock_logger.info.assert_called_with('==> gsutil mv /temp_path gs://bucket/target_path', None)
        process.wait.assert_called_with()

    def _set_up_s3_mocks(self, role_arn=None):
        patchers = [
            mock.patch('seqr.utils.file_utils.S3_ARN_ASSUME_ROLE', role_arn),
            mock.patch.dict('seqr.utils.file_utils.S3_CLIENT_CACHE', clear=True),
            mock.patch('seqr.utils.file_utils.logger'),
            mock.patch('seqr.utils.file_utils.boto3'),
        ]
        _, _, self.mock_logger, self.mock_boto3 = [patcher.start() for patcher in patchers]
        for patcher in patchers:
            self.addCleanup(patcher.stop)
        self.mock_s3 = mock.MagicMock()
        self.mock_sts = mock.MagicMock()
        self.mock_boto3.client.side_effect = lambda service, **kwargs: {'s3': self.mock_s3, 'sts': self.mock_sts}[service]

    def test_s3_does_file_exist(self):
        self._set_up_s3_mocks()
        self.assertTrue(is_s3_file_path('s3://bucket/sample.cram'))
        self.assertFalse(is_s3_file_path('gs://bucket/sample.cram'))

        self.assertTrue(does_file_exist('s3://bucket/reads/sample.cram', user='test_user'))
        self.mock_s3.head_object.assert_called_with(Bucket='bucket', Key='reads/sample.cram')
        self.mock_boto3.client.assert_called_once_with('s3')
        self.mock_logger.warning.assert_not_called()

        self.mock_s3.head_object.side_effect = ClientError({'Error': {'Code': '404', 'Message': 'Not Found'}}, 'HeadObject')
        self.assertFalse(does_file_exist('s3://bucket/reads/missing.cram', user='test_user'))
        self.mock_s3.head_object.assert_called_with(Bucket='bucket', Key='reads/missing.cram')
        self.mock_logger.warning.assert_called_with(
            'An error occurred (404) when calling the HeadObject operation: Not Found', 'test_user')

        self.mock_s3.head_object.side_effect = NoCredentialsError()
        self.assertFalse(does_file_exist('s3://bucket/reads/sample.cram'))
        self.mock_logger.warning.assert_called_with('Unable to locate credentials', None)
        self.mock_boto3.client.assert_called_once_with('s3')

    def test_s3_assume_role(self):
        self._set_up_s3_mocks(role_arn=S3_ROLE_ARN)
        now = datetime.now(timezone.utc)
        credentials = {'AccessKeyId': 'key_id', 'SecretAccessKey': 'secret_key', 'SessionToken': 'token'}
        self.mock_sts.assume_role.return_value = {'Credentials': {**credentials, 'Expiration': now + timedelta(hours=1)}}
        client_calls = [
            mock.call('sts'),
            mock.call('s3', aws_access_key_id='key_id', aws_secret_access_key='secret_key', aws_session_token='token'),
        ]

        self.assertTrue(does_file_exist('s3://bucket/sample.cram'))
        self.assertTrue(does_file_exist('s3://bucket/sample.cram.crai'))
        self.mock_sts.assume_role.assert_called_once_with(RoleArn=S3_ROLE_ARN, RoleSessionName='seqr')
        self.mock_boto3.client.assert_has_calls(client_calls)
        self.assertEqual(self.mock_boto3.client.call_count, 2)
        self.assertEqual(self.mock_s3.head_object.call_count, 2)

        with mock.patch('seqr.utils.file_utils.datetime') as mock_datetime:
            mock_datetime.now.return_value = now + timedelta(minutes=54)
            self.assertTrue(does_file_exist('s3://bucket/sample.cram'))
            self.assertEqual(self.mock_sts.assume_role.call_count, 1)

            mock_datetime.now.return_value = now + timedelta(minutes=56)
            self.mock_sts.assume_role.return_value = {'Credentials': {**credentials, 'Expiration': now + timedelta(hours=2)}}
            self.assertTrue(does_file_exist('s3://bucket/sample.cram'))
            self.assertEqual(self.mock_sts.assume_role.call_count, 2)
            self.assertEqual(self.mock_boto3.client.call_count, 4)

            self.assertTrue(does_file_exist('s3://bucket/sample.cram'))
            self.assertEqual(self.mock_sts.assume_role.call_count, 2)

        self.mock_boto3.client.reset_mock()
        self.mock_sts.assume_role.side_effect = S3_ACCESS_ERROR
        with mock.patch.dict('seqr.utils.file_utils.S3_CLIENT_CACHE', clear=True):
            self.assertFalse(does_file_exist('s3://bucket/sample.cram', user='test_user'))
            self.mock_logger.warning.assert_called_with(S3_ACCESS_ERROR_MESSAGE, 'test_user')
            self.mock_boto3.client.assert_called_once_with('sts')

    def test_s3_file_iter(self):
        self._set_up_s3_mocks()
        chunks = [b'CRAM\x03\x83', b'\\\t\xfb\xa3\xf7%\x01']
        mock_body = mock.MagicMock()
        mock_body.iter_chunks.return_value = chunks
        self.mock_s3.get_object.return_value = {'Body': mock_body}

        self.assertListEqual(
            list(file_iter('s3://bucket/reads/sample.cram', byte_range=(100, 250), raw_content=True)), chunks)
        self.mock_s3.head_object.assert_called_with(Bucket='bucket', Key='reads/sample.cram')
        self.mock_s3.get_object.assert_called_with(Bucket='bucket', Key='reads/sample.cram', Range='bytes=100-250')
        mock_body.iter_chunks.assert_called_with(65536)
        mock_body.close.assert_called_once_with()
        self.mock_boto3.client.assert_called_once_with('s3')

        self.assertListEqual(list(file_iter('s3://bucket/reads/sample.cram', raw_content=True)), chunks)
        self.mock_s3.get_object.assert_called_with(Bucket='bucket', Key='reads/sample.cram')

        self.mock_s3.get_object.return_value = _s3_body(b''.join(S3_FILE_LINES))
        self.assertListEqual(
            list(file_iter('s3://bucket/samples.tsv')), ['#Sample\tAffected\n', 'NA19675\tTrue\n', 'NA19678\tFalse'])
        self.mock_s3.get_object.assert_called_with(Bucket='bucket', Key='samples.tsv')

        gz_content = gzip.compress(b''.join(S3_FILE_LINES))
        self.mock_s3.get_object.return_value = _s3_body(gz_content)
        self.assertListEqual(
            list(file_iter('s3://bucket/samples.tsv.gz')), ['#Sample\tAffected\n', 'NA19675\tTrue\n', 'NA19678\tFalse'])

        self.mock_s3.get_object.return_value = _s3_body(gz_content)
        self.assertEqual(b''.join(file_iter('s3://bucket/samples.tsv.gz', raw_content=True)), gz_content)

        self.mock_s3.get_object.return_value = _s3_body(b''.join(S3_FILE_LINES[:2]))
        self.assertListEqual(
            list(file_iter('s3://bucket/samples.tsv', byte_range=(0, 30))), ['#Sample\tAffected\n', 'NA19675\tTrue\n'])
        self.mock_s3.get_object.assert_called_with(Bucket='bucket', Key='samples.tsv', Range='bytes=0-30')
        self.mock_logger.warning.assert_not_called()

        self.mock_s3.get_object.side_effect = S3_ACCESS_ERROR
        with self.assertRaises(FileNotFoundError) as e:
            next(file_iter('s3://bucket/samples.tsv', user='test_user'))
        self.assertEqual(str(e.exception), 'Could not access file s3://bucket/samples.tsv')
        self.mock_logger.warning.assert_called_with(S3_ACCESS_ERROR_MESSAGE, 'test_user')

        self.mock_s3.get_object.reset_mock()
        self.mock_s3.head_object.side_effect = S3_ACCESS_ERROR
        with self.assertRaises(FileNotFoundError) as e:
            next(file_iter('s3://bucket/samples.tsv', user='test_user'))
        self.assertEqual(str(e.exception), 'Could not access file s3://bucket/samples.tsv')
        self.mock_s3.get_object.assert_not_called()
