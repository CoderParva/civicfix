// Deployment smoke test: does the DEPLOYED stack work end to end? Point it at any pair of URLs.
//
//   E2E_APP_URL=https://civicfix.pages.dev E2E_API_URL=https://civicfix-api.onrender.com/api/v1 \
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run smoke
//
// It checks what only a real deployment can get wrong (HTTPS and HSTS, CORS between the two origins, static
// files, photos landing in object storage and loading from there, the SPA fallback, map tiles from this origin,
// AI being off in production), then drives a short citizen -> admin -> officer journey through the real UI.
// It writes a handful of clearly named "SMOKE" records (a citizen, an issue, a department and an officer) and
// leaves them in place: there is no delete API, and they are harmless.
//
// Modes (auto-detected from the app URL; override with SMOKE_MODE=local|production):
//   production  strict: HTTPS must redirect, HSTS present, photos served from a storage host (not the API)
//   local       for validating this script against a dev stack or a local production simulation
// SMOKE_EXPECT_AI=off|on says whether the backend should have the AI models (default: off in production).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { chromium } from 'playwright-core'

const APP = (process.env.E2E_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const API = (process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = process.env.E2E_SHOTS_DIR
const MODE = process.env.SMOKE_MODE ?? (APP.startsWith('https://') ? 'production' : 'local')
const PROD = MODE === 'production'
// Whether Django's DEBUG pages must be off (always true on a real deployment; a dev stack legitimately has them).
const DEBUG_OFF = process.env.SMOKE_DEBUG_OFF ? process.env.SMOKE_DEBUG_OFF === '1' : PROD
const EXPECT_AI = process.env.SMOKE_EXPECT_AI ?? (PROD ? 'off' : 'on')
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
if (!ADMIN.email || !ADMIN.password) {
  console.error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (an admin account on the deployed backend).')
  process.exit(2)
}

const API_ORIGIN = new URL(API).origin
const stamp = Date.now()
const citizen = { email: `smoke.citizen.${stamp}@example.com`, password: 'Quartz-Meadow-91-Lantern!', full_name: 'Smoke Citizen' }
const officer = { email: `smoke.officer.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!', full_name: 'Smoke Officer', employee_reference: `SMK-${stamp}` }
const DEPT = 'SMOKE Test Dept'
const title = `SMOKE pothole near the old bridge ${stamp}`
const LAT = (22.5 + (stamp % 100) * 0.004).toFixed(6) // a spot of its own, so no earlier smoke run is "nearby"
const LNG = (75.5 + (Math.floor(stamp / 100) % 100) * 0.004).toFixed(6)

function makePng(width = 96, height = 64) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, (_, x) => [60 + x, 90, 120]).flat())])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const photo = makePng()

/** fetch with a long first-byte allowance: a sleeping Render free instance needs about a minute to wake up. */
async function http(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(150_000), redirect: 'manual', ...options })
  return res
}
async function api(method, route, { token, body } = {}) {
  const res = await http(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text.slice(0, 300)}`)
  return data
}
const login = (creds) => api('POST', '/auth/login/', { body: { email: creds.email, password: creds.password } }).then((r) => r.access)

const results = []
async function step(name, fn) {
  try {
    await fn()
    results.push([name, true])
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push([name, false])
    console.log(`  ✗ ${name}\n      ${String(error.message ?? error).split('\n').join('\n      ')}`)
    throw error
  }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const VIEWPORT = { width: 1280, height: 900 }
const mk = async (label) => {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
  page.setDefaultTimeout(60_000)
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[${label}] ${m.text()} <${m.location().url}>`))
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] ${String(e)}`))
  page.on('requestfailed', (r) => failedRequests.push(`[${label}] ${r.url()} (${r.failure()?.errorText})`))
  page.on('response', (r) => allResponses.push([r.url(), r.status()]))
  return page
}
const consoleErrors = []
const failedRequests = []
const allResponses = []
const citizenPage = await mk('citizen')
const adminPage = await mk('admin')
const officerPage = await mk('officer')
const anonPage = await mk('anonymous')
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, `smoke-${name}.png`), fullPage: true })

async function signIn(page, creds, landing) {
  await page.goto(`${APP}/login`)
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((u) => u.pathname === landing, { timeout: 60_000 })
}

let issueId
let adminToken
let department

try {
  console.log(`Deployment smoke (${MODE}) against\n  app ${APP}\n  api ${API}\n`)

  // ---------------------------------------------------------------- the deployed backend itself
  await step('API is up and reaches its database (the first call may wake a sleeping instance)', async () => {
    const res = await http(`${API}/health/?db=1`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'ok', database: 'ok' })
  })

  await step('API rejects anonymous access to protected data and exposes no debug page', async () => {
    assert.equal((await http(`${API}/officer/issues/`)).status, 401)
    assert.equal((await http(`${API}/admin/issues/`)).status, 401)
    const missing = await http(`${API}/definitely-not-a-route/`)
    assert.equal(missing.status, 404)
    if (DEBUG_OFF) assert.doesNotMatch(await missing.text(), /DEBUG = True|Using the URLconf/i, 'DEBUG pages must be off')
  })

  if (PROD) {
    await step('HTTPS: plain http is redirected to https, and HSTS is sent', async () => {
      const insecure = await http(API_ORIGIN.replace('https://', 'http://') + new URL(API).pathname + '/categories/')
      assert.ok([301, 302, 307, 308].includes(insecure.status), `http:// answered ${insecure.status}, expected a redirect`)
      assert.match(insecure.headers.get('location') ?? '', /^https:\/\//)
      const secure = await http(`${API}/categories/`)
      assert.match(secure.headers.get('strict-transport-security') ?? '', /max-age=\d{6,}/)
      assert.equal(secure.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(secure.headers.get('x-frame-options'), 'DENY')
    })
  }

  await step('static files are served by the API container (whitenoise in production: admin CSS)', async () => {
    const css = await http(`${API_ORIGIN}/static/admin/css/base.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /css/)
  })

  await step('CORS: the frontend origin is allowed to call the API, any other origin is not', async () => {
    const preflight = (origin) =>
      http(`${API}/auth/login/`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
      })
    const appOrigin = new URL(APP).origin
    assert.equal((await preflight(appOrigin)).headers.get('access-control-allow-origin'), appOrigin)
    assert.equal((await preflight('https://evil.example')).headers.get('access-control-allow-origin'), null)
  })

  // ---------------------------------------------------------------- the deployed frontend
  await step('frontend is served, a deep link works (SPA fallback), and the build points at this API', async () => {
    const root = await http(`${APP}/`)
    assert.equal(root.status, 200)
    const html = await root.text()
    assert.match(html, /id="root"/)
    const deep = await http(`${APP}/explore`)
    assert.equal(deep.status, 200, 'a deep link must serve the app, not a 404')
    assert.match(await deep.text(), /id="root"/)
    if (PROD) assert.equal(root.headers.get('x-content-type-options'), 'nosniff', 'the _headers file was not applied')
    // The built app must carry the production API address, not the localhost default. The address lives in a
    // shared chunk, so look at the entry script, everything index.html preloads, and the entry's static imports.
    const entry = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
    if (entry) {
      const files = new Set([entry, ...[...html.matchAll(/href="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])])
      const entryText = await (await http(`${APP}${entry}`)).text()
      for (const m of entryText.matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)) files.add(`/assets/${m[1]}`)
      const texts = await Promise.all([...files].map(async (f) => (await http(`${APP}${f}`)).text()))
      assert.ok(texts.some((js) => js.includes(API)), `no built script contains ${API}: VITE_API_URL was not set at build time`)
      if (PROD) assert.ok(!texts.some((js) => js.includes('localhost:8000')), 'the production bundle still points at localhost')
    }
  })

  // ---------------------------------------------------------------- citizen, through the real UI
  await step('a new citizen registers in the browser and lands on the dashboard (browser -> CORS -> API -> DB)', async () => {
    await citizenPage.goto(`${APP}/register`)
    await citizenPage.getByLabel('Full name').fill(citizen.full_name)
    await citizenPage.getByLabel('Email').fill(citizen.email)
    await citizenPage.getByLabel('Password', { exact: true }).fill(citizen.password)
    await citizenPage.getByLabel('Confirm password').fill(citizen.password)
    await citizenPage.getByRole('button', { name: /create account|register|sign up/i }).click()
    await citizenPage.waitForURL((u) => u.pathname === '/dashboard', { timeout: 60_000 })
  })

  await step('the citizen reports an issue with a photo (it must be stored in object storage)', async () => {
    await citizenPage.goto(`${APP}/report`)
    await citizenPage.getByRole('form', { name: 'Report an issue' }).waitFor()
    await citizenPage.getByLabel('Title').fill(title)
    await citizenPage.getByLabel('Description').fill('Smoke test report: a deep pothole near the old bridge, two-wheelers swerve around it.')
    await citizenPage.getByLabel('Category').selectOption({ label: 'Pothole' })
    await citizenPage.getByLabel('Latitude').fill(LAT)
    await citizenPage.getByLabel('Longitude').fill(LNG)
    await citizenPage.getByLabel('Upload photos').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: photo })
    await citizenPage.getByAltText('Preview of smoke.png').waitFor()
    await citizenPage.getByRole('button', { name: 'Submit report' }).click()
    const warning = citizenPage.getByRole('dialog', { name: /already reported/i })
    const landed = citizenPage.getByRole('heading', { name: 'My reports' })
    if ((await Promise.any([warning.waitFor().then(() => 'warned'), landed.waitFor().then(() => 'sent')])) === 'warned') {
      await warning.getByRole('button', { name: 'Submit anyway' }).click()
    }
    await landed.waitFor()
    await shot(citizenPage, '01-my-reports')
  })

  await step('the photo is served from storage (not the API container) and actually loads, with long-lived caching', async () => {
    const mine = (await api('GET', '/issues/?mine=true', { token: await login(citizen) })).results
    assert.equal(mine.length, 1)
    issueId = mine[0].id
    const url = mine[0].images[0]?.url
    assert.ok(url, 'the issue has no photo URL')
    console.log(`      (photo url: ${url})`)
    if (PROD) {
      assert.ok(url.startsWith('https://'), 'photo URL must be https')
      assert.notEqual(new URL(url).origin, API_ORIGIN, 'photos must come from object storage, not the API container')
    }
    const res = await http(url, { redirect: 'follow' })
    assert.equal(res.status, 200, `GET ${url} -> ${res.status} (is the storage bucket public?)`)
    assert.match(res.headers.get('content-type') ?? '', /^image\//)
    if (PROD) assert.match(res.headers.get('cache-control') ?? '', /max-age=\d{6,}/)
    // and the browser renders it in the UI
    const img = citizenPage.locator('img').first()
    await img.waitFor()
    await citizenPage.waitForFunction(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0))
  })

  await step(`AI helpers behave as deployed (${EXPECT_AI === 'off' ? 'no models: "unavailable", rules still work' : 'models on'})`, async () => {
    const token = await login(citizen)
    const form = new FormData()
    form.append('image', new Blob([photo], { type: 'image/png' }), 'smoke.png')
    const classify = await (await http(`${API}/ai/classify/`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })).json()
    if (EXPECT_AI === 'off') {
      assert.equal(classify.status, 'unavailable')
      assert.deepEqual(classify.suggestions, [])
    } else {
      assert.ok(['ok', 'uncertain'].includes(classify.status))
    }
    const categories = await api('GET', '/categories/')
    const priority = await api('POST', '/ai/priority/', { token, body: { category: categories[0].id, title: 'Open manhole near school', description: 'A child fell in, dangerous' } })
    assert.equal(priority.method, 'rules')
    assert.ok(['high', 'critical'].includes(priority.priority))
    const dup = await api('POST', '/ai/duplicates/', { token, body: { latitude: Number(LAT), longitude: Number(LNG), title, description: 'x' } })
    assert.ok(['none', 'lexical', 'semantic'].includes(dup.method))
  })

  // ---------------------------------------------------------------- staff
  await step('admin signs in through the UI and sees real platform totals; the new report is waiting for review', async () => {
    adminToken = await login(ADMIN)
    await signIn(adminPage, ADMIN, '/admin')
    await adminPage.getByTestId('tile-total').waitFor()
    await adminPage.waitForFunction(() => Number(document.querySelector('[data-testid="tile-total"] p')?.textContent?.trim()) > 0)
    const analysis = await api('GET', `/ai/analysis/${issueId}/`, { token: adminToken })
    assert.equal(analysis.result.priority.method, 'rules', 'the priority recommendation was recorded on create')
    assert.equal(analysis.processing_status, EXPECT_AI === 'off' ? 'partial' : 'completed')
    await shot(adminPage, '02-admin-overview')
  })

  await step('admin approves the report, creates a department and an officer, and assigns it', async () => {
    await api('POST', `/admin/issues/${issueId}/approve/`, { token: adminToken })
    const existing = (await api('GET', '/admin/departments/', { token: adminToken })).results
    department = existing.find((d) => d.name === DEPT && d.is_active) ?? (await api('POST', '/admin/departments/', { token: adminToken, body: { name: DEPT, city: 'Indore' } }))
    await api('POST', '/admin/officers/', { token: adminToken, body: { ...officer, department: department.id } })
    const refreshed = (await api('GET', '/admin/departments/', { token: adminToken })).results.find((d) => d.id === department.id)
    const profile = refreshed.officers.find((o) => o.employee_reference === officer.employee_reference)
    assert.ok(profile, 'the new officer is listed under the department')
    await api('POST', `/admin/issues/${issueId}/assign/`, { token: adminToken, body: { department: department.id, officer: profile.id } })
  })

  await step('the admin issue page shows the AI analysis panel with the stored recommendation', async () => {
    await adminPage.goto(`${APP}/admin/issues/${issueId}`)
    const panel = adminPage.getByRole('region', { name: 'AI analysis' })
    await panel.waitFor()
    assert.ok(await panel.getByRole('list', { name: 'Why this priority' }).count())
    if (EXPECT_AI === 'off') await panel.getByText(/image model was not available/).waitFor()
    await shot(adminPage, '03-admin-issue')
  })

  await step('the officer signs in through the UI, sees the assigned issue in the queue, and accepts it', async () => {
    await signIn(officerPage, officer, '/officer')
    await officerPage.goto(`${APP}/officer/issues`)
    await officerPage.getByRole('link', { name: title }).click()
    await officerPage.getByRole('heading', { name: title }).waitFor()
    await officerPage.getByRole('button', { name: /accept/i }).first().click()
    await officerPage.getByText('In progress').first().waitFor()
    await shot(officerPage, '04-officer-accepted')
  })

  // ---------------------------------------------------------------- map, from this origin
  await step('Explore: an anonymous visitor on THIS origin gets map tiles from OpenFreeMap (CORS ok), none from openstreetmap.org', async () => {
    await anonPage.goto(`${APP}/explore?view=map`)
    const region = anonPage.getByRole('region', { name: /map/i }).first()
    await region.waitFor({ timeout: 60_000 })
    await anonPage.locator('canvas.maplibregl-canvas').first().waitFor({ timeout: 60_000 })
    const started = Date.now()
    let bytes = 0
    while (Date.now() - started < 45_000) {
      bytes = (await region.screenshot()).length
      if (bytes > 25_000) break
      await anonPage.waitForTimeout(1000)
    }
    assert.ok(bytes > 25_000, `the map is still blank after 45 s (${bytes} bytes)`)
    const tiles = allResponses.filter(([u]) => u.includes('tiles.openfreemap.org'))
    assert.ok(tiles.length > 0, 'no request reached tiles.openfreemap.org')
    assert.ok(tiles.every(([, status]) => status < 400), `some tile requests failed: ${JSON.stringify(tiles.filter(([, s]) => s >= 400))}`)
    assert.ok(!allResponses.some(([u]) => u.includes('tile.openstreetmap.org')), 'raw OSM tiles must not be used')
    console.log(`      (map painted: ${bytes} bytes; ${tiles.length} tile/style responses, all OK)`)
    await shot(anonPage, '05-explore-map')
  })

  await step('no unexpected browser console errors or failed requests during the whole run', async () => {
    const unexpected = consoleErrors.filter((e) => !/404.*\/issues\/[0-9a-f-]+\/comments\/>/.test(e)) // by design for not-yet-public issues
    assert.deepEqual(unexpected, [])
    assert.deepEqual(
      failedRequests.filter((f) => !/net::ERR_ABORTED/.test(f)),
      [],
    )
  })

  console.log(`\nSMOKE PASSED (${results.length} checks, ${MODE})`)
} catch {
  console.log(`\nSMOKE FAILED after ${results.filter(([, ok]) => ok).length} passing checks`)
  if (consoleErrors.length) console.log('console errors:\n  ' + consoleErrors.join('\n  '))
  if (failedRequests.length) console.log('failed requests:\n  ' + failedRequests.join('\n  '))
  process.exitCode = 1
} finally {
  await browser.close()
}
