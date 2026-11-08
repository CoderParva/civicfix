// Real-browser E2E for the AI features, against the REAL backend (no mocks).
//
//   docker compose up                    (in backend/)   -> API on :8000, AI models installed (scripts/install-ai-libs.sh)
//   npm run dev                                           -> app on :5173
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_PHOTO=/path/to/a/real/pothole.jpg npm run e2e:ai
//
// AI ON (default; the backend runs with AI_INFERENCE=local): a real pothole photo is classified by the real
// CLIP model and the form suggests "Pothole" with a confidence; nothing is selected until it is clicked and a
// category the citizen chose is never overridden. A report that duplicates an earlier one shows the warning
// (and "Submit anyway" always works). The admin's issue page shows the recorded analysis.
//
// AI OFF (E2E_AI=off; the backend runs with AI_INFERENCE=disabled, like production): same journey, but no
// suggestion appears, nothing breaks, duplicates are still found by location + wording, and the admin panel
// says the models were not available.
//
// Everything it creates is its own (a fresh citizen, reports at a location unique to this run).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { chromium } from 'playwright-core'

const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173'
const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = process.env.E2E_SHOTS_DIR
const AI_ON = process.env.E2E_AI !== 'off'
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
if (!ADMIN.email || !ADMIN.password) {
  console.error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (an admin account).')
  process.exit(2)
}
if (AI_ON && !process.env.E2E_PHOTO) {
  console.error('Set E2E_PHOTO to a real photo of a pothole (the real model has to recognise it), or run with E2E_AI=off.')
  process.exit(2)
}

const stamp = Date.now()
const citizen = { email: `ai.citizen.${stamp}@example.com`, password: 'Quartz-Meadow-91-Lantern!', full_name: 'AI E2E Citizen' }
// A spot of its own for this run, so earlier runs' reports are never "nearby" (0.003 deg is ~330 m).
const LAT = (22.9 + (stamp % 100) * 0.003).toFixed(6)
const LNG = (75.7 + (Math.floor(stamp / 100) % 100) * 0.003).toFixed(6)
const FIRST = { title: `AI e2e deep pothole outside the temple ${stamp}`, description: 'A very deep pothole in the middle of the lane, bikes keep swerving around it.' }
const AGAIN = { title: `AI e2e pothole outside the temple again ${stamp}`, description: 'A very deep pothole in the middle of the lane, bikes keep swerving around it.' }

function makePng(width = 64, height = 48) {
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [90, 90, 90]).flat())])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const photoFile = AI_ON
  ? { name: 'pothole.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(process.env.E2E_PHOTO) }
  : { name: 'street.png', mimeType: 'image/png', buffer: makePng() }

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

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const VIEWPORT = { width: 1280, height: 1000 }
const citizenPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
const adminPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
const consoleErrors = []
for (const [p, label] of [[citizenPage, 'citizen'], [adminPage, 'admin']]) {
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[${label}] ${m.text()} <${m.location().url}>`))
  p.on('pageerror', (e) => consoleErrors.push(`[${label}] ${String(e)}`))
}
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (p, name, fullPage = true) => SHOTS && p.screenshot({ path: path.join(SHOTS, `ai-${AI_ON ? 'on' : 'off'}-${name}.png`), fullPage })

async function signIn(page, creds, landing) {
  await page.goto(`${APP}/login`)
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((u) => u.pathname === landing, { timeout: 20000 })
}
const categoryText = (page) => page.getByLabel('Category').evaluate((el) => el.selectedOptions[0].textContent)
async function openReportForm(page) {
  await page.goto(`${APP}/report`)
  await page.getByRole('form', { name: 'Report an issue' }).waitFor()
  await page.getByRole('option', { name: 'Pothole' }).waitFor({ state: 'attached' })
}
async function fillReport(page, { title, description }, { category = null } = {}) {
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Description').fill(description)
  if (category) await page.getByLabel('Category').selectOption({ label: category })
  await page.getByLabel('Latitude').fill(LAT)
  await page.getByLabel('Longitude').fill(LNG)
}

let firstId
let secondId
let adminToken
let citizenToken

try {
  console.log(`AI E2E (${AI_ON ? 'AI ON: real models' : 'AI OFF: like production'}) against ${APP} + ${API}\n`)

  await step('setup (API): a fresh citizen and an admin token', async () => {
    adminToken = await login(ADMIN)
    await api('POST', '/auth/register/', { body: citizen })
    citizenToken = await login(citizen)
  })

  await step('citizen signs in and opens the report form', async () => {
    await signIn(citizenPage, citizen, '/dashboard')
    await openReportForm(citizenPage)
  })

  if (AI_ON) {
    await step('a real pothole photo is classified by the real model: the form SUGGESTS Pothole with a confidence, and selects nothing by itself', async () => {
      await citizenPage.getByLabel('Upload photos').setInputFiles(photoFile)
      await citizenPage.getByAltText(`Preview of ${photoFile.name}`).waitFor()
      const box = citizenPage.getByTestId('photo-suggestion')
      await box.waitFor({ timeout: 120_000 }) // the very first classification may load the model
      const text = await box.innerText()
      console.log(`      (suggestion: ${text.replace(/\s+/g, ' ').trim()})`)
      assert.match(text, /Pothole/)
      const confidence = Number(/(\d+)% sure/.exec(text)?.[1])
      assert.ok(confidence >= 50 && confidence <= 100, `confidence ${confidence}% should be shown and at least the 50% threshold`)
      assert.equal(await categoryText(citizenPage), 'Select a category', 'the suggestion must not fill the category')
      await shot(citizenPage, '01-suggestion')
    })

    await step('a category the citizen already chose is never overridden; switching is an explicit click', async () => {
      await citizenPage.getByLabel('Category').selectOption({ label: 'Garbage' })
      const box = citizenPage.getByTestId('photo-suggestion')
      await box.getByText(/You chose something else/).waitFor()
      assert.equal(await categoryText(citizenPage), 'Garbage')
      await box.getByRole('button', { name: 'Switch to Pothole' }).click()
      assert.equal(await categoryText(citizenPage), 'Pothole')
    })

    await step('"Use" works from a clean slate too (category reset, then one click accepts the suggestion)', async () => {
      await citizenPage.getByLabel('Category').selectOption({ label: 'Select a category' })
      await citizenPage.getByTestId('photo-suggestion').getByRole('button', { name: 'Use Pothole' }).click()
      assert.equal(await categoryText(citizenPage), 'Pothole')
    })
  } else {
    await step('AI OFF: a photo gets no suggestion, nothing spins forever, and the form is fully usable', async () => {
      await citizenPage.getByLabel('Upload photos').setInputFiles(photoFile)
      await citizenPage.getByAltText(`Preview of ${photoFile.name}`).waitFor()
      await citizenPage.getByRole('status', { name: /./ }).first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
      await citizenPage.waitForTimeout(1500)
      assert.equal(await citizenPage.getByTestId('photo-suggestion').count(), 0, 'no suggestion without a model')
      assert.equal(await citizenPage.getByText('Looking at your photo…').count(), 0, 'no endless "looking" spinner')
      await citizenPage.getByLabel('Category').selectOption({ label: 'Pothole' })
      await shot(citizenPage, '01-no-suggestion')
    })
  }

  await step('first report at a new location: no similar report, so it goes straight through (no dialog)', async () => {
    await fillReport(citizenPage, FIRST)
    await citizenPage.getByRole('button', { name: 'Submit report' }).click()
    await citizenPage.getByRole('heading', { name: 'My reports' }).waitFor({ timeout: 30000 })
    assert.equal(await citizenPage.getByRole('dialog').count(), 0)
    const mine = (await api('GET', '/issues/?mine=true', { token: citizenToken })).results
    assert.equal(mine.length, 1)
    firstId = mine[0].id
    assert.equal(mine[0].priority, 'medium', 'the recommendation is advice: the issue keeps its default priority')
  })

  await step('the backend recorded the analysis (priority rules always; the photo check only with a model)', async () => {
    const analysis = await api('GET', `/ai/analysis/${firstId}/`, { token: adminToken })
    assert.ok(['high', 'medium', 'low', 'critical'].includes(analysis.suggested_priority))
    assert.equal(analysis.result.priority.method, 'rules')
    assert.ok(analysis.result.priority.reasons.length >= 1)
    if (AI_ON) {
      assert.equal(analysis.processing_status, 'completed')
      assert.equal(analysis.result.classification.status, 'ok')
      assert.equal(analysis.predicted_category, 'Pothole')
      assert.equal(analysis.result.classification.agrees_with_reporter, true)
      assert.ok(analysis.confidence >= 0.5)
      assert.match(analysis.model_name, /clip/i)
    } else {
      assert.equal(analysis.processing_status, 'partial')
      assert.equal(analysis.result.classification.status, 'unavailable')
      assert.equal(analysis.predicted_category, '')
    }
  })

  await step('once the first report is public, a similar report nearby triggers the warning listing it; nothing is sent yet', async () => {
    await api('POST', `/admin/issues/${firstId}/approve/`, { token: adminToken })
    await openReportForm(citizenPage)
    await citizenPage.getByLabel('Upload photos').setInputFiles(photoFile)
    await fillReport(citizenPage, AGAIN, { category: 'Pothole' })
    await citizenPage.getByRole('button', { name: 'Submit report' }).click()
    const dialog = citizenPage.getByRole('dialog', { name: /already reported/i })
    await dialog.waitFor({ timeout: 60_000 })
    const list = dialog.getByRole('list', { name: 'Similar reports' })
    const link = list.getByRole('link', { name: new RegExp(FIRST.title) })
    assert.equal(await link.getAttribute('href'), `/issues/${firstId}`)
    console.log(`      (warning: ${(await list.innerText()).replace(/\s+/g, ' ').trim()})`)
    assert.equal((await api('GET', '/issues/?mine=true', { token: citizenToken })).count, 1, 'nothing was submitted yet')
    await citizenPage.waitForTimeout(500) // let the open animation finish before the picture
    await shot(citizenPage, '02-duplicate-warning', false) // viewport only: a full-page capture mis-places fixed overlays
  })

  await step('"Go back and edit" closes the warning with the form intact; submitting again and choosing "Submit anyway" sends it', async () => {
    const dialog = citizenPage.getByRole('dialog', { name: /already reported/i })
    await dialog.getByRole('button', { name: 'Go back and edit' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await citizenPage.getByLabel('Title').inputValue(), AGAIN.title)
    assert.equal((await api('GET', '/issues/?mine=true', { token: citizenToken })).count, 1)

    await citizenPage.getByRole('button', { name: 'Submit report' }).click()
    await dialog.waitFor({ timeout: 60_000 })
    await dialog.getByRole('button', { name: 'Submit anyway' }).click()
    await citizenPage.getByRole('heading', { name: 'My reports' }).waitFor({ timeout: 30000 })
    const mine = (await api('GET', '/issues/?mine=true', { token: citizenToken })).results
    assert.equal(mine.length, 2, 'the duplicate was still allowed through')
    secondId = mine.find((i) => i.id !== firstId).id
  })

  await step('admin opens the second report: the AI analysis panel shows the priority reasons, the photo check and the first report as a possible duplicate', async () => {
    await signIn(adminPage, ADMIN, '/admin')
    await adminPage.goto(`${APP}/admin/issues/${secondId}`)
    const panel = adminPage.getByRole('region', { name: 'AI analysis' })
    await panel.waitFor({ timeout: 20000 })
    assert.ok(await panel.getByRole('list', { name: 'Why this priority' }).count(), 'priority reasons are listed')
    const dupes = panel.getByRole('list', { name: 'Possible duplicates' })
    const link = dupes.getByRole('link', { name: new RegExp(FIRST.title) })
    await link.waitFor()
    assert.equal(await link.getAttribute('href'), `/admin/issues/${firstId}`)
    const text = (await panel.innerText()).replace(/\s+/g, ' ')
    console.log(`      (panel: ${text.slice(0, 400)})`)
    if (AI_ON) {
      assert.match(text, /Looks like Pothole/)
      assert.match(text, /Matches the reporter/)
      assert.match(text, /Photo model: sentence-transformers\/clip/)
    } else {
      assert.match(text, /image model was not available/)
      assert.match(text, /Rules only/)
      assert.match(text, /location and wording only/)
    }
    await shot(adminPage, '03-admin-panel')
    await link.click()
    await adminPage.getByRole('heading', { name: FIRST.title }).waitFor()
  })

  await step('an older issue with no analysis simply shows no AI panel', async () => {
    const older = (await api('GET', '/admin/issues/?ordering=created_at', { token: adminToken })).results.find((i) => i.id !== firstId && i.id !== secondId)
    const analysis = await api('GET', `/ai/analysis/${older.id}/`, { token: adminToken })
    await adminPage.goto(`${APP}/admin/issues/${older.id}`)
    await adminPage.getByRole('region', { name: 'Moderation' }).waitFor()
    if (analysis.processing_status === 'not_analyzed') {
      await adminPage.waitForTimeout(800)
      assert.equal(await adminPage.getByRole('region', { name: 'AI analysis' }).count(), 0)
    }
  })

  await step('no unexpected browser console errors during the whole run', async () => {
    // Expected, by design since the admin workspace: a not-yet-public issue's public comments endpoint is a 404
    // (the page says "Comments open once the issue is public"). Anything else is a failure.
    const unexpected = consoleErrors.filter((e) => !/404.*\/issues\/[0-9a-f-]+\/comments\/>/.test(e))
    assert.deepEqual(unexpected, [])
  })

  console.log(`\nAI E2E PASSED (${results.length} steps, ${AI_ON ? 'AI on' : 'AI off'})`)
} catch {
  console.log(`\nAI E2E FAILED after ${results.filter(([, ok]) => ok).length} passing steps`)
  if (consoleErrors.length) console.log('console errors:\n  ' + consoleErrors.join('\n  '))
  process.exitCode = 1
} finally {
  await browser.close()
}
