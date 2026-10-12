import cron from 'node-cron'
import { eq, isNotNull, sql as rawSql } from 'drizzle-orm'
import { anafConnector } from '../connectors/anaf/index.js'
import type { AnafInvoiceDocument } from '../connectors/types.js'
import { db } from '../shared/db/client.js'
import { financialRecords, syncLog } from '../shared/db/schema/index.js'
import { getAnafCredentialsRow, getAnafSession } from '../shared/lib/anaf.js'
import { archiveInvoiceDocuments } from '../shared/lib/financial-archive.js'
import { saveDocument } from '../shared/lib/storage.js'

// Sync facturi primite + emise din SPV/e-Factura → financial_records
// (source=anaf_efactura). Rulează orar; failure izolat în sync_log, nu se propagă.

// Max permis de ANAF pe listaMesajePaginatieFactura e 60 zile — catch-up-ul inițial
// (2026-07-18) a rulat cu 60, mutat înapoi la 30 după ce Stefan a confirmat sync-ul.
const SYNC_WINDOW_DAYS = 30
const CRON_EXPR = '0 * * * *'

async function persistInvoiceDocuments(
  invoice: AnafInvoiceDocument,
  folder: 'incoming' | 'outgoing',
): Promise<{ xmlPath: string; pdfPath: string | null }> {
  const xmlPath = await saveDocument(
    `${folder}/${invoice.issuedAt.getUTCFullYear()}/anaf_${invoice.anafMessageId}.xml`,
    invoice.xml,
  )
  const pdfPath = invoice.pdf
    ? await saveDocument(`${folder}/${invoice.issuedAt.getUTCFullYear()}/anaf_${invoice.anafMessageId}.pdf`, invoice.pdf)
    : null
  return { xmlPath, pdfPath }
}

export function startAnafSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runAnafSync().catch(() => {
      /* deja logat în sync_log */
    })
  })
  console.log(`[sync-anaf] Scheduled (${CRON_EXPR})`)
}

export async function triggerAnafSyncNow(): Promise<{ imported: number }> {
  return runAnafSync()
}

async function runAnafSync(): Promise<{ imported: number }> {
  const credentials = await getAnafCredentialsRow()
  if (!credentials || credentials.status !== 'active') {
    // Fără credențiale active nu e o eroare de sync — pur și simplu nu avem ce rula.
    throw new Error('ANAF neconfigurat sau necesită reautentificare')
  }

  const [log] = await db
    .insert(syncLog)
    .values({ jobKey: `anaf:${credentials.cif}`, status: 'RUNNING' })
    .returning()
  if (!log) throw new Error('Failed to create sync_log entry')

  try {
    const session = await getAnafSession()
    const to = new Date()
    const from = new Date(to.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    let imported = 0

    // Mesajele deja legate anterior — trecute la connector ca să sară peste re-descărcarea
    // ZIP-ului lor (rate limit ANAF, 10 descărcări/zi/mesaj, lovit garantat altfel: sync-ul
    // orar re-descărca ORICE mesaj din fereastra de 30 zile la fiecare rulare, indiferent
    // dacă era deja sincronizat). Un singur SELECT global — tabela nu e la scară unde contează.
    const known = await db
      .select({ id: financialRecords.anafMessageId })
      .from(financialRecords)
      .where(isNotNull(financialRecords.anafMessageId))
    const knownMessageIds = new Set(known.map((r) => r.id as string))

    const incoming = await anafConnector.fetchIncomingInvoices(session, from, to, knownMessageIds)
    for (const invoice of incoming) {
      // XML-ul se arhivează mereu; PDF-ul e din arhiva ANAF sau, dacă lipsea, generat
      // via /transformare — vezi connectors/anaf/index.ts.
      const { xmlPath, pdfPath } = await persistInvoiceDocuments(invoice, 'incoming')
      const [row] = await db
        .insert(financialRecords)
        .values({
          type: 'invoice',
          direction: 'in',
          source: 'anaf_efactura',
          amount: invoice.amount.toFixed(2),
          currency: invoice.currency,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          documentNumber: null,
          counterpartyName: invoice.counterpartyName,
          counterpartyCif: invoice.counterpartyCif,
          anafMessageId: invoice.anafMessageId,
          xmlStoragePath: xmlPath,
          pdfStoragePath: pdfPath,
          description: invoice.documentNumber ? `Factura ${invoice.documentNumber}` : null,
          meta: invoice.meta,
        })
        .onConflictDoUpdate({
          // Re-sync-ul aceluiași mesaj actualizează valorile, nu duplică.
          target: financialRecords.anafMessageId,
          set: {
            amount: rawSql`EXCLUDED.amount`,
            dueAt: rawSql`EXCLUDED.due_at`,
            pdfStoragePath: rawSql`COALESCE(EXCLUDED.pdf_storage_path, ${financialRecords.pdfStoragePath})`,
            updatedAt: new Date(),
          },
        })
        .returning()
      imported++

      // Arhivare best-effort (Contabilitate/LL-AAAA/Facturi furnizori/<contraparte>) — DOAR
      // pt. mesaje văzute acum prima dată (INSERT nou), nu la fiecare re-sync al aceluiași
      // mesaj (fereastra de 30 zile face re-conflict pe aceleași rânduri la fiecare rulare
      // orară). createdAt === updatedAt e un semnal fiabil de INSERT proaspăt — `now()` e
      // stabil per-tranzacție în Postgres, deci ambele coloane iau aceeași valoare la INSERT;
      // la conflict, updatedAt e suprascris explicit mai sus, deci devine ulterior lui createdAt.
      // Cerință explicită Stefan: nu re-arhiva istoricul deja organizat manual din Drive.
      const isNewlyInserted = row && row.createdAt.getTime() === row.updatedAt.getTime()
      if (isNewlyInserted) {
        await archiveInvoiceDocuments({
          direction: 'in',
          issuedAt: invoice.issuedAt,
          counterpartyName: invoice.counterpartyName,
          counterpartyCif: invoice.counterpartyCif,
          documentNumber: invoice.documentNumber,
          anafMessageId: invoice.anafMessageId,
          pdfStoragePath: row.pdfStoragePath,
          xmlStoragePath: row.xmlStoragePath,
        })
      }
    }

    const outgoing = await anafConnector.fetchOutgoingInvoices(session, from, to, knownMessageIds)
    for (const invoice of outgoing) {
      // Fără număr de document nu avem cum să dedup-ăm — sărim, nu blocăm restul sync-ului.
      if (!invoice.documentNumber) {
        console.error(`[sync-anaf] Factură emisă fără număr, sar peste (mesaj ${invoice.anafMessageId})`)
        continue
      }
      // Semnal pt. "am mai legat sync-anaf rândul ăsta de ANAF înainte?" — spre deosebire de
      // bucla de primite (unde dedup e chiar pe anafMessageId), aici dedup e pe documentNumber,
      // deci un conflict poate însemna fie "sync-anaf a mai văzut factura asta" (nu re-arhiva —
      // istoric deja organizat manual), fie "factura a fost emisă acum câteva minute prin
      // vana-dash (invoicing/service.ts) și abia acum o leagă sync-anaf de ANAF pentru prima
      // oară" (arhivează — cazul "de acum încolo" cerut de Stefan, inclusiv a treia copie,
      // PDF-ul ANAF). anafMessageId e null pe rândul creat la `issue`, populat DOAR de aici.
      const [existingBefore] = await db
        .select({ anafMessageId: financialRecords.anafMessageId })
        .from(financialRecords)
        .where(eq(financialRecords.documentNumber, invoice.documentNumber))
      const alreadyLinkedByAnaf = Boolean(existingBefore?.anafMessageId)

      const { xmlPath, pdfPath } = await persistInvoiceDocuments(invoice, 'outgoing')
      const [row] = await db
        .insert(financialRecords)
        .values({
          type: 'invoice',
          direction: 'out',
          source: 'anaf_efactura',
          amount: invoice.amount.toFixed(2),
          currency: invoice.currency,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          documentNumber: invoice.documentNumber,
          counterpartyName: invoice.counterpartyName,
          counterpartyCif: invoice.counterpartyCif,
          anafMessageId: invoice.anafMessageId,
          anafStatus: 'validated',
          xmlStoragePath: xmlPath,
          pdfStoragePath: pdfPath,
          meta: invoice.meta,
        })
        .onConflictDoUpdate({
          // Cheia reală e numărul de document — dacă factura există deja local (emisă
          // prin vana-dash, source='generated'), doar completăm metadatele ANAF pe rândul
          // existent, NU-i suprascriem suma/contrapartea (sursa noastră rămâne autoritativă
          // pt. propriile facturi emise).
          target: financialRecords.documentNumber,
          set: {
            anafMessageId: rawSql`EXCLUDED.anaf_message_id`,
            anafStatus: rawSql`EXCLUDED.anaf_status`,
            xmlStoragePath: rawSql`COALESCE(${financialRecords.xmlStoragePath}, EXCLUDED.xml_storage_path)`,
            pdfStoragePath: rawSql`COALESCE(${financialRecords.pdfStoragePath}, EXCLUDED.pdf_storage_path)`,
            updatedAt: new Date(),
          },
        })
        .returning()
      imported++

      // Arhivare best-effort — pdfStoragePath/xmlStoragePath de pe `row` sunt cele proprii
      // (COALESCE le păstrează pe ale noastre dacă existau), `pdfPath` de mai sus e PDF-ul
      // randat de ANAF pt. aceeași factură, arhivat separat ca a treia copie (regula #7).
      if (row && !alreadyLinkedByAnaf) {
        await archiveInvoiceDocuments({
          direction: 'out',
          issuedAt: invoice.issuedAt,
          counterpartyName: invoice.counterpartyName,
          counterpartyCif: invoice.counterpartyCif,
          documentNumber: invoice.documentNumber,
          anafMessageId: invoice.anafMessageId,
          pdfStoragePath: row.pdfStoragePath,
          xmlStoragePath: row.xmlStoragePath,
          anafPdfStoragePath: pdfPath,
        })
      }
    }

    await db
      .update(syncLog)
      .set({ status: 'SUCCESS', recordsSync: imported, finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    return { imported }
  } catch (err) {
    await db
      .update(syncLog)
      .set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    throw err
  }
}
