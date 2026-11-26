import os
import re

import google.auth
import google.auth.exceptions
import google.auth.transport.requests
from google.cloud import storage

from seqr.utils.logging_utils import SeqrLogger

logger = SeqrLogger(__name__)

GS_READ_SCOPES = ['https://www.googleapis.com/auth/devstorage.read_only']
WILDCARD_CHARS_REGEX = r'[*?\[{]'

_CLIENT = None
_READ_CREDENTIALS = None


def _get_client():
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = storage.Client()
    return _CLIENT


def _parse_gs_path(gs_path, no_project=False):
    if not is_google_bucket_file_path(gs_path):
        raise Exception('A Google Storage path is expected.')
    bucket_name, _, path = gs_path.replace('gs://', '', 1).partition('/')
    #  Anvil buckets are requester-pays and we bill them to the anvil project
    user_project = get_google_project(gs_path) if not no_project else None
    bucket = _get_client().bucket(bucket_name, user_project=user_project)
    return bucket, path


def _get_gs_blob(gs_path, no_project=False):
    bucket, blob_name = _parse_gs_path(gs_path, no_project=no_project)
    return bucket.blob(blob_name)


def _has_blobs(bucket, prefix):
    return any(True for _ in bucket.list_blobs(prefix=prefix, max_results=1))


def is_google_bucket_file_path(file_path):
    return file_path.startswith("gs://")


def get_google_project(gs_path):
    return 'anvil-datastorage' if gs_path.startswith('gs://fc-secure') else None


def does_gs_file_exist(file_path):
    # Matches the behavior of "gsutil ls": true for a file, a non-empty folder or an accessible bucket, false on any error
    try:
        bucket, path = _parse_gs_path(file_path)
        folder_prefix = f'{path.rstrip("/")}/' if path.rstrip('/') else ''
        if not folder_prefix:
            _has_blobs(bucket, None)
            return True
        if not path.endswith('/') and bucket.blob(path).exists():
            return True
        if _has_blobs(bucket, folder_prefix):
            return True
        error = 'One or more URLs matched no objects.'
    except Exception as e:
        error = str(e)
    logger.warning(f'Unable to access {file_path}: {error}', None)
    return False


def google_bucket_file_stream(no_project):
    def wrapper(gs_path, mode):
        blob = _get_gs_blob(gs_path, no_project=no_project)
        return blob.open(mode)
    return wrapper


def google_bucket_read_bytes(gs_path, first_byte, last_byte):
    blob = _get_gs_blob(gs_path)
    return blob.download_as_bytes(start=first_byte, end=last_byte)


def mv_file_to_gs(local_path, gs_path):
    blob = _get_gs_blob(gs_path)
    blob.upload_from_filename(local_path)
    os.remove(local_path)


def cp_file_from_gs(gs_path, local_dir):
    blob = _get_gs_blob(gs_path)
    local_path = os.path.join(local_dir, os.path.basename(blob.name))
    blob.download_to_filename(local_path)


def _blob_paths(bucket, blobs):
    return [f'gs://{bucket.name}/{blob.name}' for blob in blobs if not blob.name.endswith('/')]


def get_gs_files(gs_path):
    bucket, path = _parse_gs_path(gs_path)
    path = path.rstrip('/')
    return _blob_paths(bucket, bucket.list_blobs(prefix=f'{path}/' if path else None))


def get_gs_wildcard_match_files(gs_path):
    # GCS glob matching follows the gsutil wildcard rules: "*" does not match across "/"
    try:
        bucket, pattern = _parse_gs_path(gs_path)
        prefix = re.split(WILDCARD_CHARS_REGEX, pattern, maxsplit=1)[0]
        return _blob_paths(bucket, bucket.list_blobs(prefix=prefix or None, match_glob=pattern))
    except Exception as e:
        logger.info(f'Unable to list {gs_path}: {e}', None)
        return []


def get_gs_access_token():
    global _READ_CREDENTIALS
    try:
        if _READ_CREDENTIALS is None:
            _READ_CREDENTIALS, _ = google.auth.default(scopes=GS_READ_SCOPES)
        if not _READ_CREDENTIALS.valid:
            _READ_CREDENTIALS.refresh(google.auth.transport.requests.Request())
    except google.auth.exceptions.GoogleAuthError as e:
        raise Exception(f'Unable to authenticate to Google Storage: {e}')
    return _READ_CREDENTIALS.token
