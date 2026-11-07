// Real-browser end-to-end check of the citizen flow against the REAL backend (no mocks).
//
//   docker compose up        (in backend/)      -> API on :8000
//   npm run dev                                  -> app on :5173
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e
//
// It registers a brand-new citizen through the UI, reports an issue with a photo, then uses the
// API (as an admin and a freshly created officer) to move that issue along, and checks the
// dashboard follows. Needs a department to exist already (the admin API can create one).
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
const issueTitle = `E2E pothole ${stamp}`

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

// ---- the flow --------------------------------------------------------------------------

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage()
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(String(e)))
let refreshCalls = 0
page.on('request', (r) => r.url().endsWith('/auth/token/refresh/') && refreshCalls++)

const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
const stat = async (key) => Number(await page.getByTestId(`stat-${key}`).locator('p').innerText())
const refreshToken = () => page.evaluate(() => sessionStorage.getItem('civicfix.refresh'))
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

try {
  console.log(`E2E against ${APP} + ${API}\n`)

  await step('landing page shows the hero and both CTAs', async () => {
    await page.goto(APP)
    await page.getByRole('heading', { name: /fix your city/i }).waitFor()
    assert.ok(await page.getByRole('link', { name: 'Report an Issue' }).isVisible())
    assert.ok(await page.getByRole('link', { name: 'Login', exact: true }).first().isVisible())
    await shot('01-landing')
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
    await shot('02-register')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('heading', { name: `Hello, ${citizen.name}` }).waitFor()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(
      await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)),
      [0, 0, 0, 0],
    )
    assert.ok(await page.getByText('You have not reported anything yet').isVisible())
    assert.ok(await refreshToken(), 'refresh token should be stored for reload survival')
    await shot('03-dashboard-empty')
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
    await shot('04-report-form-filled')
    await page.getByRole('button', { name: 'Submit report' }).click()
    await page.getByRole('heading', { name: 'My reports' }).waitFor()
    assert.match(await page.getByRole('alert').innerText(), /submitted/i)
    await shot('05-my-reports')
  })

  await step('My reports shows the new issue with a Reported badge, the server-stored photo, and the review note', async () => {
    const card = page.getByTestId('issue-card').filter({ hasText: issueTitle })
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
    await shot('06-dashboard-1-pending')
  })

  let tokenBeforeReload
  await step('backend moves the issue forward (admin approve+assign to a NEW officer, officer accepts)', async () => {
    const admin = (await api('POST', '/auth/login/', { body: ADMIN })).access
    let departments = (await api('GET', '/admin/departments/', { token: admin })).results
    let department = departments.find((d) => d.is_active)
    if (!department) {
      department = await api('POST', '/admin/departments/', { token: admin, body: { name: `E2E Dept ${stamp}`, city: 'Indore' } })
    }
    const officer = await api('POST', '/admin/officers/', {
      token: admin,
      body: {
        email: `e2e.officer.${stamp}@example.com`,
        full_name: 'E2E Officer',
        password: 'Harbor-Violet-47-Kettle!',
        department: department.id,
        employee_reference: `E2E-${stamp}`,
      },
    })
    const pending = (await api('GET', '/admin/issues/?moderation_status=pending', { token: admin })).results
    const issue = pending.find((i) => i.title === issueTitle)
    assert.ok(issue, 'the issue reported through the UI should be visible to the admin')
    await api('POST', `/admin/issues/${issue.id}/approve/`, { token: admin })
    await api('POST', `/admin/issues/${issue.id}/assign/`, { token: admin, body: { department: department.id, officer: officer.id } })
    const officerToken = (
      await api('POST', '/auth/login/', { body: { email: `e2e.officer.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!' } })
    ).access
    const accepted = await api('POST', `/officer/issues/${issue.id}/accept/`, { token: officerToken })
    assert.equal(accepted.status, 'in_progress')
  })

  await step('page reload restores the session (refresh token) and the dashboard shows In progress 1', async () => {
    tokenBeforeReload = await refreshToken()
    await page.reload()
    await page.getByRole('heading', { name: `Hello, ${citizen.name}` }).waitFor()
    await page.getByLabel('Report statistics').waitFor()
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [1, 0, 1, 0])
    assert.notEqual(await refreshToken(), tokenBeforeReload, 'refresh token must rotate on restore')
    await shot('07-dashboard-in-progress')
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
    assert.deepEqual(await Promise.all(['total', 'pending', 'inProgress', 'resolved'].map(stat)), [1, 0, 1, 0])
    assert.equal(refreshCalls, 2, 'one refresh to restore the session after reload + one triggered by the injected 401')
    assert.equal(new URL(page.url()).pathname, '/dashboard', 'user must not be thrown to /login')
    await page.unroute('**/api/v1/issues/**')
  })

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
    // the list loads after the heading renders, so wait for it rather than sampling once
    await page.getByTestId('issue-card').filter({ hasText: issueTitle }).getByText('In progress', { exact: true }).waitFor({ timeout: 5000 })
  })

  await step('no unexpected browser console errors during the whole run', async () => {
    // the injected 401 and the deliberate wrong-password 401 show up as network errors; nothing else should
    const unexpected = consoleErrors.filter((e) => !/status of 401|Failed to load resource/i.test(e))
    assert.deepEqual(unexpected, [])
  })

  console.log(`\nE2E PASSED (${results.length} steps)`)
} catch {
  await shot('FAILED')
  console.log(`\nE2E FAILED at step ${results.length}: ${results.at(-1)?.[0]}`)
  console.log('Console errors:', consoleErrors)
  process.exitCode = 1
} finally {
  await browser.close()
}
