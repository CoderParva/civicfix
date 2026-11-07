from django.db import migrations

DEFAULT_CATEGORIES = [
    ("Pothole", "pothole"),
    ("Garbage", "trash"),
    ("Streetlight", "lightbulb"),
    ("Water leakage", "droplet"),
    ("Drainage", "waves"),
    ("Road damage", "road"),
    ("Other", "circle-help"),
]


def seed(apps, schema_editor):
    IssueCategory = apps.get_model("issues", "IssueCategory")
    for name, icon in DEFAULT_CATEGORIES:
        IssueCategory.objects.get_or_create(name=name, defaults={"icon": icon})


def unseed(apps, schema_editor):
    # Only removes categories nothing refers to, so reversing can never fail on a PROTECT FK.
    IssueCategory = apps.get_model("issues", "IssueCategory")
    IssueCategory.objects.filter(name__in=[n for n, _ in DEFAULT_CATEGORIES], issues__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [("issues", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
