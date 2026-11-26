from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.contrib.auth.models import User
from django.db.models import JSONField

from matchmaker.result_status import STATUS_CHOICES, STATUS_NEW, STATUS_FLAG_UPDATES, TRIAGE_FLAGS, \
    get_status_for_flags, get_status_for_flag_update
from seqr.models import ModelWithGUID, Individual
from settings import MME_DEFAULT_CONTACT_NAME, MME_DEFAULT_CONTACT_EMAIL


def get_mme_contact_default():
    return [{'name': MME_DEFAULT_CONTACT_NAME, 'email': MME_DEFAULT_CONTACT_EMAIL}]


class MatchmakerSubmission(ModelWithGUID):

    SEX_LOOKUP = {
        **{sex: 'MALE' for sex in Individual.MALE_SEXES},
        **{sex: 'FEMALE' for sex in Individual.FEMALE_SEXES},
    }

    individual = models.OneToOneField(Individual, on_delete=models.PROTECT)

    submission_id = models.CharField(max_length=255, db_index=True, unique=True)
    label = models.CharField(max_length=255, null=True, blank=True)
    contacts = ArrayField(models.JSONField(), default=get_mme_contact_default)
    features = JSONField(null=True)

    deleted_date = models.DateTimeField(null=True)
    deleted_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)

    def __unicode__(self):
        return '{}_submission_{}'.format(str(self.individual), self.id)

    GUID_PREFIX = 'MS'

    class Meta:
        json_fields = [
            'guid', 'created_date', 'last_modified_date', 'deleted_date'
        ]


class MatchmakerSubmissionGenes(models.Model):
    matchmaker_submission = models.ForeignKey(MatchmakerSubmission, on_delete=models.CASCADE)
    saved_variant = models.ForeignKey('seqr.SavedVariant', on_delete=models.PROTECT)
    gene_id = models.CharField(max_length=20)  # ensembl ID


class MatchmakerIncomingQuery(ModelWithGUID):
    institution = models.CharField(max_length=255)
    patient_id = models.CharField(max_length=255, null=True)

    def __unicode__(self):
        return '{}_{}_query'.format(self.patient_id or self.id, self.institution)

    GUID_PREFIX = 'MIQ'

    class Meta:
        json_fields = ['guid', 'created_date']


class MatchmakerResult(ModelWithGUID):
    SOURCE_MME = 'mme'
    MANUAL_SOURCE_CHOICES = (
        ('variantmatcher', 'VariantMatcher'),
        ('genematcher', 'GeneMatcher'),
        ('other', 'Other'),
    )
    SOURCE_CHOICES = ((SOURCE_MME, 'Matchmaker Exchange'),) + MANUAL_SOURCE_CHOICES

    submission = models.ForeignKey(MatchmakerSubmission, on_delete=models.PROTECT, null=True)
    originating_submission = models.ForeignKey(MatchmakerSubmission, on_delete=models.PROTECT, null=True, related_name='origin_results')
    originating_query = models.ForeignKey(MatchmakerIncomingQuery, on_delete=models.SET_NULL, null=True)
    result_data = JSONField()

    last_modified_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    we_contacted = models.BooleanField(default=False)
    host_contacted = models.BooleanField(default=False)
    deemed_irrelevant = models.BooleanField(default=False)
    flag_for_analysis = models.BooleanField(default=False)
    comments = models.TextField(null=True, blank=True)

    match_removed = models.BooleanField(default=False)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default=SOURCE_MME)

    def __unicode__(self):
        return '{}_{}_result'.format(self.id, str(self.submission))

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._loaded_triage = instance._triage_state()
        return instance

    def _triage_state(self):
        return {field: self.__dict__.get(field) for field in ('status', *TRIAGE_FLAGS)}

    def save(self, *args, **kwargs):
        self._sync_status_and_flags()
        super().save(*args, **kwargs)
        self._loaded_triage = self._triage_state()

    def _sync_status_and_flags(self):
        # See matchmaker/result_status.py: an edited status sets the legacy flags, edited flags move the status
        loaded = getattr(self, '_loaded_triage', None)
        flags = {flag: getattr(self, flag) for flag in TRIAGE_FLAGS}
        if loaded is None and self.status == STATUS_NEW:
            self.status = get_status_for_flags(**flags)
        elif loaded is None or self.status != loaded['status']:
            for flag, value in STATUS_FLAG_UPDATES[self.status].items():
                setattr(self, flag, value)
        else:
            old_flags = {flag: loaded[flag] for flag in TRIAGE_FLAGS}
            if flags != old_flags:
                self.status = get_status_for_flag_update(self.status, old_flags, flags)

    GUID_PREFIX = 'MR'

    class Meta:
        json_fields = [
            'guid', 'comments', 'we_contacted', 'host_contacted', 'deemed_irrelevant', 'flag_for_analysis',
            'created_date', 'match_removed'
        ]


class MatchmakerContactNotes(ModelWithGUID):
    institution = models.CharField(max_length=200, db_index=True, unique=True)
    comments = models.TextField(blank=True)

    def __unicode__(self):
        return '{}_{}_contact'.format(self.id, self.institution)

    GUID_PREFIX = 'MCN'

    class Meta:
        json_fields = []
        internal_json_fields = ['institution', 'comments']
