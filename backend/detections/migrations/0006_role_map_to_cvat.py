from django.db import migrations


def forwards(apps, schema_editor):
    OrganizationMembership = apps.get_model("detections", "OrganizationMembership")
    OrganizationInvite = apps.get_model("detections", "OrganizationInvite")
    role_map = {
        "ADMIN": "OWNER",
        "MANAGER": "MAINTAINER",
        "USER": "WORKER",
    }
    for old_role, new_role in role_map.items():
        OrganizationMembership.objects.filter(role=old_role).update(role=new_role)
        OrganizationInvite.objects.filter(role=old_role).update(role=new_role)


def backwards(apps, schema_editor):
    OrganizationMembership = apps.get_model("detections", "OrganizationMembership")
    OrganizationInvite = apps.get_model("detections", "OrganizationInvite")
    role_map = {
        "OWNER": "ADMIN",
        "MAINTAINER": "MANAGER",
        "WORKER": "USER",
    }
    for old_role, new_role in role_map.items():
        OrganizationMembership.objects.filter(role=old_role).update(role=new_role)
        OrganizationInvite.objects.filter(role=old_role).update(role=new_role)


class Migration(migrations.Migration):

    dependencies = [
        ("detections", "0005_orgs_projects_auth"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
