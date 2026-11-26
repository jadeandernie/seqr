from clickhouse_search.constants import DE_NOVO, RECESSIVE, X_LINKED_RECESSIVE
from seqr.utils.constants import AFFECTED_STATUS_AFFECTED, AFFECTED_STATUS_UNAFFECTED, MALE_SEXES, FEMALE_SEXES

PEDIGREE_SOURCE = 'pedigree'
EXPECTED_INHERITANCE_SOURCE = 'expected_inheritance'

EXPECTED_INHERITANCE_LABELS = {
    'S': 'Sporadic',
    'D': 'Autosomal dominant inheritance',
    'L': 'Sex-limited autosomal dominant',
    'A': 'Male-limited autosomal dominant',
    'C': 'Autosomal dominant contiguous gene syndrome',
    'R': 'Autosomal recessive inheritance',
    'G': 'Gonosomal inheritance',
    'X': 'X-linked inheritance',
    'Z': 'X-linked recessive inheritance',
    'Y': 'Y-linked inheritance',
    'W': 'X-linked dominant inheritance',
    'F': 'Multifactorial inheritance',
    'M': 'Mitochondrial inheritance',
}

EXPECTED_INHERITANCE_MODES = {
    'S': DE_NOVO,
    'D': DE_NOVO,
    'L': DE_NOVO,
    'A': DE_NOVO,
    'C': DE_NOVO,
    'W': DE_NOVO,
    'R': RECESSIVE,
    'X': X_LINKED_RECESSIVE,
    'Z': X_LINKED_RECESSIVE,
}


def _names(individuals):
    return ', '.join(i['individual_id'] for i in individuals)


def _parents(individual, individuals_by_id):
    return [
        (relationship, individuals_by_id[individual[relationship]])
        for relationship in ['mother', 'father'] if individual.get(relationship) in individuals_by_id
    ]


def _is_affected(individual):
    return individual.get('affected') == AFFECTED_STATUS_AFFECTED


def _is_unaffected(individual):
    return individual.get('affected') == AFFECTED_STATUS_UNAFFECTED


def _no_data_suffix(individual):
    return '' if individual.get('has_data') else f' ({individual["individual_id"]} has no loaded data)'


def _x_linked_why(affected, individuals_by_id, notes):
    unknown_sex = [i for i in affected if i.get('sex') not in MALE_SEXES and i.get('sex') not in FEMALE_SEXES]
    if unknown_sex:
        notes.append(f'Sex is not recorded for {_names(unknown_sex)}, so X-linked inheritance was not assessed.')
        return None
    if any(i['sex'] not in MALE_SEXES for i in affected):
        return None

    carrier_mothers = []
    for individual in affected:
        mother = individuals_by_id.get(individual.get('mother'))
        if mother and _is_unaffected(mother):
            carrier_mothers.append((individual, mother))
    if not carrier_mothers:
        return None

    individual, mother = carrier_mothers[0]
    affected_description = (
        f'All affected individuals with data ({_names(affected)}) are male' if len(affected) > 1
        else f'{individual["individual_id"]} is an affected male'
    )
    return (
        f'{affected_description} and the unaffected mother {mother["individual_id"]} may be a carrier'
        f'{_no_data_suffix(mother)}. This is a narrower subset of the Recessive search.'
    )


def _pedigree_modes(affected, unaffected, individuals_by_id, notes):
    vertical = [
        (child, relationship, parent) for child in affected
        for relationship, parent in _parents(child, individuals_by_id) if _is_affected(parent)
    ]

    if len(affected) + len(unaffected) < 2:
        note = (
            f'Only one individual with a known affected status has loaded data ({_names(affected)}), '
            'so no inheritance mode was inferred from the pedigree.'
        )
        if vertical:
            child, relationship, parent = vertical[0]
            note += (
                f' The {relationship} {parent["individual_id"]} is recorded as affected, which suggests dominant '
                'inheritance, but a dominant search needs data for at least one more relative.'
            )
        notes.append(note)
        return []

    if vertical:
        child, relationship, parent = vertical[0]
        return [(DE_NOVO, (
            f'{child["individual_id"]} and their {relationship} {parent["individual_id"]} are both affected, '
            f'consistent with dominant inheritance{_no_data_suffix(parent)}.'
        ))]

    x_linked_why = _x_linked_why(affected, individuals_by_id, notes)
    x_linked = [(X_LINKED_RECESSIVE, x_linked_why)] if x_linked_why else []
    unaffected_names = _names(unaffected)

    if len(affected) > 1:
        dominant_why = f'Lower priority: variants carried by all {len(affected)} affected individuals'
        dominant_why += (
            f' and absent from the unaffected relatives with data ({unaffected_names}), as with parental mosaicism.'
            if unaffected else '.'
        )
        return [
            (RECESSIVE, (
                f'{_names(affected)} are affected and none of their parents is recorded as affected, '
                'consistent with recessive inheritance.'
            )),
            *x_linked,
            (DE_NOVO, dominant_why),
        ]

    proband = affected[0]
    proband_id = proband['individual_id']
    parents = [parent for _, parent in _parents(proband, individuals_by_id)]
    if len(parents) == 2 and all(parent.get('has_data') and _is_unaffected(parent) for parent in parents):
        return [
            (DE_NOVO, (
                f'{proband_id} is affected and both parents ({_names(parents)}) are unaffected and have loaded data, '
                'so de novo variants can be identified.'
            )),
            (RECESSIVE, (
                f'{proband_id} is affected and both parents ({_names(parents)}) are unaffected and could each be '
                'carriers.'
            )),
            *x_linked,
        ]

    return [
        (RECESSIVE, (
            f'{proband_id} is the only affected individual with data. Unaffected relatives with data '
            f'({unaffected_names}) are used to exclude variants that do not fit recessive inheritance.'
        )),
        *x_linked,
        (DE_NOVO, (
            f'Variants in {proband_id} that are absent from the unaffected relatives with data ({unaffected_names}). '
            'Data is not loaded for two unaffected parents, so a de novo origin cannot be confirmed.'
        )),
    ]


def _expected_inheritance_modes(individuals, num_informative, notes):
    modes = []
    for individual in individuals:
        if not _is_affected(individual):
            continue
        for code in individual.get('expected_inheritance') or []:
            label = EXPECTED_INHERITANCE_LABELS.get(code, code)
            recorded = f'"{label}" is recorded as the expected inheritance for {individual["individual_id"]}'
            mode = EXPECTED_INHERITANCE_MODES.get(code)
            if not mode:
                notes.append(f'{recorded}, which has no matching search inheritance mode.')
            elif mode == DE_NOVO and num_informative < 2:
                notes.append(
                    f'{recorded}, but a dominant search needs data for at least one more relative with a known '
                    'affected status.'
                )
            else:
                modes.append((mode, f'{recorded}.'))
    return modes


def suggest_inheritance_modes(individuals):
    """
    Suggest search inheritance modes for a single family from its structured clinical record.

    individuals: dicts with individual_id, sex, affected, mother, father (individual_ids or None),
        has_data (whether variant data is loaded) and expected_inheritance (list of codes or None)

    Returns an ordered list of {mode, sources, why} and a list of notes explaining what could not be suggested.
    """
    notes = []
    individuals_by_id = {i['individual_id']: i for i in individuals}
    loaded = [i for i in individuals if i.get('has_data')]
    if not loaded:
        return [], ['No individual in this family has loaded data.']

    affected = [i for i in loaded if _is_affected(i)]
    unaffected = [i for i in loaded if _is_unaffected(i)]
    unknown = [i for i in loaded if not (_is_affected(i) or _is_unaffected(i))]
    if unknown:
        notes.append(
            f'Affected status is unknown for {_names(unknown)}, so inheritance filters ignore their genotypes.'
        )
    if not affected:
        no_data_affected = [i for i in individuals if _is_affected(i)]
        notes.append(
            f'The affected individuals ({_names(no_data_affected)}) have no loaded data, so inheritance searches cannot be run.'
            if no_data_affected else
            'No individual is recorded as affected, so inheritance searches cannot be run.'
        )
        return [], notes

    mode_whys = [
        (EXPECTED_INHERITANCE_SOURCE, mode, why)
        for mode, why in _expected_inheritance_modes(individuals, len(affected) + len(unaffected), notes)
    ] + [
        (PEDIGREE_SOURCE, mode, why)
        for mode, why in _pedigree_modes(affected, unaffected, individuals_by_id, notes)
    ]

    suggestions = {}
    for source, mode, why in mode_whys:
        suggestion = suggestions.setdefault(mode, {'mode': mode, 'sources': [], 'whys': []})
        if source not in suggestion['sources']:
            suggestion['sources'].append(source)
        suggestion['whys'].append(why)

    return [
        {'mode': s['mode'], 'sources': s['sources'], 'why': ' '.join(s['whys'])} for s in suggestions.values()
    ], notes
