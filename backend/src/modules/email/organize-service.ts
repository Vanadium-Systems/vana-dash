import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailBlocklist, emailLabels, emailMessages, emailRules } from '../../shared/db/schema/index.js'
import type { BlocklistCreateSchema, LabelCreateSchema, LabelUpdateSchema, RuleCreateSchema, RuleUpdateSchema } from './organize-schema.js'
import { tr } from '../../shared/lib/i18n.js'

// ── Labels ───────────────────────────────────────────────────────────────────

export async function listLabels() {
  return db.select().from(emailLabels).where(isNull(emailLabels.deletedAt)).orderBy(emailLabels.name)
}

export async function createLabel(input: z.infer<typeof LabelCreateSchema>) {
  const [row] = await db.insert(emailLabels).values(input).returning()
  return row
}

export async function updateLabel(id: string, input: z.infer<typeof LabelUpdateSchema>) {
  const [row] = await db
    .update(emailLabels)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(emailLabels.id, id), isNull(emailLabels.deletedAt)))
    .returning()
  return row ?? null
}

export async function deleteLabel(id: string): Promise<boolean> {
  const [row] = await db
    .update(emailLabels)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailLabels.id, id), isNull(emailLabels.deletedAt)))
    .returning({ id: emailLabels.id })
  return Boolean(row)
}

// ── Rules ────────────────────────────────────────────────────────────────────

type Rule = typeof emailRules.$inferSelect

export async function listRules() {
  return db.select().from(emailRules).where(isNull(emailRules.deletedAt)).orderBy(desc(emailRules.createdAt))
}

export async function createRule(input: z.infer<typeof RuleCreateSchema>) {
  const [row] = await db.insert(emailRules).values(input).returning()
  return row
}

export async function updateRule(id: string, input: z.infer<typeof RuleUpdateSchema>) {
  const [row] = await db
    .update(emailRules)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(emailRules.id, id), isNull(emailRules.deletedAt)))
    .returning()
  return row ?? null
}

export async function deleteRule(id: string): Promise<boolean> {
  const [row] = await db
    .update(emailRules)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailRules.id, id), isNull(emailRules.deletedAt)))
    .returning({ id: emailRules.id })
  return Boolean(row)
}

function ruleMatchesCondition(rule: Rule) {
  // Condiție SQL — folosită ATÂT la evaluare per-mesaj nou (Wave 1 INT), CÂT și la aplicare
  // retroactivă (UPDATE direct, regula #9 CLAUDE.md — SQL, nu buclă JS pe toate mesajele).
  // trim() pe from_address — un spațiu accidental în adresa parsată nu trebuie să ocolească
  // regula (SEC, Wave 4 din PLAN.md).
  const matchValue = rule.matchValue.trim()
  switch (rule.matchType) {
    case 'from_address':
      return sql`lower(trim(${emailMessages.fromAddress})) = lower(${matchValue})`
    case 'from_domain':
      return sql`lower(trim(${emailMessages.fromAddress})) like lower(${'%@' + matchValue})`
    case 'subject_contains':
      return sql`${emailMessages.subject} ilike ${'%' + matchValue + '%'}`
  }
}

function ruleUpdatePatch(rule: Rule): Record<string, unknown> {
  if (rule.action === 'label') return { labelId: rule.labelId, updatedAt: new Date() }
  return { folder: rule.action, updatedAt: new Date() }
}

/** Aplică o regulă retroactiv pe mesajele deja existente — un singur UPDATE, nu buclă. */
export async function applyRuleToExisting(id: string): Promise<number> {
  const [rule] = await db.select().from(emailRules).where(and(eq(emailRules.id, id), isNull(emailRules.deletedAt)))
  if (!rule) throw new Error(tr('errors.alerts.ruleNotFound'))

  const rows = await db
    .update(emailMessages)
    .set(ruleUpdatePatch(rule))
    .where(and(eq(emailMessages.direction, 'in'), isNull(emailMessages.deletedAt), ruleMatchesCondition(rule)))
    .returning({ id: emailMessages.id })
  return rows.length
}

export interface RuleEvaluation {
  labelId: string | null
  folder: 'archive' | 'trash' | 'spam' | null
  /** true dacă cel puțin o regulă a prins — chiar și una care a setat DOAR label (folder rămâne
   *  null în cazul ăsta). Distinct de `folder` pt. că un rule "doar label" tot trebuie să oprească
   *  euristica de spam (decizie fixată în PLAN.md: control explicit al lui Stefan, prioritate mai
   *  mare — vezi classifyInboundMessage din inbound-service.ts). */
  matched: boolean
}

/**
 * Evaluează TOATE regulile active pt. un mesaj nou (nu doar prima potrivire — ca la Gmail
 * filters, pot aplica simultan label + archive/trash/spam). Volum mic (regulile lui Stefan,
 * nu rânduri din DB), evaluare în JS aici e potrivită — nu e agregare pe seturi mari.
 */
export async function evaluateRulesForMessage(message: { fromAddress: string; subject: string }): Promise<RuleEvaluation> {
  const rules = await db.select().from(emailRules).where(isNull(emailRules.deletedAt))
  let labelId: string | null = null
  let folder: RuleEvaluation['folder'] = null
  let matched = false
  // trim() — simetric cu ruleMatchesCondition (apply-existing), altfel un spațiu accidental
  // în adresa parsată de Resend ar ocoli silențios regula (SEC, Wave 4 din PLAN.md).
  const fromAddress = message.fromAddress.trim().toLowerCase()
  const subject = message.subject.trim().toLowerCase()

  for (const rule of rules) {
    const matchValue = rule.matchValue.trim().toLowerCase()
    const matches =
      rule.matchType === 'from_address'
        ? fromAddress === matchValue
        : rule.matchType === 'from_domain'
          ? fromAddress.endsWith(`@${matchValue}`)
          : subject.includes(matchValue)

    if (!matches) continue
    matched = true
    if (rule.action === 'label') labelId = rule.labelId
    else folder = rule.action
  }

  return { labelId, folder, matched }
}

// ── Blocklist ────────────────────────────────────────────────────────────────

export async function listBlocklist() {
  return db.select().from(emailBlocklist).where(isNull(emailBlocklist.deletedAt)).orderBy(emailBlocklist.address)
}

export async function addToBlocklist(input: z.infer<typeof BlocklistCreateSchema>) {
  const [row] = await db
    .insert(emailBlocklist)
    .values({ address: input.address.trim().toLowerCase() })
    .returning()
  return row
}

export async function removeFromBlocklist(id: string): Promise<boolean> {
  const [row] = await db
    .update(emailBlocklist)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailBlocklist.id, id), isNull(emailBlocklist.deletedAt)))
    .returning({ id: emailBlocklist.id })
  return Boolean(row)
}

/** Trece retroactiv în trash mesajele deja existente de la o adresă blocată — un singur UPDATE. */
export async function applyBlocklistToExisting(id: string): Promise<number> {
  const [entry] = await db.select().from(emailBlocklist).where(and(eq(emailBlocklist.id, id), isNull(emailBlocklist.deletedAt)))
  if (!entry) throw new Error(tr('errors.email.blocklistEntryNotFound'))

  const rows = await db
    .update(emailMessages)
    .set({ folder: 'trash', updatedAt: new Date() })
    .where(
      and(
        eq(emailMessages.direction, 'in'),
        isNull(emailMessages.deletedAt),
        sql`lower(trim(${emailMessages.fromAddress})) = ${entry.address}`,
      ),
    )
    .returning({ id: emailMessages.id })
  return rows.length
}

/** Verificare la ingest — o adresă blocată manual oprește orice altă evaluare (regulă/spam). */
export async function isAddressBlocked(fromAddress: string): Promise<boolean> {
  const [row] = await db
    .select({ id: emailBlocklist.id })
    .from(emailBlocklist)
    .where(and(isNull(emailBlocklist.deletedAt), sql`lower(${emailBlocklist.address}) = lower(trim(${fromAddress}))`))
    .limit(1)
  return Boolean(row)
}

/**
 * Verificare la ingest, chiar înainte de notifyPush('email', ...) — un mesaj fără label (sau cu
 * un label care nu mai există) tot notifică, la fel ca înainte de acest câmp. Nu blochează
 * salvarea/clasificarea mesajului, doar push-ul (2026-08-20 — rapoartele DMARC îl "căsăpeau" pe
 * Stefan de notificări).
 */
export async function labelAllowsNotifications(labelId: string | null): Promise<boolean> {
  if (!labelId) return true
  const [label] = await db.select({ notificationsEnabled: emailLabels.notificationsEnabled }).from(emailLabels).where(eq(emailLabels.id, labelId))
  return label?.notificationsEnabled ?? true
}
