import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, sql as client } from '../shared/db/client.js'
import { emailMessages, emailThreadReads, users } from '../shared/db/schema/index.js'

// Verifică migrarea 0063 (citit/necitit per om): numărul de mesaje necitite calculat din
// `email_messages.is_read` (starea de dinainte) trebuie să fie identic cu cel calculat din
// `email_thread_reads.last_read_at` (starea de după). Rulează pe orice bază — inclusiv pe
// dump-ul de prod restaurat local (DB-5) — și iese cu cod 1 la orice diferență.
//
// Watermark-ul nu poate reprezenta exact un caz: un mesaj necitit sosit înaintea ultimului
// mesaj citit din același fir (se poate ajunge la el markând citite doar un subset din fir).
// Acolo firul e raportat ca citit. Scriptul listează aceste fire, ca diferența să fie
// cunoscută, nu descoperită.

const [owner] = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .orderBy(users.createdAt)
  .limit(1)
if (!owner) throw new Error('Niciun user în DB')
const ownerId = owner.id

const before = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(emailMessages)
  .where(and(eq(emailMessages.direction, 'in'), eq(emailMessages.isRead, false), isNull(emailMessages.deletedAt)))

const after = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(emailMessages)
  .leftJoin(
    emailThreadReads,
    and(eq(emailThreadReads.threadId, emailMessages.threadId), eq(emailThreadReads.userId, ownerId)),
  )
  .where(
    and(
      eq(emailMessages.direction, 'in'),
      isNull(emailMessages.deletedAt),
      sql`${emailMessages.receivedAt} > COALESCE(${emailThreadReads.lastReadAt}, '-infinity'::timestamptz)`,
    ),
  )

// Fire cu un mesaj necitit mai vechi decât watermark-ul — singurul caz unde diferența poate apărea.
const lost = await db
  .select({ threadId: emailMessages.threadId, oldest: sql`min(${emailMessages.receivedAt})` })
  .from(emailMessages)
  .innerJoin(
    emailThreadReads,
    and(eq(emailThreadReads.threadId, emailMessages.threadId), eq(emailThreadReads.userId, ownerId)),
  )
  .where(
    and(
      eq(emailMessages.direction, 'in'),
      eq(emailMessages.isRead, false),
      isNull(emailMessages.deletedAt),
      sql`${emailMessages.receivedAt} < ${emailThreadReads.lastReadAt}`,
    ),
  )
  .groupBy(emailMessages.threadId)

const beforeCount = before[0]?.count ?? 0
const afterCount = after[0]?.count ?? 0
console.log(`user: ${owner.email}`)
console.log(`necitite înainte (is_read): ${beforeCount}`)
console.log(`necitite după  (email_thread_reads): ${afterCount}`)
console.log(`diferență: ${afterCount - beforeCount}`)

if (lost.length > 0) {
  console.log(`\n${lost.length} fire cu mesaj necitit mai vechi decât watermark-ul (raportate ca citite):`)
  for (const row of lost) console.log(`  thread ${row.threadId} — cel mai vechi necitit: ${row.oldest}`)
}

await client.end()
process.exit(afterCount === beforeCount ? 0 : 1)
