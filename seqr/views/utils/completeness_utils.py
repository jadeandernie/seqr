AFFECTED = 'A'
UNKNOWN_SEX = 'U'

INDIVIDUAL_LEVEL = 'individual'
FAMILY_LEVEL = 'family'


def _round_half_up(value):
    return int(value + 0.5)


def _has_value(value):
    return value is not None and value != '' and value != [] and value != {}


def _field_has_value(field):
    return lambda record: _has_value(record.get(field))


def _has_known_sex(individual):
    sex = individual.get('sex')
    return _has_value(sex) and sex != UNKNOWN_SEX


def _has_ancestry(individual):
    return _has_value(individual.get('maternalEthnicity')) or _has_value(individual.get('paternalEthnicity'))


def _has_both_parents(individual):
    return _has_value(individual.get('maternalGuid')) and _has_value(individual.get('paternalGuid'))


def _has_no_parents(individual):
    return not (_has_value(individual.get('maternalGuid')) or _has_value(individual.get('paternalGuid')))


# The field keys are a stable vocabulary shared with clients: weights and labels may change, keys must not.
# Weights are relative; the score is the recorded share of the weight of the applicable fields.
COMPLETENESS_FIELDS = [
    # Observed HPO terms drive phenotype-based prioritisation and matching, so they dominate the score
    {'field': 'features', 'label': 'Observed features (HPO terms)', 'weight': 30, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _field_has_value('features')},
    # Excluded HPO terms narrow the differential diagnosis
    {'field': 'absentFeatures', 'label': 'Features confirmed absent (HPO terms)', 'weight': 10,
     'level': INDIVIDUAL_LEVEL, 'is_recorded': _field_has_value('absentFeatures')},
    # Age of onset separates congenital from later-onset conditions
    {'field': 'onsetAge', 'label': 'Age of onset', 'weight': 10, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _field_has_value('onsetAge')},
    # Sex is needed to interpret X-linked and sex-limited inheritance
    {'field': 'sex', 'label': 'Sex', 'weight': 8, 'level': INDIVIDUAL_LEVEL, 'is_recorded': _has_known_sex},
    # A recorded pedigree allows de novo and segregation analysis
    {'field': 'parents', 'label': 'Both parents in the pedigree', 'weight': 8, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _has_both_parents, 'is_not_applicable': _has_no_parents},
    # Year of birth puts onset and age-dependent features in context
    {'field': 'birthYear', 'label': 'Year of birth', 'weight': 6, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _field_has_value('birthYear')},
    # Consanguinity changes the prior for recessive inheritance
    {'field': 'consanguinity', 'label': 'Consanguinity (yes or no)', 'weight': 6, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _field_has_value('consanguinity')},
    # Reported ancestry informs population frequency filtering
    {'field': 'ancestry', 'label': 'Maternal or paternal ancestry', 'weight': 5, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _has_ancestry},
    # The expected mode of inheritance guides which searches are run first
    {'field': 'expectedInheritance', 'label': 'Expected mode of inheritance', 'weight': 5,
     'level': INDIVIDUAL_LEVEL, 'is_recorded': _field_has_value('expectedInheritance')},
    # Known disorders are optional context: many undiagnosed patients have none
    {'field': 'disorders', 'label': 'Known disorders (OMIM)', 'weight': 4, 'level': INDIVIDUAL_LEVEL,
     'is_recorded': _field_has_value('disorders')},
    # The family phenotype summary is shared by every affected member of the family
    {'field': 'codedPhenotype', 'label': 'Family phenotype description', 'weight': 4, 'level': FAMILY_LEVEL,
     'is_recorded': _field_has_value('codedPhenotype')},
    # A MONDO ID gives the family a coded disease for reporting and matching
    {'field': 'mondoId', 'label': 'Family MONDO disease ID', 'weight': 4, 'level': FAMILY_LEVEL,
     'is_recorded': _field_has_value('mondoId')},
]

ITEM_KEYS = ['field', 'label', 'weight', 'level']
FAMILY_COMPLETENESS_FIELDS = [config['field'] for config in COMPLETENESS_FIELDS if config['level'] == FAMILY_LEVEL]
NO_FEATURES_FIELD = 'features'


def get_individual_completeness(individual, family=None):
    """Scores how much of the structured clinical data for an affected individual has been recorded.

    Args:
        individual (dict): serialized individual fields, as returned by the individual JSON endpoints
        family (dict): serialized fields of the individual's family
    Returns:
        None for individuals who are not affected, otherwise
        {'score': 0-100, 'missing': [{field, label, weight, level}], 'present': [{field, label, weight, level}]}
    """
    if individual.get('affected') != AFFECTED:
        return None

    records = {INDIVIDUAL_LEVEL: individual, FAMILY_LEVEL: family or {}}
    missing = []
    present = []
    for config in COMPLETENESS_FIELDS:
        record = records[config['level']]
        item = {key: config[key] for key in ITEM_KEYS}
        if config['is_recorded'](record):
            present.append(item)
        elif not ('is_not_applicable' in config and config['is_not_applicable'](record)):
            missing.append(item)

    present_weight = sum(item['weight'] for item in present)
    total_weight = present_weight + sum(item['weight'] for item in missing)
    return {'score': _round_half_up(100 * present_weight / total_weight), 'missing': missing, 'present': present}


def get_family_completeness(individuals_completeness):
    """Rolls the completeness of a family's individuals up to the mean score of its affected individuals.

    Args:
        individuals_completeness (list): results of get_individual_completeness for the family's individuals
    Returns:
        None for families with no affected individuals, otherwise
        {'score': 0-100, 'numIndividuals': scored individuals, 'numNoFeatures': scored individuals with no HPO terms}
    """
    scored = [completeness for completeness in individuals_completeness if completeness]
    if not scored:
        return None
    return {
        'score': _round_half_up(sum(completeness['score'] for completeness in scored) / len(scored)),
        'numIndividuals': len(scored),
        'numNoFeatures': len([
            completeness for completeness in scored
            if any(item['field'] == NO_FEATURES_FIELD for item in completeness['missing'])
        ]),
    }
