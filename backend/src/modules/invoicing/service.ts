import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne } from 'drizzle-orm'
import type { z } from 'zod'
import { ClientPricingSchema, planPricingApply, type ClientPricingInput } from './pricing-apply.js'
import { anafConnector } from '../../connectors/anaf/index.js'
import { supplierParty } from '../../connectors/anaf/supplier.js'
import { computeTotals } from '../../connectors/anaf/xml-builder.js'
import type { UblInvoiceInput } from '../../connectors/anaf/types.js'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import {
  billingClients,
  contractDocuments,
  financialRecords,
  invoiceLineItems,
  invoiceSequences,
  invoiceTemplates,
} from '../../shared/db/schema/index.js'
import { getAnafSession } from '../../shared/lib/anaf.js'
import { getCompany, getCompanyTimeZone } from '../../shared/lib/company.js'
import { getRateForDate } from '../../shared/lib/bnr.js'
import { generateInvoiceDocuments, renderInvoiceHtml } from '../../shared/lib/documents.js'
import { dayInTimeZone, recalculatePaymentStatus } from '../../shared/lib/payments.js'
import { countyNameToIsoCode, extractBucharestSectorCode } from '../../countries/ro/counties.js'
import { nextInvoiceNumber, sequenceDefaults, type DrizzleTx } from '../../shared/lib/sequences.js'
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
import { InvoicingError } from './errors.js'

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

/** The client picker of the invoice editor: who can issue invoices sees whom to bill, not the client file. */
export async function listClientsForInvoicing() {
  return db
    .select({ id: billingClients.id, name: billingClients.name, cif: billingClients.cif, paymentTermsDays: billingClients.paymentTermsDays })
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

/** `executor` lets a caller create the client inside its own transaction (promoting a prospect). */
export async function createClient(input: z.infer<typeof ClientCreateSchema>, executor: Pick<typeof db, 'insert'> = db) {
  const [row] = await executor
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

async function loadPricingPlan(id: string, input: ClientPricingInput) {
  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, id), isNull(billingClients.deletedAt)))
  if (!client) return null
  const [signed] = await db
    .select({ id: contractDocuments.id })
    .from(contractDocuments)
    .where(
      and(
        eq(contractDocuments.billingClientId, id),
        eq(contractDocuments.docType, 'contract'),
        eq(contractDocuments.isSigned, true),
        isNull(contractDocuments.deletedAt),
      ),
    )
    .limit(1)
  return { client, plan: planPricingApply(client, input, Boolean(signed)) }
}

export async function previewClientPricing(id: string, input: ClientPricingInput) {
  const loaded = await loadPricingPlan(id, input)
  if (!loaded) return null
  return { changes: loaded.plan.changes, needsAddendum: loaded.plan.needsAddendum }
}

export async function applyClientPricing(id: string, input: ClientPricingInput) {
  const loaded = await loadPricingPlan(id, input)
  if (!loaded) return null
  const { changes, contractDetails, needsAddendum } = loaded.plan
  const [client] = await db
    .update(billingClients)
    .set({
      subscriptionPriceEur: String(input.subscriptionPriceEur),
      contractPlan: input.contractPlan,
      contractDetails,
      updatedAt: new Date(),
      ...updatedByUserId(),
    })
    .where(and(eq(billingClients.id, id), isNull(billingClients.deletedAt)))
    .returning()
  if (!client) return null
  await recordAudit({ action: 'client.pret.aplicat', entityType: 'billing_client', entityId: id, changes: Object.fromEntries(changes.map((c) => [c.field, [c.from, c.to]])) })
  return { client, changes, needsAddendum }
}

/** Writes a prospect's saved offer on the client just created from it (no contract yet, so no addendum). */
export async function applyOfferToNewClient(
  executor: Pick<typeof db, 'update'>,
  client: { id: string; subscriptionPriceEur: string | null; contractPlan: string | null; contractDetails: unknown },
  offer: unknown,
) {
  const input = ClientPricingSchema.parse(offer)
  const { contractDetails } = planPricingApply(client, input, false)
  await executor
    .update(billingClients)
    .set({
      subscriptionPriceEur: String(input.subscriptionPriceEur),
      contractPlan: input.contractPlan,
      contractDetails,
      updatedAt: new Date(),
      ...updatedByUserId(),
    })
    .where(eq(billingClients.id, client.id))
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

export const invoiceColumns = {
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
  type: financialRecords.type,
  correctsRecordId: financialRecords.correctsRecordId,
  convertedToRecordId: financialRecords.convertedToRecordId,
  proformaStatus: financialRecords.proformaStatus,
  createdAt: financialRecords.createdAt,
  updatedAt: financialRecords.updatedAt,
}

export type DocumentKind = 'invoice' | 'proforma'

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
        ne(financialRecords.type, 'proforma'),
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
        ne(financialRecords.type, 'proforma'),
      ),
    )
    .orderBy(desc(financialRecords.createdAt))
}

// The invoice routes and the proforma routes share the table; `kind` keeps a proforma id from
// being edited, issued or sent to ANAF through an invoice route, and the other way around.
export async function getGeneratedInvoice(id: string, kind: DocumentKind = 'invoice') {
  const [row] = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.id, id),
        eq(financialRecords.source, 'generated'),
        eq(financialRecords.type, kind),
        isNull(financialRecords.deletedAt),
      ),
    )
  return row ?? null
}

export class InvoiceConflictError extends Error {
  constructor(
    readonly code: 'DRAFT_CHANGED' | 'NOT_DUPLICABLE',
    message: string,
  ) {
    super(message)
  }
}

export type DraftInput = z.infer<typeof InvoiceCreateSchema>
type BillingClient = NonNullable<Awaited<ReturnType<typeof getClient>>>

// templateId optional: the server copies lineItems/currency from the template as INITIAL values
// (the draft stays editable, it is not a live link). Explicit `input.lines` win over the template.
async function resolveDraftLines(client: BillingClient, input: DraftInput) {
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
  return { lines, currency: currency ?? 'RON', discountConsumed }
}

// Due date when none is given: issue date + the client's payment terms (a per-client exception,
// see billing-clients.ts), falling back to the global default on invoice_sequences.
async function defaultDueAt(client: BillingClient, issuedAt: Date): Promise<Date> {
  const termsDays = client.paymentTermsDays ?? (await getSequence()).defaultPaymentTermsDays
  return new Date(issuedAt.getTime() + termsDays * 24 * 60 * 60 * 1000)
}

export interface DraftOptions {
  kind?: DocumentKind
  /** Where the draft was copied from: duplicate or proforma conversion. Changes the audit action. */
  origin?: { action: 'factura.duplicata' | 'factura.din.proforma'; id: string; label: string }
  /** Runs in the same transaction, after the insert. */
  inTransaction?: (tx: DrizzleTx, record: { id: string }) => Promise<void>
}

export async function createDraftInvoice(input: DraftInput, options: DraftOptions = {}) {
  const { kind = 'invoice', origin, inTransaction } = options
  const client = await getClient(input.billingClientId)
  if (!client) throw new Error(tr('errors.invoicing.billingClientNotFound'))

  const { lines: finalLines, currency: finalCurrency, discountConsumed } = await resolveDraftLines(client, input)
  const finalIssuedAt = input.issuedAt ?? new Date()
  const finalDueAt = input.dueAt ?? (await defaultDueAt(client, finalIssuedAt))

  return db.transaction(async (tx) => {
    const [record] = await tx
      .insert(financialRecords)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        type: kind,
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
        // A proforma never reaches ANAF, so it has no ANAF state at all.
        anafStatus: kind === 'invoice' ? 'draft' : null,
        proformaStatus: kind === 'proforma' ? 'open' : null,
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

    await recordAudit({
      executor: tx,
      action: origin ? origin.action : kind === 'proforma' ? 'proforma.ciorna.creata' : 'factura.ciorna.creata',
      entityType: 'invoice',
      entityId: record.id,
      changes: {
        client: [null, client.name],
        suma: [null, `${record.amount} ${finalCurrency}`],
        ...(origin ? { sursa: [origin.id, origin.label] as [unknown, unknown] } : {}),
      },
    })
    await inTransaction?.(tx, record)

    // Consum atomic cu insert-ul de mai sus — nicio fereastră unde discountul e "consumat"
    // fără ca factura să existe, sau invers (PLAN §4).
    if (discountConsumed && kind === 'invoice') {
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

export async function updateDraftInvoice(id: string, input: z.infer<typeof InvoiceUpdateSchema>, kind: DocumentKind = 'invoice') {
  const client = input.billingClientId ? await getClient(input.billingClientId) : null
  if (input.billingClientId && !client) throw new Error(tr('errors.invoicing.billingClientNotFound'))

  return db.transaction(async (tx) => {
    // Read under lock: the numbered check and the expectedUpdatedAt comparison must see the row the update will change.
    const [existing] = await tx
      .select()
      .from(financialRecords)
      .where(and(eq(financialRecords.id, id), eq(financialRecords.source, 'generated'), eq(financialRecords.type, kind), isNull(financialRecords.deletedAt)))
      .for('update')
    if (!existing) return null
    if (existing.documentNumber) throw new Error(tr('errors.invoicing.issuedNoEdit'))
    // The lines of a storno were checked against what is left on the invoice it corrects; its note and dates stay editable.
    if (existing.correctsRecordId && (input.lines || input.billingClientId || input.currency)) {
      throw new InvoicingError(400, 'STORNO_LOCKED', tr('errors.invoicing.stornoLinesLocked'))
    }
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
      throw new InvoiceConflictError('DRAFT_CHANGED', tr('errors.invoicing.draftChanged'))
    }

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

    const changed: Record<string, [unknown, unknown]> = {}
    if (row && row.amount !== existing.amount) changed.suma = [existing.amount, row.amount]
    if (row && row.currency !== existing.currency) changed.moneda = [existing.currency, row.currency]
    if (row && row.counterpartyName !== existing.counterpartyName) changed.client = [existing.counterpartyName, row.counterpartyName]
    if (row && input.dueAt !== undefined) changed.scadenta = [existing.dueAt, row.dueAt]
    if (row && input.issuedAt) changed.dataEmiterii = [existing.issuedAt, row.issuedAt]
    if (input.lines) changed.linii = [null, input.lines.length]
    await recordAudit({
      executor: tx,
      action: kind === 'proforma' ? 'proforma.ciorna.editata' : 'factura.ciorna.editata',
      entityType: 'invoice',
      entityId: id,
      changes: changed,
    })
    return row
  })
}

export async function deleteDraftInvoice(id: string, kind: DocumentKind = 'invoice'): Promise<boolean> {
  const existing = await getGeneratedInvoice(id, kind)
  if (!existing) return false
  if (existing.documentNumber) throw new Error(tr('errors.invoicing.issuedNoDelete'))
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(financialRecords)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(financialRecords.id, id))
      .returning({ id: financialRecords.id })
    if (!row) return false
    // The proforma this draft was made from can be converted again.
    await tx
      .update(financialRecords)
      .set({ convertedToRecordId: null, updatedAt: new Date() })
      .where(and(eq(financialRecords.convertedToRecordId, id), eq(financialRecords.type, 'proforma')))
    await recordAudit({
      executor: tx,
      action: kind === 'proforma' ? 'proforma.ciorna.stearsa' : 'factura.ciorna.stearsa',
      entityType: 'invoice',
      entityId: id,
      changes: { client: [existing.counterpartyName, null], suma: [`${existing.amount} ${existing.currency}`, null] },
    })
    return true
  })
}

/** The calendar day of the company at noon UTC, so the date printed on the document (UTC day) is the company's day. */
export async function companyToday(): Promise<Date> {
  return new Date(`${dayInTimeZone(new Date(), await getCompanyTimeZone())}T12:00:00Z`)
}

/** The document HTML for a draft body, without a number and without touching the database. */
export async function previewDraftInvoice(input: DraftInput, kind: DocumentKind = 'invoice'): Promise<string> {
  const client = await getClient(input.billingClientId)
  if (!client) throw new Error(tr('errors.invoicing.billingClientNotFound'))
  const { lines, currency } = await resolveDraftLines(client, input)
  const issuedAt = input.issuedAt ?? (await companyToday())
  const document: UblInvoiceInput = {
    documentNumber: '',
    issuedAt,
    dueAt: input.dueAt ?? (await defaultDueAt(client, issuedAt)),
    currency,
    note: input.note,
    supplier: supplierParty(await getCompany()),
    customer: customerParty(client, false),
    lines,
  }
  return renderInvoiceHtml(document, await eurRateFor(document, { live: false }), {
    draftLabel: tr('errors.invoicing.draftBanner'),
    proforma: kind === 'proforma',
  })
}

/** The HTML of a stored document (a storno draft cannot go through the body-based preview, its quantities are negative). */
export async function previewStoredDocument(id: string): Promise<string | null> {
  const [record] = await db
    .select()
    .from(financialRecords)
    .where(and(eq(financialRecords.id, id), eq(financialRecords.source, 'generated'), isNull(financialRecords.deletedAt)))
  if (!record) return null
  const document = await loadInvoiceInput(record, { strict: false })
  return renderInvoiceHtml(document, await eurRateFor(document, { live: false }), {
    draftLabel: record.documentNumber ? undefined : tr('errors.invoicing.draftBanner'),
    proforma: record.type === 'proforma',
  })
}

/** A new draft with the same client and lines: no number, no ANAF or payment state, today's date. */
export async function duplicateInvoice(id: string) {
  const source = await getGeneratedInvoice(id)
  if (!source) return null
  if (source.direction !== 'out' || source.type !== 'invoice' || source.correctsRecordId) {
    throw new InvoiceConflictError('NOT_DUPLICABLE', tr('errors.invoicing.notDuplicable'))
  }
  if (!source.billingClientId) throw new Error(tr('errors.invoicing.clientGone'))

  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, id), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))
  return createDraftInvoice(
    {
      billingClientId: source.billingClientId,
      currency: source.currency,
      issuedAt: await companyToday(),
      note: source.description ?? undefined,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        vatRate: Number(line.vatRate),
      })),
    },
    { origin: { action: 'factura.duplicata', id, label: source.documentNumber ?? id } },
  )
}

// `strict` is the issue path: a county or Bucharest sector ANAF would reject stops the issue.
// The editor preview only shows the document, so it falls back to what the client record has.
function customerParty(client: BillingClient, strict: boolean): UblInvoiceInput['customer'] {
  // BR-RO-110: for a buyer in Romania, CountrySubentity (the county) is mandatory in the UBL
  // XML. ANAF rejects the invoice without it.
  const customerCountyCode = client.country === 'RO' ? countyNameToIsoCode(client.county) : undefined
  if (strict && client.country === 'RO' && !customerCountyCode) {
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
    if (!sector && strict) {
      throw new Error(
        tr('errors.invoicing.sectorUnknown1', { name: client.name, city: client.city ?? '—' }) +
          tr('errors.invoicing.sectorUnknown2'),
      )
    }
    if (sector) customerCity = sector
  }

  return {
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
  }
}

// `strict: false` is for documents that never reach ANAF (a proforma) and for previews: the
// county and Bucharest sector checks only matter for e-Factura.
export async function loadInvoiceInput(
  record: typeof financialRecords.$inferSelect,
  { strict = true }: { strict?: boolean } = {},
): Promise<UblInvoiceInput> {
  const client = record.billingClientId ? await getClient(record.billingClientId) : null
  if (!client) throw new Error(tr('errors.invoicing.clientGone'))
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, record.id), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))

  const supplier = supplierParty(await getCompany())
  const customer = customerParty(client, strict)

  let corrects: UblInvoiceInput['corrects']
  if (record.correctsRecordId) {
    const [original] = await db
      .select({ documentNumber: financialRecords.documentNumber, issuedAt: financialRecords.issuedAt })
      .from(financialRecords)
      .where(eq(financialRecords.id, record.correctsRecordId))
    if (!original?.documentNumber) throw new Error(tr('errors.invoicing.invoiceGone'))
    corrects = { documentNumber: original.documentNumber, issuedAt: original.issuedAt }
  }

  return {
    documentNumber: record.documentNumber ?? 'DRAFT',
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    currency: record.currency,
    note: record.description ?? undefined,
    supplier,
    customer,
    corrects,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      vatRate: Number(line.vatRate),
    })),
  }
}

// Cosmetic: the EUR equivalent under the unit price. A BNR feed failure only drops the rate row.
export async function eurRateFor(input: UblInvoiceInput, options: { live?: boolean } = {}) {
  if (input.currency === 'EUR') return undefined
  return getRateForDate(input.issuedAt.toISOString().slice(0, 10), 'EUR', options)
    .then((r) => ({ rate: Number(r.rate), date: r.date }))
    .catch(() => undefined)
}

/** Regenerează XML+HTML+PDF din datele curente ale clientului și le salvează pe rând.
 *  Folosit la emitere (o dată) și la retrimiterea unei facturi respinse (vezi sendInvoiceToAnaf). */
async function regenerateInvoiceDocuments(record: typeof financialRecords.$inferSelect) {
  const input = await loadInvoiceInput(record)
  const eurRate = await eurRateFor(input)
  const paths = await generateInvoiceDocuments(record.id, input, eurRate)
  const [row] = await db
    .update(financialRecords)
    .set({ xmlStoragePath: paths.xmlPath, pdfStoragePath: paths.pdfPath, updatedAt: new Date() })
    .where(eq(financialRecords.id, record.id))
    .returning(invoiceColumns)
  return { row, xmlPath: paths.xmlPath }
}

// Quantities are positive on an invoice and negative on a storno (unit price positive in both:
// BT-146). Only a record that corrects another may carry negative quantities.
export function assertLineSigns(record: { correctsRecordId: string | null }, lines: UblInvoiceInput['lines']) {
  if (record.correctsRecordId) {
    if (lines.length === 0 || lines.some((line) => line.quantity >= 0 || line.unitPrice < 0)) {
      throw new InvoicingError(400, 'INVALID_LINES', tr('errors.invoicing.lineSignStorno'))
    }
  } else if (lines.some((line) => line.quantity <= 0)) {
    throw new InvoicingError(400, 'INVALID_LINES', tr('errors.invoicing.lineSignInvoice'))
  }
}

/** Emitere: alocă numărul (tranzacție atomică pe secvență) și generează XML+HTML+PDF. */
export async function issueInvoice(id: string) {
  const record = await getGeneratedInvoice(id)
  if (!record) return null

  // Validăm intrarea completă (profil firmă, client, linii) ÎNAINTE de alocarea
  // numărului — altfel am consuma un număr pentru o emitere care pică.
  assertLineSigns(record, (await loadInvoiceInput(record)).lines)

  const documentNumber = await db.transaction(async (tx) => {
    // The row lock comes first: of two simultaneous issues the second waits here, then sees the
    // number the first one set. Checking before the lock let both pass and the second overwrote the number.
    const [locked] = await tx
      .select({ documentNumber: financialRecords.documentNumber })
      .from(financialRecords)
      .where(and(eq(financialRecords.id, id), isNull(financialRecords.deletedAt)))
      .for('update')
    if (!locked) throw new Error(tr('errors.invoicing.invoiceGone'))
    if (locked.documentNumber) throw new Error(tr('errors.invoicing.alreadyIssued'))
    const number = await nextInvoiceNumber('invoice', tx)
    await tx
      .update(financialRecords)
      .set({ documentNumber: number, updatedAt: new Date(), ...updatedByUserId() })
      .where(eq(financialRecords.id, id))

    // A numbered storno lowers what the original still owes, and the original's payment state follows.
    if (record.correctsRecordId) {
      await recalculatePaymentStatus(record.correctsRecordId, tx)
      await recordAudit({
        executor: tx,
        action: 'factura.storno.emisa',
        entityType: 'invoice',
        entityId: record.correctsRecordId,
        changes: { storno: [null, number], suma: [null, `${record.amount} ${record.currency}`] },
      })
    }

    // The proforma this invoice was made from becomes invoiced only now, not when the draft is created.
    const converted = await tx
      .update(financialRecords)
      .set({ proformaStatus: 'invoiced', updatedAt: new Date() })
      .where(
        and(
          eq(financialRecords.convertedToRecordId, id),
          eq(financialRecords.type, 'proforma'),
          eq(financialRecords.proformaStatus, 'open'),
        ),
      )
      .returning({ id: financialRecords.id })
    for (const proforma of converted) {
      await recordAudit({
        executor: tx,
        action: 'proforma.facturata',
        entityType: 'invoice',
        entityId: proforma.id,
        changes: { factura: [null, number] },
      })
    }
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

export async function getSequence(key = 'invoice') {
  const [row] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, key))
  if (row) return row
  const [created] = await db.insert(invoiceSequences).values(sequenceDefaults(key)).returning()
  if (!created) throw new Error(tr('errors.invoicing.sequenceNotCreated'))
  return created
}

export async function updateSequence(input: z.infer<typeof SequenceUpdateSchema>, key = 'invoice') {
  const existing = await getSequence(key)
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
