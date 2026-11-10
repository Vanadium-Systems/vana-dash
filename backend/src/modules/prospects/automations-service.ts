import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { auditLog, emailSequenceEnrollments, prospectAutomationRules, prospectListMembers, prospectLists, prospects, users } from '../../shared/db/schema/index.js'
import { config } from '../../shared/config.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { trFor } from '../../shared/lib/i18n.js'
import type { Locale } from '../../shared/lib/locale.js'
import { notifyMany } from '../../shared/lib/notify.js'
import { findProspectIdsByAddress } from '../../shared/lib/prospect-contact-status.js'
import { onProspectEvent, type ProspectEvents } from '../../shared/lib/prospect-events.js'
import { wallClock, zonedTimeToUtc } from '../../shared/lib/schedule-recurrence.js'
import { activeAdminIds } from '../email/sequences-service.js'
import { insertTask } from './crm-service.js'
import { RULE_KEYS, RULE_PARAMS, type RuleKey, type RuleParams } from './automations-schema.js'
import { changeStatus, statusKind } from './service.js'

export class AutomationForbiddenError extends Error {
  readonly code = 'AUTOMATION_FORBIDDEN'
}

/** Changing the rules is a decision of the company, like the score: whoever can assign prospects. */
export function assertCanConfigureAutomations(me: { features: readonly string[] }) {
  if (!me.features.includes('clienti.repartizare')) throw new AutomationForbiddenError('AUTOMATION_FORBIDDEN')
}

export interface AutomationRule {
  ruleKey: RuleKey
  enabled: boolean
  params: Record<string, unknown>
  lastRunAt: Date | null
  lastRunCount: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// ── Config ───────────────────────────────────────────────────────────────────

export async function listAutomations(): Promise<AutomationRule[]> {
  const rows = await db.select().from(prospectAutomationRules).where(isNull(prospectAutomationRules.deletedAt))
  const byKey = new Map(rows.map((r) => [r.ruleKey, r]))
  return RULE_KEYS.map((ruleKey) => {
    const row = byKey.get(ruleKey)
    return {
      ruleKey,
      enabled: row?.enabled ?? false,
      params: RULE_PARAMS[ruleKey].parse(row?.params ?? {}) as Record<string, unknown>,
      lastRunAt: row?.lastRunAt ?? null,
      lastRunCount: row?.lastRunCount ?? null,
    }
  })
}

/** Null when the params do not fit the rule; the route answers 400. */
export function parseRuleParams(ruleKey: RuleKey, params: unknown): Record<string, unknown> | null {
  const result = RULE_PARAMS[ruleKey].safeParse(params)
  return result.success ? (result.data as Record<string, unknown>) : null
}

export async function saveAutomation(ruleKey: RuleKey, enabled: boolean, params: Record<string, unknown>): Promise<AutomationRule> {
  const before = (await listAutomations()).find((r) => r.ruleKey === ruleKey)!
  await db
    .insert(prospectAutomationRules)
    .values({ ruleKey, enabled, params })
    .onConflictDoUpdate({ target: [prospectAutomationRules.tenantId, prospectAutomationRules.ruleKey], set: { enabled, params, deletedAt: null, updatedAt: new Date() } })
  const after = (await listAutomations()).find((r) => r.ruleKey === ruleKey)!
  await recordAudit({
    action: 'prospect.automatizare.config',
    entityType: 'prospect_automation_rule',
    changes: { rule: [null, ruleKey], enabled: [before.enabled, enabled], params: [before.params, params] },
  })
  return after
}

async function loadRule<K extends RuleKey>(ruleKey: K): Promise<{ enabled: boolean; params: RuleParams<K> }> {
  const [row] = await db
    .select({ enabled: prospectAutomationRules.enabled, params: prospectAutomationRules.params })
    .from(prospectAutomationRules)
    .where(and(eq(prospectAutomationRules.ruleKey, ruleKey), isNull(prospectAutomationRules.deletedAt)))
  const parsed = RULE_PARAMS[ruleKey].safeParse(row?.params ?? {})
  // A row that no longer fits the schema runs with the defaults rather than not at all.
  return { enabled: row?.enabled ?? false, params: (parsed.success ? parsed.data : RULE_PARAMS[ruleKey].parse({})) as RuleParams<K> }
}

/** `lastRunCount` is what the LAST run touched (one prospect for an event rule, the total for the daily job), not a running total. */
async function recordRun(ruleKey: RuleKey, count: number) {
  const now = new Date()
  await db
    .insert(prospectAutomationRules)
    .values({ ruleKey, enabled: false, params: {}, lastRunAt: now, lastRunCount: count })
    .onConflictDoUpdate({ target: [prospectAutomationRules.tenantId, prospectAutomationRules.ruleKey], set: { lastRunAt: now, lastRunCount: count } })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** What an automation did, on the prospect it touched: no actor, `via: automation`. */
async function auditAutomation(ruleKey: RuleKey, prospectIds: string[], changes: Record<string, [unknown, unknown]> = {}) {
  if (prospectIds.length === 0) return
  await db.insert(auditLog).values(
    prospectIds.map((id) => ({
      actorUserId: null,
      action: 'prospect.automatizare',
      entityType: 'prospect',
      entityId: id,
      changes: { rule: [null, ruleKey], via: [null, 'automation'], ...changes } as Record<string, [unknown, unknown]>,
    })),
  )
}

async function loadProspect(id: string) {
  const [row] = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      status: prospects.status,
      assignedUserId: prospects.assignedUserId,
      billingClientId: prospects.billingClientId,
      score: prospects.score,
    })
    .from(prospects)
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
  return row
}

/** The owner, or the first active admin when the prospect is free. */
async function responsibleOf(prospect: { assignedUserId: string | null }): Promise<string | null> {
  return prospect.assignedUserId ?? (await activeAdminIds())[0] ?? null
}

async function localesOf(userIds: string[]): Promise<Map<string, Locale>> {
  if (userIds.length === 0) return new Map()
  const rows = await db.select({ id: users.id, locale: users.locale }).from(users).where(inArray(users.id, userIds))
  return new Map(rows.map((r) => [r.id, r.locale]))
}

// ── Handlers (one per rule; the listeners below only route events to them) ───

export async function handleReply({ prospectId }: ProspectEvents['email.replied'], now = new Date()): Promise<number> {
  if (!prospectId) return 0
  const rule = await loadRule('reply_call_task')
  if (!rule.enabled) return 0
  const prospect = await loadProspect(prospectId)
  if (!prospect) return 0
  const assigneeUserId = await responsibleOf(prospect)
  if (!assigneeUserId) return 0

  const timeZone = await getCompanyTimeZone()
  const today = wallClock(now, timeZone)
  // Day arithmetic through Date.UTC so the 31st rolls over; the hour is the company's wall clock.
  const next = new Date(Date.UTC(today.y, today.m - 1, today.d + 1))
  const dueAt = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), rule.params.hour, 0, timeZone)
  await db.transaction((tx) =>
    insertTask(tx, { id: null }, prospect.id, assigneeUserId, { kind: 'call', title: trFor(config.defaultLocale, 'push.clienti.autoCallTitle', { company: prospect.name }), dueAt }),
  )
  await auditAutomation('reply_call_task', [prospect.id], { task: [null, 'call'] })
  await recordRun('reply_call_task', 1)
  return 1
}

export async function handleBounce({ address }: ProspectEvents['email.bounced']): Promise<number> {
  const rule = await loadRule('bounce_notify')
  if (!rule.enabled) return 0
  const touched: Array<{ id: string; name: string; owner: string }> = []
  for (const prospectId of await findProspectIdsByAddress(address)) {
    const prospect = await loadProspect(prospectId)
    if (prospect?.assignedUserId) touched.push({ id: prospect.id, name: prospect.name, owner: prospect.assignedUserId })
  }
  const locales = await localesOf(touched.map((p) => p.owner))
  await notifyMany(
    touched.map((p) => ({
      userId: p.owner,
      kind: 'clienti.bounce',
      title: trFor(locales.get(p.owner) ?? config.defaultLocale, 'push.clienti.autoBounce', { address, company: p.name }),
      url: `/clients?prospect=${p.id}`,
      entityType: 'prospect',
      entityId: p.id,
    })),
  )
  await auditAutomation('bounce_notify', touched.map((p) => p.id), { address: [null, address] })
  if (touched.length > 0) await recordRun('bounce_notify', touched.length)
  return touched.length
}

export async function handleMeeting({ prospectId, at }: ProspectEvents['meeting.booked'], now = new Date()): Promise<number> {
  const rule = await loadRule('meeting_stage')
  if (!rule.enabled) return 0
  const prospect = await loadProspect(prospectId)
  if (!prospect) return 0

  const changes: Record<string, [unknown, unknown]> = {}
  const target = rule.params.status
  if (target && target !== prospect.status) {
    const kind = await statusKind(target)
    // A lost stage needs a reason, which an automation does not have; a stage that no longer exists is skipped.
    if (kind && kind !== 'lost') {
      await db.transaction((tx) => changeStatus(tx, prospect, target, kind, null))
      changes.status = [prospect.status, target]
    }
  }
  const assigneeUserId = await responsibleOf(prospect)
  if (assigneeUserId) {
    const dueAt = new Date(Math.max(at.getTime() - DAY_MS, now.getTime()))
    await db.transaction((tx) =>
      insertTask(tx, { id: null }, prospect.id, assigneeUserId, { kind: 'task', title: trFor(config.defaultLocale, 'push.clienti.autoMeetingTitle', { company: prospect.name }), dueAt }),
    )
    changes.task = [null, 'task']
  }
  if (Object.keys(changes).length === 0) return 0
  await auditAutomation('meeting_stage', [prospect.id], changes)
  await recordRun('meeting_stage', 1)
  return 1
}

export async function handleStageChange({ prospectId, kind }: ProspectEvents['prospect.stage_changed']): Promise<number> {
  if (kind !== 'won') return 0
  const rule = await loadRule('won_cleanup')
  if (!rule.enabled) return 0
  const prospect = await loadProspect(prospectId)
  if (!prospect) return 0

  // The sequence's own stop-on-won setting is not consulted: a won prospect gets no more cold emails.
  const stopped = await db
    .update(emailSequenceEnrollments)
    .set({ status: 'won_lost', updatedAt: new Date() })
    .where(and(eq(emailSequenceEnrollments.prospectId, prospect.id), eq(emailSequenceEnrollments.status, 'active'), isNull(emailSequenceEnrollments.deletedAt)))
    .returning({ id: emailSequenceEnrollments.id })
  const changes: Record<string, [unknown, unknown]> = { enrollmentsStopped: [null, stopped.length] }
  if (!prospect.billingClientId) {
    const adminIds = await activeAdminIds()
    const locales = await localesOf(adminIds)
    await notifyMany(
      adminIds.map((userId) => ({
        userId,
        kind: 'clienti.won_cleanup',
        title: trFor(locales.get(userId) ?? config.defaultLocale, 'push.clienti.autoWon', { company: prospect.name }),
        url: `/clients?prospect=${prospect.id}`,
        entityType: 'prospect',
        entityId: prospect.id,
      })),
    )
    changes.adminsNotified = [null, adminIds.length]
  }
  await auditAutomation('won_cleanup', [prospect.id], changes)
  await recordRun('won_cleanup', 1)
  return 1
}

export async function handleProspectCreated({ prospectId, via }: ProspectEvents['prospect.created']): Promise<number> {
  if (via !== 'import') return 0
  const rule = await loadRule('import_list')
  if (!rule.enabled || !rule.params.listId) return 0
  const prospect = await loadProspect(prospectId)
  if (!prospect || prospect.score === null || Number(prospect.score) < rule.params.minScore) return 0
  const [list] = await db
    .select({ id: prospectLists.id })
    .from(prospectLists)
    .where(and(eq(prospectLists.id, rule.params.listId), isNull(prospectLists.deletedAt)))
  if (!list) return 0

  const added = await db
    .insert(prospectListMembers)
    .values({ listId: list.id, prospectId: prospect.id, addedByUserId: null })
    .onConflictDoNothing({ target: [prospectListMembers.tenantId, prospectListMembers.listId, prospectListMembers.prospectId] })
    .returning({ id: prospectListMembers.id })
  if (added.length === 0) return 0
  await auditAutomation('import_list', [prospect.id], { listId: [null, list.id] })
  // Only a run that added something is recorded, or one import of 500 would end with "last run: 0".
  await recordRun('import_list', 1)
  return 1
}

const NO_NEXT_STEP_FILTER = encodeURIComponent(
  JSON.stringify([
    { field: 'nextTask', op: 'in', value: ['none'] },
    { field: 'owner', op: 'in', value: ['me'] },
  ]),
)

/** Daily, one company: one notification per owner, not one per prospect. Returns the prospects counted. */
export async function runNoNextStep(): Promise<number> {
  const rule = await loadRule('no_next_step')
  if (!rule.enabled) return 0
  const rows = await db.execute<{ owner: string; locale: Locale | null; ids: string[] }>(sql`
    SELECT p.assigned_user_id AS owner, u.locale, array_agg(p.id) AS ids
      FROM prospects p
      JOIN users u ON u.id = p.assigned_user_id AND u.status = 'active' AND u.deleted_at IS NULL
      JOIN prospect_statuses s ON s.key = p.status AND s.deleted_at IS NULL AND s.kind = 'open'
     WHERE p.deleted_at IS NULL
       AND coalesce(p.last_activity_at, p.claimed_at) < now() - make_interval(days => ${rule.params.days})
       AND NOT EXISTS (SELECT 1 FROM prospect_archives a WHERE a.prospect_id = p.id AND a.user_id = p.assigned_user_id)
       AND NOT EXISTS (SELECT 1 FROM prospect_tasks t WHERE t.prospect_id = p.id AND t.done_at IS NULL AND t.skipped_at IS NULL AND t.deleted_at IS NULL)
     GROUP BY p.assigned_user_id, u.locale`)
  await notifyMany(
    rows.map((row) => ({
      userId: row.owner,
      kind: 'clienti.no_next_step',
      title: trFor(row.locale ?? config.defaultLocale, 'push.clienti.autoNoNextStep', { count: row.ids.length }),
      url: `/clients?f=${NO_NEXT_STEP_FILTER}`,
    })),
  )
  const all = rows.flatMap((row) => row.ids)
  await auditAutomation('no_next_step', all)
  await recordRun('no_next_step', all.length)
  return all.length
}

// ── Listeners ────────────────────────────────────────────────────────────────

let listenersRegistered = false

/** Each rule on its own event; an error in one is logged and touches no other. Once per process. */
export function registerAutomationListeners(): void {
  if (listenersRegistered) return
  listenersRegistered = true
  const guarded =
    <P>(rule: RuleKey, handler: (payload: P) => Promise<unknown>) =>
    async (payload: P) => {
      try {
        await handler(payload)
      } catch (err) {
        console.error(`[automations] ${rule}:`, err)
      }
    }
  onProspectEvent('email.replied', guarded('reply_call_task', handleReply))
  onProspectEvent('email.bounced', guarded('bounce_notify', handleBounce))
  onProspectEvent('meeting.booked', guarded('meeting_stage', handleMeeting))
  onProspectEvent('prospect.stage_changed', guarded('won_cleanup', handleStageChange))
  onProspectEvent('prospect.created', guarded('import_list', handleProspectCreated))
}
