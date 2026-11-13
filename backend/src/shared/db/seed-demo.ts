import '../load-env.js'
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { config } from '../config.js'
import { encryptApiKey } from '../lib/crypto.js'
import { ensureSpaceRootOf } from '../../modules/archive/access.js'
import { defaultIdentities } from '../../modules/email/settings-service.js'
import { ENABLED_LOCALES, isLocale, type Locale } from '../lib/locale.js'
import { getCompanyTimeZone } from '../lib/company.js'
import { zonedTimeToUtc } from '../lib/schedule-recurrence.js'
import { tiptapToText, type TiptapNode } from '../lib/tiptap-text.js'
import { db, sql } from './client.js'
import {
  alertRules,
  alerts,
  archiveFiles,
  archiveFolderShares,
  archiveFolders,
  archiveStars,
  archiveTrashBatches,
  billingClients,
  bookings,
  calendarEventAttendees,
  calendarEventExceptions,
  calendarEventReminders,
  calendarEvents,
  calendarShares,
  calls,
  conversationMembers,
  conversations,
  dashboardConfig,
  emailDrafts,
  emailSequenceEnrollments,
  emailSequenceSteps,
  emailSequences,
  emailTemplates,
  emailMessages,
  emailThreads,
  emailUserSettings,
  exchangeRates,
  financialRecords,
  invoiceLineItems,
  invoicePayments,
  messageReactions,
  messageRefs,
  messages,
  noteVersions,
  notes,
  notifications,
  platformMetrics,
  platforms,
  prospectAutomationRules,
  prospectCollaborators,
  prospectContactPoints,
  prospectListFolders,
  prospectListMembers,
  prospectLists,
  prospectNotes,
  prospectPeople,
  prospectSignalHits,
  prospectSignals,
  prospectStageEvents,
  prospectStatuses,
  prospectTasks,
  prospectTransferRequests,
  prospectViewStars,
  prospectViews,
  prospects,
  roles,
  supportTicketReplies,
  supportTickets,
  userMailboxes,
  users,
} from './schema/index.js'

// Demo data for a first local run: enough rows that no screen is empty. Everything here is
// invented (Acme, example.com) and nothing calls out to ANAF, the bank or an email provider.
//
// Run after `db:seed`, on an otherwise empty database. It refuses to run in production and
// refuses to run twice, so it can never mix invented rows into real ones.
//
//   db:seed:demo [ro|en]     the language of the invented texts and of the demo people;
//                            without it, DEFAULT_LOCALE. Rows and figures are the same in both.

if (process.env.NODE_ENV === 'production') throw new Error('db:seed:demo never runs with NODE_ENV=production')

const requested = process.argv[2]
if (requested !== undefined && !isLocale(requested)) throw new Error(`Unknown language "${requested}": use ro or en`)
const locale: Locale = requested ?? config.defaultLocale
if (!ENABLED_LOCALES.includes(locale)) throw new Error(`The language "${locale}" is not enabled in this build`)
/** One invented text, in the language of the seed. */
const L = (text: Record<Locale, string>) => text[locale]

const [existingClient] = await db.select({ id: billingClients.id }).from(billingClients).limit(1)
if (existingClient) {
  console.log('This database already has clients; demo data was not added.')
  await sql.end()
  process.exit(0)
}

const [admin] = await db.select().from(users).where(eq(users.isPlatformAdmin, true))
if (!admin) throw new Error('Run `db:seed` first: the demo data needs the admin user')
await db.update(users).set({ locale }).where(eq(users.id, admin.id))

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(now - n * DAY)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}
// Deterministic "noise", so two fresh installs show the same charts.
const wobble = (i: number, amplitude: number) => Math.round(Math.sin(i * 1.7) * amplitude + Math.cos(i * 0.6) * amplitude * 0.5)

// A demo install has no business polling Romanian public sources (SICAP, BNR) or a bank.
// The same switches are in Settings; a real deployment leaves them on.
await db
  .insert(dashboardConfig)
  .values({ key: 'ops_jobs.enabled', value: { bankSync: false, tenderWatch: false, bnrFeed: false } })
  .onConflictDoNothing({ target: [dashboardConfig.tenantId, dashboardConfig.key] })

// Read by /api/auth/me as `isDemo`; the interface shows the demo banner.
await db
  .insert(dashboardConfig)
  .values({ key: 'company.demo', value: true })
  .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: true } })

// ── People ───────────────────────────────────────────────────────────────────

const demoPasswordHash = await argon2.hash(crypto.randomUUID())
const [salesRole] = await db
  .insert(roles)
  .values({
    name: 'Sales (demo)',
    kind: 'custom',
    features: ['clienti.view', 'clienti.prospectare', 'clienti.calculator', 'email.view', 'email.trimitere', 'email.setari_proprii', 'calendar.view', 'calendar.editare', 'mesaje.view', 'arhiva.view', 'arhiva.editare', 'notite.view'],
    createdByUserId: admin.id,
  })
  .returning()
const [managerRole] = await db.select().from(roles).where(eq(roles.name, 'Manager'))

// The colleagues cannot log in (random password); they exist so Team, Messages and shared
// calendars have someone in them. Invite a real person from the Team page instead.
const [ana, mihai] = await db
  .insert(users)
  .values([
    { email: 'ana@example.com', passwordHash: demoPasswordHash, displayName: 'Ana Popescu', roleId: salesRole!.id, lastSeenAt: daysAgo(0, 8), locale },
    { email: 'mihai@example.com', passwordHash: demoPasswordHash, displayName: 'Mihai Ionescu', roleId: managerRole?.id ?? null, lastSeenAt: daysAgo(2), locale },
  ])
  .returning()

// ── A connected platform with 90 days of metrics ─────────────────────────────

const [platform] = await db
  .insert(platforms)
  .values({
    name: 'Acme Platform (demo)',
    type: 'generic',
    apiUrl: 'http://demo.invalid',
    apiKeyEnc: encryptApiKey('demo'),
    // 30 February never comes: the row is display-only and must not be synced.
    syncCron: '0 0 30 2 *',
    healthStatus: 'healthy',
    lastSyncAt: daysAgo(0, 6),
  })
  .returning()

const metricRows = Array.from({ length: 90 }, (_, i) => {
  const day = 89 - i
  const recordedAt = daysAgo(day, 0)
  const growth = i / 89
  return [
    { metricKey: 'revenue', value: String(900 + Math.round(growth * 700) + wobble(i, 120)), unit: 'RON' },
    { metricKey: 'mrr', value: String(18000 + Math.round(growth * 9000) + wobble(i, 300)), unit: 'RON' },
    { metricKey: 'active_clients', value: String(14 + Math.round(growth * 9)), unit: 'count' },
    { metricKey: 'user_count', value: String(52 + Math.round(growth * 31) + wobble(i, 2)), unit: 'count' },
    { metricKey: 'collection_count', value: String(140 + Math.round(growth * 80) + wobble(i, 25)), unit: 'count' },
  ].map((m) => ({ ...m, platformId: platform!.id, recordedAt }))
}).flat()
await db.insert(platformMetrics).values(metricRows)

// Invented EUR and USD rates for the same 90 days. The BNR job is off above, and without a
// rate no total could be shown in anything but lei.
const rateRows = Array.from({ length: 91 }, (_, i) => {
  const date = daysAgo(90 - i, 0).toISOString().slice(0, 10)
  return [
    { date, currency: 'EUR', rate: (4.97 + i * 0.0012 + wobble(i, 4) / 1000).toFixed(4) },
    { date, currency: 'USD', rate: (4.58 + i * 0.0009 + wobble(i + 11, 6) / 1000).toFixed(4) },
  ]
}).flat()
await db.insert(exchangeRates).values(rateRows).onConflictDoNothing({ target: [exchangeRates.date, exchangeRates.currency] })

// ── Clients and invoices ─────────────────────────────────────────────────────

const clientSeeds = [
  { name: 'Acme Recycling SRL', cif: 'RO10000001', city: 'București', price: '450', contact: 'Ioana Marin' },
  { name: 'Borealis Metal SRL', cif: 'RO10000002', city: 'Cluj-Napoca', price: '320', contact: 'Radu Stan' },
  { name: 'Cobalt Logistics SRL', cif: 'RO10000003', city: 'Brașov', price: '600', contact: 'Elena Dumitru' },
  { name: 'Delta Print SRL', cif: 'RO10000004', city: 'Timișoara', price: '250', contact: 'Vlad Enache' },
  { name: 'Ember Foods SRL', cif: 'RO10000005', city: 'Iași', price: '380', contact: 'Maria Toma' },
  { name: 'Fjord Studio SRL', cif: 'RO10000006', city: 'Constanța', price: '290', contact: 'Dan Preda' },
]
const clients = await db
  .insert(billingClients)
  .values(
    clientSeeds.map((c, i) => ({
      name: c.name,
      cif: c.cif,
      address: L({ ro: `Str. Exemplu nr. ${i + 1}`, en: `${i + 1} Example St.` }),
      city: c.city,
      email: `office@client${i + 1}.example.com`,
      contactName: c.contact,
      contactTitle: L({ ro: 'Administrator', en: 'Director' }),
      phone: `021000000${i + 1}`,
      contractPlan: 'Standard',
      subscriptionPriceEur: c.price,
      subscriptionPriceCurrency: 'eur' as const,
      billingCycle: 'monthly' as const,
      contractDetails: { nrContract: String(i + 1).padStart(3, '0'), dataContract: '01.03.2026', taxaInitiere: '200 EUR', facturareTip: 'LUNAR' },
      createdByUserId: admin.id,
    })),
  )
  .returning()

// Three months of issued invoices; the latest month is still partly unpaid, one is overdue.
// `anafStatus` stays empty: nothing here was ever sent to ANAF.
let invoiceNumber = 0
const issued = [2, 1, 0].flatMap((monthsBack) =>
  clients.map((client, i) => {
    invoiceNumber += 1
    const issuedAt = daysAgo(monthsBack * 30 + 5)
    const paid = monthsBack > 0 || i % 3 !== 0
    return {
      type: 'invoice' as const,
      direction: 'out' as const,
      amount: (Number(clientSeeds[i]!.price) * 5).toFixed(2),
      currency: 'RON',
      description: L({ ro: `Abonament lunar ${client.name}`, en: `Monthly subscription ${client.name}` }),
      issuedAt,
      dueAt: new Date(issuedAt.getTime() + 10 * DAY),
      paidAt: paid ? new Date(issuedAt.getTime() + (3 + i) * DAY) : null,
      paymentStatus: paid ? ('paid' as const) : ('unpaid' as const),
      documentNumber: `DEMO-${String(invoiceNumber).padStart(4, '0')}`,
      billingClientId: client.id,
      counterpartyName: client.name,
      counterpartyCif: client.cif,
      source: 'demo',
      createdByUserId: admin.id,
    }
  }),
)
const INFRASTRUCTURE = L({ ro: 'Infrastructură', en: 'Infrastructure' })
const ACCOUNTING = L({ ro: 'Contabilitate', en: 'Accounting' })
const ACCOUNTANT = L({ ro: 'Contabilitate Exemplu SRL', en: 'Example Accounting SRL' })
const received = [
  { name: 'Hosting Provider GmbH', amount: '180.00', category: INFRASTRUCTURE, day: 62 },
  { name: 'Hosting Provider GmbH', amount: '180.00', category: INFRASTRUCTURE, day: 32 },
  { name: 'Hosting Provider GmbH', amount: '195.00', category: INFRASTRUCTURE, day: 2 },
  { name: ACCOUNTANT, amount: '600.00', category: ACCOUNTING, day: 40 },
  { name: ACCOUNTANT, amount: '600.00', category: ACCOUNTING, day: 10 },
  { name: 'Office Supplies SRL', amount: '312.40', category: L({ ro: 'Birou', en: 'Office' }), day: 21 },
].map((e) => ({
  type: 'expense' as const,
  direction: 'in' as const,
  amount: e.amount,
  currency: 'RON',
  description: e.category,
  category: e.category,
  issuedAt: daysAgo(e.day),
  paidAt: daysAgo(e.day - 1),
  paymentStatus: 'paid' as const,
  counterpartyName: e.name,
  source: 'demo',
  createdByUserId: admin.id,
}))
const invoiceRows = await db.insert(financialRecords).values([...issued, ...received]).returning()

// One invoice or document in each remaining state, so the invoice screens have something to show
// in every filter. Inserted after the rows above: `invoiceRows.find` at the shared-invoice step
// must still land on one of the plain unpaid ones.
const stateRow = (
  i: number,
  daysBack: number,
  amount: string,
  over: Partial<Omit<typeof issued[number], 'documentNumber' | 'paymentStatus'>> & {
    documentNumber: string | null
    paymentStatus?: 'unpaid' | 'partial' | 'paid'
    anafStatus?: 'validated' | 'rejected'
  },
) => ({
  ...issued[0]!,
  amount,
  description: L({ ro: `Servicii de implementare ${clients[i]!.name}`, en: `Implementation services ${clients[i]!.name}` }),
  issuedAt: daysAgo(daysBack),
  dueAt: daysAgo(daysBack - 14),
  paidAt: null as Date | null,
  paymentStatus: 'unpaid' as 'unpaid' | 'partial' | 'paid',
  billingClientId: clients[i]!.id,
  counterpartyName: clients[i]!.name,
  counterpartyCif: clients[i]!.cif,
  ...over,
})
// Continues the series above, so the numbers never collide with the monthly invoices.
const nextNumber = () => `DEMO-${String(++invoiceNumber).padStart(4, '0')}`
const partialNumber = nextNumber()
const splitNumber = nextNumber()
const stateRows = await db
  .insert(financialRecords)
  .values([
    stateRow(0, 3, '1500.00', { documentNumber: null }),
    stateRow(1, 20, '2000.00', { documentNumber: partialNumber, paymentStatus: 'partial' }),
    stateRow(2, 25, '900.00', { documentNumber: splitNumber, paymentStatus: 'paid', paidAt: daysAgo(12) }),
    stateRow(0, 8, '1100.00', { documentNumber: nextNumber(), anafStatus: 'rejected' }),
    stateRow(1, 15, '750.00', { documentNumber: nextNumber(), anafStatus: 'validated' }),
    {
      ...stateRow(2, 4, '600.00', { documentNumber: 'PRO-0001' }),
      type: 'proforma' as const,
      proformaStatus: 'open' as const,
    },
    {
      // Unpaid supplier invoice past its due date: the "to pay" list.
      ...received[0]!,
      amount: '240.00',
      issuedAt: daysAgo(35),
      dueAt: daysAgo(5),
      paidAt: null,
      paymentStatus: 'unpaid' as const,
      counterpartyName: 'Hosting Provider GmbH',
    },
  ])
  .returning()
const byNumber = (n: string) => stateRows.find((r) => r.documentNumber === n)!
const partialInvoice = byNumber(partialNumber)
const splitInvoice = byNumber(splitNumber)

// A storno reverses part of an already paid invoice; its lines carry the negative quantity.
const stornoSource = invoiceRows.find((r) => r.documentNumber === 'DEMO-0001')!
const [storno] = await db
  .insert(financialRecords)
  .values({
    ...stateRow(0, 2, '-300.00', { documentNumber: nextNumber() }),
    description: L({ ro: 'Storno parțial abonament', en: 'Partial credit note for the subscription' }),
    billingClientId: stornoSource.billingClientId,
    counterpartyName: stornoSource.counterpartyName,
    counterpartyCif: stornoSource.counterpartyCif,
    correctsRecordId: stornoSource.id,
  })
  .returning()

const lineOf = (record: { id: string; description: string | null }, quantity: number, unitPrice: number) => ({
  invoiceId: record.id,
  position: 0,
  description: record.description ?? '',
  quantity: String(quantity),
  unitPrice: unitPrice.toFixed(2),
})
await db.insert(invoiceLineItems).values([
  ...stateRows.filter((r) => r.direction === 'out').map((r) => lineOf(r, 1, Number(r.amount))),
  lineOf(storno!, -1, 300),
])

// Payments written directly instead of through addPayment: that one needs a request context
// (acting user, audit trail), and the seed sets the derived status on the records itself.
const paidOn = (date: Date | null) => date!.toISOString().slice(0, 10)
await db.insert(invoicePayments).values([
  ...invoiceRows
    .filter((r) => r.direction === 'out' && r.paymentStatus === 'paid')
    .map((r) => ({ recordId: r.id, amount: r.amount, currency: r.currency, paidAt: paidOn(r.paidAt), method: 'bank' as const, createdByUserId: admin.id })),
  { recordId: partialInvoice.id, amount: '800.00', currency: 'RON', paidAt: paidOn(daysAgo(10)), method: 'bank' as const, reference: 'DEMO-TX-1', createdByUserId: admin.id },
  { recordId: splitInvoice.id, amount: '400.00', currency: 'RON', paidAt: paidOn(daysAgo(18)), method: 'cash' as const, createdByUserId: admin.id },
  { recordId: splitInvoice.id, amount: '500.00', currency: 'RON', paidAt: paidOn(splitInvoice.paidAt), method: 'bank' as const, reference: 'DEMO-TX-2', createdByUserId: admin.id },
])

// ── Prospects ────────────────────────────────────────────────────────────────

// The status labels are rows created by the migrations, in Romanian. An English demo gets
// English labels; the keys, which the rest of the app goes by, stay as they are.
if (locale === 'en') {
  const labels: Record<string, string> = {
    necontactat: 'Not contacted',
    nu_a_raspuns: 'No answer',
    respins: 'Rejected',
    de_revenit: 'Call back',
    aprobat: 'Approved',
    caz_particular: 'Special case',
    nu_e_de_interes: 'Not interested',
  }
  for (const [key, label] of Object.entries(labels)) {
    await db.update(prospectStatuses).set({ label }).where(eq(prospectStatuses.key, key))
  }
}

const statusKeys = ['necontactat', 'necontactat', 'nu_a_raspuns', 'de_revenit', 'email', 'aprobat', 'respins']
// Stages passed on the way to the current one, so the funnel has steps to count.
const stagesBefore: Record<string, string[]> = {
  necontactat: [],
  nu_a_raspuns: [],
  de_revenit: ['nu_a_raspuns'],
  email: ['nu_a_raspuns'],
  aprobat: ['nu_a_raspuns', 'email'],
  respins: ['nu_a_raspuns'],
}
// Stage changes spread over the last ~60 days, oldest first; the last one dates `statusChangedAt`.
const stageEventsOf = (i: number) => {
  const path = [...(stagesBefore[statusKeys[i % statusKeys.length]!] ?? []), statusKeys[i % statusKeys.length]!]
  const first = 58 - ((i * 7) % 30)
  const last = (i * 3) % 10 + 1
  const steps = [{ from: null as string | null, to: 'necontactat', at: daysAgo(first + 2) }]
  let from = 'necontactat'
  path.forEach((to, k) => {
    if (to === from) return
    steps.push({ from, to, at: daysAgo(Math.round(first - ((first - last) * (k + 1)) / path.length)) })
    from = to
  })
  return steps
}
const anaOwned = [1, 3, 5, 8]
const mihaiOwned = 11
const freeProspect = 14
const closeDate = (days: number) => new Date(now + days * DAY).toISOString().slice(0, 10)
const prospectRows = await db.insert(prospects).values(
  Array.from({ length: 15 }, (_, i) => {
    const status = statusKeys[i % statusKeys.length]!
    const ownerId = i === freeProspect ? null : i === mihaiOwned ? mihai!.id : anaOwned.includes(i) ? ana!.id : admin.id
    const revenue = 400000 + i * 310000
    return {
      name: `Prospect ${String(i + 1).padStart(2, '0')} SRL`,
      cif: `RO2000${String(i + 1).padStart(4, '0')}`,
      phone: `031000${String(1000 + i)}`,
      email: `office@prospect${i + 1}.example.com`,
      website: `https://prospect${i + 1}.example.com`,
      contactName: ['Andrei Pop', 'Laura Ene', 'Cristi Radu', 'Diana Luca', 'George Sima'][i % 5],
      foundingYear: 2008 + (i % 12),
      employeeCount: 4 + ((i * 7) % 40),
      revenue: String(revenue),
      // Every 4th company grew more than 20%, which is what the "revenue growth" signal looks for.
      revenuePrev: i % 4 === 0 ? String(Math.round(revenue * 0.7)) : String(Math.round(revenue * 0.95)),
      revenueYear: 2025,
      profit: String(30000 + i * 21000),
      score: (45 + ((i * 13) % 50)).toFixed(1),
      status,
      source: 'demo',
      assignedUserId: ownerId,
      claimedAt: ownerId ? daysAgo(3 + (i % 20)) : null,
      lastActivityAt: i % 3 === 2 ? null : daysAgo(1 + ((i * 2) % 12)),
      isActive: i === 13 ? false : null,
      lostReason: status === 'respins' ? L({ ro: 'Au deja un partener de reciclare', en: 'They already have a recycling partner' }) : null,
      valueAmount: status === 'respins' ? null : String(4000 + i * 1500),
      valueCurrency: status === 'respins' ? null : i % 3 === 0 ? 'EUR' : 'RON',
      expectedCloseAt: status === 'respins' || status === 'aprobat' ? null : closeDate(7 + i * 6),
      statusChangedAt: stageEventsOf(i).at(-1)!.at,
      createdByUserId: admin.id,
    }
  }),
).returning()
const prospectAt = (i: number) => prospectRows[i]!

// ── Messages ─────────────────────────────────────────────────────────────────

const dmKey = [admin.id, ana!.id].sort().join(':')
const [dm, group] = await db
  .insert(conversations)
  .values([
    { kind: 'dm', dmKey, createdByUserId: admin.id },
    { kind: 'group', name: L({ ro: 'Echipa', en: 'The team' }), createdByUserId: admin.id },
  ])
  .returning()
await db.insert(conversationMembers).values([
  { conversationId: dm!.id, userId: admin.id, role: 'owner' },
  { conversationId: dm!.id, userId: ana!.id },
  { conversationId: group!.id, userId: admin.id, role: 'owner' },
  { conversationId: group!.id, userId: ana!.id },
  { conversationId: group!.id, userId: mihai!.id },
])
const say = (conversationId: string, authorUserId: string, body: string, minutesAgo: number) => ({
  conversationId,
  authorUserId,
  body,
  clientId: crypto.randomUUID(),
  createdAt: new Date(now - minutesAgo * 60_000),
})
const [dmFirst, , dmLast, groupFirst, groupLast] = await db.insert(messages).values([
  say(dm!.id, ana!.id, L({ ro: 'Am vorbit cu Prospect 04, vor o ofertă până vineri.', en: 'I talked to Prospect 04; they want an offer by Friday.' }), 190),
  say(dm!.id, admin.id, L({ ro: 'Bun. Fă calculul din Clienți și trimite-l de pe sales@.', en: 'Good. Do the calculation in Clients and send it from sales@.' }), 185),
  say(dm!.id, ana!.id, L({ ro: 'Trimis. Am pus și un reminder în calendar pentru luni.', en: 'Sent. I also put a reminder in the calendar for Monday.' }), 40),
  say(group!.id, mihai!.id, L({ ro: 'Facturile pe luna asta sunt emise, mai puțin două.', en: "This month's invoices are issued, except two." }), 300),
  say(group!.id, admin.id, L({ ro: 'Mulțumesc. Le închid eu mâine dimineață.', en: 'Thanks. I will close them tomorrow morning.' }), 290),
]).returning()

// A reply and a few reactions, so the thread shows quoted messages and chips.
await db.insert(messages).values({
  ...say(group!.id, ana!.id, L({ ro: 'Eu le verific pe cele două rămase azi.', en: 'I will check the two left today.' }), 120),
  replyToId: groupFirst!.id,
})
await db.insert(messageReactions).values([
  { messageId: dmFirst!.id, userId: admin.id, emoji: '👍' },
  { messageId: dmLast!.id, userId: admin.id, emoji: '🙏' },
  { messageId: groupFirst!.id, userId: admin.id, emoji: '👍' },
  { messageId: groupFirst!.id, userId: ana!.id, emoji: '👍' },
  { messageId: groupLast!.id, userId: mihai!.id, emoji: '✅' },
])

// ── Email: Ana's mailbox with threads, a long thread, a wide HTML newsletter and a reply draft ──

// The identity list replaces the env defaults once stored, so the defaults stay in it.
const salesAddress = 'sales@example.com'
await db
  .insert(dashboardConfig)
  .values({ key: 'email.identities', value: [...defaultIdentities(), { key: 'sales', label: 'Sales', fromAddress: `Sales <${salesAddress}>` }] })
  .onConflictDoNothing({ target: [dashboardConfig.tenantId, dashboardConfig.key] })
await db.insert(userMailboxes).values({ userId: ana!.id, identityKey: 'sales' })

type DemoMail = { direction: 'in' | 'out'; at: Date; subject: string; text: string; html?: string; read?: boolean; starred?: boolean }
const addThread = async (outside: string, mails: DemoMail[]) => {
  const last = mails.reduce((a, m) => (m.at > a ? m.at : a), mails[0]!.at)
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject: mails[0]!.subject, participants: [outside, salesAddress], lastMessageAt: last, createdAt: mails[0]!.at })
    .returning()
  const rows = await db
    .insert(emailMessages)
    .values(
      mails.map((m) => ({
        threadId: thread!.id,
        direction: m.direction,
        fromAddress: m.direction === 'in' ? outside : salesAddress,
        toAddress: m.direction === 'in' ? salesAddress : outside,
        subject: m.subject,
        bodyText: m.text,
        bodyHtml: m.html ?? null,
        receivedAt: m.direction === 'in' ? m.at : null,
        isRead: m.direction === 'out' ? true : (m.read ?? false),
        isStarred: m.starred ?? false,
        sentByUserId: m.direction === 'out' ? ana!.id : null,
        createdAt: m.at,
      })),
    )
    .returning()
  return { thread: thread!, messages: rows }
}

const offerThread = await addThread('office@client1.example.com', [
  {
    direction: 'in',
    at: daysAgo(1, 9),
    subject: L({ ro: 'Cerere de ofertă pentru colectare', en: 'Quote request for waste collection' }),
    text: L({
      ro: 'Bună ziua, avem două puncte de lucru și vrem o ofertă pentru colectarea lunară. Ne interesează hârtia și plasticul. Puteți trimite prețurile până joi?',
      en: 'Hello, we have two sites and would like a quote for monthly collection. We are interested in paper and plastic. Could you send the prices by Thursday?',
    }),
    starred: true,
  },
])
await addThread('contabil@client2.example.com', [
  {
    direction: 'in',
    at: daysAgo(2, 14),
    subject: L({ ro: 'Factura din martie', en: 'The March invoice' }),
    text: L({
      ro: 'Am primit factura, dar suma nu corespunde cu oferta. Ne puteți confirma tariful pe tonă? Vă rugăm să ne răspundeți când aveți un moment.',
      en: 'We received the invoice, but the amount does not match the offer. Can you confirm the rate per ton? Please reply when you have a moment.',
    }),
    read: true,
  },
  {
    direction: 'out',
    at: daysAgo(2, 15),
    subject: L({ ro: 'Re: Factura din martie', en: 'Re: The March invoice' }),
    text: L({
      ro: 'Mulțumesc pentru semnalare. Tariful din ofertă era de 180 RON pe tonă; verific factura și revin azi cu o corecție.',
      en: 'Thanks for flagging it. The rate in the offer was 180 RON per ton; I am checking the invoice and will come back today with a correction.',
    }),
  },
  {
    direction: 'in',
    at: daysAgo(0, 7),
    subject: L({ ro: 'Re: Factura din martie', en: 'Re: The March invoice' }),
    text: L({
      ro: 'Perfect, așteptăm factura corectată. Vă mulțumim pentru răspunsul rapid.',
      en: 'Perfect, we will wait for the corrected invoice. Thank you for the quick answer.',
    }),
  },
])

// Seven messages over six days, in and out alternating: the thread view collapses the older ones.
const longSubject = L({ ro: 'Program de colectare, depozit nou', en: 'Collection schedule, new warehouse' })
const longSteps: Array<[number, 'in' | 'out', { ro: string; en: string }]> = [
  [6, 'in', { ro: 'Ne mutăm într-un depozit nou luna viitoare. Putem stabili un program de colectare pentru adresa nouă?', en: 'We are moving to a new warehouse next month. Can we set up a collection schedule for the new address?' }],
  [6, 'out', { ro: 'Sigur. Spuneți-ne adresa și intervalul în care e cineva la depozit, iar noi propunem zilele.', en: 'Of course. Send us the address and the hours when someone is at the warehouse, and we will propose the days.' }],
  [5, 'in', { ro: 'Adresa e Str. Exemplu 12. Suntem acolo de luni până vineri, între 8 și 16.', en: 'The address is 12 Example St. We are there Monday to Friday, between 8 and 16.' }],
  [4, 'out', { ro: 'Propunem miercurea dimineața, la două săptămâni. Camionul ajunge între 9 și 11.', en: 'We propose Wednesday mornings, every two weeks. The truck arrives between 9 and 11.' }],
  [3, 'in', { ro: 'Miercurea merge. Avem nevoie și de containere suplimentare pentru carton, câte ați putea aduce?', en: 'Wednesday works. We also need extra containers for cardboard; how many can you bring?' }],
  [2, 'out', { ro: 'Putem aduce patru containere la prima colectare. Le lăsăm la rampă și vă anunțăm înainte.', en: 'We can bring four containers on the first pickup. We leave them at the dock and let you know beforehand.' }],
  [0, 'in', { ro: 'Patru ajung. Mai e o întrebare: cine semnează procesul-verbal de predare la fiecare colectare?', en: 'Four will do. One more question: who signs the handover report at each pickup?' }],
]
await addThread(
  'logistica@client3.example.com',
  longSteps.map(([ago, direction, text], i) => ({
    direction,
    at: daysAgo(ago, direction === 'in' ? 9 : 13),
    subject: i === 0 || direction === 'in' ? longSubject : `Re: ${longSubject}`,
    text: L(text),
    read: i < longSteps.length - 1,
  })),
)

// Fixed 700px layout with inline styles only, on purpose: it has to be shrunk on a 360px screen.
const newsletterTitle = L({ ro: 'Noutăți de toamnă', en: 'Autumn news' })
const newsletterHtml = `<table width="700" cellpadding="0" cellspacing="0" border="0" style="width:700px;background:#ffffff;font-family:Arial,sans-serif;color:#222222;">
<tr><td colspan="2" style="background:#1d4e89;color:#ffffff;padding:24px;font-size:22px;font-weight:bold;">Acme Newsletter &middot; ${newsletterTitle}</td></tr>
<tr>
<td width="420" valign="top" style="padding:20px;font-size:14px;line-height:1.5;"><h2 style="margin:0 0 8px;font-size:18px;">${L({ ro: 'Reciclarea în cifre', en: 'Recycling in numbers' })}</h2><p style="margin:0;">${L({ ro: 'Anul acesta am colectat cu 18% mai mult decât în urmă cu un an. Citiți raportul complet pe site.', en: 'This year we collected 18% more than a year ago. Read the full report on our site.' })}</p></td>
<td width="280" valign="top" style="padding:20px;background:#f2f4f7;font-size:14px;line-height:1.5;"><h3 style="margin:0 0 8px;font-size:16px;">${L({ ro: 'Evenimente', en: 'Events' })}</h3><p style="margin:0;">${L({ ro: 'Ziua porților deschise, 14 noiembrie, la sediul din Str. Exemplu 1.', en: 'Open day on 14 November at 1 Example St.' })}</p></td>
</tr>
<tr><td colspan="2" style="background:#222222;color:#bbbbbb;padding:16px 24px;font-size:12px;">Acme Recycling &middot; 1 Example St. &middot; newsletter@example.com</td></tr>
</table>`
await addThread('newsletter@acme-recycling.example.com', [
  {
    direction: 'in',
    at: daysAgo(0, 6),
    subject: `Acme Newsletter: ${newsletterTitle}`,
    text: L({
      ro: 'Reciclarea în cifre: anul acesta am colectat cu 18% mai mult decât în urmă cu un an. Evenimente: ziua porților deschise, 14 noiembrie.',
      en: 'Recycling in numbers: this year we collected 18% more than a year ago. Events: open day on 14 November.',
    }),
    html: newsletterHtml,
  },
])

await db.insert(emailDrafts).values({
  ownerUserId: ana!.id,
  fromKey: 'sales',
  to: 'office@client1.example.com',
  subject: L({ ro: 'Re: Cerere de ofertă pentru colectare', en: 'Re: Quote request for waste collection' }),
  body: L({
    ro: '<p>Bună ziua,</p><p>Vă trimit oferta până joi. Pentru două puncte de lucru propunem o colectare lunară.</p>',
    en: '<p>Hello,</p><p>I will send the offer by Thursday. For two sites we propose a monthly collection.</p>',
  }),
  mode: 'reply',
  threadId: offerThread.thread.id,
  sourceMessageId: offerThread.messages[0]!.id,
})

await db.insert(emailUserSettings).values({
  userId: ana!.id,
  outreachDailyCap: 20,
  signatureByMailbox: { sales: `<p>${L({ ro: 'Cu stimă', en: 'Best regards' })},<br>Ana Popescu<br>Acme Sales</p>` },
})

// ── Calendar, notes, alerts, support ─────────────────────────────────────────

const inDays = (n: number, hour: number, minutes = 0) => {
  const d = new Date(now + n * DAY)
  d.setUTCHours(hour, minutes, 0, 0)
  return d
}
const eventRows = await db.insert(calendarEvents).values([
  { ownerUserId: admin.id, title: L({ ro: 'Apel Acme Recycling', en: 'Call with Acme Recycling' }), startAt: inDays(1, 8), endAt: inDays(1, 8, 30), reminderMinutesBefore: 15, createdByUserId: admin.id },
  { ownerUserId: admin.id, title: L({ ro: 'Închidere lună', en: 'Month-end close' }), startAt: inDays(3, 7), endAt: inDays(3, 9), createdByUserId: admin.id },
  { ownerUserId: ana!.id, title: L({ ro: 'Revenit la Prospect 04', en: 'Follow up with Prospect 04' }), startAt: inDays(4, 9), endAt: inDays(4, 9, 30), createdByUserId: ana!.id },
  { ownerUserId: admin.id, title: 'Demo Cobalt Logistics', location: 'Online', startAt: inDays(6, 11), endAt: inDays(6, 12), createdByUserId: admin.id },
]).returning()

// A weekly Monday 10:00 series (company wall time) with the 2nd Monday moved and the 3rd cancelled.
const timeZone = await getCompanyTimeZone()
const nextMonday = new Date(now)
nextMonday.setUTCDate(nextMonday.getUTCDate() + ((8 - nextMonday.getUTCDay()) % 7))
const mondayAt = (weeks: number, hour: number, minutes = 0) => {
  const d = new Date(Date.UTC(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth(), nextMonday.getUTCDate() + weeks * 7))
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minutes, timeZone)
}
const [weeklySeries] = await db.insert(calendarEvents).values({
  ownerUserId: admin.id,
  title: L({ ro: 'Ședință de echipă', en: 'Team sync' }),
  startAt: mondayAt(0, 10),
  endAt: mondayAt(0, 10, 45),
  recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
  createdByUserId: admin.id,
}).returning()
await db.insert(calendarEventExceptions).values([
  { eventId: weeklySeries!.id, occurrenceStart: mondayAt(1, 10), kind: 'moved', startAt: mondayAt(1, 14), endAt: mondayAt(1, 14, 45), overrides: { location: 'Online' } },
  { eventId: weeklySeries!.id, occurrenceStart: mondayAt(2, 10), kind: 'cancelled' },
])

// Two reminders on one event, a common event with attendees, and a calendar shared with Ana.
const [twoReminders] = await db.insert(calendarEvents).values({
  ownerUserId: admin.id,
  title: L({ ro: 'Depunere declarație', en: 'Tax filing' }),
  startAt: inDays(5, 9),
  endAt: inDays(5, 10),
  createdByUserId: admin.id,
}).returning()
await db.insert(calendarEventReminders).values([
  { eventId: twoReminders!.id, minutesBefore: 10 },
  { eventId: twoReminders!.id, minutesBefore: 1440 },
])
const [commonEvent] = await db.insert(calendarEvents).values({
  ownerUserId: admin.id,
  title: L({ ro: 'Planificare trimestru', en: 'Quarter planning' }),
  startAt: inDays(2, 12),
  endAt: inDays(2, 13, 30),
  createdByUserId: admin.id,
}).returning()
await db.insert(calendarEventAttendees).values([
  { eventId: commonEvent!.id, userId: ana!.id },
  { eventId: commonEvent!.id, userId: mihai!.id },
])
await db.insert(calendarShares).values({ ownerUserId: ana!.id, userId: admin.id, level: 'edit' })

// A booking from the site with its call, plus one open and one ended call. Rooms are invented:
// nothing here reaches Daily.
const [bookingEvent] = await db.insert(calendarEvents).values({
  ownerUserId: admin.id,
  title: L({ ro: 'Programare: Acme Recycling', en: 'Booking: Acme Recycling' }),
  startAt: inDays(2, 8),
  endAt: inDays(2, 8, 30),
  source: 'booking',
  createdByUserId: admin.id,
}).returning()
const [demoBooking] = await db.insert(bookings).values({
  calendarEventId: bookingEvent!.id,
  startAt: bookingEvent!.startAt,
  endAt: bookingEvent!.endAt,
  name: 'Ioana Acme',
  email: 'ioana@example.com',
  company: 'Acme Recycling',
  topic: L({ ro: 'Ofertă colectare', en: 'Collection quote' }),
  locale,
  consentAt: new Date(now - DAY),
}).returning()
const demoCall = (slug: string, title: string, extra: Partial<typeof calls.$inferInsert>) => ({
  title,
  roomName: `demo-room-${slug}`,
  roomUrl: `https://demo.invalid/demo-room-${slug}`,
  publicId: `demo-${slug}`,
  expiresAt: inDays(3, 12),
  ...extra,
})
await db.insert(calls).values([
  demoCall('booking', bookingEvent!.title, { bookingId: demoBooking!.id, scheduledAt: bookingEvent!.startAt }),
  demoCall('open', L({ ro: 'Apel cu echipa', en: 'Team call' }), { scheduledAt: inDays(1, 13) }),
  demoCall('ended', L({ ro: 'Apel încheiat', en: 'Finished call' }), { status: 'ended', scheduledAt: daysAgo(2, 9), expiresAt: daysAgo(2, 11), durationSeconds: 1260, participantCount: 2 }),
])

const noteRows = await db.insert(notes).values([
  {
    ownerUserId: admin.id,
    title: L({ ro: 'Date demo', en: 'Demo data' }),
    body: L({
      ro: 'Tot ce vezi a fost creat de `db:seed:demo`. Resetezi cu `./dev reset`.',
      en: 'Everything you see was created by `db:seed:demo`. Reset with `./dev reset`.',
    }),
    pinned: true,
  },
  {
    ownerUserId: admin.id,
    title: L({ ro: 'De întrebat contabila', en: 'To ask the accountant' }),
    body: L({ ro: 'Termenul pentru D301 pe luna curentă.', en: 'The D301 deadline for the current month.' }),
  },
]).returning()

// One shared object of each kind the demo has (messages never point at the archive rows below). The
// snapshots follow the cards built by each module's refs.ts.
type SharedType = 'prospect' | 'invoice' | 'calendar_event' | 'note'
const sharedAbout = async (conversationId: string, authorUserId: string, minutesAgo: number, refType: SharedType, refId: string, snapshot: Record<string, unknown>) => {
  const [message] = await db.insert(messages).values(say(conversationId, authorUserId, '', minutesAgo)).returning()
  await db.insert(messageRefs).values({ messageId: message!.id, refType, refId, snapshot, position: 0 })
}
const sharedProspect = prospectRows[3]!
const sharedInvoice = invoiceRows.find((r) => r.type === 'invoice' && r.paymentStatus === 'unpaid')!
const sharedEvent = eventRows[0]!
const sharedNote = noteRows[1]!
await sharedAbout(dm!.id, ana!.id, 60, 'prospect', sharedProspect.id, {
  title: sharedProspect.name,
  ownerName: null,
  statusLabel: L({ ro: 'De revenit', en: 'Call back' }),
  lastContactAt: null,
})
await sharedAbout(group!.id, mihai!.id, 100, 'invoice', sharedInvoice.id, {
  title: sharedInvoice.documentNumber,
  clientName: sharedInvoice.counterpartyName,
  total: sharedInvoice.amount,
  currency: sharedInvoice.currency,
  status: sharedInvoice.paymentStatus,
  direction: sharedInvoice.direction,
})
await sharedAbout(dm!.id, admin.id, 30, 'calendar_event', sharedEvent.id, {
  title: sharedEvent.title,
  startAt: sharedEvent.startAt.toISOString(),
  endAt: sharedEvent.endAt.toISOString(),
  allDay: false,
  attendeeNames: [],
})
await sharedAbout(group!.id, admin.id, 20, 'note', sharedNote.id, {
  title: sharedNote.title,
  excerpt: sharedNote.body,
})

// ── Notes: rich bodies, colors, labels, an archived one, one in the Trash, one with versions ──

const textBlock = (type: string, text: string, attrs?: Record<string, unknown>): TiptapNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
})
const para = (text: string) => textBlock('paragraph', text)
const heading = (level: number, text: string) => textBlock('heading', text, { level })
const bullets = (items: string[]): TiptapNode => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [para(item)] })),
})
const tasks = (items: [string, boolean][]): TiptapNode => ({
  type: 'taskList',
  content: items.map(([item, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [para(item)] })),
})
const docOf = (...content: TiptapNode[]): TiptapNode => ({ type: 'doc', content })
// `body` is always the plain text derived from the JSON, as the server does on every save.
const richNote = (doc: TiptapNode) => ({ bodyJson: doc, body: tiptapToText(doc), bodyFormat: 'rich' as const })

const launchDoc = docOf(
  heading(1, L({ ro: 'Lansare produs', en: 'Product launch' })),
  para(L({ ro: 'Pașii de făcut înainte de lansare, în ordine.', en: 'What has to be done before the launch, in order.' })),
  tasks([
    [L({ ro: 'Textul paginii de prețuri', en: 'Pricing page copy' }), true],
    [L({ ro: 'Testat plata cu cardul', en: 'Card payment tested' }), true],
    [L({ ro: 'Anunț către clienții existenți', en: 'Announcement to existing clients' }), false],
    [L({ ro: 'Ghid de pornire în 5 minute', en: '5-minute getting started guide' }), false],
  ]),
)
const meetingDoc = docOf(
  heading(2, L({ ro: 'Ședință de echipă', en: 'Team meeting' })),
  bullets([
    L({ ro: 'Facturile pe luna asta se închid vineri', en: "This month's invoices close on Friday" }),
    L({ ro: 'Ana preia prospecții din Cluj', en: 'Ana takes over the Cluj prospects' }),
    L({ ro: 'Mihai verifică extrasele bancare', en: 'Mihai checks the bank statements' }),
  ]),
  heading(3, L({ ro: 'De urmărit', en: 'Follow-ups' })),
  para(L({ ro: 'Revin cu un rezumat după apelul de luni.', en: 'I will send a summary after the Monday call.' })),
)
const shoppingDoc = docOf(
  tasks([
    [L({ ro: 'Hârtie A4', en: 'A4 paper' }), true],
    [L({ ro: 'Cartușe imprimantă', en: 'Printer cartridges' }), false],
    [L({ ro: 'Cafea pentru birou', en: 'Office coffee' }), false],
  ]),
)
// The version history of one note: three earlier states, then the current one.
const roadmapV1 = docOf(heading(1, L({ ro: 'Plan trimestrial', en: 'Quarterly plan' })), para(L({ ro: 'De decis prioritățile.', en: 'Priorities to be decided.' })))
const roadmapV2 = docOf(
  heading(1, L({ ro: 'Plan trimestrial', en: 'Quarterly plan' })),
  bullets([L({ ro: 'Arhiva cu Coș', en: 'Archive with a Trash' }), L({ ro: 'Notițe cu formatare', en: 'Notes with formatting' })]),
)
const roadmapV3 = docOf(
  heading(1, L({ ro: 'Plan trimestrial', en: 'Quarterly plan' })),
  bullets([
    L({ ro: 'Arhiva cu Coș', en: 'Archive with a Trash' }),
    L({ ro: 'Notițe cu formatare', en: 'Notes with formatting' }),
    L({ ro: 'Calendar partajat', en: 'Shared calendar' }),
  ]),
)
const roadmapNow = docOf(
  heading(1, L({ ro: 'Plan trimestrial', en: 'Quarterly plan' })),
  bullets([
    L({ ro: 'Arhiva cu Coș', en: 'Archive with a Trash' }),
    L({ ro: 'Notițe cu formatare', en: 'Notes with formatting' }),
    L({ ro: 'Calendar partajat', en: 'Shared calendar' }),
  ]),
  tasks([
    [L({ ro: 'Date de test pentru fiecare ecran nou', en: 'Demo rows for every new screen' }), true],
    [L({ ro: 'Revizuit ghidurile', en: 'Review the guides' }), false],
  ]),
)

const [, , , roadmapNote] = await db.insert(notes).values([
  { ownerUserId: admin.id, title: L({ ro: 'Lansare produs', en: 'Product launch' }), ...richNote(launchDoc), color: 3, labels: [L({ ro: 'lansare', en: 'launch' })], pinned: true, updatedAt: daysAgo(1) },
  { ownerUserId: admin.id, title: L({ ro: 'Ședință de echipă', en: 'Team meeting' }), ...richNote(meetingDoc), color: 5, labels: [L({ ro: 'echipă', en: 'team' })], updatedAt: daysAgo(2) },
  { ownerUserId: admin.id, title: L({ ro: 'Cumpărături birou', en: 'Office shopping' }), ...richNote(shoppingDoc), labels: [L({ ro: 'birou', en: 'office' })], updatedAt: daysAgo(4) },
  { ownerUserId: admin.id, title: L({ ro: 'Plan trimestrial', en: 'Quarterly plan' }), ...richNote(roadmapNow), color: 1, labels: [L({ ro: 'lansare', en: 'launch' }), L({ ro: 'echipă', en: 'team' })], updatedAt: daysAgo(0, 8) },
  { ownerUserId: admin.id, title: L({ ro: 'Idei pentru blog', en: 'Blog ideas' }), body: L({ ro: 'Ghid de reciclare pentru birouri mici.', en: 'A recycling guide for small offices.' }), color: 7, labels: [L({ ro: 'idei', en: 'ideas' })], archivedAt: daysAgo(10), updatedAt: daysAgo(12) },
  { ownerUserId: admin.id, title: L({ ro: 'Ciornă ofertă veche', en: 'Old offer draft' }), body: L({ ro: 'Nu mai e valabilă.', en: 'No longer valid.' }), deletedAt: daysAgo(2), updatedAt: daysAgo(3) },
]).returning()
await db.insert(noteVersions).values(
  ([[roadmapV1, 5], [roadmapV2, 3], [roadmapV3, 1]] as [TiptapNode, number][]).map(([doc, ago]) => ({
    noteId: roadmapNote!.id,
    title: roadmapNote!.title,
    body: tiptapToText(doc),
    bodyJson: doc,
    createdAt: daysAgo(ago),
    updatedAt: daysAgo(ago),
  })),
)

// ── Archive: a long folder (pagination), colors, stars, a Trash batch, two shared folders ────
// The files are rows only: their R2 keys point at nothing, so opening one shows the error state.

const adminRoot = await ensureSpaceRootOf(admin.id)
const makeFolder = async (name: string, parentId: string, color: number | null = null, deletedAt: Date | null = null) => {
  const [folder] = await db.insert(archiveFolders).values({ name, parentId, ownerUserId: admin.id, color, deletedAt }).returning()
  return folder!
}
const invoicesFolder = await makeFolder(L({ ro: 'Facturi 2026', en: 'Invoices 2026' }), adminRoot, 1)
const contractsFolder = await makeFolder(L({ ro: 'Contracte', en: 'Contracts' }), adminRoot, 3)
const marketingFolder = await makeFolder('Marketing', adminRoot, 5)
const offersFolder = await makeFolder(L({ ro: 'Oferte clienți', en: 'Client offers' }), adminRoot)
const projectsFolder = await makeFolder(L({ ro: 'Proiecte comune', en: 'Shared projects' }), adminRoot)
const oldFolder = await makeFolder(L({ ro: 'Documente vechi', en: 'Old documents' }), adminRoot, null, daysAgo(3))

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  zip: 'application/zip',
} as const
let fileSeq = 0
const demoFile = (folderId: string, name: string, mimeType: string, kb: number, ago: number, extra: { deletedAt?: Date; deletedBatchId?: string } = {}) => {
  fileSeq += 1
  return {
    folderId,
    name,
    mimeType,
    sizeBytes: kb * 1024,
    r2Key: `archive/demo-${String(fileSeq).padStart(3, '0')}-${name}`,
    createdByUserId: admin.id,
    updatedByUserId: admin.id,
    createdAt: daysAgo(ago),
    updatedAt: daysAgo(ago),
    ...extra,
  }
}

// 64 files: more than one page of 50, so the pagination shows.
const invoiceFiles = await db
  .insert(archiveFiles)
  .values(
    Array.from({ length: 64 }, (_, i) =>
      demoFile(
        invoicesFolder.id,
        `${L({ ro: 'Factura', en: 'Invoice' })}-${String(i + 1).padStart(3, '0')}.${i % 9 === 8 ? 'xlsx' : 'pdf'}`,
        i % 9 === 8 ? MIME.xlsx : MIME.pdf,
        40 + ((i * 37) % 260),
        i,
      ),
    ),
  )
  .returning()
const contractFiles = await db
  .insert(archiveFiles)
  .values([
    demoFile(contractsFolder.id, `${L({ ro: 'Contract Acme Recycling', en: 'Acme Recycling contract' })}.pdf`, MIME.pdf, 310, 40),
    demoFile(contractsFolder.id, `${L({ ro: 'Anexa tarife', en: 'Rates annex' })}.docx`, MIME.docx, 58, 38),
    demoFile(contractsFolder.id, `${L({ ro: 'Contract Borealis Metal', en: 'Borealis Metal contract' })}.pdf`, MIME.pdf, 284, 22),
  ])
  .returning()
const marketingFiles = await db
  .insert(archiveFiles)
  .values([
    demoFile(marketingFolder.id, 'banner-toamna.png', MIME.png, 840, 6),
    demoFile(marketingFolder.id, 'logo-acme.png', MIME.png, 96, 30),
  ])
  .returning()
await db.insert(archiveFiles).values([
  demoFile(offersFolder.id, `${L({ ro: 'Oferta Cobalt Logistics', en: 'Cobalt Logistics offer' })}.pdf`, MIME.pdf, 205, 5),
  demoFile(offersFolder.id, `${L({ ro: 'Oferta Delta Print', en: 'Delta Print offer' })}.pdf`, MIME.pdf, 188, 9),
  demoFile(projectsFolder.id, `${L({ ro: 'Plan proiect', en: 'Project plan' })}.docx`, MIME.docx, 72, 3),
  demoFile(projectsFolder.id, `${L({ ro: 'Buget', en: 'Budget' })}.xlsx`, MIME.xlsx, 130, 2),
  demoFile(projectsFolder.id, `${L({ ro: 'Materiale', en: 'Materials' })}.zip`, MIME.zip, 2048, 14),
])

// One Trash batch: a folder deleted with a file in it, kept for 30 days.
const trashBatchId = crypto.randomUUID()
const oldFileKb = 150
await db.update(archiveFolders).set({ deletedBatchId: trashBatchId }).where(eq(archiveFolders.id, oldFolder.id))
await db.insert(archiveFiles).values(
  demoFile(oldFolder.id, `${L({ ro: 'Raport 2024', en: '2024 report' })}.pdf`, MIME.pdf, oldFileKb, 200, { deletedAt: daysAgo(3), deletedBatchId: trashBatchId }),
)
await db.insert(archiveTrashBatches).values({
  id: trashBatchId,
  rootType: 'folder',
  rootId: oldFolder.id,
  originalParentId: adminRoot,
  deletedByUserId: admin.id,
  itemCount: 2,
  totalBytes: oldFileKb * 1024,
  purgeAfter: new Date(now + 30 * DAY),
  createdAt: daysAgo(3),
})

await db.insert(archiveStars).values([
  { userId: admin.id, itemType: 'folder', itemId: contractsFolder.id },
  { userId: admin.id, itemType: 'file', itemId: contractFiles[0]!.id },
  { userId: admin.id, itemType: 'file', itemId: invoiceFiles[0]!.id },
  { userId: admin.id, itemType: 'file', itemId: marketingFiles[0]!.id },
])
await db.insert(archiveFolderShares).values([
  { folderId: offersFolder.id, userId: ana!.id, level: 'view' },
  { folderId: projectsFolder.id, userId: ana!.id, level: 'edit' },
])

const [rule] = await db
  .insert(alertRules)
  .values({ name: L({ ro: 'Venit zilnic sub 1000 RON', en: 'Daily revenue below 1000 RON' }), metricKey: 'revenue', condition: 'lt', threshold: '1000', windowHours: 24, severity: 'warning', platformId: platform!.id, createdByUserId: admin.id })
  .returning()
await db.insert(alerts).values({ ruleId: rule!.id, severity: 'warning', message: L({ ro: 'Venit zilnic sub 1000 RON pe Acme Platform (demo)', en: 'Daily revenue below 1000 RON on Acme Platform (demo)' }), triggeredAt: daysAgo(1, 7) })

const [ticket] = await db
  .insert(supportTickets)
  .values({
    createdByUserId: ana!.id,
    subject: L({ ro: 'Nu văd cutia sales@ în Email', en: 'I do not see the sales@ mailbox in Email' }),
    description: L({ ro: 'Am intrat azi și în Email apare doar cutia mea.', en: 'I signed in today and Email shows only my own mailbox.' }),
    page: '/email',
    status: 'raspuns',
    unreadByPlatform: false,
    lastActivityAt: daysAgo(0, 7),
  })
  .returning()
await db.insert(supportTicketReplies).values({ ticketId: ticket!.id, authorUserId: admin.id, body: L({ ro: 'Ți-am atribuit-o acum din Echipă. Reîncarcă pagina.', en: 'I just assigned it to you from Team. Reload the page.' }), isPlatformReply: true })

// ── Clients: people, notes, tasks, team, lists, views, funnel, sequences, automations, signals ──

const stageEventRows = prospectRows.flatMap((prospect, i) =>
  stageEventsOf(i).map((step) => ({
    prospectId: prospect.id,
    fromStatus: step.from,
    toStatus: step.to,
    changedByUserId: prospect.assignedUserId ?? admin.id,
    changedAt: step.at,
  })),
)
await db.insert(prospectStageEvents).values(stageEventRows)

const peopleRows = await db
  .insert(prospectPeople)
  .values([
    { prospectId: prospectAt(0).id, name: 'Andrei Pop', role: L({ ro: 'Director general', en: 'Managing director' }), isDecisionMaker: true, position: 0 },
    { prospectId: prospectAt(0).id, name: 'Elena Voinea', role: L({ ro: 'Office manager', en: 'Office manager' }), position: 1 },
    { prospectId: prospectAt(1).id, name: 'Laura Ene', role: L({ ro: 'Achiziții', en: 'Purchasing' }), isDecisionMaker: true },
    { prospectId: prospectAt(2).id, name: 'Cristi Radu', role: L({ ro: 'Director operațiuni', en: 'Head of operations' }), isDecisionMaker: true, position: 0 },
    {
      prospectId: prospectAt(2).id,
      name: 'Maria Dinu',
      role: L({ ro: 'Contabil', en: 'Accountant' }),
      doNotContact: true,
      doNotContactReason: L({ ro: 'A cerut la telefon să nu mai fie contactată', en: 'Asked by phone not to be contacted again' }),
      position: 1,
    },
    { prospectId: prospectAt(3).id, name: 'Diana Luca', role: L({ ro: 'Administrator', en: 'Administrator' }), isDecisionMaker: true },
    { prospectId: prospectAt(4).id, name: 'George Sima', role: L({ ro: 'Director comercial', en: 'Sales director' }), isDecisionMaker: true },
  ])
  .returning()
const personNamed = (name: string) => peopleRows.find((p) => p.name === name)!

const e164 = (local: string) => `+40${local.replace(/^0/, '')}`
const point = (prospectId: string, kind: 'phone' | 'email', value: string, extra: Partial<typeof prospectContactPoints.$inferInsert> = {}) => ({
  prospectId,
  kind,
  value,
  valueNormalized: kind === 'phone' ? e164(value) : value.toLowerCase(),
  ...extra,
})

// Two pairs the Health tab should show: the same company under two spellings, and two firms
// sharing a switchboard and an inbox. The hourly job finds the same pairs; its result is stored below.
const [nordicA, nordicB, deltaA, deltaB] = await db
  .insert(prospects)
  .values(
    ['Nordic Plast SRL', 'NORDIC PLAST S.R.L.', 'Delta Metal SRL', 'Delta Recycling SRL'].map((name, k) => ({
      name,
      status: 'necontactat',
      source: 'demo',
      assignedUserId: admin.id,
      claimedAt: daysAgo(5),
      score: (52 + k * 6).toFixed(1),
      createdByUserId: admin.id,
    })),
  )
  .returning()

await db.insert(prospectContactPoints).values([
  ...prospectRows.slice(0, 6).flatMap((p) => [
    point(p.id, 'phone', p.phone!, { isPrimary: true, label: L({ ro: 'Centrală', en: 'Switchboard' }) }),
    point(p.id, 'email', p.email!, { isPrimary: true }),
  ]),
  point(prospectAt(0).id, 'email', 'andrei.pop@prospect1.example.com', { personId: personNamed('Andrei Pop').id }),
  point(prospectAt(1).id, 'phone', '0721000221', { personId: personNamed('Laura Ene').id, label: L({ ro: 'Mobil', en: 'Mobile' }) }),
  point(prospectAt(6).id, 'email', prospectAt(6).email!, { isPrimary: true, status: 'bounced' }),
  point(prospectAt(7).id, 'phone', prospectAt(7).phone!, { isPrimary: true, status: 'invalid' }),
  point(deltaA!.id, 'phone', '0721000900', { isPrimary: true }),
  point(deltaB!.id, 'phone', '0721000900', { isPrimary: true }),
  point(deltaA!.id, 'email', 'contact@delta.example.com', { isPrimary: true }),
  point(deltaB!.id, 'email', 'contact@delta.example.com', { isPrimary: true }),
])

// Same shape the job writes (`a < b`, reasons sorted), so Health has pairs before the first hourly run.
const orderedPair = (x: string, y: string, reasons: string[]) => (x < y ? { a: x, b: y, reasons } : { a: y, b: x, reasons })
await db
  .insert(dashboardConfig)
  .values({
    key: 'clienti.duplicates',
    value: { checkedAt: new Date().toISOString(), pairs: [orderedPair(nordicA!.id, nordicB!.id, ['name']), orderedPair(deltaA!.id, deltaB!.id, ['email', 'phone'])] },
  })
  .onConflictDoNothing({ target: [dashboardConfig.tenantId, dashboardConfig.key] })

await db.insert(prospectNotes).values([
  {
    prospectId: prospectAt(1).id,
    authorUserId: admin.id,
    body: L({
      ro: '@Ana Popescu îi suni tu săptămâna asta? Au cerut ofertă pentru 2 tone pe lună.',
      en: '@Ana Popescu can you call them this week? They asked for an offer for 2 tons a month.',
    }),
    mentions: [ana!.id],
  },
  {
    prospectId: prospectAt(0).id,
    authorUserId: admin.id,
    body: L({ ro: 'Decide Andrei Pop. Preferă apelurile dimineața, înainte de 11.', en: 'Andrei Pop decides. He prefers morning calls, before 11.' }),
    pinned: true,
  },
  { prospectId: prospectAt(3).id, authorUserId: ana!.id, body: L({ ro: 'Au deja contract cu alt colector până în martie. Revin în februarie.', en: 'They have a contract with another collector until March. I will call back in February.' }) },
  { prospectId: prospectAt(5).id, authorUserId: admin.id, body: L({ ro: 'Au acceptat oferta, semnăm contractul joi.', en: 'They accepted the offer, we sign the contract on Thursday.' }) },
])

const task = (assigneeUserId: string, prospectId: string, kind: 'call' | 'email' | 'meeting' | 'task', title: string, dueAt: Date, extra: Partial<typeof prospectTasks.$inferInsert> = {}) => ({
  assigneeUserId,
  createdByUserId: admin.id,
  prospectId,
  kind,
  title,
  dueAt,
  ...extra,
})
const callTitle = (company: string) => L({ ro: `Sună ${company}`, en: `Call ${company}` })
const taskRows = await db
  .insert(prospectTasks)
  .values([
    // Ana: four calls today (a call session), one overdue, one later.
    ...anaOwned.map((i, k) => task(ana!.id, prospectAt(i).id, 'call', callTitle(prospectAt(i).name), daysAgo(0, 7 + k * 2), { priority: k === 0 ? 'high' : 'medium' })),
    task(ana!.id, prospectAt(1).id, 'email', L({ ro: 'Trimite oferta pentru 2 tone/lună', en: 'Send the 2 tons/month offer' }), daysAgo(2, 12), { priority: 'high' }),
    task(ana!.id, prospectAt(8).id, 'meeting', L({ ro: 'Vizită la depozit', en: 'Visit the warehouse' }), inDays(3, 10)),
    // Admin
    task(admin.id, prospectAt(0).id, 'call', callTitle(prospectAt(0).name), daysAgo(3, 9), { priority: 'high' }),
    task(admin.id, prospectAt(2).id, 'task', L({ ro: 'Pregătește contractul-cadru', en: 'Prepare the framework contract' }), daysAgo(0, 14)),
    task(admin.id, prospectAt(6).id, 'call', callTitle(prospectAt(6).name), inDays(5, 10), { priority: 'low' }),
    task(admin.id, prospectAt(0).id, 'call', callTitle(prospectAt(0).name), daysAgo(1, 9), {
      doneAt: daysAgo(1, 10),
      outcome: 'answered',
      outcomeNote: L({ ro: 'Vor ofertă scrisă până vineri', en: 'They want a written offer by Friday' }),
      personId: personNamed('Andrei Pop').id,
    }),
    // The call the sequence is waiting on (below).
    task(admin.id, prospectAt(4).id, 'call', callTitle(prospectAt(4).name), inDays(1, 10)),
  ])
  .returning()
const waitingCall = taskRows.at(-1)!

// Ana helps on a prospect owned by Mihai.
await db.insert(prospectCollaborators).values({ prospectId: prospectAt(mihaiOwned).id, userId: ana!.id, level: 'edit' })
await db.insert(prospectTransferRequests).values({
  prospectId: prospectAt(3).id,
  kind: 'transfer',
  fromUserId: ana!.id,
  toUserId: admin.id,
  requestedByUserId: admin.id,
  note: L({ ro: 'Îl preiau eu, are legătură cu contractul-cadru.', en: 'I will take it, it ties in with the framework contract.' }),
})

const prospectUrl = (i: number) => `/clients?prospect=${prospectAt(i).id}`
await db.insert(notifications).values([
  { userId: ana!.id, kind: 'clienti.mention', title: L({ ro: `Admin te-a menționat la ${prospectAt(1).name}`, en: `Admin mentioned you on ${prospectAt(1).name}` }), url: prospectUrl(1), entityType: 'prospect', entityId: prospectAt(1).id, createdAt: daysAgo(0, 8) },
  { userId: ana!.id, kind: 'clienti.request', title: L({ ro: `Admin cere ${prospectAt(3).name}`, en: `Admin asked for ${prospectAt(3).name}` }), body: L({ ro: 'Îl preiau eu, are legătură cu contractul-cadru.', en: 'I will take it, it ties in with the framework contract.' }), url: prospectUrl(3), entityType: 'prospect', entityId: prospectAt(3).id, createdAt: daysAgo(0, 7) },
  { userId: ana!.id, kind: 'clienti.transfer', title: L({ ro: `${prospectAt(5).name} de la Admin`, en: `${prospectAt(5).name} from Admin` }), url: prospectUrl(5), entityType: 'prospect', entityId: prospectAt(5).id, createdAt: daysAgo(0, 6), readAt: daysAgo(0, 7) },
  { userId: admin.id, kind: 'clienti.release_warning', title: L({ ro: `${prospectAt(0).name} se eliberează în 3 zile`, en: `${prospectAt(0).name} will be released in 3 days` }), url: prospectUrl(0), entityType: 'prospect', entityId: prospectAt(0).id, createdAt: daysAgo(0, 6) },
  { userId: admin.id, kind: 'clienti.bounce', title: L({ ro: `Email respins la ${prospectAt(6).name}`, en: `Email bounced at ${prospectAt(6).name}` }), url: prospectUrl(6), entityType: 'prospect', entityId: prospectAt(6).id, createdAt: daysAgo(1, 9) },
  { userId: admin.id, kind: 'clienti.no_next_step', title: L({ ro: `${prospectAt(2).name} nu are un pas următor`, en: `${prospectAt(2).name} has no next step` }), url: prospectUrl(2), entityType: 'prospect', entityId: prospectAt(2).id, createdAt: daysAgo(2, 10), readAt: daysAgo(2, 11) },
])

// ── Saved views, folders and static lists ────────────────────────────────────

const viewRows = await db
  .insert(prospectViews)
  .values([
    {
      ownerUserId: admin.id,
      name: L({ ro: 'Scor mare, necontactați', en: 'High score, not contacted' }),
      filters: [
        { field: 'status', op: 'in', value: ['necontactat'] },
        { field: 'score', op: 'between', value: [65, null] },
      ],
      columns: ['owner', 'status', 'score', 'value'],
      sort: { key: 'score', dir: 'desc' },
      shared: true,
    },
    {
      ownerUserId: admin.id,
      name: L({ ro: 'În așteptarea unui răspuns', en: 'Waiting for a reply' }),
      filters: [{ field: 'status', op: 'in', value: ['nu_a_raspuns', 'de_revenit', 'email'] }],
      layout: 'board',
      notifyNew: true,
      lastNotifiedAt: daysAgo(1, 8),
    },
    {
      ownerUserId: admin.id,
      name: L({ ro: 'Estimare încasări', en: 'Expected revenue' }),
      filters: [{ field: 'value', op: 'not_empty' }],
      layout: 'forecast',
    },
  ])
  .returning()
await db.insert(prospectViewStars).values({ viewId: viewRows[0]!.id, userId: ana!.id })

const [campaignFolder, fairFolder] = await db
  .insert(prospectListFolders)
  .values([
    { ownerUserId: admin.id, name: L({ ro: 'Campanie Q4', en: 'Q4 campaign' }) },
    { ownerUserId: admin.id, name: L({ ro: 'Târguri', en: 'Trade fairs' }), shared: false },
  ])
  .returning()
const listRows = await db
  .insert(prospectLists)
  .values([
    { folderId: campaignFolder!.id, ownerUserId: admin.id, name: L({ ro: 'Ofertă reciclare', en: 'Recycling offer' }) },
    { folderId: campaignFolder!.id, ownerUserId: admin.id, name: L({ ro: 'Revenire după apel', en: 'Follow-up after call' }) },
    { folderId: fairFolder!.id, ownerUserId: admin.id, name: L({ ro: 'Vizitatori stand', en: 'Booth visitors' }), shared: false },
  ])
  .returning()
const listMembers = [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9, 10]]
await db.insert(prospectListMembers).values(listRows.flatMap((list, k) => listMembers[k]!.map((i) => ({ listId: list.id, prospectId: prospectAt(i).id, addedByUserId: admin.id }))))

// ── Sequences ────────────────────────────────────────────────────────────────

const [offerTemplate, offerTemplateB, reminderTemplate] = await db
  .insert(emailTemplates)
  .values([
    { name: L({ ro: 'Ofertă reciclare', en: 'Recycling offer' }), subject: L({ ro: 'Colectare deșeuri pentru {{nume}}', en: 'Waste collection for {{nume}}' }), body: L({ ro: 'Bună ziua {{nume}},\n\nColectăm și reciclăm deșeurile firmei dvs., cu raport lunar. Vă trimit o ofertă?', en: 'Hello {{nume}},\n\nWe collect and recycle your company waste, with a monthly report. Shall I send an offer?' }) },
    { name: L({ ro: 'Ofertă reciclare (varianta B)', en: 'Recycling offer (variant B)' }), subject: L({ ro: 'Cât plătiți azi pentru deșeuri, {{nume}}?', en: 'What do you pay for waste today, {{nume}}?' }), body: L({ ro: 'Bună ziua {{nume}},\n\nPuteți reduce costul de colectare cu până la 20%. Ne dați zece minute?', en: 'Hello {{nume}},\n\nYou can cut your collection cost by up to 20%. Can we have ten minutes?' }) },
    { name: L({ ro: 'Reminder', en: 'Reminder' }), subject: L({ ro: 'Ați văzut oferta noastră?', en: 'Did you see our offer?' }), body: L({ ro: 'Bună ziua {{nume}},\n\nRevin pe scurt cu oferta de săptămâna trecută.', en: 'Hello {{nume}},\n\nA short follow-up on last week\'s offer.' }) },
  ])
  .returning()
const [outreach, reengagement] = await db
  .insert(emailSequences)
  .values([
    { name: L({ ro: 'Ofertă reciclare: email, apel, reminder', en: 'Recycling offer: email, call, reminder' }), fromIdentity: 'sales' },
    // Paused by the bounce-rate guard, so the banner on the Sequences page has something to show.
    { name: L({ ro: 'Reactivare clienți vechi', en: 'Win-back' }), fromIdentity: 'sales', pausedAt: daysAgo(3, 9), pausedReason: 'BOUNCE_RATE:0.120:25' },
  ])
  .returning()
await db.insert(emailSequenceSteps).values([
  { sequenceId: outreach!.id, stepOrder: 1, kind: 'email', templateId: offerTemplate!.id, variantBTemplateId: offerTemplateB!.id, delayDays: 0 },
  { sequenceId: outreach!.id, stepOrder: 2, kind: 'call', taskTitle: L({ ro: 'Sună după email', en: 'Call after the email' }), taskDescription: L({ ro: 'Întreabă dacă au văzut oferta.', en: 'Ask whether they saw the offer.' }), delayDays: 2 },
  { sequenceId: outreach!.id, stepOrder: 3, kind: 'task', taskTitle: L({ ro: 'Pregătește oferta personalizată', en: 'Prepare the tailored offer' }), delayDays: 3 },
  { sequenceId: outreach!.id, stepOrder: 4, kind: 'email', templateId: reminderTemplate!.id, delayDays: 5 },
  { sequenceId: reengagement!.id, stepOrder: 1, kind: 'email', templateId: reminderTemplate!.id, delayDays: 0 },
  { sequenceId: reengagement!.id, stepOrder: 2, kind: 'email', templateId: offerTemplate!.id, delayDays: 4 },
])
// next_send_at stays in the future so a local run never sends anything.
const enrollment = (i: number, currentStep: number, nextSendInDays: number, extra: Partial<typeof emailSequenceEnrollments.$inferInsert> = {}) => ({
  sequenceId: outreach!.id,
  prospectId: prospectAt(i).id,
  recipientEmail: prospectAt(i).email!,
  recipientName: prospectAt(i).contactName,
  currentStep,
  nextSendAt: inDays(nextSendInDays, 9),
  enrolledAt: daysAgo(currentStep * 3 + 1),
  lastSentAt: currentStep > 0 ? daysAgo(currentStep * 2) : null,
  ...extra,
})
await db.insert(emailSequenceEnrollments).values([
  enrollment(2, 0, 1),
  enrollment(3, 1, 1),
  enrollment(4, 2, 1, { waitingTaskId: waitingCall.id }),
  enrollment(5, 3, 3),
  enrollment(6, 1, 1, { status: 'bounced', consecutiveFailures: 3 }),
  enrollment(7, 1, 1, { status: 'replied' }),
])

// ── Automations and signals ──────────────────────────────────────────────────

await db.insert(prospectAutomationRules).values([
  { ruleKey: 'reply_call_task', enabled: true, params: { hour: 10 }, lastRunAt: daysAgo(0, 6), lastRunCount: 2 },
  { ruleKey: 'no_next_step', enabled: true, params: { days: 7 }, lastRunAt: daysAgo(0, 6), lastRunCount: 3 },
])

// The built-ins the app creates on first use, with their hits, so the Signals tab is not empty.
const signalRows = await db
  .insert(prospectSignals)
  .values([
    { builtinKey: 'new_company', groupKey: 'company', filters: [], name: L({ ro: 'Firmă nouă', en: 'New company' }), description: L({ ro: 'Înființată anul acesta sau anul trecut.', en: 'Founded this year or last.' }), talkingTip: L({ ro: 'Firmele noi își aleg furnizorii din prima lună.', en: 'New firms pick their suppliers in the first month.' }) },
    { builtinKey: 'revenue_growth', groupKey: 'company', filters: [], name: L({ ro: 'Cifră de afaceri în creștere', en: 'Growing revenue' }), description: L({ ro: 'Cifra de afaceri a crescut cu peste 20% față de anul trecut.', en: 'Revenue grew more than 20% over last year.' }), talkingTip: L({ ro: 'Cresc, deci produc mai multe deșeuri: întreabă de volume.', en: 'They are growing, so they produce more waste: ask about volumes.' }) },
    { builtinKey: 'target_caen', groupKey: 'company', filters: [], name: L({ ro: 'Cod CAEN țintă', en: 'Target CAEN code' }), description: L({ ro: 'Activitate din lista de coduri CAEN căutate.', en: 'Activity in your list of target CAEN codes.' }) },
    { builtinKey: 'engaged', groupKey: 'activity', filters: [{ field: 'emailEvent', op: 'in', value: ['opened', 'replied'] }], name: L({ ro: 'A deschis sau a răspuns', en: 'Opened or replied' }), description: L({ ro: 'A deschis sau a răspuns la un email.', en: 'Opened or replied to an email.' }), talkingTip: L({ ro: 'Amintește emailul trimis și întreabă ce a reținut.', en: 'Mention the email you sent and ask what stood out.' }) },
    { builtinKey: 'not_contacted', groupKey: 'activity', filters: [], name: L({ ro: 'Necontactat de 30 de zile', en: 'Not contacted for 30 days' }), description: L({ ro: 'Nicio activitate în ultimele 30 de zile.', en: 'No activity in the last 30 days.' }) },
    { builtinKey: 'decision_maker', groupKey: 'contact', filters: [{ field: 'people.decisionMaker', op: 'in', value: ['true'] }], name: L({ ro: 'Persoană de decizie', en: 'Decision maker' }), description: L({ ro: 'Are un contact marcat ca decident.', en: 'Has a contact marked as decision maker.' }), talkingTip: L({ ro: 'Cere-l direct pe decident.', en: 'Ask for the decision maker by name.' }) },
  ])
  .returning()
const signalId = (key: string) => signalRows.find((s) => s.builtinKey === key)!.id
const hitIndexes: Record<string, number[]> = {
  revenue_growth: [0, 4, 8, 12],
  not_contacted: [2, 5, 8, 11, 14],
  decision_maker: [0, 1, 2, 3, 4],
  engaged: [5, 7],
}
await db.insert(prospectSignalHits).values(
  Object.entries(hitIndexes).flatMap(([key, indexes]) => indexes.map((i) => ({ signalId: signalId(key), prospectId: prospectAt(i).id, computedAt: daysAgo(0, 6) }))),
)

console.log(`Demo data added (${locale}): ${clients.length} clients, ${invoiceRows.length + stateRows.length + 1} invoices and expenses, 19 prospects with people, notes, tasks, lists, views, sequences, automations and signals, 90 days of metrics, notes and archive files.`)
await sql.end()
