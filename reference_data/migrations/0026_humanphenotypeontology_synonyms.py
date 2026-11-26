from django.db import migrations, models


def force_hpo_reload(apps, schema_editor):
    # Synonyms are only populated when hp.obo is next loaded, so drop the tracked version to trigger that load
    DataVersions = apps.get_model('reference_data', 'DataVersions')
    DataVersions.objects.using(schema_editor.connection.alias).filter(
        data_model_name='HumanPhenotypeOntology',
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('reference_data', '0025_dataversions'),
    ]

    operations = [
        migrations.AddField(
            model_name='humanphenotypeontology',
            name='synonyms',
            field=models.JSONField(default=list),
        ),
        migrations.RunPython(force_hpo_reload, reverse_code=migrations.RunPython.noop),
    ]
