import { and, eq, isNull, sql, type Column, type SQL } from 'drizzle-orm'
import { db } from '../db/client.js'
import { emailAttachments, emailMessages } from '../db/schema/index.js'
import { getIdentities } from './email-identities.js'
import type { SessionUser } from './session.js'

// Shared email-visibility helpers used by both the email and accounting modules.

export function bareAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value)
  return (match?.[1] ?? value).trim().toLowerCase()
}

export const extractBareEmailAddress = bareAddress

const addressOf = (column: SQL | Column) =>
  sql`lower(regexp_replace(${column}, '^.*<\\s*|\\s*>.*$', '', 'g'))`

const addressList = (addresses: string[]) =>
  sql`ARRAY[${sql.join(addresses.map((a) => sql`${a}`), sql`, `)}]::text[]`

export async function mailboxAddresses(me: SessionUser): Promise<string[] | null> {
  if (me.mailboxes === null) return null
  if (me.mailboxes.length === 0) return []
  const identities = await getIdentities()
  return me.mailboxes
    .map((key) => identities.find((i) => i.key === key)?.fromAddress)
    .filter((a): a is string => Boolean(a))
    .map(bareAddress)
}

export function messageVisibleTo(addresses: string[] | null): SQL | undefined {
  if (addresses === null) return undefined
  if (addresses.length === 0) return sql`false`
  const list = addressList(addresses)
  return sql`(
    (${emailMessages.direction} = 'in' AND ${addressOf(emailMessages.toAddress)} = ANY(${list}))
    OR (${emailMessages.direction} = 'out' AND ${addressOf(emailMessages.fromAddress)} = ANY(${list}))
  )`
}

/**
 * Thrown when an email message or attachment does not exist or belongs to a mailbox the caller
 * does not hold. Mapped to HTTP 404 (never 403) so unauthorized mailbox content is indistinguishable
 * from a missing ID.
 */
export class SupplierEmailNotFoundError extends Error {
  readonly statusCode = 404
  readonly userFacing = true
  readonly code = 'EMAIL_ATTACHMENT_NOT_FOUND'
  constructor(message = 'Email attachment not found') {
    super(message)
    this.name = 'SupplierEmailNotFoundError'
  }
}

export interface VisibleEmailAttachment {
  message: {
    id: string
    fromAddress: string
    toAddress: string
    subject: string
    receivedAt: Date
  }
  attachment: {
    id: string
    messageId: string
    filename: string
    storagePath: string
    contentType: string | null
  }
}

/**
 * Loads an email message and one of its attachments after verifying the acting user has mailbox
 * access to the message. Throws `SupplierEmailNotFoundError` (404) if missing or invisible.
 */
export async function loadVisibleEmailAttachment(
  me: SessionUser,
  messageId: string,
  attachmentId: string,
): Promise<VisibleEmailAttachment> {
  const addresses = await mailboxAddresses(me)
  const visible = messageVisibleTo(addresses)

  const [msg] = await db
    .select({
      id: emailMessages.id,
      fromAddress: emailMessages.fromAddress,
      toAddress: emailMessages.toAddress,
      subject: emailMessages.subject,
      receivedAt: emailMessages.receivedAt,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.id, messageId), isNull(emailMessages.deletedAt), visible))
    .limit(1)

  if (!msg) {
    throw new SupplierEmailNotFoundError('Email message not found')
  }

  const [att] = await db
    .select({
      id: emailAttachments.id,
      messageId: emailAttachments.messageId,
      filename: emailAttachments.filename,
      storagePath: emailAttachments.storagePath,
      contentType: emailAttachments.contentType,
    })
    .from(emailAttachments)
    .where(
      and(
        eq(emailAttachments.id, attachmentId),
        eq(emailAttachments.messageId, messageId),
        isNull(emailAttachments.deletedAt),
      ),
    )
    .limit(1)

  if (!att) {
    throw new SupplierEmailNotFoundError('Email attachment not found')
  }

  return {
    message: {
      id: msg.id,
      fromAddress: msg.fromAddress,
      toAddress: msg.toAddress,
      subject: msg.subject,
      receivedAt: msg.receivedAt ?? msg.createdAt,
    },
    attachment: att,
  }
}
