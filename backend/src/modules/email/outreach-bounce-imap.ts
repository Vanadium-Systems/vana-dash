import { and, desc, eq, isNull } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { db } from '../../shared/db/client.js'
import { emailSends, outreachMailboxes } from '../../shared/db/schema/index.js'
import { decryptField } from '../../shared/lib/crypto.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import { pauseSequenceIfBouncing } from './sequences-service.js'
import { suppressEmail } from './unsubscribe-service.js'

export interface ParsedDsnBounce {
  bouncedAddress: string
  statusCode?: string
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

/**
 * Pure RFC 3464 DSN parser. Returns the bounced recipient only for permanent failures
 * (`Action: failed` or `Status: 5.x.x`), never for temporary delays (`Action: delayed` / 4.x.x).
 * Does not persist or return the message body.
 */
export function parseDsnBounce(rawMessage: string): ParsedDsnBounce | null {
  const lower = rawMessage.toLowerCase()
  const looksLikeDsn =
    lower.includes('delivery-status') ||
    lower.includes('multipart/report') ||
    ((lower.includes('mailer-daemon') || lower.includes('postmaster@')) &&
      (lower.includes('final-recipient:') || lower.includes('x-failed-recipients:')))

  if (!looksLikeDsn) return null

  const actionMatch = /^action:\s*([a-z]+)/im.exec(rawMessage)
  const action = actionMatch?.[1]?.toLowerCase()
  if (action && action !== 'failed') return null

  const statusMatch = /^status:\s*([245]\.\d+\.\d+)/im.exec(rawMessage)
  const statusCode = statusMatch?.[1]
  if (statusCode && !statusCode.startsWith('5.')) return null
  if (!action && !statusCode) return null

  const recipientMatch =
    /^(?:final-recipient|original-recipient):\s*(?:rfc822\s*;\s*)?([^\r\n]+)/im.exec(rawMessage) ??
    /^x-failed-recipients:\s*([^\r\n]+)/im.exec(rawMessage)

  if (!recipientMatch?.[1]) return null
  const emailMatch = EMAIL_RE.exec(recipientMatch[1])
  if (!emailMatch) return null

  return {
    bouncedAddress: emailMatch[0].toLowerCase(),
    statusCode,
  }
}

export async function recordOutreachBounce(bouncedAddress: string, statusCode?: string): Promise<void> {
  await suppressEmail(bouncedAddress, 'bounce')

  const [latestSend] = await db
    .select({
      id: emailSends.id,
      sequenceEnrollmentId: emailSends.sequenceEnrollmentId,
    })
    .from(emailSends)
    .where(and(eq(emailSends.recipient, bouncedAddress), eq(emailSends.status, 'sent'), isNull(emailSends.deletedAt)))
    .orderBy(desc(emailSends.createdAt))
    .limit(1)

  if (latestSend) {
    await db
      .update(emailSends)
      .set({
        status: 'bounced',
        errorMessage: statusCode ? `IMAP_DSN_${statusCode}` : 'IMAP_DSN_BOUNCE',
        updatedAt: new Date(),
      })
      .where(eq(emailSends.id, latestSend.id))

    emitProspectEvent('email.bounced', { address: bouncedAddress, sendId: latestSend.id })
    if (latestSend.sequenceEnrollmentId) {
      await pauseSequenceIfBouncing(latestSend.sequenceEnrollmentId)
    }
  }
}

export async function checkOutreachMailboxBounces(
  mailbox: typeof outreachMailboxes.$inferSelect,
): Promise<number> {
  if (!mailbox.imapHost) return 0

  const pass = await decryptField(mailbox.secretEnc)
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort ?? 993,
    secure: mailbox.imapSecure,
    auth: { user: mailbox.address, pass },
    logger: false,
  })

  let bouncesFound = 0
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = mailbox.lastImapCheckAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const uids = await client.search({ seen: false, since }, { uid: true })
      if (uids && uids.length > 0) {
        // Cap per-run fetch so a flooded inbox cannot stall the worker.
        const slice = uids.slice(0, 100)
        for await (const msg of client.fetch(slice, { uid: true, source: true }, { uid: true })) {
          const raw = msg.source?.toString('utf8') ?? ''
          const parsed = parseDsnBounce(raw)
          if (parsed) {
            await recordOutreachBounce(parsed.bouncedAddress, parsed.statusCode)
            await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true })
            bouncesFound++
          }
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  await db
    .update(outreachMailboxes)
    .set({ lastImapCheckAt: new Date(), updatedAt: new Date() })
    .where(eq(outreachMailboxes.id, mailbox.id))

  return bouncesFound
}
