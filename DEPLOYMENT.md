# Deploying CivicFix

Stack: **Cloudflare Pages** (React app) → **Render** free web service (Django API, Docker) → **Supabase** (Postgres + PostGIS, and Storage for photos). All free tiers; AI inference stays off in production (it cannot run in 0.1 vCPU / 512 MB, and the app works without it).

Everything in this repo that can be prepared and tested without your accounts is done and tested; the steps below are the ones that need **you** to create accounts/projects and paste secrets. After step 6 the same smoke test that already passes against a local production simulation runs against your real URLs.

| Piece | Where it is defined | Verified without accounts? |
| --- | --- | --- |
| Production settings (fail-fast on unsafe values) | `backend/config/settings/production.py` | yes: `backend/config/tests/` + `manage.py check --deploy` |
| Photos in S3-compatible storage | `backend/config/storage.py`, `sync_media_to_storage` | yes: fake S3 (moto) + a real gunicorn/`start.sh` run |
| PostGIS check, RLS lock-down, static files, migrate | `backend/scripts/start.sh` | yes: ran against local PostGIS |
| Render service | `render.yaml`, `backend/Dockerfile`, `backend/.dockerignore` | config validated; **first real deploy is yours** |
| Keep-alive | `.github/workflows/keepalive.yml` | pipeline logic tested locally; **first scheduled run is yours** |
| Frontend on Pages | `frontend/public/_headers`, `.node-version`, `.env.production.example` | build tested; **first real deploy is yours** |
| Smoke test of the deployed stack | `frontend/e2e/smoke.mjs` | passes (15 checks) on a local production simulation |

## 1. Supabase (database + photo storage)

1. **New project** (free). Pick the region nearest your users (for Indore: Mumbai `ap-south-1`) and **write down the database password**. Note the *project ref* (the `abcdefgh` in `abcdefgh.supabase.co`).
2. **PostGIS.** Dashboard → *Database → Extensions* → enable `postgis`. Or in the SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
   SELECT PostGIS_Version();
   ```
   (The API's boot also runs `manage.py ensure_postgis`, which creates it if your role may and prints the version either way. If the extension was never enabled and your role cannot create it, the deploy stops there with this exact instruction. That is the "PostGIS is not guaranteed" risk from the architecture plan, checked on every boot.)
3. **Connection string** → *Connect* → **Session pooler** (port 5432, user `postgres.<ref>`). Use this, not the "Direct connection": Render's free tier is IPv4-only and Supabase's direct host is IPv6-only. Append `?sslmode=require`:
   `DATABASE_URL=postgis://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`
   (Note the scheme: `postgis://`, not `postgresql://`. URL-encode special characters in the password.)
   If you prefer *Transaction mode* (port 6543), also set `DATABASE_TRANSACTION_POOLER=true`.
4. **Storage** → New bucket `issue-photos`, **public**. Then *Storage → S3 connection*: copy the **endpoint** and **region**, and create an **access key** (keep the secret: it is shown once).
   - `MEDIA_S3_ENDPOINT_URL=https://<ref>.storage.supabase.co/storage/v1/s3`
   - `MEDIA_PUBLIC_BASE_URL=https://<ref>.supabase.co/storage/v1/object/public/issue-photos`
5. **Security.** Nothing to click: every boot runs `manage.py lockdown_public_schema`, which turns on row-level security for every table and revokes the `anon`/`authenticated` roles, so Supabase's auto-generated REST API (which anyone with your public anon key can call) sees none of Django's tables. You may additionally disable the Data API in *Project settings → API*.

   Trade-off to know: a *public* bucket serves any photo whose URL is known. File names are random UUIDs (unguessable) and a photo only appears in the API for people allowed to see the issue, but a pending or rejected issue's photo is not secret from someone who has its URL. If that matters, switch to a private bucket and signed URLs (`querystring_auth` in `config/storage.py`).

## 2. GitHub

Create a repository and push (Render and Cloudflare Pages both deploy from it). Then *Settings → Secrets and variables → Actions*:

- Variable `API_BASE_URL` = your Render URL (after step 3), e.g. `https://civicfix-api.onrender.com`
- Optional secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` (extra direct ping)

**Keep-alive** (`keepalive.yml`, every 2 days, also runnable by hand from the Actions tab): it calls `GET /api/v1/health/?db=1`, which wakes the Render instance and makes a real Postgres round-trip, so Supabase never sees 7 days of inactivity and Render never stays asleep long. The job fails (and GitHub emails you) if the database does not answer. GitHub disables scheduled workflows after 60 days without repository activity; push something occasionally.

## 3. Render (API)

*New → Blueprint* → select the repo; it reads `render.yaml`. Fill in the variables it asks for:

| Variable | Value | Notes |
| --- | --- | --- |
| `DJANGO_SETTINGS_MODULE` | `config.settings.production` | preset |
| `AI_INFERENCE` | `disabled` | preset; production.py pins it anyway |
| `DJANGO_SECRET_KEY` | (generated) | never reuse the dev key |
| `DJANGO_ALLOWED_HOSTS` | `civicfix-api.onrender.com` | exact hostname; `*` is refused. Render's own hostname is also added automatically |
| `CORS_ALLOWED_ORIGINS` | `https://<your-app>.pages.dev` | https, no path, no trailing slash. Add a custom domain here too if you use one. Several allowed, comma-separated |
| `DATABASE_URL` | from step 1.3 | |
| `MEDIA_S3_ENDPOINT_URL`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | from step 1.4 | |
| `MEDIA_S3_BUCKET` | `issue-photos` | preset |
| `MEDIA_PUBLIC_BASE_URL` | from step 1.4 | |
| `WEB_CONCURRENCY` | `1` | preset: one worker + threads, so in-memory rate-limit counters stay consistent |
| `TRUSTED_PROXY_COUNT` | `1` (default) | see "Client IP" below |

The app refuses to start, with a message naming the variable, if any required value is missing or unsafe (short secret, `*` host, http origin, missing storage keys).

**What a boot does** (`backend/scripts/start.sh`; the free tier has no pre-deploy hook): `ensure_postgis` → `migrate` → `lockdown_public_schema` → `collectstatic` (whitenoise then serves `/static/`) → gunicorn. A cold start takes about a minute.

**Check it:** `curl https://civicfix-api.onrender.com/api/v1/health/?db=1` → `{"status": "ok", "database": "ok"}`.

**Client IP.** Rate limits are per client IP, so the app must know the real one behind Render's proxy. `TRUSTED_PROXY_COUNT=1` trusts the last `X-Forwarded-For` entry. If you later find all visitors share one limit (many users get `429` at once), the platform adds more hops than that; raise the number by one. If it is too high, a client could spoof its address to dodge limits.

### First data

From your machine, with a file `backend/.env.render` (gitignored) holding the same variables as Render:

```bash
cd backend
docker compose build web          # once, so the image has the current code
# an administrator (role "admin"; the console and moderation need one):
docker run --rm -it --env-file .env.render backend-web python manage.py createsuperuser
# optional demo data (~160 issues, 90 days of history, photos uploaded to the bucket):
docker run --rm --env-file .env.render backend-web python manage.py seed_demo --password '<a strong password>'
```

`seed_demo` **refuses to run without `--password` outside DEBUG**: its built-in password is in the repository, so it must never protect accounts on a live site. Its admin is `admin@demo.civicfix.test`. If you already have a database whose photo rows point at local files, `python manage.py sync_media_to_storage --dry-run` (then without `--dry-run`) copies the missing files into the bucket; it never overwrites or deletes.

## 4. Cloudflare Pages (frontend)

*Workers & Pages → Create → Pages → Connect to Git* → the repo, then:

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| `NODE_VERSION` | `22` (also pinned by `frontend/.node-version`) |
| `VITE_API_URL` (Production) | `https://civicfix-api.onrender.com/api/v1` |

`VITE_API_URL` is baked in at **build** time: changing it needs a new deployment. Single-page-app routing works without extra files (Pages serves `index.html` for unknown paths when there is no `404.html`); `public/_headers` adds security headers and long caching for hashed assets. Then put the resulting `https://<name>.pages.dev` into Render's `CORS_ALLOWED_ORIGINS` and redeploy the API.

**Map tiles** come from OpenFreeMap (`tiles.openfreemap.org`): no key, `access-control-allow-origin: *`, no referrer allow-list, so any production domain works. The smoke test confirms it from your real origin.

## 5. Security checklist (what is enforced, where)

- **CORS**: only `CORS_ALLOWED_ORIGINS` (https only, exact origins). Smoke test checks an unknown origin gets nothing.
- **Hosts**: `DJANGO_ALLOWED_HOSTS` exact; no wildcard.
- **HTTPS**: `SECURE_SSL_REDIRECT`, HSTS (1 year), secure cookies, `SECURE_PROXY_SSL_HEADER`; `/api/v1/health/` is exempt so Render's HTTP health check works. The smoke test checks the redirect and the HSTS header **on the real HTTPS URL**. `manage.py check --deploy` is clean except `W005`/`W021` (HSTS include-subdomains/preload: not ours to set on a shared `*.onrender.com` host).
- **Secrets**: only in Render/Cloudflare/GitHub settings; `.env*` files are gitignored and excluded from the Docker build.
- **Database**: TLS required (`sslmode=require`); row-level security on every table.
- **Rate limits** (per user, or per IP when anonymous; in-memory, so they reset on restart or sleep): report creation 10/h, comments 30/h, photo uploads 30/h, content reports 20/h, AI classify 60/h, AI duplicates 120/h, AI priority 120/h, and **login 10/min, registration 10/h, token refresh 120/h** (the last three were added in this phase; auth had no limits before).

## 6. Smoke-test the real deployment

```bash
cd frontend
E2E_APP_URL=https://<your-app>.pages.dev \
E2E_API_URL=https://civicfix-api.onrender.com/api/v1 \
E2E_ADMIN_EMAIL=<your admin> E2E_ADMIN_PASSWORD=<its password> \
npm run smoke
```

It checks health and DB, anonymous access denied, no debug pages, HTTP→HTTPS and HSTS, whitenoise static files, CORS allowed/denied, the SPA fallback and that the build points at your API, then drives the UI: register a citizen, report an issue with a photo (must be served from storage, https, long cache), AI endpoints in "no models" mode, admin sign-in and AI panel, create a department and officer and assign, officer accepts, and the map painting from OpenFreeMap on your origin. It leaves clearly named `SMOKE` records behind. The first call may take about a minute while a sleeping Render instance wakes.

The older suites also accept production URLs (`E2E_APP_URL`, `E2E_API_URL`): `npm run e2e` (citizen + map), `npm run e2e:staff`, `npm run e2e:ai` (with `E2E_AI=off`). They create more demo data than the smoke test, so use them sparingly on a live site. Login is limited to 10 per minute per IP, so do not chain suites back to back from one machine: wait a minute between them (a `429 ... Expected available in N seconds` is that limit, not a bug).

## Known limits of the free tiers

- Render sleeps after 15 minutes idle; the first request then takes ~1 minute (the keep-alive job reduces how often a visitor hits that, it cannot remove it).
- Free Postgres is 500 MB and storage 1 GB: fine for a demo, not for sustained real traffic.
- Rate-limit counters are in memory: a restart clears them.
- AI suggestions are off in production by design (see the architecture plan); run the models locally with `AI_INFERENCE=local` for development and demos.
