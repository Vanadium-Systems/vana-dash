import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { emailSends, emailSuppressions } from '../../shared/db/schema/index.js'
import { markContactAddress } from '../../shared/lib/prospect-contact-status.js'
import { stopEnrollmentsForAddress } from './sequences-service.js'

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/** Query batched pt. bulkSend — un singur SELECT pt. tot batch-ul curent (volum <50, vezi
 *  comentariul din service.ts), nu un lookup per destinatar. */
export async function getSuppressedEmails(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set()
  const normalized = emails.map(normalize)
  const rows = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(inArray(emailSuppressions.email, normalized))
  return new Set(rows.map((r) => r.email))
}

/**
 * Click pe link-ul de dezabonare (sau hard-bounce/complaint automat, vezi service.ts webhook) —
 * idempotent (upsert pe `email`, un al doilea click nu aruncă). Adresa rămâne suprimată în toate
 * cazurile (nu trimitem la o adresă moartă), dar efectul pe prospect diferă: dezabonare și
 * complaint marchează punctele de contact `unsubscribed`, un bounce doar `bounced` (adresa e
 * moartă, omul nu a cerut nimic). Înscrierile active pe adresă se opresc imediat cu același status.
 * Eșecul marcării NU trebuie să blocheze suprimarea efectivă, de aceea e izolat separat.
 *
 * `source` (2026-09-03) — 'manual' (click real) vs. 'bounce'/'complaint' (automat din webhook),
 * pt. pagina „Dezabonări" din Setări Email. Pe un re-trigger (ex: bounce după un unsubscribe
 * manual anterior) sursa se actualizează la valoarea nouă — cel mai recent eveniment câștigă.
 */
export async function suppressEmail(email: string, source: 'manual' | 'bounce' | 'complaint' = 'manual'): Promise<void> {
  const normalized = normalize(email)
  await db
    .insert(emailSuppressions)
    .values({ email: normalized, source })
    .onConflictDoUpdate({ target: [emailSuppressions.tenantId, emailSuppressions.email], set: { unsubscribedAt: sql`now()`, source } })

  const status = source === 'bounce' ? 'bounced' : 'unsubscribed'
  try {
    await markContactAddress(normalized, status)
  } catch (err) {
    console.error('[email/unsubscribe] marcare puncte de contact eșuată pentru %s:', normalized, err)
  }
  try {
    await stopEnrollmentsForAddress(normalized, status)
  } catch (err) {
    console.error('[email/unsubscribe] oprire înscrieri eșuată pentru %s:', normalized, err)
  }
}

export interface SuppressionsOverview {
  unsubscribed: { email: string; unsubscribedAt: string }[]
  autoUnsubscribed: { email: string; unsubscribedAt: string; source: 'bounce' | 'complaint' }[]
  bounced: { recipient: string; lastBouncedAt: string; count: number }[]
}

/**
 * Cele 3 liste pt. pagina „Dezabonări" — dezabonați manual, auto-dezabonați (bounce/complaint),
 * și bounce agregat pe destinatar din email_sends (poate include adrese care au eșuat fără
 * (încă) să fi trecut pragul de suprimare, distinct de `autoUnsubscribed`). Agregare SQL
 * (GROUP BY pe email_sends), regula #9 CLAUDE.md.
 */
export async function getSuppressionsOverview(): Promise<SuppressionsOverview> {
  const [manualRows, autoRows, bounceRows] = await Promise.all([
    db
      .select({ email: emailSuppressions.email, unsubscribedAt: emailSuppressions.unsubscribedAt })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.source, 'manual'))
      .orderBy(desc(emailSuppressions.unsubscribedAt)),
    db
      .select({ email: emailSuppressions.email, unsubscribedAt: emailSuppressions.unsubscribedAt, source: emailSuppressions.source })
      .from(emailSuppressions)
      .where(sql`${emailSuppressions.source} != 'manual'`)
      .orderBy(desc(emailSuppressions.unsubscribedAt)),
    db
      .select({
        recipient: emailSends.recipient,
        lastBouncedAt: sql<string>`max(${emailSends.updatedAt})`,
        count: sql<number>`count(*)::int`,
      })
      .from(emailSends)
      .where(eq(emailSends.status, 'bounced'))
      .groupBy(emailSends.recipient)
      .orderBy(desc(sql`max(${emailSends.updatedAt})`)),
  ])

  return {
    unsubscribed: manualRows.map((r) => ({ email: r.email, unsubscribedAt: r.unsubscribedAt.toISOString() })),
    autoUnsubscribed: autoRows.map((r) => ({ email: r.email, unsubscribedAt: r.unsubscribedAt.toISOString(), source: r.source as 'bounce' | 'complaint' })),
    bounced: bounceRows,
  }
}

/**
 * Manual removal from a table that is internal to the app: nothing is reported to the email
 * provider, so the domain's reputation is not affected. Bulk sends and sequences stop skipping
 * the address, and the "Unsubscribed" badge in Sent goes away. Two cases need it: a transient
 * bounce (full mailbox, not a dead address) that blocks a contact you do write to, and your own
 * address, suppressed while testing templates.
 */
export async function removeSuppression(email: string): Promise<boolean> {
  const [row] = await db
    .delete(emailSuppressions)
    .where(eq(emailSuppressions.email, normalize(email)))
    .returning({ email: emailSuppressions.email })
  return Boolean(row)
}
