import { eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { dashboardConfig } from '../db/schema/index.js'
import { tr } from './i18n.js'

// The mailboxes (identities) the company sends from. Here, not in modules/email, because other
// modules need the address behind a mailbox key too (the ORGANIZER of a meeting invitation).

// `key` stays the stable reference used by Compose, bulk and sequences.
export interface EmailIdentity {
  key: string
  label: string
  fromAddress: string
}

const IDENTITIES_KEY = 'email.identities'

export function defaultIdentities(): EmailIdentity[] {
  return [
    { key: 'stefan', label: 'Stefan', fromAddress: config.emailFromStefan },
    { key: 'contact', label: 'Contact', fromAddress: config.emailFromContact },
    { key: 'noreply', label: 'No-reply', fromAddress: config.emailFromNoreply },
    // outreach may be empty in env: the row stays visible in the UI so it can be filled in there,
    // and sending falls back to contact.
    { key: 'outreach', label: 'Outreach', fromAddress: config.emailFromOutreach },
  ]
}

export async function getIdentities(): Promise<EmailIdentity[]> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, IDENTITIES_KEY))
  return (row?.value as EmailIdentity[] | undefined) ?? defaultIdentities()
}

export async function resolveFromAddress(from: string): Promise<string> {
  const identities = await getIdentities()
  const identity = identities.find((i) => i.key === from)
  if (!identity) throw new Error(tr('errors.email.unknownIdentity', { from }))
  if (!identity.fromAddress) {
    return identities.find((i) => i.key === 'contact' && i.fromAddress)?.fromAddress ?? config.emailFromContact
  }
  return identity.fromAddress
}

/** "Acme <office@acme.example>" → "office@acme.example"; a bare address stays as it is. */
export function bareAddress(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() || from.trim()
}
