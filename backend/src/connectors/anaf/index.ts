import { unzipSync } from 'fflate'
import { config } from '../../shared/config.js'
import type {
  AccountingConnector,
  AnafInvoiceDocument,
  AnafSession,
  AnafUploadStatus,
  PlatformHealth,
  SpvMessage,
} from '../types.js'
import {
  isCreditNoteXml,
  parseUblInvoice,
  parseUblInvoiceOutgoing,
  parseUploadResponse,
  parseUploadStatusResponse,
  transformSpvMessage,
} from './transform.js'
import type { AnafEfacturaMessage, AnafListaMesajeResponse } from './types.js'
import { tr } from '../../shared/lib/i18n.js'

// Connector ANAF SPV / e-Factura. Toată logica specifică ANAF trăiește AICI.
// sandbox → api.anaf.ro/test (facturile nu au valoare fiscală), prod → api.anaf.ro/prod.

const FETCH_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_PAGES = 20

// ANAF documentează o limită de 1000 req/min pe aplicație — la burst-uri (mai
// ales în bucla de paginare) putem primi 429. Retry cu backoff exponențial,
// DOAR pe 429 (alte erori HTTP nu sunt tranzitorii, nu le retriem aici).
const MAX_RETRIES_429 = 3
const BACKOFF_MS = [500, 1000, 2000]

function baseUrl(): string {
  return config.anafEnv === 'prod'
    ? 'https://api.anaf.ro/prod/FCTEL/rest'
    : 'https://api.anaf.ro/test/FCTEL/rest'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Extrage delay-ul din header-ul Retry-After (secunde sau dată HTTP), dacă e prezent. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

async function anafGet(session: AnafSession, url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(tr('errors.anaf.tokenInvalid', { status: res.status }))
    }
    if (res.status === 429) {
      if (attempt === MAX_RETRIES_429) {
        throw new Error(tr('errors.anaf.rateLimited', { value: url.split('?')[0], MAX_RETRIES_429 }))
      }
      const delay = retryAfterMs(res) ?? BACKOFF_MS[attempt] ?? BACKOFF_MS.at(-1) ?? 2000
      console.warn(`[anaf] 429 rate limited, reîncerc în ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES_429})`)
      await sleep(delay)
      continue
    }
    if (!res.ok) throw new Error(`ANAF: ${url.split('?')[0]} returned HTTP ${res.status}`)
    return res
  }
  // Neatins — bucla fie întoarce, fie aruncă în interior.
  throw new Error('ANAF: retry loop exited unexpectedly')
}

async function listMessages(
  session: AnafSession,
  from: Date,
  to: Date,
): Promise<AnafEfacturaMessage[]> {
  const messages: AnafEfacturaMessage[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      startTime: String(from.getTime()),
      endTime: String(to.getTime()),
      cif: session.cif,
      pagina: String(page),
    })
    const res = await anafGet(session, `${baseUrl()}/listaMesajePaginatieFactura?${params}`)
    const payload = (await res.json()) as AnafListaMesajeResponse
    // "Nu exista mesaje" vine ca eroare — nu e o eroare reală, doar listă goală.
    if (payload.eroare) {
      if (/nu exista mesaje/i.test(payload.eroare)) break
      throw new Error(`ANAF listaMesaje: ${payload.eroare}`)
    }
    messages.push(...(payload.mesaje ?? []))
    if (page >= (payload.numar_total_pagini ?? 1)) break
  }
  return messages
}

/**
 * Descarcă ZIP-ul unui mesaj și extrage XML-ul facturii + PDF-ul vizual, dacă
 * există (nu semnătura — fișierele `semnatura*` sunt excluse din ambele
 * căutări). UI-ul SPV arată XML/PDF ca descărcări separate pentru facturile
 * primite — presupunem că vin din aceeași arhivă `descarcare`, la fel ca la
 * `fetchIncomingInvoices` (aceeași cerere HTTP, un singur zip). Dacă vreo
 * factură nu are PDF în arhivă, `pdf` rămâne `null` — nu blocăm sync-ul XML
 * pe lipsa lui.
 */
async function downloadInvoiceArchive(
  session: AnafSession,
  messageId: string,
): Promise<{ xml: string; pdf: Buffer | null }> {
  const res = await anafGet(session, `${baseUrl()}/descarcare?id=${messageId}`, DOWNLOAD_TIMEOUT_MS)
  const zip = new Uint8Array(await res.arrayBuffer())
  const files = unzipSync(zip)
  const xmlName = Object.keys(files).find((name) => name.endsWith('.xml') && !name.startsWith('semnatura'))
  if (!xmlName) throw new Error(tr('errors.anaf.zipNoXml', { messageId }))
  const pdfName = Object.keys(files).find((name) => name.endsWith('.pdf'))
  return {
    xml: new TextDecoder('utf-8').decode(files[xmlName]),
    pdf: pdfName ? Buffer.from(files[pdfName]!) : null,
  }
}

/**
 * Fallback PDF: arhiva `descarcare` a facturilor primite nu conține mereu un PDF vizual —
 * generăm unul via endpoint-ul oficial ANAF de transformare XML→PDF (același XSLT folosit
 * de portalul SPV). `xsi:schemaLocation` e eliminat din XML înainte de trimitere — bug
 * documentat ANAF, respinge cererea altfel ("The requested URL was rejected"). Failure
 * izolat — un PDF negenerat nu blochează sync-ul (rămâne `null`, XML-ul tot se arhivează).
 */
async function transformXmlToPdf(session: AnafSession, xml: string): Promise<Buffer | null> {
  const standard = isCreditNoteXml(xml) ? 'FCN' : 'FACT1'
  const cleaned = xml.replace(/\s+xsi:schemaLocation="[^"]*"/g, '')
  try {
    const res = await fetch(`${baseUrl()}/transformare/${standard}/DA`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'text/plain' },
      body: cleaned,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`[anaf] Transformare XML→PDF eșuată: ${String(err)}`)
    return null
  }
}

export const anafConnector: AccountingConnector = {
  type: 'anaf',
  displayName: 'ANAF SPV / e-Factura',

  async fetchIncomingInvoices(session: AnafSession, from: Date, to: Date, knownMessageIds: ReadonlySet<string>): Promise<AnafInvoiceDocument[]> {
    const messages = await listMessages(session, from, to)
    const incoming = messages.filter((m) => m.tip?.toUpperCase().includes('FACTURA PRIMITA') && !knownMessageIds.has(m.id))

    const invoices: AnafInvoiceDocument[] = []
    for (const message of incoming) {
      // Failure izolat per mesaj: o factură coruptă nu blochează restul descărcărilor.
      try {
        const { xml, pdf } = await downloadInvoiceArchive(session, message.id)
        invoices.push({ ...parseUblInvoice(xml, message), pdf: pdf ?? (await transformXmlToPdf(session, xml)) })
      } catch (err) {
        console.error(`[anaf] Descărcare/parsare eșuată pentru mesajul ${message.id}: ${String(err)}`)
      }
    }
    return invoices
  },

  async fetchOutgoingInvoices(session: AnafSession, from: Date, to: Date, knownMessageIds: ReadonlySet<string>): Promise<AnafInvoiceDocument[]> {
    const messages = await listMessages(session, from, to)
    const outgoing = messages.filter((m) => m.tip?.toUpperCase().includes('FACTURA TRIMISA') && !knownMessageIds.has(m.id))

    const invoices: AnafInvoiceDocument[] = []
    for (const message of outgoing) {
      try {
        const { xml, pdf } = await downloadInvoiceArchive(session, message.id)
        invoices.push({ ...parseUblInvoiceOutgoing(xml, message), pdf: pdf ?? (await transformXmlToPdf(session, xml)) })
      } catch (err) {
        console.error(`[anaf] Descărcare/parsare eșuată (emisă) pentru mesajul ${message.id}: ${String(err)}`)
      }
    }
    return invoices
  },

  async fetchSpvMessages(session: AnafSession, days: number): Promise<SpvMessage[]> {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
    const messages = await listMessages(session, from, to)
    return messages.map(transformSpvMessage)
  },

  async uploadInvoice(session: AnafSession, xml: string): Promise<{ uploadId: string }> {
    const params = new URLSearchParams({ standard: 'UBL', cif: session.cif })
    const res = await fetch(`${baseUrl()}/upload?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: xml,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`ANAF upload returned HTTP ${res.status}`)
    return parseUploadResponse(await res.text())
  },

  async checkUploadStatus(session: AnafSession, uploadId: string): Promise<AnafUploadStatus> {
    const res = await anafGet(session, `${baseUrl()}/stareMesaj?id_incarcare=${uploadId}`)
    return parseUploadStatusResponse(await res.text())
  },

  async checkHealth(session: AnafSession): Promise<PlatformHealth> {
    const startedAt = Date.now()
    try {
      const to = new Date()
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000)
      await listMessages(session, from, to)
      return { status: 'healthy', latencyMs: Date.now() - startedAt }
    } catch (err) {
      return { status: 'down', message: String(err) }
    }
  },
}
