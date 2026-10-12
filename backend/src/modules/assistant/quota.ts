import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { assistantUsage, dashboardConfig } from '../../shared/db/schema/index.js'
import { ensureAlertRule, raiseAlert } from '../../shared/lib/alerting.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { tr, trFor } from '../../shared/lib/i18n.js'
import { INTL_TAG } from '../../shared/lib/locale.js'

// Plafonul lunar de tokeni al asistentului, per om (PLAN.md C2, BE-5). `assistant_usage` ține
// consumul pe lună calendaristică; plafonul e o singură setare în Setări → Asistent, valabilă
// pentru toți oamenii, cu excepția adminului (implicit fără plafon).
//
// Trei praguri, trei comportamente: la 80% o alertă la Stefan (o singură dată pe lună, la
// traversare), la 100% `429 ASSISTANT_QUOTA` cu mesaj către om — nu o eroare generică de model.

const CAP_KEY = 'assistant.monthly_token_cap'
/** Când se ridică alerta: la 80% din plafon. */
const ALERT_RATIO = 0.8

/** `YYYY-MM` pe luna calendaristică din București — bucket-ul de consum. */
export function currentMonth(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  return `${year}-${month}`
}

/** Plafonul global, în tokeni pe lună. `null` = fără plafon (nicio setare, sau setată pe 0). */
export async function getMonthlyCap(): Promise<number | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, CAP_KEY))
  const value = row ? Number(row.value) : 0
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Adminul nu e plafonat: e cel care plătește furnizorul (decizie C2, „implicit fără plafon"). */
function isExempt(user: SessionUser): boolean {
  return user.role?.kind === 'admin'
}

export interface QuotaState {
  cap: number | null
  used: number
  /** Procent din plafon, sau `null` când nu există plafon. */
  ratio: number | null
}

export async function quotaState(user: SessionUser, at: Date = new Date()): Promise<QuotaState> {
  const cap = isExempt(user) ? null : await getMonthlyCap()
  const month = currentMonth(at)
  const [row] = await db
    .select({ used: sql<number>`COALESCE(SUM(${assistantUsage.inputTokens} + ${assistantUsage.outputTokens}), 0)` })
    .from(assistantUsage)
    .where(and(eq(assistantUsage.userId, user.id), eq(assistantUsage.month, month)))
  const used = Number(row?.used ?? 0)
  return { cap, used, ratio: cap ? used / cap : null }
}

export type QuotaCheck = { ok: true } | { ok: false; code: 'ASSISTANT_QUOTA'; message: string }

/**
 * Poate omul rula acum un tur de conversație? La 100% din plafon nu — și mesajul spune ce s-a
 * întâmplat și până când se reia, nu „ceva n-a mers".
 */
export async function checkQuota(user: SessionUser, at: Date = new Date()): Promise<QuotaCheck> {
  const { cap, used } = await quotaState(user, at)
  if (cap === null || used < cap) return { ok: true }
  return {
    ok: false,
    code: 'ASSISTANT_QUOTA',
    message: `Ai atins plafonul de asistent pentru luna ${currentMonth(at)} (${used.toLocaleString('ro-RO')} din ${cap.toLocaleString('ro-RO')} tokeni). Se reia luna viitoare.`,
  }
}

/**
 * Adună consumul unui tur și ridică alerta la Stefan la traversarea pragului de 80%. Se
 * numără doar la traversare, nu la fiecare tur de după prag — altfel o alertă nouă la fiecare
 * mesaj, până când Stefan o confirmă.
 */
export async function recordUsage(user: SessionUser, inputTokens: number, outputTokens: number, at: Date = new Date()): Promise<void> {
  if (inputTokens <= 0 && outputTokens <= 0) return
  const month = currentMonth(at)
  const { cap, used } = await quotaState(user, at)
  await db
    .insert(assistantUsage)
    .values({ userId: user.id, month, inputTokens, outputTokens })
    .onConflictDoUpdate({
      target: [assistantUsage.userId, assistantUsage.month],
      set: {
        inputTokens: sql`${assistantUsage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${assistantUsage.outputTokens} + ${outputTokens}`,
        updatedAt: new Date(),
      },
    })
  if (cap === null) return
  const next = used + inputTokens + outputTokens
  if (used / cap >= ALERT_RATIO || next / cap < ALERT_RATIO) return

  const ruleId = await ensureAlertRule(`assistant.quota.${user.id}`, tr('alerts.rules.assistantQuota', { name: user.displayName ?? user.email }), 'warning')
  await raiseAlert(
    ruleId,
    (locale) =>
      trFor(locale, 'alerts.jobs.assistantQuota', {
        name: user.displayName ?? user.email,
        percent: Math.round(ALERT_RATIO * 100),
        used: next.toLocaleString(INTL_TAG[locale]),
        cap: cap.toLocaleString(INTL_TAG[locale]),
        month,
      }),
    { url: '/settings' },
  )
}
