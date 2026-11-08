// Real-browser E2E for the officer + admin workspaces, against the REAL backend (no mocks).
//
//   docker compose up                    (in backend/)   -> API on :8000
//   npm run dev                                           -> app on :5173
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e:staff
//
// Two browsers play two people at once: an ADMIN and an OFFICER. The script creates a fresh citizen
// report through the API, then drives the whole lifecycle through the UI:
//   approve -> assign -> (officer) accept -> note -> resolve -> (admin) reopen -> reassign ->
//   (officer) send back -> (admin) reject
// and checks role gating, comment hiding, sorting and department CRUD. Everything it creates is its
// own (a dedicated "E2E Test Dept", a new officer and citizen per run), so demo data stays clean.
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
  console.error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (a super-admin account).')
  process.exit(2)
}

const stamp = Date.now()
const citizen = { email: `staff.citizen.${stamp}@example.com`, password: 'Quartz-Meadow-91-Lantern!', full_name: 'Staff E2E Citizen' }
const officer = { email: `staff.officer.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!', full_name: 'Staff E2E Officer', employee_reference: `SE-${stamp}` }
const colleague = { email: `staff.colleague.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!', full_name: 'Staff E2E Colleague', employee_reference: `SC-${stamp}` }
const title = `Staff E2E pothole ${stamp}`
const DEPT = 'E2E Test Dept'

// ---- helpers ---------------------------------------------------------------------------
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [40, 160, 90]).flat())])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
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

// ---- two people, two browsers ----------------------------------------------------------
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const VIEWPORT = { width: 1440, height: 900 }
const adminPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
const officerPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
const anonPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
const consoleErrors = []
for (const [p, label] of [[adminPage, 'admin'], [officerPage, 'officer'], [anonPage, 'anon']]) {
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[${label}] ${m.text()}`))
  p.on('pageerror', (e) => consoleErrors.push(`[${label}] ${String(e)}`))
}
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = (p, name) => SHOTS && p.screenshot({ path: path.join(SHOTS, `staff-${name}.png`), fullPage: true })
const path_ = (p) => new URL(p.url()).pathname

async function signIn(page, creds, landing) {
  await page.goto(`${APP}/login`)
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((u) => u.pathname === landing, { timeout: 20000 })
}
/** In-app navigation (keeps the in-memory token, unlike page.goto which reloads and re-restores the session). */
const goto = (page, to) => page.evaluate((target) => { window.history.pushState({}, '', target); window.dispatchEvent(new PopStateEvent('popstate')) }, to)
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 10000 })
/** selectOption by a regex on the option's visible text (Playwright's label match is string-only). */
async function pick(select, pattern) {
  const options = await select.locator('option').evaluateAll((els) => els.map((o) => ({ value: o.value, text: o.textContent ?? '' })))
  const hit = options.find((o) => pattern.test(o.text))
  assert.ok(hit, `no option matching ${pattern} in ${JSON.stringify(options.map((o) => o.text))}`)
  await select.selectOption(hit.value)
}
const stepper = (page) => page.getByRole('list', { name: 'Progress' }).locator('li[aria-current="step"]')
const maps = async (page) => {
  // wait for any map on the page to paint so screenshots show tiles
  const regions = page.locator('[role="region"]:has(canvas.maplibregl-canvas)')
  for (let i = 0; i < (await regions.count()); i++) {
    for (let t = 0; t < 20; t++) {
      if ((await regions.nth(i).screenshot()).length > 25_000) break
      await page.waitForTimeout(750)
    }
  }
}

let issueId
let department
let adminToken

try {
  console.log(`Staff E2E against ${APP} + ${API}\n`)

  await step('setup (API): a test department, an officer + a colleague, and a fresh citizen report', async () => {
    adminToken = await login(ADMIN)
    const existing = (await api('GET', '/admin/departments/', { token: adminToken })).results
    department =
      existing.find((d) => d.name === DEPT && d.is_active) ?? (await api('POST', '/admin/departments/', { token: adminToken, body: { name: DEPT, city: 'Indore' } }))
    await api('POST', '/admin/officers/', { token: adminToken, body: { ...officer, department: department.id } })
    await api('POST', '/admin/officers/', { token: adminToken, body: { ...colleague, department: department.id } })
    await api('POST', '/auth/register/', { body: citizen })
    const citizenToken = await login(citizen)
    const categories = await api('GET', '/categories/')
    const created = await api('POST', '/issues/', {
      token: citizenToken,
      body: { category: categories[0].id, title, description: 'A staff end-to-end test issue: deep pothole outside the school gate.', latitude: 22.7196, longitude: 75.8577, address: 'MG Road, Indore' },
    })
    issueId = created.id
    // a public comment to moderate later (needs the issue to be public, so it is added after approval)
  })

  // ---------------------------------------------------------------- admin: moderate + assign
  await step('admin signs in and lands on the Overview with real totals', async () => {
    await signIn(adminPage, ADMIN, '/admin')
    await adminPage.getByTestId('tile-total').waitFor()
    await adminPage.waitForFunction(() => document.querySelector('[data-testid="tile-total"] p')?.textContent?.trim() !== '0')
    const shownTotal = Number((await adminPage.getByTestId('tile-total').locator('p').innerText()).trim())
    const apiTotal = (await api('GET', '/admin/analytics/', { token: adminToken })).totals.issues
    assert.equal(shownTotal, apiTotal, 'the tile must show the DB aggregate, not a hardcoded number')
    for (const id of ['chart-trend', 'chart-category', 'chart-priority', 'chart-departments']) await adminPage.getByTestId(id).waitFor()
    assert.ok((await adminPage.locator('[data-testid="chart-trend"] svg.recharts-surface').count()) > 0, 'the trend chart renders an SVG')
    assert.ok((await adminPage.locator('[data-testid="chart-category"] svg.recharts-surface').count()) > 0)
    await adminPage.waitForTimeout(1200)
    await shot(adminPage, '01-admin-overview')
  })

  await step('Issues table: sort by priority (backend ordering), filter to "Awaiting review", open the new report', async () => {
    await adminPage.getByRole('link', { name: 'Issues' }).first().click()
    await adminPage.getByRole('table', { name: 'All issues' }).waitFor()
    const sorted = adminPage.waitForRequest((r) => /\/admin\/issues\/\?.*ordering=-?priority/.test(r.url()))
    await adminPage.getByRole('button', { name: /^Priority/ }).click()
    await sorted
    await adminPage.waitForFunction(() => document.querySelector('th[aria-sort="descending"], th[aria-sort="ascending"]')?.textContent?.includes('Priority'))
    const filtered = adminPage.waitForRequest((r) => r.url().includes('moderation_status=pending'))
    await adminPage.getByRole('button', { name: 'Awaiting review' }).click()
    await filtered
    await adminPage.getByRole('button', { name: /^Reported/ }).click() // newest first
    const row = adminPage.getByRole('row').filter({ hasText: title })
    await row.waitFor({ timeout: 10000 })
    assert.ok(await row.getByText('Awaiting review').isVisible(), 'a pending issue shows its moderation state')
    await shot(adminPage, '02-admin-issues-table')
    await row.getByRole('link', { name: title }).click()
    await adminPage.getByRole('heading', { name: title }).waitFor()
    assert.equal(path_(adminPage), `/admin/issues/${issueId}`)
  })

  await step('admin approves: toast, status moves to Under review, the timeline records it', async () => {
    await maps(adminPage)
    await shot(adminPage, '03-admin-issue-pending')
    await adminPage.getByRole('button', { name: 'Approve and start review' }).click()
    await toast(adminPage, 'Issue approved and moved to review.')
    await stepper(adminPage).filter({ hasText: 'Under review' }).waitFor()
    const timeline = adminPage.getByRole('list', { name: 'Status history' })
    await timeline.getByText('Approved by moderator').waitFor()
    assert.equal(await timeline.locator('li').count(), 2)
  })

  await step('admin assigns it through the department -> officer picker', async () => {
    await adminPage.getByRole('button', { name: 'Assign to a department…' }).click()
    const dialog = adminPage.getByRole('dialog')
    await pick(dialog.getByLabel('Department'), new RegExp(DEPT))
    // only that department's officers are offered
    const options = await dialog.getByLabel('Officer').locator('option').allInnerTexts()
    assert.ok(options.some((o) => o.includes(officer.employee_reference)) && options.some((o) => o.includes(colleague.employee_reference)))
    assert.ok(!options.some((o) => /Rohit|Sunita|Deepak|Harish/.test(o)), 'officers of other departments must not be offered')
    await pick(dialog.getByLabel('Officer'), new RegExp(officer.employee_reference)) // refs are unique; names repeat across runs
    await shot(adminPage, '04-assign-dialog')
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click()
    await toast(adminPage, 'Issue assigned.')
    await stepper(adminPage).filter({ hasText: 'Assigned' }).waitFor()
    await adminPage.getByRole('region', { name: 'Assignment' }).getByText(new RegExp(officer.employee_reference)).waitFor()
  })

  // ---------------------------------------------------------------- officer: accept, note, resolve
  await step('officer signs in: Overview shows the new assignment awaiting acceptance (department analytics)', async () => {
    await signIn(officerPage, officer, '/officer')
    await officerPage.getByTestId('tile-awaiting').waitFor()
    // the shared test department may hold leftovers from earlier runs, so "at least one", not "exactly one"
    await officerPage.waitForFunction(() => Number(document.querySelector('[data-testid="tile-awaiting"] p')?.textContent?.trim()) >= 1)
    await officerPage.getByRole('region', { name: 'Needs your attention' }).locator('li').first().waitFor()
    assert.ok((await officerPage.locator('[data-testid="chart-status"] svg.recharts-surface').count()) > 0)
    await officerPage.waitForTimeout(1200)
    await shot(officerPage, '05-officer-overview')
  })

  await step('officer opens it from the queue and accepts', async () => {
    await officerPage.getByRole('link', { name: 'My queue' }).click()
    await officerPage.getByRole('button', { name: 'Awaiting acceptance' }).click()
    const row = officerPage.getByRole('row').filter({ hasText: title })
    await row.waitFor()
    await shot(officerPage, '06-officer-queue')
    await row.getByRole('link', { name: title }).click()
    await officerPage.getByRole('heading', { name: title }).waitFor()
    await maps(officerPage)
    await shot(officerPage, '07-officer-issue-accept')
    await officerPage.getByRole('button', { name: 'Accept assignment' }).click()
    await toast(officerPage, 'Assignment accepted. The issue is now in progress.')
    await stepper(officerPage).filter({ hasText: 'In progress' }).waitFor()
    await officerPage.getByRole('list', { name: 'Status history' }).getByText('Accepted by officer').waitFor()
  })

  await step('officer adds a private note; a colleague-less citizen API sees no trace of it', async () => {
    await officerPage.getByLabel('New note').fill('Site visited. Need cold-mix asphalt from the zonal depot.')
    await officerPage.getByRole('button', { name: 'Add note' }).click()
    await toast(officerPage, 'Note added.')
    await officerPage.getByRole('region', { name: 'Internal notes' }).getByText('Need cold-mix asphalt').waitFor()
    const publicView = JSON.stringify(await api('GET', `/issues/${issueId}/`))
    assert.ok(!publicView.includes('cold-mix'), 'notes must never reach a public endpoint')
  })

  await step('officer resolves: the dialog insists on a photo, then the issue becomes Resolved', async () => {
    await officerPage.getByRole('button', { name: 'Mark as resolved…' }).click()
    const dialog = officerPage.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Mark as resolved', exact: true }).click()
    await dialog.getByText('Add a photo that shows the finished work.').waitFor()
    await dialog.getByLabel('Upload photos').setInputFiles({ name: 'fixed.png', mimeType: 'image/png', buffer: makePng() })
    await dialog.getByAltText('Preview of fixed.png').waitFor()
    await dialog.getByLabel('What was done (optional)').fill('Filled and levelled with cold-mix asphalt')
    await shot(officerPage, '08-resolve-dialog')
    await dialog.getByRole('button', { name: 'Mark as resolved', exact: true }).click()
    await toast(officerPage, 'Issue marked as resolved.')
    await stepper(officerPage).filter({ hasText: 'Resolved' }).waitFor()
    await officerPage.getByRole('region', { name: 'Photos' }).getByAltText(`Resolution photo for ${title}`).waitFor()
    await officerPage.waitForTimeout(500)
    await shot(officerPage, '09-officer-issue-resolved')
  })

  // ---------------------------------------------------------------- admin: reopen + reassign
  await step('admin reopens it: a reason is mandatory (validation), then it is Reopened with the reason in the timeline', async () => {
    await adminPage.reload()
    await adminPage.getByRole('heading', { name: title }).waitFor()
    await stepper(adminPage).filter({ hasText: 'Resolved' }).waitFor()
    await adminPage.getByRole('button', { name: 'Reopen…' }).click()
    const dialog = adminPage.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Reopen issue' }).click()
    await dialog.getByText('Give a short reason (at least 3 characters)').waitFor()
    await dialog.getByLabel('Reason').fill('The pothole is back after the first rain')
    await shot(adminPage, '10-reopen-dialog')
    await dialog.getByRole('button', { name: 'Reopen issue' }).click()
    await toast(adminPage, 'Issue reopened.')
    await stepper(adminPage).filter({ hasText: 'Reopened' }).waitFor()
    await adminPage.getByRole('list', { name: 'Status history' }).getByText('The pothole is back after the first rain').waitFor()
    await adminPage.waitForTimeout(500)
    await shot(adminPage, '11-admin-issue-reopened')
  })

  await step('admin reassigns the reopened issue to the colleague (review + assignment recorded)', async () => {
    await adminPage.getByRole('button', { name: 'Reassign…' }).click()
    const dialog = adminPage.getByRole('dialog')
    await pick(dialog.getByLabel('Department'), new RegExp(DEPT))
    await pick(dialog.getByLabel('Officer'), new RegExp(colleague.employee_reference))
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click()
    await toast(adminPage, 'Issue assigned.')
    await stepper(adminPage).filter({ hasText: 'Assigned' }).waitFor()
    const steps = await adminPage.getByRole('list', { name: 'Status history' }).locator('li').allInnerTexts()
    assert.ok(steps.length >= 8, `reopen -> review -> assigned adds two rows (got ${steps.length})`)
  })

  await step('same department, different officer: the first officer can still read it but is NOT offered any action (assignment.is_mine)', async () => {
    await officerPage.reload() // the officer comes back to the page later and must see the current state
    await officerPage.getByRole('heading', { name: title }).waitFor()
    await officerPage.getByText(`Assigned to ${colleague.full_name}. Only they can act on it`).waitFor()
    assert.equal(await officerPage.getByRole('button', { name: 'Accept assignment' }).count(), 0)
    assert.equal(await officerPage.getByRole('button', { name: 'Send back…' }).count(), 0)
  })

  await step('an officer of ANOTHER department gets the friendly "Not in your queue" page (the API says 403)', async () => {
    const other = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    await signIn(other, { email: 'rohit.chauhan@demo.civicfix.test', password: ADMIN.password }, '/officer')
    await goto(other, `/officer/issues/${issueId}`)
    await other.getByText('Not in your queue').waitFor()
    await other.close()
  })

  // ---------------------------------------------------------------- officer sends back, admin rejects
  await step('the colleague sends it back with a reason; it returns to the admin as Under review', async () => {
    const colleaguePage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    await signIn(colleaguePage, colleague, '/officer')
    await goto(colleaguePage, `/officer/issues/${issueId}`)
    await colleaguePage.getByRole('heading', { name: title }).waitFor()
    await colleaguePage.getByRole('button', { name: 'Send back…' }).click()
    const dialog = colleaguePage.getByRole('dialog')
    await dialog.getByLabel('Reason').fill('This needs a drainage crew, not roads')
    await shot(colleaguePage, '12-send-back-dialog')
    await dialog.getByRole('button', { name: 'Send back', exact: true }).click()
    await toast(colleaguePage, 'Sent back to the admin for reassignment.')
    await colleaguePage.waitForURL((u) => u.pathname === '/officer/issues') // it left their queue: back to the list, not an error page
    await colleaguePage.getByRole('table', { name: 'Assigned issues' }).waitFor()
    assert.equal(await colleaguePage.getByRole('row').filter({ hasText: title }).count(), 0, 'it is no longer in their queue')
    await colleaguePage.close()
  })

  await step('admin rejects it with a reason: status Rejected, hidden from the public site', async () => {
    await adminPage.reload()
    await stepper(adminPage).filter({ hasText: 'Under review' }).waitFor()
    await adminPage.getByRole('button', { name: 'Reject…' }).click()
    const dialog = adminPage.getByRole('dialog')
    await dialog.getByLabel('Reason').fill('Duplicate of an existing report')
    await dialog.getByRole('button', { name: 'Reject issue' }).click()
    await toast(adminPage, 'Issue rejected.')
    await stepper(adminPage).filter({ hasText: 'Rejected' }).waitFor()
    await adminPage.getByText('This issue was rejected. That is final.').waitFor()
    const res = await fetch(`${API}/issues/${issueId}/`)
    assert.equal(res.status, 404, 'a rejected issue is not public')
    await shot(adminPage, '13-admin-issue-rejected')
  })

  // ---------------------------------------------------------------- comment moderation
  await step('comment moderation: a public comment is visible, admin hides it, it disappears for everyone', async () => {
    const citizenToken = await login(citizen)
    const categories = await api('GET', '/categories/')
    const second = await api('POST', '/issues/', {
      token: citizenToken,
      body: { category: categories[1].id, title: `${title} (comments)`, description: 'Second issue, used to test comment moderation.', latitude: 22.72, longitude: 75.86 },
    })
    await api('POST', `/admin/issues/${second.id}/approve/`, { token: adminToken })
    await api('POST', `/issues/${second.id}/comments/`, { token: citizenToken, body: { content: 'This comment should be hidden by a moderator' } })
    await goto(adminPage, `/admin/issues/${second.id}`)
    await adminPage.getByRole('heading', { name: `${title} (comments)` }).waitFor()
    const panel = adminPage.getByRole('region', { name: 'Comments' })
    await panel.getByText('This comment should be hidden by a moderator').waitFor()
    await panel.getByRole('button', { name: /Hide comment by/ }).click()
    await shot(adminPage, '14-hide-comment-dialog')
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Hide comment' }).click()
    await toast(adminPage, 'Comment hidden from public view.')
    await panel.getByText('No visible comments.').waitFor()
    const publicComments = await api('GET', `/issues/${second.id}/comments/`)
    assert.equal(publicComments.count, 0)
  })

  // ---------------------------------------------------------------- departments
  await step('Departments: create, edit (inactive), see the officer counts, delete; and add an officer from the page', async () => {
    const name = `E2E Dept ${stamp}`
    await goto(adminPage, '/admin/departments')
    await adminPage.getByRole('table', { name: 'Departments' }).waitFor()
    await shot(adminPage, '15-admin-departments')
    await adminPage.getByRole('button', { name: 'New department' }).click()
    let dialog = adminPage.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Create department' }).click()
    await dialog.getByText('Enter the department name').waitFor() // validation, nothing sent
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Create department' }).click()
    await toast(adminPage, 'Department created.')
    const row = adminPage.getByRole('row').filter({ hasText: name })
    await row.waitFor()
    // duplicate name -> server error on the field
    await adminPage.getByRole('button', { name: 'New department' }).click()
    dialog = adminPage.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name.toLowerCase())
    await dialog.getByRole('button', { name: 'Create department' }).click()
    await dialog.getByText('A department with this name already exists in this city.').waitFor()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    // add an officer to it from the row
    await row.getByRole('button', { name: `Add officer to ${name}` }).click()
    dialog = adminPage.getByRole('dialog')
    const added = { full_name: 'Row Added Officer', email: `row.officer.${stamp}@example.com`, password: 'Harbor-Violet-47-Kettle!', employee_reference: `RO-${stamp}` }
    await dialog.getByLabel('Full name').fill(added.full_name)
    await dialog.getByLabel('Email').fill(added.email)
    await dialog.getByLabel('Temporary password').fill(added.password)
    await dialog.getByLabel('Employee reference').fill(added.employee_reference)
    await shot(adminPage, '16-add-officer-dialog')
    await dialog.getByRole('button', { name: 'Create officer' }).click()
    await toast(adminPage, 'can now sign in as an officer.')
    await adminPage.getByRole('row').filter({ hasText: name }).getByText('1 officer').waitFor()
    assert.ok(await login({ email: added.email, password: added.password }), 'the new officer can sign in')
    // a department with officers cannot be deleted: the server's reason is shown
    await adminPage.getByRole('button', { name: `Delete ${name}` }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Delete department' }).click()
    await toast(adminPage, 'set is_active=false instead')
    await adminPage.keyboard.press('Escape')
    // switch it off instead
    await adminPage.getByRole('button', { name: `Edit ${name}` }).click()
    dialog = adminPage.getByRole('dialog')
    await dialog.getByRole('checkbox', { name: /Active/ }).uncheck()
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await toast(adminPage, 'Department updated.')
    await adminPage.getByRole('row').filter({ hasText: name }).getByText('Inactive').waitFor()
  })

  // ---------------------------------------------------------------- role gating
  await step('role gating (UX layer): officer cannot open /admin, admin cannot open /officer, anonymous goes to /login', async () => {
    await goto(officerPage, '/admin')
    await officerPage.waitForURL((u) => u.pathname === '/officer')
    await goto(adminPage, '/officer')
    await adminPage.waitForURL((u) => u.pathname === '/admin')
    await anonPage.goto(`${APP}/admin/issues`)
    await anonPage.getByRole('heading', { name: 'Log in' }).waitFor()
    assert.equal(path_(anonPage), '/login')
    // and the REAL boundary: the API refuses an officer token on admin endpoints
    const officerToken = await login(officer)
    const res = await fetch(`${API}/admin/analytics/`, { headers: { Authorization: `Bearer ${officerToken}` } })
    assert.equal(res.status, 403)
  })

  await step('after logout the staff session is gone: /officer needs a login again', async () => {
    await officerPage.getByRole('button', { name: 'Log out' }).click()
    await officerPage.getByRole('heading', { name: /fix your city/i }).waitFor()
    await anonPage.goto(`${APP}/officer`)
    await anonPage.getByRole('heading', { name: 'Log in' }).waitFor()
  })

  await step('no unexpected browser console errors during the whole run', async () => {
    const unexpected = consoleErrors.filter((e) => !/status of (401|403|404|409|400)|Failed to load resource/i.test(e))
    assert.deepEqual(unexpected, [])
  })

  console.log(`\nSTAFF E2E PASSED (${results.length} steps)`)
} catch {
  await shot(adminPage, 'FAILED-admin')
  await shot(officerPage, 'FAILED-officer')
  console.log(`\nSTAFF E2E FAILED at step ${results.length}: ${results.at(-1)?.[0]}`)
  console.log('Console errors:', consoleErrors)
  process.exitCode = 1
} finally {
  await browser.close()
}
