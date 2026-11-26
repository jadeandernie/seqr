import logging

from django.core.management.base import BaseCommand

from seqr.models import Family, Project
from seqr.utils.known_variant_utils import find_known_variant_matches, notify_known_variant_matches

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Check families against the known variant checks recorded by researchers'

    def add_arguments(self, parser):
        parser.add_argument('--project', help='optional guid of a single project to check')
        parser.add_argument('--notify', action='store_true', help='notify project subscribers of new matches')

    def handle(self, *args, **options):
        families = Family.objects.all()
        if options['project']:
            families = families.filter(project=Project.objects.get(guid=options['project']))

        matches = find_known_variant_matches(families)
        if matches and options['notify']:
            notify_known_variant_matches(matches)
        logger.info(f'Found {len(matches)} new known variant matches in {options["project"] or "all projects"}')
