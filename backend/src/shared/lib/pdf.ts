import puppeteer, { type Browser } from 'puppeteer-core'
import { tr } from './i18n.js'
import { addSignatureFields, MARK_SIGNATURE_AREAS } from './pdf-signature-fields.js'

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

export interface HtmlToPdfOptions {
  /** Empty signature fields over the "Semnătură" lines, except those of the party with this name (our own company). */
  signatureFields?: boolean | { skipPartyName?: string }
  /**
   * For HTML a user wrote (contract templates): no JavaScript and no request leaves the page, so an
   * <img src="http://internal-host/"> cannot reach the network from the server. Only data: URLs load.
   * Signature fields then come from the marker links already in the HTML (see markSignatureRoles).
   */
  isolated?: boolean
  /** Only the network off; the page script that marks the signature lines still runs (the SaaS templates). */
  offline?: boolean
}

export async function htmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    if (options.isolated) await page.setJavaScriptEnabled(false)
    if (options.isolated || options.offline) {
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = request.url()
        if (url.startsWith('data:') || url === 'about:blank') void request.continue()
        else void request.abort('blockedbyclient')
      })
    }
    await page.setContent(html, { waitUntil: 'load' })
    if (options.signatureFields && !options.isolated) {
      const skip = typeof options.signatureFields === 'object' ? options.signatureFields.skipPartyName ?? '' : ''
      await page.evaluate(MARK_SIGNATURE_AREAS(skip))
    }
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    })
    return Buffer.from(options.signatureFields ? await addSignatureFields(pdf) : pdf)
  } finally {
    await page.close()
  }
}
