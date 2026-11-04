import { and, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailUserSettings } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { selectableIdentities } from './mailboxes.js'
import type { MySettingsUpdateSchema } from './me-schema.js'
import { getEmailSettings, getIdentities } from './settings-service.js'

export class CapAboveCompany extends Error {
  readonly code = 'CAP_ABOVE_COMPANY'
  constructor(readonly limit: number) {
    super(`cap_above_company: ${limit}`)
  }
}

export class MailboxNotMine extends Error {
  readonly code = 'MAILBOX_NOT_MINE'
  constructor(readonly identityKey: string) {
    super(`mailbox_not_mine: ${identityKey}`)
  }
}

// Rendering sanitizes on the client (DOMPurify); this only keeps a signature from carrying
// active content into the emails it is appended to.
export function stripActiveHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2')
}

export interface MySettings {
  mailboxes: Array<{ key: string; label: string; fromAddress: string; companySignature: string }>
  signatures: Record<string, string>
  outreachDailyCap: number | null
  companyOutreachCap: number
}

async function ownRow(userId: string) {
  const [row] = await db
    .select()
    .from(emailUserSettings)
    .where(and(eq(emailUserSettings.userId, userId), isNull(emailUserSettings.deletedAt)))
  return row ?? null
}

export async function getMySettings(me: SessionUser): Promise<MySettings> {
  const [identities, settings, row] = await Promise.all([getIdentities(), getEmailSettings(), ownRow(me.id)])
  const mine = selectableIdentities(me, identities)
  const keys = new Set(mine.map((i) => i.key))
  const stored = row?.signatureByMailbox ?? {}
  return {
    mailboxes: mine.map((i) => ({
      key: i.key,
      label: i.label,
      fromAddress: i.fromAddress,
      companySignature: settings.signatures[i.key] ?? settings.signatures['contact'] ?? '',
    })),
    // A mailbox taken away keeps its row but is not shown or used for this person any more.
    signatures: Object.fromEntries(Object.entries(stored).filter(([key]) => keys.has(key))),
    outreachDailyCap: row?.outreachDailyCap ?? null,
    companyOutreachCap: settings.outreachDailyCap,
  }
}

export async function updateMySettings(me: SessionUser, input: z.infer<typeof MySettingsUpdateSchema>): Promise<MySettings> {
  const [identities, settings, row] = await Promise.all([getIdentities(), getEmailSettings(), ownRow(me.id)])
  const keys = new Set(selectableIdentities(me, identities).map((i) => i.key))

  const signatures = { ...(row?.signatureByMailbox ?? {}) }
  for (const [key, html] of Object.entries(input.signatures ?? {})) {
    if (!keys.has(key)) throw new MailboxNotMine(key)
    if (html.trim()) signatures[key] = stripActiveHtml(html)
    else delete signatures[key]
  }
  if (input.outreachDailyCap != null && input.outreachDailyCap > settings.outreachDailyCap) {
    throw new CapAboveCompany(settings.outreachDailyCap)
  }

  const values = {
    signatureByMailbox: signatures,
    outreachDailyCap: input.outreachDailyCap !== undefined ? input.outreachDailyCap : (row?.outreachDailyCap ?? null),
    updatedAt: new Date(),
  }
  await db
    .insert(emailUserSettings)
    .values({ userId: me.id, ...values })
    .onConflictDoUpdate({ target: [emailUserSettings.tenantId, emailUserSettings.userId], set: values })
  return getMySettings(me)
}
