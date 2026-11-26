import mock
import responses

from django.contrib.auth.models import User
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory, override_settings
from social_core.backends.azuread_tenant import AzureADV2TenantOAuth2
from social_core.backends.google import GoogleOAuth2
from social_django.models import UserSocialAuth
from social_django.utils import load_backend, load_strategy

from seqr.utils.social_auth_pipeline import validate_anvil_registration, validate_user_exist, log_signed_in
from seqr.utils.social_auth_settings import get_social_auth_pipeline_settings, GOOGLE_PROVIDER, AZURE_PROVIDER
from seqr.views.utils.test_utils import AuthenticationTestCase, TEST_TERRA_API_ROOT_URL, REGISTER_RESPONSE

AZURE_TENANT = '3e0a6a0e-6f6c-4f3a-9a44-6f1a2c1f7b11'
# Entra v2 ID tokens identify the user by "preferred_username" and do not include an "email" claim by default
ENTRA_RESPONSE = {
    'access_token': 'entra-token',  # nosec
    'preferred_username': 'test_user_manager@test.com',
    'name': 'Test Manager User',
    'given_name': 'Test',
    'family_name': 'Manager User',
    'tid': AZURE_TENANT,
}
NEW_ENTRA_RESPONSE = {**ENTRA_RESPONSE, 'preferred_username': 'new_entra_user@test.com', 'name': 'New Entra User'}


@mock.patch('seqr.views.utils.terra_api_utils.TERRA_API_ROOT_URL', TEST_TERRA_API_ROOT_URL)
class SocialAuthPipelineTest(AuthenticationTestCase):

    fixtures = ['users']

    @responses.activate
    def test_validate_anvil_registration(self):
        url = TEST_TERRA_API_ROOT_URL + 'register'
        responses.add(responses.GET, url, status=404)
        r = validate_anvil_registration(GoogleOAuth2(), {'access_token': '', 'email': 'test@seqr.org'})  # nosec
        self.assert_json_logs(None, [
            ('User test@seqr.org is trying to login without registration on AnVIL. None called Terra API: GET /register got status 404 with reason: Not Found', {
                'severity': 'WARNING', 'user': 'test@seqr.org',
            })
        ])
        self.assertEqual(r.url, '/login/error/anvil_registration')

        backend = GoogleOAuth2()
        backend.strategy.session_set('next', '/foo/bar')
        r = validate_anvil_registration(backend, {'access_token': '', 'email': 'test@seqr.org'})  # nosec
        self.assertEqual(r.url, '/login/error/anvil_registration?next=%2Ffoo%2Fbar')

        # The email resolved by the backend is used if provided
        self.reset_logs()
        validate_anvil_registration(GoogleOAuth2(), {'access_token': ''}, details={'email': 'details@seqr.org'})  # nosec
        self.assert_json_logs(None, [
            ('User details@seqr.org is trying to login without registration on AnVIL. None called Terra API: GET /register got status 404 with reason: Not Found', {
                'severity': 'WARNING', 'user': 'details@seqr.org',
            })
        ])

        # AnVIL registration is only required for Google users
        self.reset_logs()
        self.assertIsNone(validate_anvil_registration(AzureADV2TenantOAuth2(), ENTRA_RESPONSE))
        self.assert_no_logs()
        self.assertEqual(len(responses.calls), 3)

        self.reset_logs()
        responses.replace(responses.GET, url, status=200, body=REGISTER_RESPONSE)
        r = validate_anvil_registration(GoogleOAuth2(), {'access_token': '', 'email': 'test@seqr.org'})
        self.assert_json_logs(None, [(f'GET {url} 200 127', None)])
        self.assertIsNone(r)

    def test_validate_user_exist(self):
        validate_user_exist(GoogleOAuth2(), {'email': 'test_user_manager@test.com'}, user='test')
        self.assert_no_logs()

        r = validate_user_exist(GoogleOAuth2(), {'email': 'test_user_manager@test.com'})
        self.assert_json_logs(None, [
            ('User test_user_manager@test.com is trying to login without an existing seqr account (google-oauth2).', {
                'severity': 'WARNING', 'user': 'test_user_manager@test.com',
            })
        ])
        self.assertEqual(r.url, '/login/error/no_account')

        backend = GoogleOAuth2()
        backend.strategy.session_set('next', '/foo/bar')
        r = validate_user_exist(backend, {'email': 'test_user_manager@test.com'})
        self.assertEqual(r.url, '/login/error/no_account?next=%2Ffoo%2Fbar')

        self.reset_logs()
        backend = AzureADV2TenantOAuth2()
        r = validate_user_exist(backend, ENTRA_RESPONSE, details=backend.get_user_details(ENTRA_RESPONSE))
        self.assert_json_logs(None, [
            ('User test_user_manager@test.com is trying to login without an existing seqr account (azuread-v2-tenant-oauth2).', {
                'severity': 'WARNING', 'user': 'test_user_manager@test.com',
            })
        ])
        self.assertEqual(r.url, '/login/error/no_account')

    def test_log_signed_in(self):
        log_signed_in(GoogleOAuth2(), {'email': 'test_user_manager@test.com'}, user='test')
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (google-oauth2)', {'user': 'test_user_manager@test.com'})
        ])

        self.reset_logs()
        log_signed_in(GoogleOAuth2(), {'email': 'test_user_manager@test.com'}, is_new=True, user='test')
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (google-oauth2)', {'user': 'test_user_manager@test.com'}),
            ('Created user test_user_manager@test.com (google-oauth2)', {'user': 'test_user_manager@test.com'})
        ])

        self.reset_logs()
        backend = AzureADV2TenantOAuth2()
        log_signed_in(backend, ENTRA_RESPONSE, is_new=True, details=backend.get_user_details(ENTRA_RESPONSE))
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (azuread-v2-tenant-oauth2)', {'user': 'test_user_manager@test.com'}),
            ('Created user test_user_manager@test.com (azuread-v2-tenant-oauth2)', {'user': 'test_user_manager@test.com'})
        ])

        # The email is resolved by the backend when the pipeline details are not available
        self.reset_logs()
        log_signed_in(backend, ENTRA_RESPONSE)
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (azuread-v2-tenant-oauth2)', {'user': 'test_user_manager@test.com'}),
        ])

    def _authenticate(self, provider, response, next_url=None):
        request = RequestFactory().get(f'/complete/{provider}')
        SessionMiddleware(lambda r: None).process_request(request)
        strategy = load_strategy(request)
        if next_url:
            strategy.session_set('next', next_url)
        backend = load_backend(strategy, provider, redirect_uri=None)
        return backend.authenticate(backend=backend, strategy=strategy, response=response, request=request)

    def _test_multiple_provider_azure_login(self):
        manager = User.objects.get(email='test_user_manager@test.com')
        self.assertFalse(UserSocialAuth.objects.filter(user=manager).exists())

        # A Microsoft user is linked to the existing seqr user with the same email
        self.assertEqual(self._authenticate(AZURE_PROVIDER, ENTRA_RESPONSE), manager)
        self.assertListEqual(
            list(UserSocialAuth.objects.filter(user=manager).values_list('provider', 'uid')),
            [(AZURE_PROVIDER, 'test_user_manager@test.com')],
        )
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (azuread-v2-tenant-oauth2)', {'user': 'test_user_manager@test.com'}),
        ])

        # Any other user in the tenant has a seqr user created for them
        self.reset_logs()
        user = self._authenticate(AZURE_PROVIDER, NEW_ENTRA_RESPONSE)
        self.assertEqual(user.email, 'new_entra_user@test.com')
        self.assertNotEqual(user, manager)
        self.assertEqual(user.social_auth.get().provider, AZURE_PROVIDER)
        self.assert_json_logs(None, [
            ('Logged in new_entra_user@test.com (azuread-v2-tenant-oauth2)', {'user': 'new_entra_user@test.com'}),
            ('Created user new_entra_user@test.com (azuread-v2-tenant-oauth2)', {'user': 'new_entra_user@test.com'}),
        ])
        self.reset_logs()
        return manager

    @override_settings(**get_social_auth_pipeline_settings([GOOGLE_PROVIDER, AZURE_PROVIDER], azure_tenant=AZURE_TENANT))
    def test_multiple_provider_login(self):
        manager = self._test_multiple_provider_azure_login()

        # Google users still require an existing seqr account
        google_response = {'access_token': 'google-token', 'email': 'new_google_user@test.com', 'sub': '123'}  # nosec
        r = self._authenticate(GOOGLE_PROVIDER, google_response, next_url='/project/R001')
        self.assertEqual(r.url, '/login/error/no_account?next=%2Fproject%2FR001')
        self.assertFalse(User.objects.filter(email='new_google_user@test.com').exists())
        self.assert_json_logs(None, [
            ('User new_google_user@test.com is trying to login without an existing seqr account (google-oauth2).', {
                'severity': 'WARNING', 'user': 'new_google_user@test.com',
            })
        ])

        # A user can sign in to the same seqr account with both providers
        self.reset_logs()
        google_response['email'] = 'test_user_manager@test.com'
        self.assertEqual(self._authenticate(GOOGLE_PROVIDER, google_response), manager)
        self.assertSetEqual(
            set(UserSocialAuth.objects.filter(user=manager).values_list('provider', flat=True)),
            {AZURE_PROVIDER, GOOGLE_PROVIDER},
        )
        self.assert_json_logs(None, [
            ('Logged in test_user_manager@test.com (google-oauth2)', {'user': 'test_user_manager@test.com'}),
        ])

    @override_settings(**get_social_auth_pipeline_settings(
        [GOOGLE_PROVIDER, AZURE_PROVIDER], terra_enabled=True, azure_tenant=AZURE_TENANT,
    ))
    @responses.activate
    def test_multiple_provider_anvil_login(self):
        url = TEST_TERRA_API_ROOT_URL + 'register'
        responses.add(responses.GET, url, status=404)

        # Microsoft users are never validated against AnVIL
        self._test_multiple_provider_azure_login()
        self.assertEqual(len(responses.calls), 0)

        google_response = {'access_token': 'google-token', 'email': 'new_google_user@test.com', 'sub': '123'}  # nosec
        r = self._authenticate(GOOGLE_PROVIDER, google_response)
        self.assertEqual(r.url, '/login/error/anvil_registration')
        self.assertFalse(User.objects.filter(email='new_google_user@test.com').exists())
        self.assertEqual(len(responses.calls), 1)
        self.assertEqual(responses.calls[0].request.headers['Authorization'], 'Bearer google-token')

        self.reset_logs()
        responses.replace(responses.GET, url, status=200, body=REGISTER_RESPONSE)
        user = self._authenticate(GOOGLE_PROVIDER, google_response)
        self.assertEqual(user.email, 'new_google_user@test.com')
        self.assertEqual(user.social_auth.get().provider, GOOGLE_PROVIDER)
        self.assert_json_logs(None, [
            (f'GET {url} 200 127', None),
            ('Logged in new_google_user@test.com (google-oauth2)', {'user': 'new_google_user@test.com'}),
            ('Created user new_google_user@test.com (google-oauth2)', {'user': 'new_google_user@test.com'}),
        ])
