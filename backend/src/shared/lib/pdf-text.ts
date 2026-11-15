import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ExtractedInvoiceHints {
  documentNumber: string | null
  amount: number | null
  currency: 'RON' | 'EUR' | 'USD' | null
  issuedAt: string | null
}

/**
 * Extracts raw text from the first two pages of a PDF using `pdftotext` (poppler-utils,
 * already installed in the production image for `pdftoppm`). Best-effort: returns null if
 * the binary is unavailable, the file is encrypted, or extraction times out.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string | null> {
  if (!pdfBuffer || pdfBuffer.byteLength < 8 || !pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return null
  }
  const dir = await mkdtemp(join(tmpdir(), 'pdf-text-'))
  try {
    const inputPath = join(dir, 'input.pdf')
    await writeFile(inputPath, pdfBuffer)
    const { stdout } = await execFileAsync('pdftotext', ['-f', '1', '-l', '2', '-layout', inputPath, '-'], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    })
    return typeof stdout === 'string' && stdout.trim() ? stdout : null
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function parseAmountString(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!cleaned) return null
  // Handle European '1.234,56' vs US '1,234.56' vs simple '49.50' / '49,50'.
  let normalized = cleaned
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1
    normalized = decimals === 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  }
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 && value < 10_000_000 ? Math.round(value * 100) / 100 : null
}

function detectCurrency(snippet: string): 'RON' | 'EUR' | 'USD' | null {
  if (/\bUSD\b|\$/i.test(snippet)) return 'USD'
  if (/\bEUR\b|€/i.test(snippet)) return 'EUR'
  if (/\bRON\b|\bLEI\b/i.test(snippet)) return 'RON'
  return null
}

/**
 * Deterministic regex extraction of invoice number, total amount, currency, and issue date
 * from PDF text (covers Stripe/Anthropic, Hetzner, and common EN/RO/DE supplier layouts).
 * Used strictly as a pre-fill on `needs_review = true` records or the manual import dialog.
 */
export function extractInvoiceHintsFromText(text: string): ExtractedInvoiceHints {
  if (!text || !text.trim()) {
    return { documentNumber: null, amount: null, currency: null, issuedAt: null }
  }

  let documentNumber: string | null = null
  const docPatterns = [
    /Invoice\s+number\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{2,30})/i,
    /Rechnungsnummer\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{2,30})/i,
    /Invoice\s*#\s*([A-Z0-9][A-Z0-9._/-]{2,30})/i,
    /Factur[aă]\s+(?: seria\s+[A-Z0-9]+\s+)?nr\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]{1,30})/i,
  ]
  for (const pattern of docPatterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      documentNumber = match[1].trim()
      break
    }
  }

  let amount: number | null = null
  let currency: 'RON' | 'EUR' | 'USD' | null = null
  const amountPatterns = [
    /(?:Amount\s+due|Amount\s+paid|Total\s+due|Total\s+de\s+plat[aă]|Gesamtbetrag|Bruttobetrag|Total)\s*(?:\([^)]*\))?\s*[:=]?\s*(?:(USD|EUR|RON|LEI|\$|€)\s*)?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(USD|EUR|RON|LEI|\$|€)?/i,
    /(USD|EUR|RON|\$|€)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s+(?:due|paid)/i,
  ]
  for (const pattern of amountPatterns) {
    const match = text.match(pattern)
    if (match) {
      const rawNum = match[2] ?? ''
      const parsed = parseAmountString(rawNum)
      if (parsed !== null && parsed > 0) {
        amount = parsed
        currency = detectCurrency(`${match[1] ?? ''} ${match[3] ?? ''}`)
        break
      }
    }
  }
  if (!currency) {
    currency = detectCurrency(text)
  }

  let issuedAt: string | null = null
  // ISO or DD.MM.YYYY or Month DD, YYYY
  const isoMatch = text.match(/(?:Date\s+of\s+issue|Invoice\s+date|Rechnungsdatum|Data\s+emiterii|Date)\s*[:#]?\s*(\d{4}-\d{2}-\d{2})/i)
  if (isoMatch?.[1]) {
    issuedAt = isoMatch[1]
  } else {
    const dmyMatch = text.match(/(?:Date\s+of\s+issue|Invoice\s+date|Rechnungsdatum|Data\s+emiterii|Date)\s*[:#]?\s*(\d{2})[./](\d{2})[./](\d{4})/i)
    if (dmyMatch?.[1] && dmyMatch[2] && dmyMatch[3]) {
      issuedAt = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`
    } else {
      const enDateMatch = text.match(
        /(?:Date\s+of\s+issue|Invoice\s+date|Date)\s*[:#]?\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/i,
      )
      if (enDateMatch?.[1] && enDateMatch[2] && enDateMatch[3]) {
        const parsedDate = new Date(`${enDateMatch[1]} ${enDateMatch[2]}, ${enDateMatch[3]} UTC`)
        if (!Number.isNaN(parsedDate.getTime())) {
          issuedAt = parsedDate.toISOString().slice(0, 10)
        }
      }
    }
  }

  return { documentNumber, amount, currency, issuedAt }
}

export async function extractInvoiceHintsFromPdf(pdfBuffer: Buffer): Promise<ExtractedInvoiceHints> {
  const text = await extractPdfText(pdfBuffer)
  if (!text) return { documentNumber: null, amount: null, currency: null, issuedAt: null }
  return extractInvoiceHintsFromText(text)
}
