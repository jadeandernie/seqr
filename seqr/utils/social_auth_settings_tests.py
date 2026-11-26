from itertools import product

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings
from social_core.backends.azuread_tenant import AzureADV2TenantOAuth2
from social_core.backends.google import GoogleOAuth2
from social_django.utils import load_strategy

from seqr.utils.social_auth_settings import get_social_auth_providers, get_login_url, \
    get_social_auth_pipeline_settings, GOOGLE_PROVIDER, AZURE_PROVIDER, ANVIL_PIPELINE, CREATE_USER_PIPELINE, \
    EXISTING_USER_PIPELINE

TENANT = '3e0a6a0e-6f6c-4f3a-9a44-6f1a2c1f7b11'

EXPECTED_EXISTING_USER_PIPELINE = (
    'social_core.pipeline.social_auth.social_details',
    'social_core.pipeline.social_auth.social_uid',
    'social_core.pipeline.social_auth.social_user',
    'social_core.pipeline.social_auth.associate_by_email',
    'seqr.utils.social_auth_pipeline.validate_user_exist',
    'social_core.pipeline.social_auth.associate_user',
    'seqr.utils.social_auth_pipeline.log_signed_in',
)
EXPECTED_CREATE_USER_PIPELINE = (
    'social_core.pipeline.social_auth.social_details',
    'social_core.pipeline.social_auth.social_uid',
    'social_core.pipeline.social_auth.social_user',
    'social_core.pipeline.social_auth.associate_by_email',
    'social_core.pipeline.user.get_username',
    'social_core.pipeline.user.create_user',
    'social_core.pipeline.social_auth.associate_user',
    'social_core.pipeline.social_auth.load_extra_data',
    'social_core.pipeline.user.user_details',
    'seqr.utils.social_auth_pipeline.log_signed_in',
)
EXPECTED_ANVIL_PIPELINE = ('seqr.utils.social_auth_pipeline.validate_anvil_registration',) + \
    EXPECTED_CREATE_USER_PIPELINE


def _legacy_settings(google_key, azure_key, terra_enabled):
    """The settings.py logic from before multiple providers were supported"""
    provider = ''
    if azure_key:
        provider = 'azuread-v2-tenant-oauth2'
    if google_key:
        provider = 'google-oauth2'
    login_url = '/'.join(filter(None, ['/login', provider]))
    if terra_enabled:
        pipeline = EXPECTED_ANVIL_PIPELINE
    elif azure_key:
        pipeline = EXPECTED_CREATE_USER_PIPELINE
    else:
        pipeline = EXPECTED_EXISTING_USER_PIPELINE
    return provider, login_url, pipeline


class SocialAuthSettingsTest(SimpleTestCase):

    def test_pipelines(self):
        self.assertTupleEqual(EXISTING_USER_PIPELINE, EXPECTED_EXISTING_USER_PIPELINE)
        self.assertTupleEqual(CREATE_USER_PIPELINE, EXPECTED_CREATE_USER_PIPELINE)
        self.assertTupleEqual(ANVIL_PIPELINE, EXPECTED_ANVIL_PIPELINE)

    def test_get_social_auth_providers(self):
        self.assertListEqual(get_social_auth_providers(), [])
        self.assertListEqual(get_social_auth_providers(google_key='', azure_key=None), [])
        self.assertListEqual(get_social_auth_providers(google_key='google-id'), [GOOGLE_PROVIDER])
        self.assertListEqual(get_social_auth_providers(azure_key='azure-id'), [AZURE_PROVIDER])
        self.assertListEqual(
            get_social_auth_providers(google_key='google-id', azure_key='azure-id'), [GOOGLE_PROVIDER, AZURE_PROVIDER],
        )

    def test_get_login_url(self):
        self.assertEqual(get_login_url([]), '/login')
        self.assertEqual(get_login_url([GOOGLE_PROVIDER]), '/login/google-oauth2')
        self.assertEqual(get_login_url([AZURE_PROVIDER]), '/login/azuread-v2-tenant-oauth2')
        self.assertEqual(get_login_url([GOOGLE_PROVIDER, AZURE_PROVIDER]), '/login')

    def test_single_provider_settings_unchanged(self):
        configs = [c for c in product(['google-id', None], ['azure-id', None], [True, False]) if not (c[0] and c[1])]
        self.assertEqual(len(configs), 6)
        for google_key, azure_key, terra_enabled in configs:
            with self.subTest(google_key=google_key, azure_key=azure_key, terra_enabled=terra_enabled):
                providers = get_social_auth_providers(google_key=google_key, azure_key=azure_key)
                provider = providers[0] if providers else ''
                pipeline_settings = get_social_auth_pipeline_settings(providers, terra_enabled=terra_enabled)
                self.assertSetEqual(set(pipeline_settings.keys()), {'SOCIAL_AUTH_PIPELINE'})
                self.assertTupleEqual(
                    (provider, get_login_url(providers), pipeline_settings['SOCIAL_AUTH_PIPELINE']),
                    _legacy_settings(google_key, azure_key, terra_enabled),
                )

    def test_single_provider_pipeline_settings(self):
        self.assertDictEqual(get_social_auth_pipeline_settings([]), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_EXISTING_USER_PIPELINE,
        })
        self.assertDictEqual(get_social_auth_pipeline_settings([], terra_enabled=True), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_ANVIL_PIPELINE,
        })
        self.assertDictEqual(get_social_auth_pipeline_settings([GOOGLE_PROVIDER]), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_EXISTING_USER_PIPELINE,
        })
        self.assertDictEqual(get_social_auth_pipeline_settings([GOOGLE_PROVIDER], terra_enabled=True), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_ANVIL_PIPELINE,
        })
        # A tenant is not required when Azure is the only provider
        self.assertDictEqual(get_social_auth_pipeline_settings([AZURE_PROVIDER]), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_CREATE_USER_PIPELINE,
        })
        self.assertDictEqual(get_social_auth_pipeline_settings([AZURE_PROVIDER], terra_enabled=True), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_ANVIL_PIPELINE,
        })

    def test_multiple_provider_pipeline_settings(self):
        providers = [GOOGLE_PROVIDER, AZURE_PROVIDER]
        self.assertDictEqual(get_social_auth_pipeline_settings(providers, azure_tenant=TENANT), {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_EXISTING_USER_PIPELINE,
            'SOCIAL_AUTH_GOOGLE_OAUTH2_PIPELINE': EXPECTED_EXISTING_USER_PIPELINE,
            'SOCIAL_AUTH_AZUREAD_V2_TENANT_OAUTH2_PIPELINE': EXPECTED_CREATE_USER_PIPELINE,
        })

        # AnVIL registration is only ever required for Google users
        anvil_settings = get_social_auth_pipeline_settings(providers, terra_enabled=True, azure_tenant=TENANT)
        self.assertDictEqual(anvil_settings, {
            'SOCIAL_AUTH_PIPELINE': EXPECTED_EXISTING_USER_PIPELINE,
            'SOCIAL_AUTH_GOOGLE_OAUTH2_PIPELINE': EXPECTED_ANVIL_PIPELINE,
            'SOCIAL_AUTH_AZUREAD_V2_TENANT_OAUTH2_PIPELINE': EXPECTED_CREATE_USER_PIPELINE,
        })

        # The backend-specific settings are the ones resolved by social auth for each backend
        with override_settings(**anvil_settings):
            strategy = load_strategy()
            self.assertTupleEqual(strategy.get_pipeline(GoogleOAuth2(strategy)), EXPECTED_ANVIL_PIPELINE)
            self.assertTupleEqual(
                strategy.get_pipeline(AzureADV2TenantOAuth2(strategy)), EXPECTED_CREATE_USER_PIPELINE)
            self.assertTupleEqual(strategy.get_pipeline(), EXPECTED_EXISTING_USER_PIPELINE)

    def test_multiple_providers_require_single_azure_tenant(self):
        providers = [GOOGLE_PROVIDER, AZURE_PROVIDER]
        for tenant in [None, '', 'common', 'Organizations', 'consumers']:
            with self.subTest(tenant=tenant):
                with self.assertRaises(ImproperlyConfigured) as cm:
                    get_social_auth_pipeline_settings(providers, azure_tenant=tenant)
                self.assertEqual(
                    str(cm.exception),
                    'Error starting seqr - SOCIAL_AUTH_AZUREAD_V2_OAUTH2_TENANT must be set to a single Azure tenant '
                    'when both Google and Azure authentication are configured',
                )
