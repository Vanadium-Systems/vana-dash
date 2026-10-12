import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne } from 'drizzle-orm'
import type { z } from 'zod'
import { anafConnector } from '../../connectors/anaf/index.js'
import { computeTotals } from '../../connectors/anaf/xml-builder.js'
import type { UblInvoiceInput } from '../../connectors/anaf/types.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import {
  billingClients,
  financialRecords,
  invoiceLineItems,
  invoiceSequences,
  invoiceTemplates,
} from '../../shared/db/schema/index.js'
import { getAnafSession } from '../../shared/lib/anaf.js'
import { getRateForDate } from '../../shared/lib/bnr.js'
import { generateInvoiceDocuments } from '../../shared/lib/documents.js'
import { countyNameToIsoCode, extractBucharestSectorCode } from '../../shared/lib/ro-counties.js'
import { nextInvoiceNumber, type DrizzleTx } from '../../shared/lib/sequences.js'
import { readDocument } from '../../shared/lib/storage.js'
import type {
  ClientCreateSchema,
  ClientUpdateSchema,
  InvoiceCreateSchema,
  InvoiceLine,
  InvoiceTemplateCreateSchema,
  InvoiceTemplateLine,
  InvoiceTemplateUpdateSchema,
  InvoiceUpdateSchema,
  SequenceUpdateSchema,
} from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

// ── Billing clients ──────────────────────────────────────────────────────────

// isDemo exclus aici — sunt scheletele sincronizate din tenanții demo vanagreen
// (jobs/vanagreen-tenant-sync.ts), afișate SEPARAT în UI (ClientsTab.tsx, tabelul „Clienți
// demo") ca să nu se amestece cu clienții reali în listă/dropdown-uri de facturare.
// pendingDeletionAt exclus (2026-08-11) — tenant reziliat în vanagreen, afișat separat în
// tabelul „Clienți în ștergere" (vezi listPendingDeletionClients mai jos).
export async function listClients() {
  return db
    .select()
    .from(billingClients)
    .where(and(isNull(billingClients.deletedAt), eq(billingClients.isDemo, false), isNull(billingClients.pendingDeletionAt)))
    .orderBy(asc(billingClients.name))
}

export async function listDemoClients() {
  return db
    .select()
    .from(billingClients)
    .where(and(isNull(billingClients.deletedAt), eq(billingClients.isDemo, true), isNull(billingClients.pendingDeletionAt)))
    .orderBy(asc(billingClients.name))
}

/** Clienți al căror tenant vanagreen a fost reziliat (2026-08-11) — vor fi soft-deletați local
 *  automat de `jobs/vanagreen-tenant-sync.ts` la 30 zile de la `pendingDeletionAt`, în ritm cu
 *  purge-cron-ul din vanagreen. Tab separat ca Stefan să prindă din timp facturi neregularizate
 *  înainte de purjare. */
export async function listPendingDeletionClients() {
  return db
    .select()
    .from(billingClients)
    .where(and(isNull(billingClients.deletedAt), isNotNull(billingClients.pendingDeletionAt)))
    .orderBy(asc(billingClients.pendingDeletionAt))
}

export async function getClient(id: string) {
  const [row] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, id), isNull(billingClients.deletedAt)))
  return row ?? null
}

// numeric(precision,scale) în drizzle cere string la insert/update — zod ne dă number.
function toNumericInput<T extends { subscriptionPriceLei?: number | null; subscriptionPriceEur?: number | null }>(
  input: T,
) {
  return {
    ...input,
    ...(input.subscriptionPriceLei !== undefined
      ? { subscriptionPriceLei: input.subscriptionPriceLei === null ? null : String(input.subscriptionPriceLei) }
      : {}),
    ...(input.subscriptionPriceEur !== undefined
      ? { subscriptionPriceEur: input.subscriptionPriceEur === null ? null : String(input.subscriptionPriceEur) }
      : {}),
  }
}

export async function createClient(input: z.infer<typeof ClientCreateSchema>) {
  const [row] = await db
    .insert(billingClients)
    .values({ ...toNumericInput(input), ...createdByUserId(), ...updatedByUserId() })
    .returning()
  await recordAudit({
    action: 'client.creat',
    entityType: 'billing_client',
    entityId: row?.id ?? null,
    changes: { name: [null, input.name] },
  })
  return row
}

export async function updateClient(id: string, input: z.infer<typeof ClientUpdateSchema>) {
  const [row] = await db
    .update(billingClients)
    .set({ ...toNumericInput(input), updatedAt: new Date(), ...updatedByUserId() })
    .where(and(eq(billingClients.id, id), isNull(billingClients.deletedAt)))
    .returning()
  if (row) {
    await recordAudit({
      action: 'client.modificat',
      entityType: 'billing_client',
      entityId: row.id,
      changes: { fields: [null, Object.keys(input).join(', ')] },
    })
  }
  return row ?? null
}

export async function softDeleteClient(id: string): Promise<boolean> {
  const [row] = await db
    .update(billingClients)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(billingClients.id, id), isNull(billingClients.deletedAt)))
    .returning({ id: billingClients.id })
  return Boolean(row)
}

// ── Facturi emise ────────────────────────────────────────────────────────────
// Ciclu de viață: draft (fără număr) → issued (număr + XML/PDF) → pending (upload
// ANAF) → validated/rejected. Editabil doar cât e draft.

const invoiceColumns = {
  id: financialRecords.id,
  amount: financialRecords.amount,
  currency: financialRecords.currency,
  description: financialRecords.description,
  issuedAt: financialRecords.issuedAt,
  dueAt: financialRecords.dueAt,
  paymentStatus: financialRecords.paymentStatus,
  paidAt: financialRecords.paidAt,
  documentNumber: financialRecords.documentNumber,
  billingClientId: financialRecords.billingClientId,
  counterpartyName: financialRecords.counterpartyName,
  counterpartyCif: financialRecords.counterpartyCif,
  anafUploadId: financialRecords.anafUploadId,
  anafStatus: financialRecords.anafStatus,
  createdAt: financialRecords.createdAt,
}

function computeAmount(lines: InvoiceLine[]): string {
  return computeTotals(lines).taxInclusiveAmount.toFixed(2)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

type SubscriptionPriceFields = {
  name: string
  subscriptionPriceCurrency: 'lei' | 'eur'
  subscriptionPriceLei: string | null
  subscriptionPriceEur: string | null
  // Sprint Referral discount status (2026-08-12) — reducere pending, scrisă de
  // maybeGrantReferralDiscount (modules/reconciliation/vanagreen-extension.ts). Ambele null =
  // fără reducere pending.
  referralDiscountPendingAmount: string | null
  referralDiscountPendingCurrency: 'lei' | 'eur' | null
}

/** BNR cotează mereu RON per 1 unitate valută (`getRateForDate`) — RON e pivotul pt.
 *  conversia între oricare 2 valute suportate (RON/EUR/USD). */
async function convertAmount(amount: number, from: string, to: string, dateIso: string): Promise<number> {
  if (from === to) return amount
  if (from === 'RON') {
    const rate = Number((await getRateForDate(dateIso, to)).rate)
    return amount / rate
  }
  if (to === 'RON') {
    const rate = Number((await getRateForDate(dateIso, from)).rate)
    return amount * rate
  }
  const fromRate = Number((await getRateForDate(dateIso, from)).rate)
  const toRate = Number((await getRateForDate(dateIso, to)).rate)
  return (amount * fromRate) / toRate
}

/** Prețul curent de abonament al clientului, convertit (dacă e nevoie) la moneda facturii —
 *  altfel un abonament EUR pe o factură RON ar ajunge cu numărul EUR scris direct ca RON.
 *  Dacă clientul are o reducere referral pending, o aplică aici (convertită la
 *  `targetCurrency`, plafonată la 90% din prețul curent — plafonul se calculează cu prețul
 *  CURENT, nu cel de la grant, vezi PLAN §4/Risks). `discountApplied` = 0 fără pending. */
async function resolveClientSubscriptionPrice(
  client: SubscriptionPriceFields,
  targetCurrency: string,
  dateIso: string,
): Promise<{ price: number; discountApplied: number }> {
  const clientCurrency = client.subscriptionPriceCurrency === 'eur' ? 'EUR' : 'RON'
  const raw = client.subscriptionPriceCurrency === 'eur' ? client.subscriptionPriceEur : client.subscriptionPriceLei
  if (raw === null) {
    throw new Error(
      tr('errors.invoicing.noSubscriptionPrice', { name: client.name }),
    )
  }
  const resolvedPrice = round2(await convertAmount(Number(raw), clientCurrency, targetCurrency, dateIso))

  if (client.referralDiscountPendingAmount === null) {
    return { price: resolvedPrice, discountApplied: 0 }
  }

  const pendingCurrency = client.referralDiscountPendingCurrency === 'eur' ? 'EUR' : 'RON'
  const convertedDiscount = await convertAmount(
    Number(client.referralDiscountPendingAmount),
    pendingCurrency,
    targetCurrency,
    dateIso,
  )
  const cap = resolvedPrice * 0.9
  const discountApplied = round2(Math.min(convertedDiscount, cap))
  return { price: round2(resolvedPrice - discountApplied), discountApplied }
}

/** Rezolvă liniile unui template la valori concrete de pus pe factură: liniile cu preț fix
 *  rămân neschimbate, cele cu `priceSource: 'client_subscription'` iau prețul curent al
 *  clientului (convertit la `targetCurrency` prin curs BNR dacă diferă de moneda abonamentului),
 *  cu reducerea referral pending aplicată dacă există. Rezoluția se face la momentul apelului
 *  (nu e un link viu) — un draft rămâne editabil după. `discountConsumed` = true dacă vreo
 *  linie a avut o reducere aplicată — apelantul (createDraftInvoice) decide dacă o consumă.
 *  Secvențial (nu Promise.all) — dacă template-ul are 2+ linii `client_subscription`, reducerea
 *  pending se aplică o singură dată (pe prima), nu independent pe fiecare linie. */
export async function resolveTemplateLines(
  lineItems: InvoiceTemplateLine[],
  client: SubscriptionPriceFields,
  targetCurrency: string,
  dateIso: string,
): Promise<{ lines: InvoiceLine[]; discountConsumed: boolean }> {
  let discountConsumed = false
  let remainingDiscountClient = client
  const lines: InvoiceLine[] = []
  for (const li of lineItems) {
    if (li.priceSource !== 'client_subscription') {
      lines.push({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice ?? 0, vatRate: li.vatRatePct })
      continue
    }
    const { price, discountApplied } = await resolveClientSubscriptionPrice(remainingDiscountClient, targetCurrency, dateIso)
    if (discountApplied > 0) {
      discountConsumed = true
      remainingDiscountClient = { ...remainingDiscountClient, referralDiscountPendingAmount: null, referralDiscountPendingCurrency: null }
    }
    lines.push({ description: li.description, quantity: li.quantity, unitPrice: price, vatRate: li.vatRatePct })
  }
  return { lines, discountConsumed }
}

/** Cursul BNR pt. un preț introdus în altă valută decât factura (ex: linie în EUR pe o
 *  factură RON) — folosit de InvoiceFormDialog ca să calculeze unitPrice-ul convertit,
 *  fără să pună conversia pe umerii lui Stefan. */
export async function getExchangeRateForInvoicing(currency: string, dateIso?: string) {
  return getRateForDate(dateIso ?? new Date().toISOString().slice(0, 10), currency)
}

/** Idempotency pt. `jobs/vanagreen-billing.ts` — nu emite a doua factură pt. același
 *  client în aceeași zi dacă job-ul rulează de 2 ori (restart, retry). */
export async function hasInvoiceForClientOnDate(billingClientId: string, dateIso: string): Promise<boolean> {
  const dayStart = new Date(`${dateIso}T00:00:00.000Z`)
  const dayEnd = new Date(`${dateIso}T23:59:59.999Z`)
  const [row] = await db
    .select({ id: financialRecords.id })
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.billingClientId, billingClientId),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.source, 'generated'),
        isNull(financialRecords.deletedAt),
        gte(financialRecords.issuedAt, dayStart),
        lte(financialRecords.issuedAt, dayEnd),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function listInvoices() {
  return db
    .select(invoiceColumns)
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.source, 'generated'),
      ),
    )
    .orderBy(desc(financialRecords.createdAt))
}

async function getGeneratedInvoice(id: string) {
  const [row] = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.id, id),
        eq(financialRecords.source, 'generated'),
        isNull(financialRecords.deletedAt),
      ),
    )
  return row ?? null
}

export async function createDraftInvoice(input: z.infer<typeof InvoiceCreateSchema>) {
  const client = await getClient(input.billingClientId)
  if (!client) throw new Error(tr('errors.invoicing.billingClientNotFound'))

  // Sprint D, Track 3 — templateId opțional: serverul copiază lineItems/currency din
  // template ca valori INIȚIALE (draft-ul rămâne editabil, nu e un link viu la template).
  // `input.lines` explicit, dacă e prezent, câștigă peste template (cazul "factură specială"
  // pornită dintr-un template dar cu linii proprii).
  let lines = input.lines
  let currency = input.currency
  let discountConsumed = false

  if (input.templateId) {
    if (!client.platformId) throw new Error(tr('errors.invoicing.clientNotMapped'))
    const template = await getPlatformTemplate(client.platformId, input.templateId)
    if (!template) throw new Error(tr('errors.invoicing.templateNotFound'))
    currency = currency ?? template.currency
    if (!lines) {
      const dateIso = (input.issuedAt ?? new Date()).toISOString().slice(0, 10)
      const resolved = await resolveTemplateLines(template.lineItems as InvoiceTemplateLine[], client, currency, dateIso)
      lines = resolved.lines
      discountConsumed = resolved.discountConsumed
    }
  }

  if (!lines || lines.length === 0) {
    throw new Error(tr('errors.invoicing.needsLine'))
  }
  const finalLines = lines
  const finalCurrency = currency ?? 'RON'
  const finalIssuedAt = input.issuedAt ?? new Date()

  // Scadență: dacă nu vine explicit (nici din formular, nici din job-ul de facturare
  // automată — jobs/vanagreen-billing.ts nu o trimite), calculăm issuedAt + termen de plată.
  // Termenul e o excepție per client (contracte diferite — ex. un client are 15 zile,
  // nu 10, vezi billing-clients.ts), cu fallback la default-ul global din invoice_sequences.
  let finalDueAt = input.dueAt
  if (!finalDueAt) {
    const termsDays = client.paymentTermsDays ?? (await getSequence()).defaultPaymentTermsDays
    finalDueAt = new Date(finalIssuedAt.getTime() + termsDays * 24 * 60 * 60 * 1000)
  }

  return db.transaction(async (tx) => {
    const [record] = await tx
      .insert(financialRecords)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        type: 'invoice',
        direction: 'out',
        source: 'generated',
        amount: computeAmount(finalLines),
        currency: finalCurrency,
        description: input.note,
        issuedAt: finalIssuedAt,
        dueAt: finalDueAt,
        billingClientId: client.id,
        counterpartyName: client.name,
        counterpartyCif: client.cif,
        anafStatus: 'draft',
      })
      .returning(invoiceColumns)
    if (!record) throw new Error(tr('errors.invoicing.insertFailed'))

    await tx.insert(invoiceLineItems).values(
      finalLines.map((line, position) => ({
        invoiceId: record.id,
        position,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        vatRate: String(line.vatRate),
      })),
    )

    // Consum atomic cu insert-ul de mai sus — nicio fereastră unde discountul e "consumat"
    // fără ca factura să existe, sau invers (PLAN §4).
    if (discountConsumed) {
      await tx
        .update(billingClients)
        .set({
          referralDiscountReferralId: null,
          referralDiscountPendingAmount: null,
          referralDiscountPendingCurrency: null,
          updatedAt: new Date(),
        })
        .where(eq(billingClients.id, client.id))
    }

    return record
  })
}

export async function updateDraftInvoice(id: string, input: z.infer<typeof InvoiceUpdateSchema>) {
  const existing = await getGeneratedInvoice(id)
  if (!existing) return null
  if (existing.documentNumber) throw new Error(tr('errors.invoicing.issuedNoEdit'))

  const client = input.billingClientId ? await getClient(input.billingClientId) : null
  if (input.billingClientId && !client) throw new Error(tr('errors.invoicing.billingClientNotFound'))

  return db.transaction(async (tx) => {
    const changes: Record<string, unknown> = { updatedAt: new Date() }
    if (input.currency) changes.currency = input.currency
    if (input.note !== undefined) changes.description = input.note
    if (input.issuedAt) changes.issuedAt = input.issuedAt
    if (input.dueAt !== undefined) changes.dueAt = input.dueAt
    if (client) {
      changes.billingClientId = client.id
      changes.counterpartyName = client.name
      changes.counterpartyCif = client.cif
    }
    if (input.lines) {
      changes.amount = computeAmount(input.lines)
      await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))
      await tx.insert(invoiceLineItems).values(
        input.lines.map((line, position) => ({
          invoiceId: id,
          position,
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: String(line.unitPrice),
          vatRate: String(line.vatRate),
        })),
      )
    }
    const [row] = await tx
      .update(financialRecords)
      .set(changes)
      .where(eq(financialRecords.id, id))
      .returning(invoiceColumns)
    return row
  })
}

export async function deleteDraftInvoice(id: string): Promise<boolean> {
  const existing = await getGeneratedInvoice(id)
  if (!existing) return false
  if (existing.documentNumber) throw new Error(tr('errors.invoicing.issuedNoDelete'))
  const [row] = await db
    .update(financialRecords)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(financialRecords.id, id))
    .returning({ id: financialRecords.id })
  return Boolean(row)
}

async function loadInvoiceInput(record: typeof financialRecords.$inferSelect): Promise<UblInvoiceInput> {
  const client = record.billingClientId ? await getClient(record.billingClientId) : null
  if (!client) throw new Error(tr('errors.invoicing.clientGone'))
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, record.id), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))

  if (!config.company.cif) {
    throw new Error(tr('errors.invoicing.companyProfileIncomplete'))
  }

  // BR-RO-110: for a buyer in Romania, CountrySubentity (the county) is mandatory in the UBL
  // XML. ANAF rejects the invoice without it.
  const customerCountyCode = client.country === 'RO' ? countyNameToIsoCode(client.county) : undefined
  if (client.country === 'RO' && !customerCountyCode) {
    throw new Error(
      tr('errors.invoicing.countyUnknown1', { name: client.name, county: client.county ?? '—' }) +
        tr('errors.invoicing.countyUnknown2'),
    )
  }

  // BR-RO-100: when the county is RO-B (Bucharest), the city (BT-52) has to be one of
  // SECTOR1..SECTOR6, not free text ("Sector 1 Mun. București"); ANAF rejects the invoice
  // otherwise. Normalized on every issue, however the city got into the database.
  let customerCity = client.city ?? 'N/A'
  if (customerCountyCode === 'RO-B') {
    const sector = extractBucharestSectorCode(client.city) ?? extractBucharestSectorCode(client.address)
    if (!sector) {
      throw new Error(
        tr('errors.invoicing.sectorUnknown1', { name: client.name, city: client.city ?? '—' }) +
          tr('errors.invoicing.sectorUnknown2'),
      )
    }
    customerCity = sector
  }

  return {
    documentNumber: record.documentNumber ?? 'DRAFT',
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    currency: record.currency,
    note: record.description ?? undefined,
    supplier: {
      name: config.company.name,
      cif: config.company.cif,
      regCom: config.company.regCom || undefined,
      address: config.company.address,
      city: config.company.city,
      countyCode: config.company.countyCode,
      country: 'RO',
      iban: config.company.iban || undefined,
      bank: config.company.bank || undefined,
      email: config.company.email || undefined,
    },
    customer: {
      name: client.name,
      cif: client.cif,
      regCom: client.regCom ?? undefined,
      address: client.address,
      city: customerCity,
      countyCode: customerCountyCode,
      country: client.country,
      email: client.email ?? undefined,
      iban: client.iban ?? undefined,
      bank: client.bank ?? undefined,
    },
    lines: lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
    })),
  }
}

/** Regenerează XML+HTML+PDF din datele curente ale clientului și le salvează pe rând.
 *  Folosit la emitere (o dată) și la retrimiterea unei facturi respinse (vezi sendInvoiceToAnaf). */
async function regenerateInvoiceDocuments(record: typeof financialRecords.$inferSelect) {
  const input = await loadInvoiceInput(record)
  // Cosmetic — echivalentul EUR sub prețul unitar în PDF. Eșecul feed-ului BNR nu
  // blochează emiterea, doar sare peste rândul de curs (regula #7 CLAUDE.md, izolat).
  const eurRate =
    input.currency === 'EUR'
      ? undefined
      : await getRateForDate(input.issuedAt.toISOString().slice(0, 10), 'EUR')
          .then((r) => ({ rate: Number(r.rate), date: r.date }))
          .catch(() => undefined)
  const paths = await generateInvoiceDocuments(record.id, input, eurRate)
  const [row] = await db
    .update(financialRecords)
    .set({ xmlStoragePath: paths.xmlPath, pdfStoragePath: paths.pdfPath, updatedAt: new Date() })
    .where(eq(financialRecords.id, record.id))
    .returning(invoiceColumns)
  return { row, xmlPath: paths.xmlPath }
}

/** Emitere: alocă numărul (tranzacție atomică pe secvență) și generează XML+HTML+PDF. */
export async function issueInvoice(id: string) {
  const record = await getGeneratedInvoice(id)
  if (!record) return null
  if (record.documentNumber) throw new Error(tr('errors.invoicing.alreadyIssued'))

  // Validăm intrarea completă (profil firmă, client, linii) ÎNAINTE de alocarea
  // numărului — altfel am consuma un număr pentru o emitere care pică.
  await loadInvoiceInput(record)

  const documentNumber = await db.transaction(async (tx) => {
    const number = await nextInvoiceNumber('invoice', tx)
    await tx
      .update(financialRecords)
      .set({ documentNumber: number, updatedAt: new Date(), ...updatedByUserId() })
      .where(eq(financialRecords.id, id))
    return number
  })

  // Generarea documentelor e în afara tranzacției (IO lent); numărul e deja alocat.
  const { row } = await regenerateInvoiceDocuments({ ...record, documentNumber })
  await recordAudit({
    action: 'factura.emitata',
    entityType: 'invoice',
    entityId: id,
    changes: { documentNumber: [null, documentNumber] },
  })
  return row
}

/** Trimitere la ANAF: upload XML → anaf_status 'pending'; poll-ul actualizează starea. */
export async function sendInvoiceToAnaf(id: string) {
  const record = await getGeneratedInvoice(id)
  if (!record) return null
  if (!record.documentNumber || !record.xmlStoragePath) throw new Error(tr('errors.invoicing.issueFirst'))
  if (record.anafStatus === 'pending') throw new Error(tr('errors.invoicing.alreadySent'))
  if (record.anafStatus === 'validated') throw new Error(tr('errors.invoicing.alreadyValidated'))

  // Rejected before: the stored XML is the rejected one. Regenerate it from the client's
  // current data, or the same wrong XML goes out again.
  const xmlPath =
    record.anafStatus === 'rejected' ? (await regenerateInvoiceDocuments(record)).xmlPath : record.xmlStoragePath

  const session = await getAnafSession()
  const xml = (await readDocument(xmlPath)).toString('utf8')
  const { uploadId } = await anafConnector.uploadInvoice(session, xml)
  await recordAudit({ action: 'factura.trimisa.anaf', entityType: 'invoice', entityId: id })

  const [row] = await db
    .update(financialRecords)
    .set({ anafUploadId: uploadId, anafStatus: 'pending', updatedAt: new Date() })
    .where(eq(financialRecords.id, id))
    .returning(invoiceColumns)
  return row
}

// ── Secvența de numerotare ───────────────────────────────────────────────────

export async function getSequence() {
  const [row] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, 'invoice'))
  if (row) return row
  const [created] = await db.insert(invoiceSequences).values({ key: 'invoice' }).returning()
  if (!created) throw new Error(tr('errors.invoicing.sequenceNotCreated'))
  return created
}

export async function updateSequence(input: z.infer<typeof SequenceUpdateSchema>) {
  const existing = await getSequence()
  const [row] = await db
    .update(invoiceSequences)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(invoiceSequences.id, existing.id))
    .returning()
  return row
}

// ── Template-uri de facturi per APLICAȚIE integrată (Sprint D, Track 3; re-scope 2026-07-18) ──
// 2-3 template-uri per platformă, reutilizate de toți clienții ei (nu unul per client) —
// prețul rămâne strict pe client, luat live prin priceSource: 'client_subscription'.

export async function listPlatformTemplates(platformId: string) {
  return db
    .select()
    .from(invoiceTemplates)
    .where(and(eq(invoiceTemplates.platformId, platformId), isNull(invoiceTemplates.deletedAt)))
    .orderBy(asc(invoiceTemplates.name))
}

export async function getPlatformTemplate(platformId: string, id: string) {
  const [row] = await db
    .select()
    .from(invoiceTemplates)
    .where(and(eq(invoiceTemplates.id, id), eq(invoiceTemplates.platformId, platformId), isNull(invoiceTemplates.deletedAt)))
  return row ?? null
}

/** Convenience pt. picker-ul din `InvoiceFormDialog` — template-urile disponibile la
 *  facturarea UNUI client anume, derivate din platforma lui. [] dacă clientul nu e mapat
 *  la nicio platformă (rămâne strict pe facturare manuală/custom). */
export async function listClientTemplates(billingClientId: string) {
  const client = await getClient(billingClientId)
  if (!client?.platformId) return []
  return listPlatformTemplates(client.platformId)
}

/** Regula "cel mult un default per platformă" — impusă și de indexul unic parțial din DB,
 *  dar de-marcăm explicit aici ca update-ul să fie curat (nu doar să eșueze pe constraint). */
async function clearOtherDefaults(tx: DrizzleTx, platformId: string, exceptId?: string) {
  const conditions = [eq(invoiceTemplates.platformId, platformId), eq(invoiceTemplates.isDefaultForAutoInvoice, true)]
  if (exceptId) conditions.push(ne(invoiceTemplates.id, exceptId))
  await tx.update(invoiceTemplates).set({ isDefaultForAutoInvoice: false, updatedAt: new Date() }).where(and(...conditions))
}

export async function createPlatformTemplate(platformId: string, input: z.infer<typeof InvoiceTemplateCreateSchema>) {
  return db.transaction(async (tx) => {
    if (input.isDefaultForAutoInvoice) await clearOtherDefaults(tx, platformId)
    const [row] = await tx
      .insert(invoiceTemplates)
      .values({
        platformId,
        name: input.name,
        currency: input.currency,
        lineItems: input.lineItems,
        isDefaultForAutoInvoice: input.isDefaultForAutoInvoice ?? false,
      })
      .returning()
    if (!row) throw new Error(tr('errors.invoicing.templateInsertFailed'))
    return row
  })
}

export async function updatePlatformTemplate(
  platformId: string,
  id: string,
  input: z.infer<typeof InvoiceTemplateUpdateSchema>,
) {
  const existing = await getPlatformTemplate(platformId, id)
  if (!existing) return null

  return db.transaction(async (tx) => {
    if (input.isDefaultForAutoInvoice) await clearOtherDefaults(tx, platformId, id)
    const changes: Record<string, unknown> = { updatedAt: new Date() }
    if (input.name !== undefined) changes.name = input.name
    if (input.currency !== undefined) changes.currency = input.currency
    if (input.lineItems !== undefined) changes.lineItems = input.lineItems
    if (input.isDefaultForAutoInvoice !== undefined) changes.isDefaultForAutoInvoice = input.isDefaultForAutoInvoice
    const [row] = await tx.update(invoiceTemplates).set(changes).where(eq(invoiceTemplates.id, id)).returning()
    return row ?? null
  })
}

export async function deletePlatformTemplate(platformId: string, id: string): Promise<boolean> {
  const existing = await getPlatformTemplate(platformId, id)
  if (!existing) return false
  const [row] = await db
    .update(invoiceTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoiceTemplates.id, id))
    .returning({ id: invoiceTemplates.id })
  return Boolean(row)
}

/** Preview pt. UI (`InvoiceFormDialog`) — rezolvă liniile unui template ÎNAINTE de a crea
 *  draft-ul, cu prețul CLIENTULUI ales (rămâne editabil după, nu e un link viu). */
export async function resolveClientTemplateLines(billingClientId: string, templateId: string, currency?: string) {
  const client = await getClient(billingClientId)
  if (!client) throw new Error(tr('errors.invoicing.billingClientNotFound'))
  if (!client.platformId) throw new Error(tr('errors.invoicing.clientNotMapped'))
  const template = await getPlatformTemplate(client.platformId, templateId)
  if (!template) throw new Error(tr('errors.invoicing.templateNotFound'))

  const targetCurrency = currency ?? template.currency
  const dateIso = new Date().toISOString().slice(0, 10)
  const { lines } = await resolveTemplateLines(template.lineItems as InvoiceTemplateLine[], client, targetCurrency, dateIso)
  return { currency: targetCurrency, lines }
}

/** Folosit de jobs/vanagreen-billing.ts — template-ul cu care se generează factura auto pt.
 *  ORICE client al acestei platforme. */
export async function getDefaultPlatformTemplate(platformId: string) {
  const [row] = await db
    .select()
    .from(invoiceTemplates)
    .where(
      and(
        eq(invoiceTemplates.platformId, platformId),
        eq(invoiceTemplates.isDefaultForAutoInvoice, true),
        isNull(invoiceTemplates.deletedAt),
      ),
    )
  return row ?? null
}
