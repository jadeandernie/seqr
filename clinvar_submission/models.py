from django.contrib.auth.models import User
from django.contrib.postgres.fields import ArrayField
from django.db import models

from seqr.models import ModelWithGUID


class ClinvarSubmission(ModelWithGUID):
    STATUS_DRAFT = 'draft'
    STATUS_IN_REVIEW = 'in_review'
    STATUS_APPROVED = 'approved'
    STATUS_DRY_RUN_PASSED = 'dry_run_passed'
    STATUS_SUBMITTED = 'submitted'
    STATUS_PROCESSED = 'processed'
    STATUS_ERROR = 'error'
    STATUS_WITHDRAWN = 'withdrawn'
    STATUS_CHOICES = (
        (STATUS_DRAFT, 'Draft'),
        (STATUS_IN_REVIEW, 'In review'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_DRY_RUN_PASSED, 'Dry run passed'),
        (STATUS_SUBMITTED, 'Submitted'),
        (STATUS_PROCESSED, 'Processed'),
        (STATUS_ERROR, 'Error'),
        (STATUS_WITHDRAWN, 'Withdrawn'),
    )
    EDITABLE_STATUSES = {
        STATUS_DRAFT, STATUS_IN_REVIEW, STATUS_APPROVED, STATUS_DRY_RUN_PASSED, STATUS_PROCESSED, STATUS_ERROR,
    }
    SUBMITTABLE_STATUSES = {STATUS_APPROVED, STATUS_DRY_RUN_PASSED}

    # Kept when the saved variant is deleted: the record of what was published must outlive it
    saved_variant = models.ForeignKey('seqr.SavedVariant', null=True, on_delete=models.SET_NULL)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)

    classification = models.CharField(max_length=40, null=True, blank=True)
    condition_id = models.CharField(max_length=30, null=True, blank=True)
    mode_of_inheritance = models.CharField(max_length=60, null=True, blank=True)
    collection_method = models.CharField(max_length=30, null=True, blank=True)
    affected_status = models.CharField(max_length=20, null=True, blank=True)
    allele_origin = models.CharField(max_length=20, null=True, blank=True)
    citations = ArrayField(models.CharField(max_length=20), default=list)

    # The exact record that would be sent. Always built server-side.
    payload = models.JSONField(null=True)
    validation_errors = ArrayField(models.TextField(), default=list)

    scv_accession = models.CharField(max_length=20, null=True, blank=True)
    ncbi_submission_id = models.CharField(max_length=30, null=True, blank=True)
    submission_mode = models.CharField(max_length=10, null=True, blank=True)
    response = models.JSONField(null=True)

    last_edited_by = models.ForeignKey(User, null=True, blank=True, related_name='+', on_delete=models.SET_NULL)
    reviewed_by = models.ForeignKey(User, null=True, blank=True, related_name='+', on_delete=models.SET_NULL)
    reviewed_date = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(User, null=True, blank=True, related_name='+', on_delete=models.SET_NULL)
    submitted_date = models.DateTimeField(null=True, blank=True)
    withdrawal_requested_by = models.ForeignKey(User, null=True, blank=True, related_name='+', on_delete=models.SET_NULL)
    withdrawal_requested_date = models.DateTimeField(null=True, blank=True)

    def __unicode__(self):
        return 'clinvar'

    GUID_PREFIX = 'CS'

    class Meta:
        json_fields = [
            'guid', 'created_date', 'last_modified_date', 'status', 'classification', 'condition_id',
            'mode_of_inheritance', 'collection_method', 'affected_status', 'allele_origin', 'citations', 'payload',
            'validation_errors', 'scv_accession', 'ncbi_submission_id', 'submission_mode', 'response',
            'reviewed_date', 'submitted_date', 'withdrawal_requested_date',
        ]
        audit_fields = {'status'}
        constraints = [models.UniqueConstraint(
            fields=['saved_variant'], condition=~models.Q(status='withdrawn'), name='one_active_clinvar_submission',
        )]
