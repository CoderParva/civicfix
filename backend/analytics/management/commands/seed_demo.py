"""Seed realistic demo data: ~90 days of civic issues around Indore, with real lifecycles.

    python manage.py seed_demo [--count 160] [--seed 2026]

Everything goes through the real service layer (create_issue -> approve -> assign -> accept ->
resolve -> reopen), so the status history, assignments and moderation state are exactly what the
API would have produced; only the *timestamps* are then spread over the last 90 days. Every
dashboard number is therefore a real aggregate over real rows (the plan forbids hardcoded stats).

Idempotent: if demo accounts already exist it does nothing. It only ever creates rows and never
deletes. Demo accounts use the @demo.civicfix.test domain and the password printed at the end
(development only).
"""
import random
from datetime import timedelta
from io import BytesIO

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont

from accounts.models import User
from departments import services as dept_services
from departments.models import Department, DepartmentNote, IssueAssignment, OfficerProfile
from issues import services as issue_services
from issues.models import (
    ContentReport,
    Issue,
    IssueCategory,
    IssueComment,
    IssueImage,
    IssueStatusHistory,
    IssueVote,
)

DOMAIN = "demo.civicfix.test"
PASSWORD = "DemoPass-2026!x"  # development only

DEPARTMENTS = {
    "Public Works": ("Roads, potholes and civil repairs", [("Rohit Chauhan", "PW-101"), ("Meera Joshi", "PW-102"), ("Arjun Tiwari", "PW-103")]),
    "Sanitation": ("Waste collection and street cleaning", [("Sunita Verma", "SAN-201"), ("Imran Qureshi", "SAN-202")]),
    "Electricity": ("Street lighting and power faults", [("Deepak Soni", "EL-301"), ("Kavita Rathore", "EL-302")]),
    "Water & Drainage": ("Water supply, leaks and drains", [("Harish Patidar", "WD-401"), ("Neha Bhatt", "WD-402")]),
}
CATEGORY_DEPARTMENT = {
    "Pothole": "Public Works", "Road damage": "Public Works", "Other": "Public Works",
    "Garbage": "Sanitation", "Streetlight": "Electricity", "Water leakage": "Water & Drainage", "Drainage": "Water & Drainage",
}
CITIZENS = [
    "Aarav Sharma", "Diya Patel", "Vihaan Mehta", "Ananya Iyer", "Kabir Singh", "Ishita Jain", "Rahul Agrawal", "Priya Nair",
    "Siddharth Rao", "Neha Gupta", "Aditya Kulkarni", "Riya Malhotra", "Manish Yadav", "Pooja Deshmukh", "Karan Bansal",
    "Sneha Pillai", "Rohan Saxena", "Tanvi Choudhary", "Vivek Mishra", "Anjali Dubey", "Nikhil Verma", "Shreya Kapoor",
    "Harsh Vardhan", "Meghna Das", "Yash Thakur",
]
# (name, lat, lng): approximate neighbourhood centres in Indore
PLACES = [
    ("Rajwada", 22.7196, 75.8577), ("Vijay Nagar", 22.7533, 75.8937), ("Palasia", 22.7244, 75.8839), ("Bhawarkuan", 22.6932, 75.8681),
    ("Sarafa Bazaar", 22.7176, 75.8553), ("Rau", 22.6401, 75.8044), ("Scheme 78", 22.7603, 75.9022), ("Sudama Nagar", 22.6830, 75.8090),
    ("Mhow Naka", 22.7130, 75.8660), ("Annapurna Road", 22.6895, 75.8270), ("Khajrana", 22.7310, 75.9030), ("Lasudia Mori", 22.7549, 75.9150),
    ("Airport Road", 22.7250, 75.8010), ("Geeta Bhawan", 22.7200, 75.8730), ("Navlakha", 22.7040, 75.8760), ("Tilak Nagar", 22.7140, 75.8940),
    ("MR-10 Crossing", 22.7510, 75.8850), ("Bengali Square", 22.7270, 75.9120), ("Regal Square", 22.7185, 75.8685), ("Chhoti Gwaltoli", 22.7110, 75.8480),
]
TEMPLATES = {
    "Pothole": ["Deep pothole near {p}", "String of potholes on the {p} stretch", "Water-filled pothole at {p}"],
    "Road damage": ["Sunken, cracked road at {p}", "Broken road edge near {p}", "Road surface peeling off at {p}"],
    "Garbage": ["Overflowing garbage bin at {p}", "Uncollected waste pile near {p}", "Garbage dumped on the footpath at {p}"],
    "Streetlight": ["Streetlight not working at {p}", "Flickering streetlights near {p}", "Whole lane dark after sunset at {p}"],
    "Water leakage": ["Water pipe leaking near {p}", "Burst water main at {p}", "Constant leak from the junction box at {p}"],
    "Drainage": ["Blocked drain at {p}", "Sewage overflowing near {p}", "Waterlogging because of a choked drain at {p}"],
    "Other": ["Stray cattle blocking the road at {p}", "Illegal hoarding near {p}", "Open manhole cover at {p}"],
}
DETAILS = [
    "It has been like this for several days and it is getting worse. Residents and commuters are affected every day.",
    "Reported by multiple neighbours. It is especially risky early in the morning and after dark.",
    "This looks like a recurring problem at this spot. A permanent fix is needed, not a temporary patch.",
    "Two-wheelers and pedestrians have to detour around it. Please look into it at the earliest.",
]
REJECT_REASONS = ["Not a municipal responsibility (private property)", "Duplicate of an existing report", "Insufficient detail to act on"]
REOPEN_REASONS = ["The problem came back within a week", "Repair was only cosmetic, still unsafe", "Same spot failed again after the rain"]
RESOLVE_NOTES = ["Repaired and levelled", "Replaced the faulty part", "Cleared and cleaned the area", "Fixed on site; inspected after the work"]
NOTE_TEXTS = [
    "Site visited. Needs material from the zonal depot; scheduled for tomorrow.",
    "Contractor informed. Waiting on a road-cut permission before starting.",
    "Cause identified; temporary barricading placed for safety.",
    "Work completed; will re-inspect after the next rain.",
]
COMMENT_TEXTS = ["Same problem here, it happens every morning.", "Please fix this soon, it is dangerous.", "Seen this too, +1.", "Any update on this?", "Thanks for reporting."]
HEX = {"Pothole": "#2563eb", "Road damage": "#16a34a", "Garbage": "#d97706", "Streetlight": "#dc2626", "Water leakage": "#7c3aed", "Drainage": "#0891b2", "Other": "#db2777"}


def _outcome_weights(days_ago):
    """Older issues are mostly finished; recent ones are mostly still moving."""
    if days_ago > 45:
        return {"resolved": 72, "rejected": 8, "in_progress": 8, "reopened": 4, "assigned": 4, "under_review": 4}
    if days_ago > 15:
        return {"resolved": 50, "in_progress": 20, "assigned": 10, "under_review": 8, "rejected": 6, "reopened": 3, "pending": 3}
    return {"resolved": 20, "in_progress": 22, "assigned": 16, "under_review": 14, "pending": 18, "rejected": 5, "reopened": 5}


def _png(color_hex, label, resolved=False):
    """A tidy placeholder photo: colour wash, a few soft shapes and a caption bar."""
    rng = random.Random(label)
    w, h = 640, 420
    base = tuple(int(color_hex[i : i + 2], 16) for i in (1, 3, 5))
    top, bottom = ((34, 139, 90), (18, 84, 58)) if resolved else (tuple(min(255, c + 60) for c in base), tuple(int(c * 0.55) for c in base))
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        row = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(9):
        r = rng.randint(30, 120)
        x, y = rng.randint(0, w), rng.randint(0, h - 80)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, rng.randint(14, 34)))
    draw.rectangle((0, h - 64, w, h), fill=(0, 0, 0, 120))
    draw.text((24, h - 50), label, fill=(255, 255, 255, 235), font=ImageFont.load_default(size=26))
    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


class Command(BaseCommand):
    help = "Seed realistic demo data (departments, officers, citizens and ~90 days of issues with real lifecycles)."

    def add_arguments(self, parser):
        parser.add_argument("--count", type=int, default=160, help="number of issues to create (default 160)")
        parser.add_argument("--seed", type=int, default=2026, help="random seed, for reproducible data")
        parser.add_argument(
            "--password",
            help="password for every demo account. Required outside DEBUG: the default is public (it is in the repo), "
            "so it must never protect accounts on a deployed site.",
        )

    @transaction.atomic  # all or nothing: a failure leaves no half-seeded data behind
    def handle(self, *args, count, seed, password=None, **options):
        from django.conf import settings

        if password is None and not settings.DEBUG:
            raise CommandError("Pass --password: the built-in demo password is public and cannot be used on a deployed database.")
        self.password = password or PASSWORD
        if Issue.objects.filter(reporter__email__endswith=f"@{DOMAIN}").exists():
            self.stdout.write("Demo data already present: nothing to do.")
            return
        rng = random.Random(seed)
        now = timezone.now()

        categories = {c.name: c for c in IssueCategory.objects.all()}
        if set(CATEGORY_DEPARTMENT) - set(categories):
            self.stderr.write("Missing seeded categories; run `migrate` first.")
            return

        admin = self._user(f"admin@{DOMAIN}", "Anita Deshpande", role=User.Role.ADMIN, is_staff=True)
        officers = {}  # department name -> [OfficerProfile]
        for name, (description, people) in DEPARTMENTS.items():
            # reuse a department that already exists (case-insensitively) instead of colliding with it
            department = Department.objects.filter(name__iexact=name, city__iexact="Indore").first() or Department.objects.create(
                name=name, city="Indore", description=description
            )
            officers[name] = []
            for person, ref in people:
                email = f"{person.split()[0].lower()}.{person.split()[1].lower()}@{DOMAIN}"
                existing = OfficerProfile.objects.filter(user__email=email).first()
                officers[name].append(
                    existing
                    or dept_services.create_officer(
                        email=email, full_name=person, password=self.password, department=department, employee_reference=ref
                    )
                )
        citizens = [
            self._user(f"{n.split()[0].lower()}.{n.split()[1].lower()}@{DOMAIN}", n, city="Indore", state="Madhya Pradesh")
            for n in CITIZENS
        ]

        photos = {name: default_storage.save(f"issues/seed/{name.lower().replace(' ', '-')}.png", ContentFile(_png(HEX[name], name))) for name in HEX}
        done_photo = default_storage.save("issues/seed/resolved.png", ContentFile(_png("#16a34a", "Resolved", resolved=True)))

        created = 0
        for _ in range(count):
            created += self._one_issue(rng, now, admin, officers, citizens, categories, photos, done_photo)

        self._social(rng, now, citizens)
        self.stdout.write(self.style.SUCCESS(f"Seeded {created} issues, {len(citizens)} citizens, {sum(len(v) for v in officers.values())} officers."))
        self.stdout.write(f"Logins (password for all: {'the one you passed' if password else PASSWORD})")
        self.stdout.write(f"  admin   : admin@{DOMAIN}")
        for name, people in officers.items():
            self.stdout.write(f"  officer : {people[0].user.email}  ({name})")
        self.stdout.write(f"  citizen : {citizens[0].email}")

    def _user(self, email, full_name, **extra):
        return User.objects.filter(email=email).first() or User.objects.create_user(email, self.password, full_name=full_name, **extra)

    # ------------------------------------------------------------------------------------------

    def _one_issue(self, rng, now, admin, officers, citizens, categories, photos, done_photo):
        days_ago = 90 * (rng.random() ** 1.6)  # more recent issues than old ones
        t0 = now - timedelta(days=days_ago, hours=rng.uniform(0, 14))
        if t0 > now - timedelta(minutes=30):
            t0 = now - timedelta(hours=rng.uniform(1, 6))
        place, lat, lng = rng.choice(PLACES)
        category = categories[rng.choice(list(TEMPLATES))]
        department = CATEGORY_DEPARTMENT[category.name]
        weights = _outcome_weights(days_ago)
        outcome = rng.choices(list(weights), weights=list(weights.values()))[0]
        priority = rng.choices(["low", "medium", "high", "critical"], weights=[25, 45, 22, 8])[0]
        reporter = rng.choice(citizens)

        issue = issue_services.create_issue(
            reporter=reporter,
            category=category,
            title=rng.choice(TEMPLATES[category.name]).format(p=place),
            description=f"{rng.choice(DETAILS)} Location: {place}, Indore.",
            latitude=round(lat + rng.uniform(-0.004, 0.004), 6),
            longitude=round(lng + rng.uniform(-0.004, 0.004), 6),
            address=f"{place}, Indore",
            landmark=rng.choice(["", "", "Main square", "City bus stop", "Petrol pump", "Community hall"]),
        )
        IssueImage.objects.create(issue=issue, image=photos[category.name], image_type=IssueImage.ImageType.REPORT)

        # Walk the real workflow, remembering which transitions happened.
        steps = []  # (kind, hours after the previous step)
        officer = None
        if outcome == "rejected":
            issue_services.reject_issue(issue_id=issue.pk, admin=admin, reason=rng.choice(REJECT_REASONS))
            steps.append(("reject", rng.uniform(2, 30)))
        elif outcome != "pending":
            issue_services.approve_issue(issue_id=issue.pk, admin=admin)
            steps.append(("approve", rng.uniform(1, 28)))
            if outcome != "under_review":
                officer = rng.choice(officers[department])
                dept_services.assign_issue(issue_id=issue.pk, department=officer.department, officer=officer, assigned_by=admin)
                steps.append(("assign", rng.uniform(1, 24)))
                if outcome != "assigned":
                    dept_services.accept_assignment(issue_id=issue.pk, actor=officer.user)
                    steps.append(("accept", rng.uniform(1, 18)))
                    if outcome in ("resolved", "reopened"):
                        IssueImage.objects.create(issue=issue, image=done_photo, image_type=IssueImage.ImageType.RESOLUTION)
                        dept_services.resolve_issue(issue_id=issue.pk, actor=officer.user, remarks=rng.choice(RESOLVE_NOTES))
                        speed = {"critical": 0.35, "high": 0.7, "medium": 1.0, "low": 1.6}[priority]
                        steps.append(("resolve", rng.uniform(5, 24 * 6) * speed))
                        if outcome == "reopened":
                            issue_services.reopen_issue(issue_id=issue.pk, admin=admin, reason=rng.choice(REOPEN_REASONS))
                            steps.append(("reopen", rng.uniform(24, 96)))
        self._backdate(issue, t0, now, steps, priority)

        if officer and outcome in ("in_progress", "resolved", "reopened"):
            for text in rng.sample(NOTE_TEXTS, k=rng.randint(1, 2)):
                note = DepartmentNote.objects.create(issue=issue, officer=officer, note=text)
                DepartmentNote.objects.filter(pk=note.pk).update(created_at=min(now, t0 + timedelta(hours=rng.uniform(20, 90))))
        return 1

    def _backdate(self, issue, t0, now, steps, priority):
        """Spread the real rows over time: creation, history, assignment and resolution timestamps."""
        offsets, running = [], 0.0
        for _, hours in steps:
            running += hours
            offsets.append(running)
        limit = (now - t0).total_seconds() / 3600 - 0.05
        if offsets and offsets[-1] > limit:  # keep everything in the past by scaling the offsets down
            factor = max(limit, 0.2) / offsets[-1]
            offsets = [o * factor for o in offsets]
        times = [t0 + timedelta(hours=o) for o in offsets]

        history = list(IssueStatusHistory.objects.filter(issue=issue).order_by("created_at"))
        stamps = [t0] + times
        for row, when in zip(history, stamps, strict=False):
            IssueStatusHistory.objects.filter(pk=row.pk).update(created_at=when)
        # assign step makes two rows when the issue was REOPENED first; seeding never does that, so 1:1 holds.

        kinds = [k for k, _ in steps]
        fields = {"created_at": t0, "priority": priority}
        if "resolve" in kinds and "reopen" not in kinds:
            fields["resolved_at"] = times[kinds.index("resolve")]
        Issue.objects.filter(pk=issue.pk).update(**fields)
        assignment = IssueAssignment.objects.filter(issue=issue).first()
        if assignment and "assign" in kinds:
            changes = {"assigned_at": times[kinds.index("assign")]}
            if "accept" in kinds:
                changes["accepted_at"] = times[kinds.index("accept")]
            IssueAssignment.objects.filter(pk=assignment.pk).update(**changes)

    def _social(self, rng, now, citizens):
        """Votes, comments, a few flagged items: the moderation queue needs something to show."""
        public = list(Issue.objects.filter(moderation_status=Issue.ModerationStatus.APPROVED))
        for issue in public:
            for voter in rng.sample(citizens, k=min(len(citizens), int(rng.expovariate(1 / 4)))):
                IssueVote.objects.get_or_create(issue=issue, user=voter)
            for _ in range(rng.choices([0, 1, 2, 3], weights=[55, 25, 14, 6])[0]):
                comment = IssueComment.objects.create(issue=issue, user=rng.choice(citizens), content=rng.choice(COMMENT_TEXTS))
                IssueComment.objects.filter(pk=comment.pk).update(created_at=min(now, issue.created_at + timedelta(hours=rng.uniform(3, 120))))
        for issue in rng.sample(public, k=min(6, len(public))):
            for reporter in rng.sample(citizens, k=rng.randint(1, 3)):
                ContentReport.objects.get_or_create(
                    reporter=reporter, issue=issue, defaults={"reason": rng.choice(["spam", "misleading", "inappropriate", "other"])}
                )
        comments = list(IssueComment.objects.all())
        for comment in rng.sample(comments, k=min(2, len(comments))):
            IssueComment.objects.filter(pk=comment.pk).update(is_hidden=True)
