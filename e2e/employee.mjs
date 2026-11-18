// The "test as an employee" from the sprint profile: log in with a non-admin account, open every page in
// that person's menu and fail on any 403 / 5xx from /api or any uncaught page error. An admin sees
// everything, so a route that asks for the wrong feature only shows up here (2026-10-29: the "From"
// list on Email came from a route that needed email.setari).
//   E2E_BASE=http://localhost:5174 E2E_EMAIL=... E2E_PASSWORD=... node e2e/employee.mjs [/extra-page ...]
// Screenshots go to E2E_OUT (default e2e/out/).
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5174'
const { E2E_EMAIL: EMAIL, E2E_PASSWORD: PASSWORD } = process.env
const OUT = process.env.E2E_OUT ?? new URL('./out/', import.meta.url).pathname
if (!EMAIL || !PASSWORD) throw new Error('E2E_EMAIL and E2E_PASSWORD are required')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const problems = []
let current = '/login'

function watch(page) {
  page.on('pageerror', (e) => problems.push(`${current}: pageerror ${e.message.slice(0, 200)}`))
  page.on('response', (r) => {
    const { pathname } = new URL(r.url())
    if (!pathname.startsWith('/api/')) return
    if (r.status() === 403 || r.status() >= 500) problems.push(`${current}: ${r.status()} ${r.request().method()} ${pathname}`)
  })
}

const page = await context.newPage()
watch(page)
await page.goto(`${BASE}/login`)
await page.fill('input[type=email]', EMAIL)
await page.fill('input[type=password]', PASSWORD)
await page.keyboard.press('Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
await page.waitForSelector('aside nav a[href^="/"]', { timeout: 30_000 })

const menu = await page.$$eval('aside nav a[href^="/"]', (links) => links.map((a) => a.getAttribute('href')))
const paths = [...new Set([...menu, '/me', ...process.argv.slice(2)])]
console.log(`${EMAIL}: ${paths.length} pages (${paths.join(' ')})`)

for (const path of paths) {
  current = path
  await page.goto(BASE + path)
  // Wait for the page's own requests, not a fixed delay; a page that never settles still gets checked.
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => problems.push(`${path}: never went idle`))
  if (new URL(page.url()).pathname.startsWith('/login')) problems.push(`${path}: sent back to login`)
  const name = path === '/' ? 'home' : path.slice(1).replaceAll('/', '_')
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

await browser.close()
if (problems.length) {
  console.error(`FAIL\n${[...new Set(problems)].join('\n')}`)
  process.exit(1)
}
console.log('ok: no 403 / 5xx, no page errors')
