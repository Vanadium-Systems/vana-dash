import puppeteer, { type Browser } from 'puppeteer-core'
import { tr } from './i18n.js'

// Browser singleton pentru generarea PDF — pattern identic cu vanagreen.
// puppeteer-core (fără Chromium bundled): executabilul vine din PUPPETEER_EXECUTABLE_PATH
// (pachetul chromium din imaginea Docker / instalat local). Fără el, PDF-ul se sare
// elegant (facturile păstrează HTML-ul și XML-ul; PDF-ul se poate regenera ulterior).

let cachedBrowser: Browser | null = null
let pendingLaunch: Promise<Browser> | null = null

export function isPdfAvailable(): boolean {
  return Boolean(process.env.PUPPETEER_EXECUTABLE_PATH)
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (!executablePath) throw new Error(tr('errors.pdf.puppeteerMissing'))
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  })
}

export async function getBrowser(): Promise<Browser> {
  if (cachedBrowser?.connected) return cachedBrowser
  if (pendingLaunch) return pendingLaunch
  pendingLaunch = launchBrowser()
    .then((browser) => {
      cachedBrowser = browser
      browser.once('disconnected', () => {
        if (cachedBrowser === browser) cachedBrowser = null
      })
      return browser
    })
    .finally(() => {
      pendingLaunch = null
    })
  return pendingLaunch
}

export async function closeBrowser(): Promise<void> {
  const browser = cachedBrowser
  cachedBrowser = null
  if (!browser) return
  try {
    await browser.close()
  } catch {
    /* best-effort */
  }
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}
