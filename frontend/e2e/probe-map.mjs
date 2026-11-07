// Diagnostic: does the live map render, is WebGL available, and which hosts serve the tiles?
//   node e2e/probe-map.mjs [path]      (needs `npm run dev` + backend running)
import path from 'node:path'

import { chromium } from 'playwright-core'

const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const target = process.argv[2] ?? '/explore?view=map'

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage()

const hosts = {}
const failed = []
page.on('response', (r) => {
  const host = new URL(r.url()).host
  hosts[host] = (hosts[host] ?? 0) + 1
  if (host.includes('openfreemap') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
})
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`))

await page.goto(APP + target)
try {
  await page.getByRole('region').first().waitFor({ timeout: 20000 })
} catch {
  console.log('NO MAP REGION. page text:', (await page.locator('body').innerText()).slice(0, 400))
}
await page.waitForTimeout(6000)

console.log('webgl     :', await page.evaluate(() => !!(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl'))))
console.log('gl canvas :', await page.locator('canvas.maplibregl-canvas').count())
console.log('pins      :', await page.locator('.leaflet-marker-icon').count())
console.log('hosts     :', JSON.stringify(hosts))
console.log('failed    :', failed)
console.log('errors    :', errors)
if (process.env.E2E_SHOTS_DIR) {
  await page.screenshot({ path: path.join(process.env.E2E_SHOTS_DIR, 'probe-map.png') })
}
await browser.close()
