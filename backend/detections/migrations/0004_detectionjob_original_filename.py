from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0003_bulkdetectionjob"),
    ]

    operations = [
        migrations.AddField(
            model_name="detectionjob",
            name="original_filename",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
