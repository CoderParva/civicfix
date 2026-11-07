// Real-browser end-to-end check of the citizen flow AND the map against the REAL backend (no mocks).
//
//   docker compose up        (in backend/)      -> API on :8000
//   npm run dev                                  -> app on :5173
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e
//
// It registers a brand-new citizen through the UI, reports an issue with a photo, then uses the
// API (as an admin and a freshly created officer) to move that issue along, and checks the
// dashboard follows. Then it opens Explore as an anonymous visitor, proves the map really draws
// from OpenFreeMap (and never from the raw OpenStreetMap tile server), exercises markers, clusters,
// popups, filters and the detail page, and finally reports an issue whose location is set from the
// map. Needs a department to exist already (the admin API can create one) and the seeded categories.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { chromium } from 'playwright-core'

const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173'
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = process.env.E2E_SHOTS_DIR
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
if (!ADMIN.email || !ADMIN.password) {
  console.error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (an existing super-admin account).')
  process.exit(2)
}

const stamp = Date.now()
const citizen = { name: 'E2E Citizen', email: `e2e.${stamp}@example.com`, password: 'Quartz-Meadow-91-Lantern!' }
const officerLogin = { email: `e2e.officer.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!' }
const issueTitle = `E2E pothole ${stamp}`
const mapTitles = ['A', 'B', 'C'].map((k) => `E2E map ${k} ${stamp}`)
const GPS = { latitude: 22.73, longitude: 75.88 }

// ---- helpers ---------------------------------------------------------------------------

/** A valid solid-colour PNG, built by hand so the script needs no image library. */
function makePng(width = 64, height = 48, [r, g, b] = [200, 60, 60]) {
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
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text}`)
  return data
}

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

// ---- browser ---------------------------------------------------------------------------

// MapLibre needs WebGL; headless Chrome gets it from SwiftShader (software GL).
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    // Only when testing a build served on a port the backend's CORS list does not include
    // (e.g. `vite preview --port 4173`). Affects this throwaway test browser only.
    ...(process.env.E2E_RELAX_CORS ? ['--disable-web-security'] : []),
  ],
})
const VIEWPORT = { width: 1100, height: 900 }
const allUrls = [] // every request from every page: used to prove which tile server is used
const consoleErrors = []
const track = (p, label) => {
  p.on('request', (r) => allUrls.push(r.url()))
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[${label}] ${m.text()}`))
  p.on('pageerror', (e) => consoleErrors.push(`[${label}] ${String(e)}`))
}

const context = await browser.newContext({ viewport: VIEWPORT, permissions: ['geolocation'], geolocation: GPS })
const page = await context.newPage()
track(page, 'citizen')
let refreshCalls = 0
page.on('request', (r) => r.url().endsWith('/auth/token/refresh/') && refreshCalls++)

const anon = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
track(anon, 'anonymous')

const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
const stat = async (key) => Number(await page.getByTestId(`stat-${key}`).locator('p').innerText())
const refreshToken = () => page.evaluate(() => sessionStorage.getItem('civicfix.refresh'))
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const cards = (p) => p.getByTestId('issue-card')
/** Wait until the list shows exactly `n` cards (the list re-renders asynchronously after a filter). */
const expectCards = async (p, n) => {
  await p.waitForFunction((count) => document.querySelectorAll('[data-testid="issue-card"]').length === count, n, { timeout: 10000 })
}
const selectAndWait = async (p, label, option, paramRegex) => {
  const request = p.waitForRequest((r) => paramRegex.test(r.url()), { timeout: 10000 })
  await p.getByLabel(label).selectOption({ label: option })
  await request
}

/**
 * Wait until a map region is really painted (not just present): a blank map screenshot is a few KB
 * of flat colour, a drawn one is tens of KB or more. Software GL paints progressively, so poll.
 */
const waitPainted = async (region, label, minBytes = 25_000) => {
  const started = Date.now()
  let bytes = 0
  while (Date.now() - started < 30_000) {
    bytes = (await region.screenshot()).length
    if (bytes > minBytes) break
    await region.page().waitForTimeout(1000)
  }
  console.log(`      (${label} painted: ${bytes} bytes after ${((Date.now() - started) / 1000).toFixed(1)}s)`)
  assert.ok(bytes > minBytes, `${label} still blank after 30s (${bytes} bytes)`)
}

let categories = []

try {
  console.log(`E2E against ${APP} + ${API}\n`)

  // ================= part 1: the citizen flow (as before) =================

  await step('landing page shows the hero and both CTAs', async () => {
    await page.goto(APP)
    await page.getByRole('heading', { name: /fix your city/i }).waitFor()
    assert.ok(await page.getByRole('link', { name: 'Report an Issue' }).isVisible())
    assert.ok(await page.getByRole('link', { name: 'Login', exact: true }).first().isVisible())
    await shot(page, '01-landing')
  })

  await step('signed-out "Report an Issue" is bounced to /login (UX gate)', async () => {
    await page.getByRole('link', { name: 'Report an Issue' }).click()
    await page.getByRole('heading', { name: 'Log in' }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/login')
  })

  await step('register a new citizen through the form -> auto sign-in -> dashboard with zero stats', async () => {
    await page.getByRole('link', { name: 'Create an account' }).click()
    await page.getByLabel('Full name').fill(citizen.name)
    await page.getByLabel('Email').fill(citizen.email)
    await page.getByLabel('Password', { exact: true }).fill(citizen.password)
    await page.getByLabel('Confirm password').fill(citizen.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('heading', { name: `Hello, ${citizen.name}` }).waitFor()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [0, 0, 0, 0])
    assert.ok(await refreshToken(), 'refresh token should be stored for reload survival')
    await shot(page, '03-dashboard-empty')
  })

  await step('report an issue with a photo and manual coordinates', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Report an issue' }).click()
    await page.getByRole('form', { name: 'Report an issue' }).waitFor()
    await page.getByLabel('Title').fill(issueTitle)
    await page.getByLabel('Description').fill('Large pothole in the middle of the lane, two-wheelers are swerving to avoid it.')
    await page.getByLabel('Category').selectOption({ label: 'Pothole' })
    await page.getByLabel('Latitude').fill('22.7196')
    await page.getByLabel('Longitude').fill('75.8577')
    await page.getByLabel('Address (optional)').fill('MG Road, Indore')
    await page.getByLabel('Upload photos').setInputFiles({ name: 'pothole.png', mimeType: 'image/png', buffer: makePng() })
    await page.getByAltText('Preview of pothole.png').waitFor()
    await page.getByRole('button', { name: 'Submit report' }).click()
    await page.getByRole('heading', { name: 'My reports' }).waitFor()
    assert.match(await page.getByRole('alert').innerText(), /submitted/i)
  })

  await step('My reports shows the new issue with a Reported badge, the server-stored photo, and the review note', async () => {
    const card = cards(page).filter({ hasText: issueTitle })
    await card.waitFor()
    assert.ok(await card.getByText('Reported', { exact: true }).isVisible())
    assert.ok(await card.getByText('Awaiting review before it becomes public').isVisible())
    const img = card.locator('img')
    await img.waitFor()
    await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle())
    assert.match(await img.getAttribute('src'), /\/media\/issues\/.+\.png$/)
  })

  await step('dashboard tally now reads total 1 / pending 1 (counted client-side from /issues/?mine=true)', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [1, 1, 0, 0])
    await shot(page, '06-dashboard-1-pending')
  })

  await step('backend moves the issue forward (admin approve+assign to a NEW officer, officer accepts) and 3 map issues go public', async () => {
    const admin = (await api('POST', '/auth/login/', { body: ADMIN })).access
    const departments = (await api('GET', '/admin/departments/', { token: admin })).results
    let department = departments.find((d) => d.is_active)
    if (!department) {
      department = await api('POST', '/admin/departments/', { token: admin, body: { name: `E2E Dept ${stamp}`, city: 'Indore' } })
    }
    const officer = await api('POST', '/admin/officers/', {
      token: admin,
      body: { ...officerLogin, full_name: 'E2E Officer', department: department.id, employee_reference: `E2E-${stamp}` },
    })
    const pending = (await api('GET', '/admin/issues/?moderation_status=pending', { token: admin })).results
    const issue = pending.find((i) => i.title === issueTitle)
    assert.ok(issue, 'the issue reported through the UI should be visible to the admin')
    await api('POST', `/admin/issues/${issue.id}/approve/`, { token: admin })
    await api('POST', `/admin/issues/${issue.id}/assign/`, { token: admin, body: { department: department.id, officer: officer.id } })
    const officerToken = (await api('POST', '/auth/login/', { body: officerLogin })).access
    const accepted = await api('POST', `/officer/issues/${issue.id}/accept/`, { token: officerToken })
    assert.equal(accepted.status, 'in_progress')

    // Three issues ~35 m apart, in three different categories, approved: they must cluster on the map.
    categories = await api('GET', '/categories/')
    const citizenToken = (await api('POST', '/auth/login/', { body: { email: citizen.email, password: citizen.password } })).access
    for (const [i, title] of mapTitles.entries()) {
      const created = await api('POST', '/issues/', {
        token: citizenToken,
        body: {
          category: categories[i].id,
          title,
          description: `Map test issue ${title} in category ${categories[i].name}.`,
          latitude: 22.7255 + i * 0.0003,
          longitude: 75.8835 + i * 0.0003,
        },
      })
      await api('POST', `/admin/issues/${created.id}/approve/`, { token: admin })
    }
  })

  await step('page reload restores the session (refresh token); dashboard now shows 4 issues: 1 in progress, 3 pending', async () => {
    const before = await refreshToken()
    await page.reload()
    await page.getByRole('heading', { name: `Hello, ${citizen.name}` }).waitFor()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [4, 3, 1, 0])
    assert.notEqual(await refreshToken(), before, 'refresh token must rotate on restore')
    await shot(page, '07-dashboard-in-progress')
  })

  await step('an expired access token (401 from the API) is silently refreshed and the request retried', async () => {
    refreshCalls = 0
    let injected = 0
    await page.route('**/api/v1/issues/**', async (route) => {
      if (injected++ === 0) {
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Given token not valid for any token type"}' })
      }
      return route.continue()
    })
    await page.reload()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [4, 3, 1, 0])
    assert.equal(refreshCalls, 2, 'one refresh to restore the session after reload + one triggered by the injected 401')
    assert.equal(new URL(page.url()).pathname, '/dashboard', 'user must not be thrown to /login')
    await page.unroute('**/api/v1/issues/**')
  })

  // ================= part 2: Explore + the map (anonymous visitor) =================

  await step('Explore is public: an anonymous visitor sees the map, drawn from OpenFreeMap vector tiles', async () => {
    const tile = anon.waitForResponse((r) => /tiles\.openfreemap\.org\/planet\/.+\.pbf/.test(r.url()) && r.status() === 200, { timeout: 30000 })
    await anon.goto(`${APP}/explore?view=map&q=${stamp}`)
    const region = anon.getByRole('region', { name: 'Map of issues' })
    await region.waitFor({ timeout: 20000 })
    assert.equal(new URL(anon.url()).pathname, '/explore', 'no login redirect')
    await anon.locator('canvas.maplibregl-canvas').first().waitFor({ timeout: 20000 })
    await tile // a real vector tile (.pbf) came back 200 from OpenFreeMap

    // The map is actually painted, not a blank background: a drawn city map compresses to a big PNG
    // (a blank one is ~6 KB). Software GL paints progressively, so poll instead of sleeping.
    const started = Date.now()
    let bytes = 0
    while (Date.now() - started < 30_000) {
      bytes = (await region.screenshot()).length
      if (bytes > 40_000) break
      await anon.waitForTimeout(1000)
    }
    console.log(`      (map painted: ${bytes} bytes after ${((Date.now() - started) / 1000).toFixed(1)}s of polling)`)
    assert.ok(bytes > 40_000, `map still blank after 30s (${bytes} bytes)`)

    const openfreemap = allUrls.filter((u) => new URL(u).host === 'tiles.openfreemap.org')
    assert.ok(openfreemap.some((u) => u.includes('/styles/')), 'style requested from OpenFreeMap')
    assert.ok(openfreemap.some((u) => u.endsWith('.pbf')), 'vector tiles requested from OpenFreeMap')
    const osmTiles = allUrls.filter((u) => /(^|\/\/|\.)tile\.openstreetmap\.org/.test(u))
    assert.deepEqual(osmTiles, [], 'must never hit the raw OpenStreetMap tile server')
    console.log(`      (${openfreemap.length} requests to tiles.openfreemap.org, 0 to tile.openstreetmap.org)`)

    // The credit comes from the style's TileJSON, so it appears only once that has loaded: wait for it.
    const attribution = anon.locator('.leaflet-control-attribution')
    await attribution.getByText(/OpenFreeMap/).first().waitFor({ timeout: 15000 })
    await attribution.getByText(/OpenStreetMap/).first().waitFor({ timeout: 15000 })
    await shot(anon, '08-explore-map')
  })

  await step('map: pins coloured per category, 3 nearby issues form a cluster, clicking it reveals them', async () => {
    // issueTitle sits alone (~3 km away); the three map issues are 35 m apart -> one cluster of 3
    await anon.locator(`.civicfix-pin[title="${issueTitle}"]`).waitFor({ timeout: 10000 })
    const cluster = anon.locator('.marker-cluster').first()
    await cluster.waitFor({ timeout: 10000 })
    assert.equal((await cluster.innerText()).trim(), '3')
    await cluster.click()
    await anon.waitForFunction(
      (titles) => titles.every((t) => document.querySelector(`.civicfix-pin[title="${t}"]`)),
      mapTitles,
      { timeout: 10000 },
    )
    const colors = await anon.locator('.civicfix-pin[title^="E2E map"] .civicfix-pin__dot').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    assert.equal(colors.length, 3)
    assert.equal(new Set(colors).size, 3, `three categories must give three colours, got ${colors}`)
    await shot(anon, '09-map-cluster-expanded')
  })

  await step('map: clicking a pin opens a popup (title, category, status, View details) that opens the detail page', async () => {
    await anon.locator(`.civicfix-pin[title="${mapTitles[1]}"]`).click()
    const popup = anon.locator('.leaflet-popup')
    await popup.waitFor()
    const text = await popup.innerText()
    assert.ok(text.includes(mapTitles[1]))
    assert.ok(text.includes(categories[1].name))
    assert.ok(text.includes('Under review'))
    await shot(anon, '10-map-popup')
    await popup.getByRole('link', { name: 'View details' }).click()
    await anon.getByRole('heading', { name: mapTitles[1] }).waitFor()
    assert.match(new URL(anon.url()).pathname, /^\/issues\/[0-9a-f-]{36}$/)
    assert.equal(await anon.getByTestId('coordinates').innerText(), '22.72580, 75.88380')
    const detailMap = anon.getByRole('region', { name: 'Map showing the issue location' })
    await detailMap.waitFor()
    await anon.locator('.civicfix-pin').first().waitFor()
    await anon.locator('canvas.maplibregl-canvas').first().waitFor()
    await waitPainted(detailMap, 'detail-page map')
    await shot(anon, '11-issue-detail')
  })

  await step('detail page: Back returns to the same map view', async () => {
    await anon.getByRole('button', { name: /back/i }).click()
    await anon.getByRole('heading', { name: 'Explore issues' }).waitFor()
    assert.equal(new URL(anon.url()).pathname, '/explore')
    assert.match(anon.url(), /view=map/)
    assert.match(anon.url(), new RegExp(`q=${stamp}`))
  })

  await step('list view shows the same issues as cards (photo, title, category, location, status, priority, votes)', async () => {
    await anon.getByRole('button', { name: 'List' }).click()
    await expectCards(anon, 4)
    const card = cards(anon).filter({ hasText: issueTitle })
    assert.ok(await card.getByText('In progress', { exact: true }).isVisible())
    assert.ok(await card.getByText('Medium priority').isVisible())
    assert.ok(await card.getByText('MG Road, Indore').isVisible())
    assert.ok(await card.getByText('Pothole', { exact: false }).first().isVisible())
    assert.equal(await card.getByLabel(/votes?$/).innerText(), '▲ 0')
    const img = card.locator('img')
    await anon.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle())
    assert.match(await card.getByRole('link', { name: issueTitle }).getAttribute('href'), /^\/issues\/[0-9a-f-]{36}$/)
    await shot(anon, '12-explore-list')
  })

  await step('filters go to the backend (status, priority, category) and the list and map agree', async () => {
    await selectAndWait(anon, 'Status', 'In progress', /status=in_progress/)
    await expectCards(anon, 1)
    assert.ok(await cards(anon).filter({ hasText: issueTitle }).isVisible())

    await selectAndWait(anon, 'Status', 'Under review', /status=under_review/)
    await expectCards(anon, 3)

    await selectAndWait(anon, 'Status', 'Resolved', /status=resolved/)
    await expectCards(anon, 0)
    await anon.getByText('No issues match').waitFor()

    await anon.getByRole('button', { name: 'Clear filters' }).click()
    await anon.getByLabel('Search').fill(String(stamp))
    await expectCards(anon, 4)

    await selectAndWait(anon, 'Priority', 'High', /priority=high/)
    await expectCards(anon, 0) // nothing is high priority yet

    await selectAndWait(anon, 'Priority', 'Medium', /priority=medium/)
    await expectCards(anon, 4)

    await selectAndWait(anon, 'Category', categories[1].name, new RegExp(`category=${categories[1].id}`))
    await expectCards(anon, 1)
    assert.ok(await cards(anon).filter({ hasText: mapTitles[1] }).isVisible())

    // same filters on the map: exactly that one issue is on it
    await anon.getByRole('button', { name: 'Map' }).click()
    await anon.getByText('1 issue on the map').waitFor()
    await anon.locator(`.civicfix-pin[title="${mapTitles[1]}"]`).waitFor()
    assert.equal(await anon.locator('.civicfix-pin').count(), 1)
    await shot(anon, '13-explore-filtered-map')

    // the keyword is client-side: only issue C's description mentions its category name
    await anon.getByRole('button', { name: 'Clear filters' }).click()
    await anon.getByLabel('Search').fill(`${categories[2].name} ${stamp}`)
    await anon.getByText('1 issue on the map').waitFor()
    await anon.locator(`.civicfix-pin[title="${mapTitles[2]}"]`).waitFor()
  })

  // ================= part 3: report an issue with the location set from the map =================

  await step('report an issue: location from GPS, then a map click, then a typed correction (all three work together)', async () => {
    await page.goto(`${APP}/report`)
    await page.getByRole('form', { name: 'Report an issue' }).waitFor()
    const picker = page.getByRole('region', { name: /click to set the issue location/i })
    await picker.waitFor()
    await picker.locator('canvas.maplibregl-canvas').first().waitFor({ timeout: 20000 })
    await waitPainted(picker, 'report-form map')
    const lat = page.getByLabel('Latitude')
    const lng = page.getByLabel('Longitude')
    assert.equal(await lat.inputValue(), '')
    assert.equal(await picker.locator('.civicfix-pin').count(), 0, 'no pin before a location is chosen')

    // 1) browser geolocation
    await page.getByRole('button', { name: /use my current location/i }).click()
    await page.waitForFunction(() => document.querySelector('#latitude').value === '22.730000')
    assert.equal(await lng.inputValue(), '75.880000')
    await picker.locator('.civicfix-pin').waitFor()

    // 2) click on the map: marker drops there, fields follow
    const box = await picker.boundingBox()
    await picker.locator('.leaflet-container').click({ position: { x: box.width / 2 + 140, y: box.height / 2 - 70 } })
    await page.waitForFunction(() => document.querySelector('#latitude').value !== '22.730000')
    const clickedLat = await lat.inputValue()
    const clickedLng = await lng.inputValue()
    console.log(`      (map click -> ${clickedLat}, ${clickedLng})`)
    assert.ok(Number(clickedLat) > 22.7 && Number(clickedLat) < 22.8, `latitude ${clickedLat} not near Indore`)
    assert.ok(Number(clickedLng) > 75.85 && Number(clickedLng) < 75.95, `longitude ${clickedLng} not near Indore`)
    assert.ok(Number(clickedLng) > GPS.longitude, 'clicking right of centre must increase longitude')
    assert.equal(await picker.locator('.civicfix-pin').count(), 1, 'exactly one pin')
    await waitPainted(picker, 'report-form map after the click')
    await shot(page, '14-report-map-click')

    // 3) typing coordinates moves the pin
    const pinBefore = await picker.locator('.civicfix-pin').boundingBox()
    await lat.fill('22.7400')
    await page.waitForFunction(
      (before) => {
        const r = document.querySelector('[aria-label*="click to set"] .civicfix-pin')?.getBoundingClientRect()
        return r && Math.abs(r.top - before.y) > 3
      },
      pinBefore,
      { timeout: 5000 },
    )

    await page.getByLabel('Title').fill(`E2E map-picked ${stamp}`)
    await page.getByLabel('Description').fill('Location chosen by clicking on the map, then nudged by typing a latitude.')
    await page.getByLabel('Category').selectOption({ label: 'Garbage' })
    await page.getByRole('button', { name: 'Submit report' }).click()
    await page.getByRole('heading', { name: 'My reports' }).waitFor()

    // The backend stored exactly what the form held
    const admin = (await api('POST', '/auth/login/', { body: ADMIN })).access
    const stored = (await api('GET', '/admin/issues/?moderation_status=pending', { token: admin })).results.find(
      (i) => i.title === `E2E map-picked ${stamp}`,
    )
    assert.ok(stored, 'the map-picked issue should exist')
    assert.ok(Math.abs(stored.location.latitude - 22.74) < 1e-6, `stored latitude ${stored.location.latitude}`)
    assert.ok(Math.abs(stored.location.longitude - Number(clickedLng)) < 1e-6, `stored longitude ${stored.location.longitude}`)
  })

  // ================= part 4: auth edge cases (as before) =================

  await step('wrong password shows the server message and stays on /login', async () => {
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.getByRole('heading', { name: /fix your city/i }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(await refreshToken(), null, 'logout must clear the stored refresh token')
    await page.goto(`${APP}/login`)
    await page.getByLabel('Email').fill(citizen.email)
    await page.getByLabel('Password').fill('definitely-wrong-password')
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.getByText('No active account found with the given credentials').waitFor()
    assert.equal(new URL(page.url()).pathname, '/login')
  })

  await step('after logout a protected URL needs login again; logging back in returns to that page', async () => {
    await page.goto(`${APP}/my-reports`)
    await page.getByRole('heading', { name: 'Log in' }).waitFor()
    await page.getByLabel('Email').fill(citizen.email)
    await page.getByLabel('Password').fill(citizen.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.getByRole('heading', { name: 'My reports' }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/my-reports')
    await cards(page).filter({ hasText: issueTitle }).getByText('In progress', { exact: true }).waitFor({ timeout: 5000 })
  })

  await step('whole run: no tile request ever went to tile.openstreetmap.org, and no unexpected browser console errors', async () => {
    assert.deepEqual(allUrls.filter((u) => /(^|\/\/|\.)tile\.openstreetmap\.org/.test(u)), [])
    // the injected 401 and the deliberate wrong-password 401 show up as network errors; nothing else should
    const unexpected = consoleErrors.filter((e) => !/status of 401|Failed to load resource/i.test(e))
    assert.deepEqual(unexpected, [])
  })

  console.log(`\nE2E PASSED (${results.length} steps)`)
} catch {
  await shot(page, 'FAILED-citizen')
  await shot(anon, 'FAILED-anonymous')
  console.log(`\nE2E FAILED at step ${results.length}: ${results.at(-1)?.[0]}`)
  console.log('Console errors:', consoleErrors)
  process.exitCode = 1
} finally {
  await browser.close()
}
