import '../load-env.js'
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { encryptApiKey } from '../lib/crypto.js'
import { db, sql } from './client.js'
import {
  alertRules,
  alerts,
  billingClients,
  calendarEvents,
  conversationMembers,
  conversations,
  dashboardConfig,
  financialRecords,
  messages,
  notes,
  platformMetrics,
  platforms,
  prospects,
  roles,
  supportTicketReplies,
  supportTickets,
  users,
} from './schema/index.js'

// Demo data for a first local run: enough rows that no screen is empty. Everything here is
// invented (Acme, example.com) and nothing calls out to ANAF, the bank or an email provider.
//
// Run after `db:seed`, on an otherwise empty database. It refuses to run in production and
// refuses to run twice, so it can never mix invented rows into real ones.

if (process.env.NODE_ENV === 'production') throw new Error('db:seed:demo never runs with NODE_ENV=production')

const [existingClient] = await db.select({ id: billingClients.id }).from(billingClients).limit(1)
if (existingClient) {
  console.log('This database already has clients; demo data was not added.')
  await sql.end()
  process.exit(0)
}

const [admin] = await db.select().from(users).where(eq(users.isPlatformAdmin, true))
if (!admin) throw new Error('Run `db:seed` first: the demo data needs the admin user')

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
  .onConflictDoNothing({ target: dashboardConfig.key })

// ── People ───────────────────────────────────────────────────────────────────

const demoPasswordHash = await argon2.hash(crypto.randomUUID())
const [salesRole] = await db
  .insert(roles)
  .values({
    name: 'Sales (demo)',
    kind: 'custom',
    features: ['clienti.view', 'clienti.prospectare', 'clienti.calculator', 'email.view', 'email.trimitere', 'calendar.view', 'calendar.editare', 'mesaje.view'],
    createdByUserId: admin.id,
  })
  .returning()
const [managerRole] = await db.select().from(roles).where(eq(roles.name, 'Manager'))

// The colleagues cannot log in (random password); they exist so Team, Messages and shared
// calendars have someone in them. Invite a real person from the Team page instead.
const [ana, mihai] = await db
  .insert(users)
  .values([
    { email: 'ana@example.com', passwordHash: demoPasswordHash, displayName: 'Ana Popescu', roleId: salesRole!.id, lastSeenAt: daysAgo(0, 8) },
    { email: 'mihai@example.com', passwordHash: demoPasswordHash, displayName: 'Mihai Ionescu', roleId: managerRole?.id ?? null, lastSeenAt: daysAgo(2) },
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
      address: `Str. Exemplu nr. ${i + 1}`,
      city: c.city,
      email: `office@client${i + 1}.example.com`,
      contactName: c.contact,
      contactTitle: 'Administrator',
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
      description: `Abonament lunar ${client.name}`,
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
const received = [
  { name: 'Hosting Provider GmbH', amount: '180.00', category: 'Infrastructură', day: 62 },
  { name: 'Hosting Provider GmbH', amount: '180.00', category: 'Infrastructură', day: 32 },
  { name: 'Hosting Provider GmbH', amount: '195.00', category: 'Infrastructură', day: 2 },
  { name: 'Contabilitate Exemplu SRL', amount: '600.00', category: 'Contabilitate', day: 40 },
  { name: 'Contabilitate Exemplu SRL', amount: '600.00', category: 'Contabilitate', day: 10 },
  { name: 'Office Supplies SRL', amount: '312.40', category: 'Birou', day: 21 },
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
await db.insert(financialRecords).values([...issued, ...received])

// ── Prospects ────────────────────────────────────────────────────────────────

const prospectStatuses = ['necontactat', 'necontactat', 'nu_a_raspuns', 'de_revenit', 'email', 'aprobat', 'respins']
await db.insert(prospects).values(
  Array.from({ length: 15 }, (_, i) => ({
    name: `Prospect ${String(i + 1).padStart(2, '0')} SRL`,
    cif: `RO2000${String(i + 1).padStart(4, '0')}`,
    phone: `031000${String(1000 + i)}`,
    email: `office@prospect${i + 1}.example.com`,
    website: `https://prospect${i + 1}.example.com`,
    contactName: ['Andrei Pop', 'Laura Ene', 'Cristi Radu', 'Diana Luca', 'George Sima'][i % 5],
    foundingYear: 2008 + (i % 12),
    employeeCount: 4 + ((i * 7) % 40),
    revenue: String(400000 + i * 310000),
    profit: String(30000 + i * 21000),
    score: (45 + ((i * 13) % 50)).toFixed(1),
    status: prospectStatuses[i % prospectStatuses.length],
    source: 'demo',
    createdByUserId: admin.id,
  })),
)

// ── Messages ─────────────────────────────────────────────────────────────────

const dmKey = [admin.id, ana!.id].sort().join(':')
const [dm, group] = await db
  .insert(conversations)
  .values([
    { kind: 'dm', dmKey, createdByUserId: admin.id },
    { kind: 'group', name: 'Echipa', createdByUserId: admin.id },
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
await db.insert(messages).values([
  say(dm!.id, ana!.id, 'Am vorbit cu Prospect 04, vor o ofertă până vineri.', 190),
  say(dm!.id, admin.id, 'Bun. Fă calculul din Clienți și trimite-l de pe sales@.', 185),
  say(dm!.id, ana!.id, 'Trimis. Am pus și un reminder în calendar pentru luni.', 40),
  say(group!.id, mihai!.id, 'Facturile pe luna asta sunt emise, mai puțin două.', 300),
  say(group!.id, admin.id, 'Mulțumesc. Le închid eu mâine dimineață.', 290),
])

// ── Calendar, notes, alerts, support ─────────────────────────────────────────

const inDays = (n: number, hour: number, minutes = 0) => {
  const d = new Date(now + n * DAY)
  d.setUTCHours(hour, minutes, 0, 0)
  return d
}
await db.insert(calendarEvents).values([
  { ownerUserId: admin.id, title: 'Apel Acme Recycling', startAt: inDays(1, 8), endAt: inDays(1, 8, 30), reminderMinutesBefore: 15, createdByUserId: admin.id },
  { ownerUserId: admin.id, title: 'Închidere lună', startAt: inDays(3, 7), endAt: inDays(3, 9), createdByUserId: admin.id },
  { ownerUserId: ana!.id, title: 'Revenit la Prospect 04', startAt: inDays(4, 9), endAt: inDays(4, 9, 30), createdByUserId: ana!.id },
  { ownerUserId: admin.id, title: 'Demo Cobalt Logistics', location: 'Online', startAt: inDays(6, 11), endAt: inDays(6, 12), createdByUserId: admin.id },
])

await db.insert(notes).values([
  { ownerUserId: admin.id, title: 'Demo data', body: 'Everything you see was created by `db:seed:demo`. Reset with `./dev reset`.', pinned: true },
  { ownerUserId: admin.id, title: 'De întrebat contabila', body: 'Termenul pentru D301 pe luna curentă.' },
])

const [rule] = await db
  .insert(alertRules)
  .values({ name: 'Venit zilnic sub 1000 RON', metricKey: 'revenue', condition: 'lt', threshold: '1000', windowHours: 24, severity: 'warning', platformId: platform!.id, createdByUserId: admin.id })
  .returning()
await db.insert(alerts).values({ ruleId: rule!.id, severity: 'warning', message: 'Venit zilnic sub 1000 RON pe Acme Platform (demo)', triggeredAt: daysAgo(1, 7) })

const [ticket] = await db
  .insert(supportTickets)
  .values({
    createdByUserId: ana!.id,
    subject: 'Nu văd cutia sales@ în Email',
    description: 'Am intrat azi și în Email apare doar cutia mea.',
    page: '/email',
    status: 'raspuns',
    unreadByPlatform: false,
    lastActivityAt: daysAgo(0, 7),
  })
  .returning()
await db.insert(supportTicketReplies).values({ ticketId: ticket!.id, authorUserId: admin.id, body: 'Ți-am atribuit-o acum din Echipă. Reîncarcă pagina.', isPlatformReply: true })

console.log(`Demo data added: ${clients.length} clients, ${issued.length + received.length} invoices and expenses, 15 prospects, 90 days of metrics.`)
await sql.end()
