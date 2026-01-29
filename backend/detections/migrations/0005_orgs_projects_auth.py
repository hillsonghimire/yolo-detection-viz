from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0004_detectionjob_original_filename"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Organization",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="orgs_created", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="OrganizationInvite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("email", models.EmailField(blank=True, default="", max_length=254)),
                ("role", models.CharField(choices=[("OWNER", "Owner"), ("MAINTAINER", "Maintainer"), ("SUPERVISOR", "Supervisor"), ("WORKER", "Worker")], default="WORKER", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("accepted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="org_invites_accepted", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="org_invites_created", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="invites", to="detections.organization")),
            ],
        ),
        migrations.CreateModel(
            name="Project",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("visibility", models.CharField(choices=[("PRIVATE", "Private"), ("ORG", "Organization")], default="PRIVATE", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="projects", to="detections.organization")),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="projects_owned", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "unique_together": {("organization", "name", "owner")},
            },
        ),
        migrations.CreateModel(
            name="OrganizationMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("OWNER", "Owner"), ("MAINTAINER", "Maintainer"), ("SUPERVISOR", "Supervisor"), ("WORKER", "Worker")], default="WORKER", max_length=20)),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("is_active", models.BooleanField(default=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="detections.organization")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="org_memberships", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "unique_together": {("user", "organization")},
            },
        ),
        migrations.AddField(
            model_name="bulkdetectionjob",
            name="organization",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="bulk_jobs", to="detections.organization"),
        ),
        migrations.AddField(
            model_name="bulkdetectionjob",
            name="owner",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="bulk_jobs", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="bulkdetectionjob",
            name="project",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="bulk_jobs", to="detections.project"),
        ),
        migrations.AddField(
            model_name="detectionjob",
            name="organization",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="detection_jobs", to="detections.organization"),
        ),
        migrations.AddField(
            model_name="detectionjob",
            name="owner",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="detection_jobs", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="detectionjob",
            name="project",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="detection_jobs", to="detections.project"),
        ),
    ]
