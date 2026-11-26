import logging

from django.shortcuts import redirect
from urllib.parse import urlencode

from seqr.utils.social_auth_settings import GOOGLE_PROVIDER
from seqr.views.utils.terra_api_utils import anvil_call, TerraNotFoundException

logger = logging.getLogger(__name__)


def _get_email(backend, response, details):
    # Not all providers return an "email" claim, so use the email as resolved by the backend
    if details is None:
        details = backend.get_user_details(response)
    return details.get('email')


def validate_anvil_registration(backend, response, *args, details=None, **kwargs):
    if backend.name == GOOGLE_PROVIDER:
        try:
            anvil_call('get', 'register', response['access_token'])
        except TerraNotFoundException as et:
            email = _get_email(backend, response, details)
            logger.warning('User {} is trying to login without registration on AnVIL. {}'.format(email, str(et)),
                           extra={'user_email': email})
            return _redirect_login_error('anvil_registration', backend)


def validate_user_exist(backend, response, *args, user=None, details=None, **kwargs):
    if not user:
        email = _get_email(backend, response, details)
        logger.warning('User {} is trying to login without an existing seqr account ({}).'
                       .format(email, backend.name), extra={'user_email': email})
        return _redirect_login_error('no_account', backend)


def _redirect_login_error(error, backend):
    params = ''
    next_param = backend.strategy.session_get('next')
    if next_param:
        params = '?{}'.format(urlencode({'next': next_param}))
    return redirect('/login/error/{}{}'.format(error, params))


def log_signed_in(backend, response, *args, is_new=False, details=None, **kwargs):
    email = _get_email(backend, response, details)
    logger.info('Logged in {} ({})'.format(email, backend.name), extra={'user_email': email})
    if is_new:
        logger.info('Created user {} ({})'.format(email, backend.name), extra={'user_email': email})
