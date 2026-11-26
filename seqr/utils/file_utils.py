import codecs
import glob
import gzip
import os
import zlib
from io import StringIO

from seqr.utils.google_storage_utils import is_google_bucket_file_path, does_gs_file_exist, google_bucket_file_stream, \
    google_bucket_read_bytes, get_gs_files, get_gs_wildcard_match_files

CHUNK_SIZE = 65536


def does_file_exist(file_path):
    if is_google_bucket_file_path(file_path):
        return does_gs_file_exist(file_path)
    return os.path.isfile(file_path)


def list_files(files_dir):
    if is_google_bucket_file_path(files_dir):
        return get_gs_files(files_dir)
    return _list_local_wildcard_files(f'{files_dir.rstrip("/")}/**', recursive=True)


def list_wildcard_match_files(wildcard_path):
    if is_google_bucket_file_path(wildcard_path):
        return get_gs_wildcard_match_files(wildcard_path)
    return _list_local_wildcard_files(wildcard_path)


def _list_local_wildcard_files(wildcard_path, **kwargs):
    return [file_path for file_path in glob.glob(wildcard_path, **kwargs) if os.path.isfile(file_path)]


def file_iter(file_path, raw_content=False, no_project=False):
    if not does_file_exist(file_path):
        raise FileNotFoundError(f'Could not access file {file_path}')
    file_stream = google_bucket_file_stream(no_project) if is_google_bucket_file_path(file_path) else open
    if raw_content:
        with file_stream(file_path, 'rb') as f:
            yield from iter(lambda: f.read(CHUNK_SIZE), b'')
    elif file_path.endswith('gz'):
        with file_stream(file_path, 'rb') as f:
            with gzip.open(f, 'rt') as gz_f:
                yield from gz_f
    else:
        with file_stream(file_path, 'r') as f:
            yield from f


def file_bytes_iter(file_path, first_byte, last_byte, raw_content=False):
    if not does_file_exist(file_path):
        raise FileNotFoundError(f'Could not access file {file_path}')
    if is_google_bucket_file_path(file_path):
        data = google_bucket_read_bytes(file_path, first_byte, last_byte)
    else:
        with open(file_path, 'rb') as f:
            f.seek(first_byte)
            data = f.read(last_byte - first_byte + 1)

    if raw_content:
        yield data
        return

    if file_path.endswith('gz'):
        data = _decompress_partial_gzip(data)
    # The range may end part way through a multi-byte character, which an incremental decoder ignores
    yield from StringIO(codecs.getincrementaldecoder('utf-8')().decode(data))


def _decompress_partial_gzip(data):
    # A byte range of a gzip file is usually cut off mid-stream, and bgzip files consist of many concatenated members
    decompressed = []
    while data:
        decompressor = zlib.decompressobj(wbits=31)
        try:
            decompressed.append(decompressor.decompress(data))
        except zlib.error as e:
            raise gzip.BadGzipFile(str(e))
        if not decompressor.eof:
            break
        data = decompressor.unused_data
    return b''.join(decompressed)
