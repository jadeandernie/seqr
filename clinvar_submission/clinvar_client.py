import requests

from clinvar_submission.clinvar_utils import get_api_key, get_clinvar_mode
from clinvar_submission.constants import MODE_TEST, SENDING_MODES, PRODUCTION_URL, TEST_URL, \
    API_KEY_HEADER, REQUEST_TIMEOUT_SECONDS, SUMMARY_FILE_URL_PREFIX
from seqr.utils.logging_utils import SeqrLogger

logger = SeqrLogger(__name__)

DRY_RUN_SUFFIX = '?dry-run=true'
NO_KEY_MESSAGE = 'CLINVAR_API_KEY is not configured'


class ClinvarConfigError(Exception):
    pass


def _base_url(mode):
    return TEST_URL if mode == MODE_TEST else PRODUCTION_URL


def _redact(text, api_key):
    return text.replace(api_key, '[redacted]')


def _request(method, url, api_key, user, **kwargs):
    """Returns (response, error). Never logs or returns the API key."""
    try:
        response = requests.request(
            method, url, headers={API_KEY_HEADER: api_key}, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs)
    except requests.exceptions.Timeout:
        error = f'ClinVar request timed out after {REQUEST_TIMEOUT_SECONDS} seconds'
    except requests.exceptions.RequestException as e:
        error = f'ClinVar request failed: {type(e).__name__}'
    else:
        logger.info(f'ClinVar {method} {url} returned {response.status_code}', user)
        return response, None
    logger.warning(f'ClinVar {method} {url}: {error}', user)
    return None, error


def _response_json(response):
    try:
        parsed = response.json()
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_error(response, api_key):
    response_json = _response_json(response)
    message = response_json.get('message') or response.reason or 'Unknown error'
    result = {
        'ok': False,
        'httpStatus': response.status_code,
        'message': _redact(f'ClinVar returned {response.status_code}: {message}', api_key),
    }
    errors = response_json.get('errors')
    if errors:
        result['errors'] = [_redact(str(e), api_key) for e in (errors if isinstance(errors, list) else [errors])]
    return result


def send_submission(content, user, dry_run=True):
    """POSTs a record. A real submission is only possible when dry_run=False AND the mode is test or live."""
    mode = get_clinvar_mode()
    api_key = get_api_key()
    if not dry_run and mode not in SENDING_MODES:
        raise ClinvarConfigError(f'CLINVAR_SUBMISSION_MODE "{mode}" does not allow sending to ClinVar')
    if not api_key:
        if mode in SENDING_MODES:
            raise ClinvarConfigError(f'{NO_KEY_MESSAGE}: refusing to operate in {mode} mode')
        return {
            'ok': True, 'dryRun': True, 'sentToNcbi': False,
            'message': f'Validated by seqr only. {NO_KEY_MESSAGE}, so the NCBI dry run was not performed',
        }

    url = _base_url(mode) + (DRY_RUN_SUFFIX if dry_run else '')
    body = {'actions': [{'type': 'AddData', 'targetDb': 'clinvar', 'data': {'content': content}}]}
    response, error = _request('POST', url, api_key, user, json=body)
    if error:
        return {'ok': False, 'dryRun': dry_run, 'sentToNcbi': True, 'message': error}

    result = {'dryRun': dry_run, 'sentToNcbi': True, 'httpStatus': response.status_code}
    if dry_run and response.status_code == 204:
        return {**result, 'ok': True, 'message': 'NCBI dry run passed: the record matches the ClinVar schema. Nothing was submitted'}
    submission_id = _response_json(response).get('id')
    if not dry_run and response.status_code in {200, 201} and submission_id:
        return {**result, 'ok': True, 'submissionId': submission_id, 'message': f'ClinVar created submission {submission_id}'}
    return {**result, **_parse_error(response, api_key)}


def _parse_summary(summary, parsed):
    parsed['batchProcessingStatus'] = summary.get('batchProcessingStatus')
    for key in ['submissions', 'deletions']:
        for record in summary.get(key) or []:
            identifiers = record.get('identifiers') or {}
            if identifiers.get('clinvarAccession'):
                parsed['accessions'].append(identifiers['clinvarAccession'])
            for error in record.get('errors') or []:
                parsed['errors'] += [
                    e.get('userMessage') for e in (error.get('output') or {}).get('errors') or [] if e.get('userMessage')
                ]


def get_submission_status(ncbi_submission_id, mode, user):
    """Polls .../submissions/<SUB id>/actions/ on the endpoint the record was sent to."""
    api_key = get_api_key()
    if not api_key:
        raise ClinvarConfigError(NO_KEY_MESSAGE)

    response, error = _request('GET', f'{_base_url(mode)}{ncbi_submission_id}/actions/', api_key, user)
    if error:
        return {'ok': False, 'message': error}
    if response.status_code != 200:
        return _parse_error(response, api_key)

    actions = _response_json(response).get('actions') or [{}]
    parsed = {
        'ok': True, 'status': actions[0].get('status'), 'accessions': [], 'errors': [], 'batchProcessingStatus': None,
    }
    for action_response in actions[0].get('responses') or []:
        text = (action_response.get('message') or {}).get('text')
        if text:
            parsed['message'] = text
        for file in action_response.get('files') or []:
            file_url = file.get('url') or ''
            if not file_url.startswith(SUMMARY_FILE_URL_PREFIX):
                continue
            file_response, file_error = _request('GET', file_url, api_key, user)
            if file_error or file_response.status_code != 200:
                parsed['errors'].append(file_error or f'Unable to load the ClinVar summary file ({file_response.status_code})')
            else:
                _parse_summary(_response_json(file_response), parsed)
    return parsed
