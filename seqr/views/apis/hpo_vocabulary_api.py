import hashlib
import json

from django.http import HttpResponse
from django.utils.cache import get_conditional_response, patch_cache_control
from django.utils.http import quote_etag
from django.views.decorators.gzip import gzip_page

from reference_data.models import DataVersions, HumanPhenotypeOntology
from seqr.views.utils.permissions_utils import login_and_policies_required

CACHE_SECONDS = 60 * 60


@login_and_policies_required
@gzip_page
def hpo_vocabulary(request):
    """
    Get the names and synonyms of all HPO phenotype terms, for matching against free text in the browser.
    Only terms below "Phenotypic abnormality" have a category, which excludes modifier, inheritance and obsolete terms.
    """
    terms = HumanPhenotypeOntology.objects.exclude(category_id__isnull=True).exclude(category_id='').order_by(
        'hpo_id').values_list('hpo_id', 'name', 'parent_id', 'synonyms')
    version = DataVersions.objects.filter(data_model_name=HumanPhenotypeOntology.__name__).values_list(
        'version', flat=True).first()
    content = json.dumps({'version': version, 'terms': [list(term) for term in terms]}, separators=(',', ':'))

    response = HttpResponse(content, content_type='application/json')
    response['ETag'] = quote_etag(hashlib.sha256(content.encode('utf-8')).hexdigest()[:32])
    patch_cache_control(response, private=True, max_age=CACHE_SECONDS)
    response = get_conditional_response(request, etag=response['ETag'], response=response)
    # The vocabulary is public reference data, so it opts out of the no-store default set by CacheControlMiddleware
    response.allow_private_cache = True
    return response
