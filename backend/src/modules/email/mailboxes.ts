import { and, eq, isNotNull, isNull, or, sql, type Column, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailThreadReads, emailThreads, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { getIdentities, type EmailIdentity } from './settings-service.js'
import { tr } from '../../shared/lib/i18n.js'

// Cutii de email per om (PLAN.md C2, BE-4). Fiecare vede și trimite doar de pe cutiile
// atribuite; aceeași cutie poate fi la doi oameni (deci citit/necitit e per om, nu per cutie).
//
// Filtrul e în service, nu într-un hook: aceleași condiții intră în liste, căutare, fir deschis
// prin id și atașamente — un singur loc, ca să nu existe cale de citire rămasă neatinsă.

/** Adresa dintr-un header care poate fi „Vanadium Systems <contact@vanadium.systems>". */
export function bareAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value)
  return (match?.[1] ?? value).trim().toLowerCase()
}

/** Adresele reale ale cutiilor atribuite omului; `null` = adminul, care le are pe toate. */
export async function mailboxAddresses(me: SessionUser): Promise<string[] | null> {
  if (me.mailboxes === null) return null
  if (me.mailboxes.length === 0) return []
  const identities = await getIdentities()
  return me.mailboxes
    .map((key) => identities.find((i) => i.key === key)?.fromAddress)
    .filter((a): a is string => Boolean(a))
    .map(bareAddress)
}

/**
 * Adresa dintr-un header `From`/`To` care poate fi „Vanadium Systems <contact@vanadium.systems>".
 * `lower(...)` ca listele de mai jos să se compare insensitive la caz.
 */
const addressOf = (column: SQL | Column) => sql`lower(regexp_replace(${column}, '^.*<\\s*|\\s*>.*$', '', 'g'))`

/** Lista de adrese ale omului, ca valoare SQL comparabilă cu `= ANY(...)`. */
const addressList = (addresses: string[]) =>
  sql`ARRAY[${sql.join(addresses.map((a) => sql`${a}`), sql`, `)}]::text[]`

/**
 * Condiția care ține un fir în cutiile omului: are un mesaj primit pe o cutie a lui sau
 * trimis de pe una. Un fir deschis prin id dintr-o cutie străină nu se potrivește → 404,
 * exact ca un fir inexistent.
 */
export function threadVisibleTo(addresses: string[] | null): SQL | undefined {
  if (addresses === null) return undefined
  if (addresses.length === 0) return sql`false`
  const list = addressList(addresses)
  return sql`EXISTS (
    SELECT 1 FROM email_messages m
    WHERE m.thread_id = ${emailThreads.id} AND m.deleted_at IS NULL
      AND (
        (m.direction = 'in' AND ${addressOf(sql`m.to_address`)} = ANY(${list}))
        OR (m.direction = 'out' AND ${addressOf(sql`m.from_address`)} = ANY(${list}))
      )
  )`
}

/** Același filtru, pe un rând din `email_messages` (atașamente, mesaj singular). */
export function messageVisibleTo(addresses: string[] | null): SQL | undefined {
  if (addresses === null) return undefined
  if (addresses.length === 0) return sql`false`
  const list = addressList(addresses)
  return sql`(
    (${emailMessages.direction} = 'in' AND ${addressOf(emailMessages.toAddress)} = ANY(${list}))
    OR (${emailMessages.direction} = 'out' AND ${addressOf(emailMessages.fromAddress)} = ANY(${list}))
  )`
}

export class MailboxForbidden extends Error {
  readonly code = 'MAILBOX_FORBIDDEN'
  constructor(readonly fromKey: string) {
    super(tr('errors.email.mailboxNotYours', { fromKey }))
  }
}

/** Trimiterea acceptă doar identitățile omului (`403 MAILBOX_FORBIDDEN`). */
export function assertCanSendFrom(me: SessionUser, fromKey: string) {
  if (me.mailboxes === null) return
  if (!me.mailboxes.includes(fromKey)) throw new MailboxForbidden(fromKey)
}

/**
 * Aceeași verificare, dar pentru o adresă, nu pentru o cheie aleasă de om — cazul răspunsului
 * și al forward-ului, care trimit de pe adresa firului. Altfel un coleg cu doar `sales` ar fi
 * refuzat la răspuns pe un fir primit pe sales@ doar fiindcă verificarea era pe `contact`.
 * Adresă care nu mai e nicio identitate (cutie scoasă din Setări) → refuz: proprietatea ei nu
 * se mai poate dovedi, și adminul trece oricum pe scurtătură.
 */
export function assertCanSendFromAddress(me: SessionUser, address: string, identities: EmailIdentity[]) {
  assertCanSendFrom(me, identityKeyForAddress(address, identities) ?? bareAddress(address))
}

/** Cheile de identitate pe care omul le are voie să le vadă în selectorul „De pe". */
export function selectableIdentities(me: SessionUser, identities: EmailIdentity[]): EmailIdentity[] {
  if (me.mailboxes === null) return identities
  return identities.filter((identity) => me.mailboxes?.includes(identity.key))
}

/** Cheia identității care primește pe adresa dată (din header, cu sau fără „Nume <...>"). */
export function identityKeyForAddress(address: string, identities: EmailIdentity[]): string | null {
  const target = bareAddress(address)
  return identities.find((i) => bareAddress(i.fromAddress) === target)?.key ?? null
}

/**
 * Oamenii care trebuie anunțați când intră un email pe cutia `identityKey`: cei care au cutia
 * atribuită (adminul le are pe toate) și care nu și-au oprit notificările de email nou.
 * `notification_prefs` null = default-urile (emailNew true).
 */
export async function userIdsForIdentity(identityKey: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id, prefs: users.notificationPrefs })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(
      userMailboxes,
      and(
        eq(userMailboxes.userId, users.id),
        eq(userMailboxes.identityKey, identityKey),
        isNull(userMailboxes.deletedAt),
      ),
    )
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.status, 'active'),
        or(eq(roles.kind, 'admin'), isNotNull(userMailboxes.id)),
      ),
    )
  return rows.filter((r) => r.prefs?.emailNew !== false).map((r) => r.id)
}

// ── Citit / necitit per om ───────────────────────────────────────────────────────────────────

/** Fire necitite ale omului: mesaje primite după ultima lui citire. */
export function unreadThreadFilter(me: SessionUser): SQL {
  return sql`EXISTS (
    SELECT 1 FROM email_messages m
    WHERE m.thread_id = ${emailThreads.id} AND m.direction = 'in' AND m.deleted_at IS NULL
      AND m.received_at > COALESCE(
        (SELECT r.last_read_at FROM email_thread_reads r
          WHERE r.thread_id = ${emailThreads.id} AND r.user_id = ${me.id} AND r.deleted_at IS NULL),
        '-infinity'::timestamptz)
  )`
}

/** Marcă firul citit pentru omul curent — și numai pentru el. */
export async function markThreadRead(me: SessionUser, threadId: string, at: Date = new Date()) {
  await db
    .insert(emailThreadReads)
    .values({ userId: me.id, threadId, lastReadAt: at })
    .onConflictDoUpdate({
      target: [emailThreadReads.userId, emailThreadReads.threadId],
      set: { lastReadAt: at, updatedAt: new Date() },
    })
}

export async function getThreadReadState(me: SessionUser, threadId: string) {
  const [row] = await db
    .select({ lastReadAt: emailThreadReads.lastReadAt })
    .from(emailThreadReads)
    .where(
      and(
        eq(emailThreadReads.userId, me.id),
        eq(emailThreadReads.threadId, threadId),
        isNull(emailThreadReads.deletedAt),
      ),
    )
  return row?.lastReadAt ?? null
}
