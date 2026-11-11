// Visual review helper: sign in as a seeded demo user and screenshot pages in a real browser.
//
//   node e2e/shoot.mjs <officer|admin|citizen|anon> <path> [<path> ...]      (anon = signed out: landing, login, explore...)
//
// Env: SHOTS_DIR (required), SHOT_EMAIL (sign in as someone else),  DEMO_PASSWORD (default: the seed_demo password), SHOT_WIDTH (default 1440),
//      SHOT_FULL=0 for viewport-only. Needs `npm run dev` + the backend, and `manage.py seed_demo` data.
import fs from 'node:fs'
import path from 'node:path'

import { chromium } from 'playwright-core'

const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DIR = process.env.SHOTS_DIR
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass-2026!x'
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440)
const FULL = process.env.SHOT_FULL !== '0'
const USERS = {
  officer: 'rohit.chauhan@demo.civicfix.test',
  admin: 'admin@demo.civicfix.test',
  citizen: 'aarav.sharma@demo.civicfix.test',
}

const [role, ...paths] = process.argv.slice(2)
if (!DIR || (role !== 'anon' && !USERS[role]) || paths.length === 0) {
  console.error('usage: SHOTS_DIR=... node e2e/shoot.mjs <officer|admin|citizen|anon> <path> [<path>...]')
  process.exit(2)
}
fs.mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`))

if (role === 'anon') {
  await page.goto(`${APP}/`)
} else {
  await page.goto(`${APP}/login`)
  await page.getByLabel('Email').fill(process.env.SHOT_EMAIL ?? USERS[role])
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 })
}

for (const target of paths) {
  // client-side navigation keeps the in-memory token (a hard goto would reload and re-bootstrap the session)
  await page.evaluate((to) => {
    window.history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, target)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(1800) // charts animate in (600 ms) and lazy chunks resolve
  // a map region: wait until it has really painted (a blank one is a few KB), so the shot shows tiles
  const maps = page.locator('[role="region"]:has(canvas.maplibregl-canvas)')
  for (let i = 0; i < (await maps.count()); i++) {
    for (let t = 0; t < 20; t++) {
      if ((await maps.nth(i).screenshot()).length > 25_000) break
      await page.waitForTimeout(750)
    }
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(250)
  const name = target.replace(/^\//, '').replace(/[/?=&]+/g, '-') || 'root'
  const file = path.join(DIR, `${role}-${name}.png`)
  await page.screenshot({ path: file, fullPage: FULL })
  console.log(`saved ${file}`)
}
if (errors.length) console.log('console errors:', errors)
await browser.close()
