"""
Triage status for matchmaker results and its relationship to the legacy boolean flags.

The status is the stored source of truth for the triage workflow. The legacy flags stay editable on the
per-individual page, and every save keeps the two consistent with these rules:
  - deemed_irrelevant is set if and only if the status is "not relevant"
  - a "relevant" status implies flag_for_analysis
  - a "responded" status implies we_contacted
Contact flags record facts (an email was sent or received) and are never cleared by a status change.
"""
import itertools

STATUS_NEW = 'new'
STATUS_REVIEWING = 'reviewing'
STATUS_RELEVANT = 'relevant'
STATUS_NOT_RELEVANT = 'not_relevant'
STATUS_RESPONDED = 'responded'

STATUS_CHOICES = (
    (STATUS_NEW, 'New'),
    (STATUS_REVIEWING, 'Reviewing'),
    (STATUS_RELEVANT, 'Relevant'),
    (STATUS_NOT_RELEVANT, 'Not Relevant'),
    (STATUS_RESPONDED, 'Responded'),
)
STATUSES = [status for status, _ in STATUS_CHOICES]

TRIAGE_FLAGS = ('we_contacted', 'host_contacted', 'deemed_irrelevant', 'flag_for_analysis')

STATUS_FLAG_UPDATES = {
    STATUS_NEW: {'deemed_irrelevant': False, 'flag_for_analysis': False},
    STATUS_REVIEWING: {'deemed_irrelevant': False, 'flag_for_analysis': False},
    STATUS_RELEVANT: {'deemed_irrelevant': False, 'flag_for_analysis': True},
    STATUS_NOT_RELEVANT: {'deemed_irrelevant': True, 'flag_for_analysis': False},
    STATUS_RESPONDED: {'deemed_irrelevant': False, 'we_contacted': True},
}


def get_status_for_flags(we_contacted=False, host_contacted=False, deemed_irrelevant=False, flag_for_analysis=False):
    """The status of a result that only has legacy flags. Used to backfill existing results, in this precedence."""
    if deemed_irrelevant:
        return STATUS_NOT_RELEVANT
    if we_contacted:
        return STATUS_RESPONDED
    if flag_for_analysis:
        return STATUS_RELEVANT
    if host_contacted:
        return STATUS_REVIEWING
    return STATUS_NEW


def get_status_for_flag_update(status, old_flags, new_flags):
    """The status of a result after its legacy flags were edited from old_flags to new_flags"""
    if new_flags['deemed_irrelevant']:
        return STATUS_NOT_RELEVANT
    newly_set = {flag for flag in TRIAGE_FLAGS if new_flags[flag] and not old_flags[flag]}
    if 'we_contacted' in newly_set:
        return STATUS_RESPONDED
    if 'flag_for_analysis' in newly_set and status != STATUS_RESPONDED:
        return STATUS_RELEVANT
    if 'host_contacted' in newly_set and status == STATUS_NEW:
        return STATUS_REVIEWING
    is_stale = status == STATUS_NOT_RELEVANT or \
        (status == STATUS_RELEVANT and not new_flags['flag_for_analysis']) or \
        (status == STATUS_RESPONDED and not new_flags['we_contacted'])
    return get_status_for_flags(**new_flags) if is_stale else status


def iter_flag_combinations():
    for values in itertools.product([False, True], repeat=len(TRIAGE_FLAGS)):
        yield dict(zip(TRIAGE_FLAGS, values))


def backfill_result_status(result_model, db_alias='default'):
    """Sets the status of all existing results from their legacy flags. Used by the schema migration."""
    for flags in iter_flag_combinations():
        result_model.objects.using(db_alias).filter(**flags).update(status=get_status_for_flags(**flags))
