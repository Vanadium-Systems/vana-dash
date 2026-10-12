/**
 * modules/search/service.ts — căutarea din Ctrl K (PLAN.md C2, BE-9). pg real: interogările
 * sunt pe tabelele reale, cu filtrele reale (funcționalitate + cutii).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailThreads, financialRecords, prospects, userMailboxes, users } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { getIdentities } from '../email/settings-service.js'
import { search } from './service.js'

const CONTACT_KEY = 'contact'
const STEFAN_KEY = 'stefan'
const identities = await getIdentities()
const contactAddress = identities.find((i) => i.key === CONTACT_KEY)?.fromAddress ?? 'Vanadium Systems <contact@vanadium.systems>'
const stefanAddress = identities.find((i) => i.key === STEFAN_KEY)?.fromAddress ?? 'Stefan <stefan@vanadium.systems>'

const marker = `qa-search-${Math.random().toString(36).slice(2)}`
const threadIds: string[] = []
const prospectIds: string[] = []
const recordIds: string[] = []
const colleagueIds: string[] = []

const [admin] = await db.select().from(users).where(eq(users.isPlatformAdmin, true)).limit(1)
const adminSession = {
  id: admin!.id,
  email: admin!.email,
  displayName: admin!.displayName,
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' as const },
  isPlatformAdmin: true,
  features: ['cautare.view', 'facturi.view', 'clienti.view', 'email.view'],
  mailboxes: null,
  status: 'active' as const,
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  sessionVersion: 1,
} satisfies SessionUser

// Coleg cu doar contact@ și fără facturi: caută doar ce are, și numai pe cutia lui.
const [colleague] = await db
  .insert(users)
  .values({ email: `search-test-${Math.random().toString(36).slice(2)}@vanadium.systems`, passwordHash: 'x', displayName: 'Ana Popescu' })
  .returning()
colleagueIds.push(colleague!.id)
await db.insert(userMailboxes).values({ userId: colleague!.id, identityKey: CONTACT_KEY })
const colleagueSession = {
  ...adminSession,
  id: colleague!.id,
  email: colleague!.email,
  displayName: colleague!.displayName,
  role: { id: '00000000-0000-4000-8000-000000000003', name: 'Sales', kind: 'custom' as const },
  isPlatformAdmin: false,
  features: ['cautare.view', 'clienti.view', 'email.view'],
  mailboxes: [CONTACT_KEY],
} satisfies SessionUser

afterAll(async () => {
  if (threadIds.length) {
    await db.delete(emailMessages).where(inArray(emailMessages.threadId, threadIds))
    await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  }
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  if (colleagueIds.length) {
    await db.delete(userMailboxes).where(inArray(userMailboxes.userId, colleagueIds))
    await db.delete(users).where(inArray(users.id, colleagueIds))
  }
})

/** Câte un rând din fiecare grupă, cu același marcaj de căutare. */
async function seed() {
  const onContact = await db
    .insert(emailThreads)
    .values({ subject: `Factură ${marker} de la un client`, participants: [contactAddress, 'client@extern.ro'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(onContact[0]!.id)
  await db.insert(emailMessages).values({
    threadId: onContact[0]!.id,
    direction: 'in',
    fromAddress: 'client@extern.ro',
    toAddress: contactAddress,
    subject: onContact[0]!.subject,
    receivedAt: new Date(),
  })

  const onStefan = await db
    .insert(emailThreads)
    .values({ subject: `Doar pentru ${marker} pe stefan`, participants: [stefanAddress, 'altcineva@extern.ro'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(onStefan[0]!.id)
  await db.insert(emailMessages).values({
    threadId: onStefan[0]!.id,
    direction: 'in',
    fromAddress: 'altcineva@extern.ro',
    toAddress: stefanAddress,
    subject: onStefan[0]!.subject,
    receivedAt: new Date(),
  })

  const [prospect] = await db
    .insert(prospects)
    .values({ name: `Prospect ${marker} SRL`, cif: `RO${marker.slice(-8).toUpperCase()}` })
    .returning()
  prospectIds.push(prospect!.id)

  const [record] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      issuedAt: new Date(),
      documentNumber: `FV-${marker}`,
      counterpartyName: `Prospect ${marker} SRL`,
      amount: '100',
      currency: 'RON',
    })
    .returning()
  recordIds.push(record!.id)
}

// Un singur set de rânduri pentru toate testele — marcajul le face deosebite de restul bazei.
await seed()

describe('search', () => {
  it('grupa fără funcționalitate nu apare deloc, nici goală', async () => {
    const withoutInvoices = { ...colleagueSession, features: ['cautare.view', 'clienti.view', 'email.view'] }
    const groups = await search(withoutInvoices, marker)
    expect(groups.map((g) => g.group).sort()).toEqual(['Clienți', 'Email'])
  })

  it('emailul e filtrat pe cutiile omului: firul de pe stefan@ nu apare la un coleg doar pe contact@', async () => {
    const email = (await search(colleagueSession, marker)).find((g) => g.group === 'Email')!
    expect(email.items).toHaveLength(1)
    expect(email.items[0]!.label).toContain('de la un client')
  })

  it('adminul le vede pe toate trei', async () => {
    const groups = await search(adminSession, marker)
    expect(groups.map((g) => g.group).sort()).toEqual(['Clienți', 'Email', 'Facturi'])
    expect(groups.find((g) => g.group === 'Email')!.items).toHaveLength(2)
    expect(groups.find((g) => g.group === 'Facturi')!.items[0]!.label).toBe(`FV-${marker}`)
  })

  it('mai puțin de două caractere → nimic, fără să bată tabelele', async () => {
    expect(await search(adminSession, 'a')).toEqual([])
    expect(await search(adminSession, '   ')).toEqual([])
  })

  it('limitul se plafonează la 10', async () => {
    for (const group of await search(adminSession, marker, { limit: 99 })) {
      expect(group.items.length).toBeLessThanOrEqual(10)
    }
  })
})
