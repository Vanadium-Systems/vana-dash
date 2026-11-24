import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { billingClients, contractDocuments, contracts, contractSeries, contractTemplates, prospects, users } from '../../shared/db/schema/index.js'
import type { ContractStatus } from '../../shared/db/schema/contracts.js'
import { listEntityHistory, recordAudit } from '../../shared/lib/audit.js'
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '../../shared/lib/calendar-write.js'
import { getCompany } from '../../shared/lib/company.js'
import { httpError } from '../../shared/lib/http-error.js'
import { tr, trFor } from '../../shared/lib/i18n.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { escapeLike } from '../../shared/lib/prospect-access.js'
import { zonedTimeToUtc } from '../../shared/lib/schedule-recurrence.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { deleteDocument, saveDocument } from '../../shared/lib/storage.js'
import { claimNumber, defaultSeries, formatContractNumber, getSeries, nextNumber, releaseNumber } from './numbers.js'
import type { CounterpartySchema, CreateContractSchema, RegistryQuerySchema, UpdateContractSchema, UploadContractMetaSchema } from './registry-schema.js'
import { TemplateFieldSchema, SignerRoleSchema } from './registry-schema.js'
import { missingFields, renderCustomTemplate } from './template-render.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Me = Pick<SessionUser, 'id' | 'isPlatformAdmin' | 'role'>

// Every contract is confidential (decision of 2026-11-24): the admin sees all of them, everyone else only
// the ones they are responsible for. Someone else's contract answers 404, like the other personal data.
export const seesAllContracts = (me: Me) => me.isPlatformAdmin || me.role?.kind === 'admin'
const visibleTo = (me: Me) => (seesAllContracts(me) ? sql`true` : sql`k."owner_user_id" = ${me.id}`)

const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['to_sign', 'signed', 'terminated'],
  to_sign: ['draft', 'signed', 'terminated'],
  signed: ['expired', 'terminated'],
  expired: ['signed', 'terminated'],
  // A terminated contract is history; a new agreement is a new contract.
  terminated: [],
}

const NOTICE_EVENT_HOUR = 9

export async function listRegistry(me: Me, query: z.infer<typeof RegistryQuerySchema>) {
  const like = query.q ? `%${escapeLike(query.q)}%` : null
  const rows = await db.execute<{
    id: string
    title: string
    category: string
    counterparty_name: string
    counterparty_kind: string
    number: number | null
    number_format: string | null
    series_code: string | null
    external_number: string | null
    status: ContractStatus
    signed_on: string | null
    starts_on: string | null
    ends_on: string | null
    notice_deadline: string | null
    origin: string
    owner_name: string | null
    doc_id: string | null
    doc_signed: boolean | null
    total: number
  }>(sql`
    SELECT k."id", k."title", k."category", k."counterparty_name", k."counterparty_kind", k."number",
           s."number_format", s."code" AS series_code, k."external_number", k."status",
           k."signed_on"::text, k."starts_on"::text, k."ends_on"::text,
           CASE WHEN k."notice_days" IS NOT NULL THEN (k."ends_on" - k."notice_days")::text END AS notice_deadline,
           k."origin", coalesce(u."display_name", u."email") AS owner_name,
           ld."id" AS doc_id, ld."is_signed" AS doc_signed,
           count(*) OVER ()::int AS total
      FROM ${contracts} k
      LEFT JOIN ${contractSeries} s ON s."id" = k."series_id"
      LEFT JOIN ${users} u ON u."id" = k."owner_user_id"
      LEFT JOIN LATERAL (
        SELECT d."id", d."is_signed" FROM ${contractDocuments} d
         WHERE d."contract_id" = k."id" AND d."deleted_at" IS NULL
         ORDER BY d."created_at" DESC LIMIT 1
      ) ld ON true
     WHERE k."deleted_at" IS NULL AND ${visibleTo(me)}
       AND (${like}::text IS NULL OR k."counterparty_name" ILIKE ${like} OR k."title" ILIKE ${like} OR k."external_number" ILIKE ${like}
            OR k."number"::text = ${query.q ?? null})
       ${query.status ? sql`AND k."status" IN (${sql.join(query.status.map((s) => sql`${s}`), sql`, `)})` : sql``}
       ${query.category ? sql`AND k."category" = ${query.category}` : sql``}
       ${query.kind ? sql`AND k."counterparty_kind" = ${query.kind}` : sql``}
     ORDER BY k."number" DESC NULLS LAST, k."created_at" DESC
     LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `)
  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      counterpartyName: r.counterparty_name,
      counterpartyKind: r.counterparty_kind,
      number: r.number !== null && r.number_format ? formatContractNumber(r.number_format, r.series_code ?? '', r.number) : null,
      externalNumber: r.external_number,
      status: r.status,
      signedOn: r.signed_on,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      noticeDeadline: r.notice_deadline,
      origin: r.origin,
      ownerName: r.owner_name,
      latestDocument: r.doc_id ? { id: r.doc_id, isSigned: Boolean(r.doc_signed) } : null,
    })),
    total: rows[0]?.total ?? 0,
  }
}

async function loadVisible(me: Me, id: string, executor: Tx | typeof db = db) {
  const [row] = await executor
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), isNull(contracts.deletedAt), seesAllContracts(me) ? undefined : eq(contracts.ownerUserId, me.id)))
  if (!row) throw httpError(404, 'CONTRACT_NOT_FOUND')
  return row
}

async function numberLabel(contract: { seriesId: string | null; number: number | null; externalNumber: string | null }) {
  if (contract.number !== null && contract.seriesId) {
    const series = await getSeries(contract.seriesId)
    return formatContractNumber(series.numberFormat, series.code, contract.number)
  }
  return contract.externalNumber
}

export async function getContract(me: Me, id: string) {
  const contract = await loadVisible(me, id)
  const [documents, history, owner] = await Promise.all([
    db
      .select()
      .from(contractDocuments)
      .where(and(eq(contractDocuments.contractId, id), isNull(contractDocuments.deletedAt)))
      .orderBy(desc(contractDocuments.createdAt)),
    listEntityHistory(['contract'], id),
    db.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, contract.ownerUserId)),
  ])
  // The snapshot is the whole template body: the page does not need it.
  const rest: Omit<typeof contract, 'templateSnapshot'> & { templateSnapshot?: unknown } = { ...contract }
  delete rest.templateSnapshot
  return {
    ...rest,
    numberLabel: await numberLabel(contract),
    noticeDeadline: contract.endsOn && contract.noticeDays ? shiftDays(contract.endsOn, -contract.noticeDays) : null,
    ownerName: owner[0]?.name ?? null,
    documents,
    history,
  }
}

/** A registry document, for download: someone else's contract answers 404. */
export async function getVisibleDocument(me: Me, documentId: string) {
  const [doc] = await db
    .select()
    .from(contractDocuments)
    .where(and(eq(contractDocuments.id, documentId), isNull(contractDocuments.deletedAt)))
  if (!doc) return null
  if (doc.docType === 'document') await loadVisible(me, doc.contractId)
  return doc
}

async function resolveCounterparty(counterparty: z.infer<typeof CounterpartySchema>, executor: Tx | typeof db = db) {
  switch (counterparty.kind) {
    case 'client': {
      const [row] = await executor.select({ name: billingClients.name }).from(billingClients).where(and(eq(billingClients.id, counterparty.id), isNull(billingClients.deletedAt)))
      if (!row) throw httpError(400, 'CLIENT_NOT_FOUND')
      return { counterpartyKind: 'client' as const, billingClientId: counterparty.id, counterpartyName: row.name }
    }
    case 'prospect': {
      const [row] = await executor.select({ name: prospects.name }).from(prospects).where(and(eq(prospects.id, counterparty.id), isNull(prospects.deletedAt)))
      if (!row) throw httpError(400, 'PROSPECT_NOT_FOUND')
      return { counterpartyKind: 'prospect' as const, prospectId: counterparty.id, counterpartyName: row.name }
    }
    case 'user': {
      const [row] = await executor
        .select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` })
        .from(users)
        .where(and(eq(users.id, counterparty.id), isNull(users.deletedAt)))
      if (!row) throw httpError(400, 'USER_NOT_FOUND')
      return { counterpartyKind: 'user' as const, userId: counterparty.id, counterpartyName: row.name }
    }
    case 'other':
      return { counterpartyKind: 'other' as const, counterpartyName: counterparty.name }
  }
}

/** Only the admin hands a contract to someone else; the person must exist in the company. */
async function resolveOwner(me: Me, ownerUserId: string | undefined, executor: Tx | typeof db = db): Promise<string> {
  if (!ownerUserId || ownerUserId === me.id) return me.id
  if (!seesAllContracts(me)) throw httpError(403, 'CONTRACT_OWNER_ADMIN_ONLY')
  const [row] = await executor.select({ id: users.id }).from(users).where(and(eq(users.id, ownerUserId), isNull(users.deletedAt)))
  if (!row) throw httpError(400, 'USER_NOT_FOUND')
  return row.id
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}

/**
 * The notice deadline as an event in the owner's calendar, kept in step with the contract on every
 * save (not by the cron), in the same transaction. No deadline, or a contract that is over: no event.
 */
export async function syncNoticeEvent(tx: Tx, contractId: string): Promise<void> {
  const [contract] = await tx.select().from(contracts).where(eq(contracts.id, contractId))
  if (!contract) return
  const live = !contract.deletedAt && contract.status !== 'terminated' && contract.status !== 'expired'
  const deadline = live && contract.endsOn && contract.noticeDays ? shiftDays(contract.endsOn, -contract.noticeDays) : null
  if (!deadline) {
    if (contract.noticeEventId) {
      await deleteCalendarEvent(contract.noticeEventId, tx)
      await tx.update(contracts).set({ noticeEventId: null }).where(eq(contracts.id, contractId))
    }
    return
  }
  const company = await getCompany()
  const [y, m, d] = deadline.split('-').map(Number) as [number, number, number]
  const startAt = zonedTimeToUtc(y, m, d, NOTICE_EVENT_HOUR, 0, company.timeZone)
  const endAt = new Date(startAt.getTime() + 30 * 60_000)
  const locale = await ownerLocale(contract.ownerUserId, tx)
  const title = trFor(locale, 'alerts.contracts.noticeEventTitle', { title: contract.title, party: contract.counterpartyName })
  const description = trFor(locale, 'alerts.contracts.noticeEventBody', { endsOn: contract.endsOn, days: contract.noticeDays })
  if (contract.noticeEventId) {
    await updateCalendarEvent(contract.noticeEventId, { ownerUserId: contract.ownerUserId, title, description, startAt, endAt }, tx)
  } else {
    const eventId = await createCalendarEvent({ ownerUserId: contract.ownerUserId, title, description, startAt, endAt }, tx)
    await tx.update(contracts).set({ noticeEventId: eventId }).where(eq(contracts.id, contractId))
  }
}

async function ownerLocale(userId: string, executor: Tx | typeof db) {
  const [row] = await executor.select({ locale: users.locale }).from(users).where(eq(users.id, userId))
  return row?.locale ?? 'ro'
}

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)
}

function todayIso(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function loadCustomTemplate(templateId: string, executor: Tx | typeof db = db) {
  const [template] = await executor
    .select()
    .from(contractTemplates)
    .where(and(eq(contractTemplates.id, templateId), isNull(contractTemplates.deletedAt)))
  // The SaaS templates are generated from the client's page, with the client's billing data.
  if (!template || template.isSystem || template.key) throw httpError(400, 'TEMPLATE_NOT_FOUND')
  return {
    ...template,
    fields: TemplateFieldSchema.array().parse(template.fields),
    signerRoles: SignerRoleSchema.array().parse(template.signerRoles),
  }
}

export async function createFromTemplate(me: Me, input: z.infer<typeof CreateContractSchema>) {
  const template = await loadCustomTemplate(input.templateId)
  const missing = missingFields(template.fields, input.fieldValues)
  if (missing.length > 0) throw httpError(400, 'CONTRACT_DATA_INCOMPLETE', { fields: missing.join(', ') }, { fields: missing })
  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  const company = await getCompany()

  let savedPath: string | null = null
  try {
    const result = await db.transaction(async (tx) => {
      const party = await resolveCounterparty(input.counterparty, tx)
      const ownerUserId = await resolveOwner(me, input.ownerUserId, tx)
      const seriesId = input.seriesId ?? template.seriesId ?? (await defaultSeries(tx))?.id
      if (!seriesId) throw httpError(400, 'CONTRACT_SERIES_NOT_FOUND')
      const series = await getSeries(seriesId, tx)
      const [contract] = await tx
        .insert(contracts)
        .values({
          title: input.title ?? template.name,
          category: template.category ?? 'other',
          ...party,
          ownerUserId,
          startsOn: input.startsOn ?? null,
          endsOn: input.endsOn ?? null,
          autoRenew: input.autoRenew,
          renewalMonths: input.renewalMonths ?? null,
          noticeDays: input.noticeDays ?? null,
          status: 'draft',
          origin: 'template',
          templateId: template.id,
          templateSnapshot: { name: template.name, bodyHtml: template.bodyHtml, fields: template.fields, signerRoles: template.signerRoles },
          fieldValues: input.fieldValues,
          createdByUserId: me.id,
          updatedByUserId: me.id,
        })
        .returning()
      const number = input.number ?? (await nextNumber(seriesId, tx))
      await claimNumber(tx, seriesId, number, contract!.id)
      const label = formatContractNumber(series.numberFormat, series.code, number)

      const html = renderCustomTemplate({
        bodyHtml: template.bodyHtml,
        fields: template.fields,
        signerRoles: template.signerRoles,
        values: input.fieldValues,
        numberLabel: label,
        date: todayIso(company.timeZone),
        counterpartyName: party.counterpartyName,
      })
      const pdf = await htmlToPdf(html, { signatureFields: true, isolated: true })
      savedPath = await saveDocument(`contracts/registry/${contract!.id}/${safeName(label)}_${Date.now()}.pdf`, pdf)
      const [document] = await tx
        .insert(contractDocuments)
        .values({ contractId: contract!.id, docType: 'document', pdfStoragePath: savedPath })
        .returning({ id: contractDocuments.id })
      await syncNoticeEvent(tx, contract!.id)
      return { id: contract!.id, number: label, documentId: document!.id }
    })
    await recordAudit({ action: 'contract.creat', entityType: 'contract', entityId: result.id, changes: { numar: [null, result.number], sablon: [null, template.name] } })
    return result
  } catch (err) {
    if (savedPath) await deleteDocument(savedPath).catch(() => undefined)
    throw err
  }
}

/** A contract signed elsewhere (a supplier's, a paper one), uploaded as it is. */
export async function uploadContract(me: Me, meta: z.infer<typeof UploadContractMetaSchema>, pdf: Buffer) {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw httpError(415, 'UNSUPPORTED_MEDIA_TYPE')
  let savedPath: string | null = null
  try {
    const result = await db.transaction(async (tx) => {
      const party = await resolveCounterparty(meta.counterparty, tx)
      const ownerUserId = await resolveOwner(me, meta.ownerUserId, tx)
      const [contract] = await tx
        .insert(contracts)
        .values({
          title: meta.title,
          category: meta.category,
          ...party,
          ownerUserId,
          externalNumber: meta.externalNumber ?? null,
          signedOn: meta.signedOn ?? null,
          startsOn: meta.startsOn ?? null,
          endsOn: meta.endsOn ?? null,
          autoRenew: meta.autoRenew,
          renewalMonths: meta.renewalMonths ?? null,
          noticeDays: meta.noticeDays ?? null,
          status: meta.status,
          origin: 'uploaded',
          createdByUserId: me.id,
          updatedByUserId: me.id,
        })
        .returning()
      if (meta.number) {
        const seriesId = meta.seriesId ?? (await defaultSeries(tx))?.id
        if (!seriesId) throw httpError(400, 'CONTRACT_SERIES_NOT_FOUND')
        await getSeries(seriesId, tx)
        await claimNumber(tx, seriesId, meta.number, contract!.id)
      }
      savedPath = await saveDocument(`contracts/registry/${contract!.id}/${safeName(meta.title)}_${Date.now()}.pdf`, pdf)
      const [document] = await tx
        .insert(contractDocuments)
        .values({
          contractId: contract!.id,
          docType: 'document',
          pdfStoragePath: savedPath,
          isSigned: meta.status === 'signed',
          signedAt: meta.status === 'signed' ? new Date() : null,
        })
        .returning({ id: contractDocuments.id })
      await syncNoticeEvent(tx, contract!.id)
      return { id: contract!.id, documentId: document!.id }
    })
    await recordAudit({ action: 'contract.incarcat', entityType: 'contract', entityId: result.id, changes: { titlu: [null, meta.title] } })
    return result
  } catch (err) {
    if (savedPath) await deleteDocument(savedPath).catch(() => undefined)
    throw err
  }
}

export async function updateContract(me: Me, id: string, patch: z.infer<typeof UpdateContractSchema>) {
  const before = await loadVisible(me, id)
  if (patch.status && patch.status !== before.status && !ALLOWED_TRANSITIONS[before.status].includes(patch.status)) {
    throw httpError(400, 'CONTRACT_STATUS_TRANSITION', { from: before.status, to: patch.status })
  }
  const next = { ...before, ...patch }
  if (next.autoRenew && !next.renewalMonths) throw httpError(400, 'CONTRACT_RENEWAL_MONTHS_REQUIRED')
  if (next.noticeDays && !next.endsOn) throw httpError(400, 'CONTRACT_END_REQUIRED')
  const ownerUserId = patch.ownerUserId ? await resolveOwner(me, patch.ownerUserId) : undefined
  // A new end date is a new term: its notice gets its own alert.
  const noticeAlertedFor = patch.endsOn !== undefined && patch.endsOn !== before.endsOn ? null : before.noticeAlertedFor

  const row = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contracts)
      .set({ ...patch, ...(ownerUserId ? { ownerUserId } : {}), noticeAlertedFor, updatedByUserId: me.id, updatedAt: new Date() })
      .where(eq(contracts.id, id))
      .returning()
    await syncNoticeEvent(tx, id)
    return row!
  })
  const changes = Object.fromEntries(
    Object.keys(patch)
      .filter((key) => before[key as keyof typeof before] !== row[key as keyof typeof row])
      .map((key) => [key, [before[key as keyof typeof before], row[key as keyof typeof row]] as [unknown, unknown]]),
  )
  if (Object.keys(changes).length > 0) await recordAudit({ action: 'contract.modificat', entityType: 'contract', entityId: id, changes })
  return getContract(me, id)
}

/** Only a draft goes away, and its number becomes free again; a signed contract is terminated instead. */
export async function deleteDraft(me: Me, id: string) {
  const contract = await loadVisible(me, id)
  if (contract.status !== 'draft' || contract.origin === 'saas') throw httpError(400, 'CONTRACT_NOT_DRAFT')
  await db.transaction(async (tx) => {
    await releaseNumber(tx, id)
    await tx.update(contracts).set({ deletedAt: new Date(), updatedByUserId: me.id }).where(eq(contracts.id, id))
    await tx.update(contractDocuments).set({ deletedAt: new Date() }).where(eq(contractDocuments.contractId, id))
    await syncNoticeEvent(tx, id)
  })
  await recordAudit({ action: 'contract.sters', entityType: 'contract', entityId: id, changes: { status: [contract.status, null] } })
}

// ── SaaS contracts: the registry row behind the client's documents ──────────────────────────

/**
 * The SaaS contract of a client, created on first use. Every path that makes or signs a SaaS
 * document goes through here, so the document always has its contract_id and the client's
 * contract number is held in the series (and cannot be handed out twice).
 */
export async function ensureSaasContract(tx: Tx, clientId: string, actorUserId: string | null): Promise<string> {
  const [client] = await tx.select().from(billingClients).where(eq(billingClients.id, clientId))
  if (!client) throw httpError(400, 'CLIENT_NOT_FOUND')
  let [contract] = await tx
    .select()
    .from(contracts)
    .where(and(eq(contracts.billingClientId, clientId), eq(contracts.origin, 'saas'), isNull(contracts.deletedAt)))
  if (!contract) {
    const ownerUserId = actorUserId ?? (await companyAdminId(tx))
    ;[contract] = await tx
      .insert(contracts)
      .values({
        title: tr('errors.contracts.saasTitle'),
        category: 'saas',
        counterpartyKind: 'client',
        billingClientId: clientId,
        counterpartyName: client.name,
        ownerUserId,
        status: 'draft',
        origin: 'saas',
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      })
      .returning()
  } else if (contract.counterpartyName !== client.name) {
    await tx.update(contracts).set({ counterpartyName: client.name }).where(eq(contracts.id, contract.id))
  }

  const raw = ((client.contractDetails ?? {}) as { nrContract?: string }).nrContract?.trim() ?? ''
  const plain = /^\d{1,6}$/.test(raw) ? Number(raw) : null
  if (plain !== null) {
    const series = contract!.seriesId ? { id: contract!.seriesId } : await defaultSeries(tx)
    if (series && contract!.number !== plain) {
      if (contract!.number !== null) await releaseNumber(tx, contract!.id)
      await claimNumber(tx, series.id, plain, contract!.id)
      await tx.update(contracts).set({ externalNumber: null }).where(eq(contracts.id, contract!.id))
    } else if (!series) {
      await tx.update(contracts).set({ externalNumber: raw }).where(eq(contracts.id, contract!.id))
    }
  } else if (raw && contract!.externalNumber !== raw) {
    if (contract!.number !== null) await releaseNumber(tx, contract!.id)
    await tx.update(contracts).set({ externalNumber: raw }).where(eq(contracts.id, contract!.id))
  }
  return contract!.id
}

/** A SaaS document was signed: the contract is too, from that day. */
export async function markSaasContractSigned(tx: Tx, contractId: string, signedAt: Date): Promise<void> {
  await tx
    .update(contracts)
    .set({ status: 'signed', signedOn: sql`coalesce(${contracts.signedOn}, ${signedAt.toISOString().slice(0, 10)}::date)`, updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), sql`${contracts.status} IN ('draft', 'to_sign')`))
}

async function companyAdminId(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT u."id" FROM ${users} u LEFT JOIN "roles" r ON r."id" = u."role_id"
     WHERE u."deleted_at" IS NULL
     ORDER BY u."is_platform_admin" DESC, (r."kind" = 'admin') DESC NULLS LAST, u."created_at" LIMIT 1
  `)
  if (!row) throw new Error('no user to own the contract')
  return row.id
}

/** A sample PDF of a company template: each field shows its label, so the layout can be checked before use. */
export async function previewCustomTemplate(templateId: string): Promise<Buffer> {
  const template = await loadCustomTemplate(templateId)
  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  const company = await getCompany()
  const series = template.seriesId ? await getSeries(template.seriesId) : await defaultSeries()
  const sample = Object.fromEntries(template.fields.map((f) => [f.key, `[${f.label.ro}]`]))
  const html = renderCustomTemplate({
    bodyHtml: template.bodyHtml,
    fields: template.fields,
    signerRoles: template.signerRoles,
    values: sample,
    numberLabel: series ? formatContractNumber(series.numberFormat, series.code, await nextNumber(series.id)) : '—',
    date: todayIso(company.timeZone),
    counterpartyName: '[…]',
  })
  return htmlToPdf(html, { signatureFields: true, isolated: true })
}
