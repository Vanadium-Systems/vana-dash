import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailThreads } from '../../shared/db/schema/index.js'
import { excerpt, registerRefType } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { htmlToPlainText } from './html-to-text.js'
import { mailboxAddresses, threadVisibleTo } from './mailboxes.js'

async function visibleThreadIds(me: SessionUser, ids: string[]): Promise<Set<string>> {
  if (!me.features.includes('email.view')) return new Set()
  const rows = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(and(inArray(emailThreads.id, ids), isNull(emailThreads.deletedAt), threadVisibleTo(await mailboxAddresses(me))))
  return new Set(rows.map((r) => r.id))
}

registerRefType('email_thread', {
  kind: 'personal',
  async snapshot(refId, sender, { quote }) {
    if (!(await visibleThreadIds(sender, [refId])).has(refId)) return null
    const [thread] = await db.select({ subject: emailThreads.subject }).from(emailThreads).where(eq(emailThreads.id, refId))
    // The newest incoming message stands for the thread, as in the inbox list.
    const latest = await db
      .select({
        direction: emailMessages.direction,
        fromAddress: emailMessages.fromAddress,
        bodyText: emailMessages.bodyText,
        bodyHtml: emailMessages.bodyHtml,
      })
      .from(emailMessages)
      .where(and(eq(emailMessages.threadId, refId), isNull(emailMessages.deletedAt)))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(20)
    const message = latest.find((m) => m.direction === 'in') ?? latest[0]
    const text = message?.bodyText || (message?.bodyHtml ? htmlToPlainText(message.bodyHtml) : '')
    return {
      card: {
        title: thread?.subject ?? '',
        from: message?.fromAddress ?? null,
        excerpt: excerpt(text, 300),
        ...(quote ? { quote } : {}),
      },
    }
  },
  async resolve(refIds, reader) {
    const visible = await visibleThreadIds(reader, refIds)
    return new Map(refIds.map((id) => [id, { canOpen: visible.has(id) }]))
  },
})
