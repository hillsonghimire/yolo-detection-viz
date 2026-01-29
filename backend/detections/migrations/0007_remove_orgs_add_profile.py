from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0006_role_map_to_cvat"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("organization", models.CharField(max_length=200)),
                ("email_verified", models.BooleanField(default=False)),
                ("verification_token", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("otp_code", models.CharField(blank=True, default="", max_length=10)),
                ("otp_expires_at", models.DateTimeField(blank=True, null=True)),
                ("verification_sent_at", models.DateTimeField(blank=True, null=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="profile", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RemoveField(
            model_name="bulkdetectionjob",
            name="organization",
        ),
        migrations.RemoveField(
            model_name="bulkdetectionjob",
            name="project",
        ),
        migrations.RemoveField(
            model_name="detectionjob",
            name="organization",
        ),
        migrations.RemoveField(
            model_name="detectionjob",
            name="project",
        ),
        migrations.DeleteModel(
            name="OrganizationInvite",
        ),
        migrations.DeleteModel(
            name="OrganizationMembership",
        ),
        migrations.DeleteModel(
            name="Project",
        ),
        migrations.DeleteModel(
            name="Organization",
        ),
    ]
