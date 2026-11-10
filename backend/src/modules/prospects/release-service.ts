import { sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { auditLog, notifications } from '../../shared/db/schema/index.js'
import { trFor } from '../../shared/lib/i18n.js'
import type { Locale } from '../../shared/lib/locale.js'
import { notifyMany } from '../../shared/lib/notify.js'
import { getReleaseSettings } from './team-service.js'

interface ReleaseRow extends Record<string, unknown> {
  id: string
  name: string
  owner: string
  locale: Locale | null
}

const WARNING_KIND = 'clienti.release_warning'

/** One company's pass: release what has sat idle past the limit, warn once about what is about to. */
export async function runProspectRelease(defaultLocale: Locale) {
  const { enabled, idleDays, warnDays } = await getReleaseSettings()
  if (!enabled) return { released: 0, warned: 0 }
  const lastTouch = sql`coalesce(p.last_activity_at, p.claimed_at)`
  // A won or lost prospect is finished business, not an idle lead: it stays with its owner.
  const stillOpen = sql`NOT EXISTS (SELECT 1 FROM prospect_statuses s WHERE s.key = p.status AND s.deleted_at IS NULL AND s.kind IN ('won', 'lost'))`

  // The CTE keeps the old owner: RETURNING on the UPDATE alone would already show null.
  const released = await db.execute<ReleaseRow>(sql`
    WITH due AS (
      SELECT p.id, p.name, p.assigned_user_id AS owner FROM prospects p
       WHERE p.assigned_user_id IS NOT NULL AND p.deleted_at IS NULL AND ${stillOpen}
         AND ${lastTouch} < now() - make_interval(days => ${idleDays})
    ), upd AS (
      UPDATE prospects SET assigned_user_id = NULL, claimed_at = NULL, updated_at = now()
        FROM due WHERE prospects.id = due.id
      RETURNING due.id, due.name, due.owner
    )
    SELECT upd.id, upd.name, upd.owner, u.locale FROM upd JOIN users u ON u.id = upd.owner`)
  if (released.length > 0) {
    await db.insert(auditLog).values(
      released.map((row) => ({
        action: 'prospect.eliberat.automat',
        entityType: 'prospect',
        entityId: row.id,
        changes: { assignedUserId: [row.owner, null] as [unknown, unknown] },
      })),
    )
    await notifyMany(
      released.map((row) => ({
        userId: row.owner,
        kind: 'clienti.released',
        title: trFor(row.locale ?? defaultLocale, 'push.clienti.released', { company: row.name, count: idleDays }),
        url: `/clients?prospect=${row.id}`,
        entityType: 'prospect',
        entityId: row.id,
      })),
    )
  }

  if (warnDays <= 0) return { released: released.length, warned: 0 }
  // A warning counts only if it came after the last activity: a new note restarts the clock, and
  // the next idle stretch earns its own warning.
  const toWarn = await db.execute<ReleaseRow & { days_left: number }>(sql`
    SELECT p.id, p.name, p.assigned_user_id AS owner, u.locale,
           ceil(extract(epoch FROM (${lastTouch} + make_interval(days => ${idleDays}) - now())) / 86400)::int AS days_left
      FROM prospects p JOIN users u ON u.id = p.assigned_user_id
     WHERE p.assigned_user_id IS NOT NULL AND p.deleted_at IS NULL AND ${stillOpen}
       AND ${lastTouch} < now() - make_interval(days => ${idleDays - warnDays})
       AND NOT EXISTS (
         SELECT 1 FROM ${notifications} n
          WHERE n.kind = ${WARNING_KIND} AND n.entity_id = p.id AND n.user_id = p.assigned_user_id
            AND n.created_at > ${lastTouch})`)
  await notifyMany(
    toWarn.map((row) => ({
      userId: row.owner,
      kind: WARNING_KIND,
      title: trFor(row.locale ?? defaultLocale, 'push.clienti.releaseWarning', { company: row.name, count: Math.max(row.days_left, 1) }),
      url: `/clients?prospect=${row.id}`,
      entityType: 'prospect',
      entityId: row.id,
    })),
  )
  return { released: released.length, warned: toWarn.length }
}
