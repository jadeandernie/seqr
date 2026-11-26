"""
Pure helpers that derive the social auth settings from the configured provider credentials.

Imported by settings.py, so this module must not import anything that requires configured Django settings.
"""
from django.core.exceptions import ImproperlyConfigured

GOOGLE_PROVIDER = 'google-oauth2'
AZURE_PROVIDER = 'azuread-v2-tenant-oauth2'

LOCAL_LOGIN_URL = '/login'

# Entra authorities that accept accounts from any tenant, and so are not restricted to a single trusted directory
AZURE_MULTI_TENANT_AUTHORITIES = {'common', 'organizations', 'consumers'}

PIPELINE_BASE = (
    'social_core.pipeline.social_auth.social_details',
    'social_core.pipeline.social_auth.social_uid',
    'social_core.pipeline.social_auth.social_user',
    'social_core.pipeline.social_auth.associate_by_email',
)
PIPELINE_USER_EXIST = ('seqr.utils.social_auth_pipeline.validate_user_exist',)
PIPELINE_ASSOCIATE_USER = ('social_core.pipeline.social_auth.associate_user',)
PIPELINE_LOG = ('seqr.utils.social_auth_pipeline.log_signed_in',)
PIPELINE_CLOUD_BASE = (
    'social_core.pipeline.user.get_username',
    'social_core.pipeline.user.create_user',
) + PIPELINE_ASSOCIATE_USER + (
    'social_core.pipeline.social_auth.load_extra_data',
    'social_core.pipeline.user.user_details',
)

# Any user in the trusted identity provider can sign in, and a seqr user is created for them if needed
CREATE_USER_PIPELINE = PIPELINE_BASE + PIPELINE_CLOUD_BASE + PIPELINE_LOG
# As above, but Google users must also be registered with AnVIL
ANVIL_PIPELINE = ('seqr.utils.social_auth_pipeline.validate_anvil_registration',) + CREATE_USER_PIPELINE
# Only users who already have a seqr account can sign in
EXISTING_USER_PIPELINE = PIPELINE_BASE + PIPELINE_USER_EXIST + PIPELINE_ASSOCIATE_USER + PIPELINE_LOG


def _backend_pipeline_setting(provider):
    # Matches the backend-specific lookup in social_core.strategy.BaseStrategy.setting
    return 'SOCIAL_AUTH_{}_PIPELINE'.format(provider.upper().replace('-', '_'))


def get_social_auth_providers(google_key=None, azure_key=None):
    """The configured OAuth providers, in order of precedence."""
    configured = ((GOOGLE_PROVIDER, google_key), (AZURE_PROVIDER, azure_key))
    return [provider for provider, key in configured if key]


def get_login_url(providers):
    """A single provider is redirected to directly, otherwise the seqr login page handles local or multi-provider login"""
    if len(providers) == 1:
        return '{}/{}'.format(LOCAL_LOGIN_URL, providers[0])
    return LOCAL_LOGIN_URL


def get_social_auth_pipeline_settings(providers, terra_enabled=False, azure_tenant=None):
    """
    Returns the pipeline settings to add to the Django settings, keyed by setting name.

    With zero or one configured providers a single SOCIAL_AUTH_PIPELINE applies to every backend. With multiple
    providers each backend gets its own pipeline so that each keeps its own sign-in rule, and AnVIL registration is
    only ever required for Google users.
    """
    google_pipeline = ANVIL_PIPELINE if terra_enabled else EXISTING_USER_PIPELINE

    if len(providers) < 2:
        if terra_enabled or AZURE_PROVIDER not in providers:
            return {'SOCIAL_AUTH_PIPELINE': google_pipeline}
        return {'SOCIAL_AUTH_PIPELINE': CREATE_USER_PIPELINE}

    if not azure_tenant or azure_tenant.lower() in AZURE_MULTI_TENANT_AUTHORITIES:
        raise ImproperlyConfigured(
            'Error starting seqr - SOCIAL_AUTH_AZUREAD_V2_OAUTH2_TENANT must be set to a single Azure tenant when '
            'both Google and Azure authentication are configured'
        )

    return {
        # Backends without their own pipeline fall back to the most restrictive rule
        'SOCIAL_AUTH_PIPELINE': EXISTING_USER_PIPELINE,
        _backend_pipeline_setting(GOOGLE_PROVIDER): google_pipeline,
        _backend_pipeline_setting(AZURE_PROVIDER): CREATE_USER_PIPELINE,
    }
