/**
 * Profilul „Sales" de la QA-5, verificat prin API (PLAN.md C2, QA-5).
 *
 * QA-5 se cerea manual, cu un user local: Clienți + Calendar + Email fără bulk, o singură
 * cutie (sales@). Partea de „nu vede X" e cea care contează, și e perfect verificabilă de aici:
 * fiecare pagină pe care o deschide are un cod de refuz cu numele funcționalității. Ce rămâne
 * manual e partea vizuală (capturi la 1440/390, dark/light) — fără browser în acest mediu.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmail: vi.fn(async () => {}), sendEmailWithResult: vi.fn(async () => ({ ok: true, id: 'qa-sales' })) }
})

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, notes, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { getIdentities, type EmailIdentity } from '../email/settings-service.js'

const app = await buildServer()
await app.ready()

// Funcționalitățile unui coleg de vânzări, din lista din PLAN.md („Clienți + Calendar + Email
// fără bulk"). `notite.view` lipsește: notițele sunt ale fiecărui om, nu ale echipei.
const SALES = ['clienti.view', 'clienti.prospectare', 'clienti.calculator', 'calendar.view', 'calendar.editare', 'email.view', 'email.trimitere']

const [role] = await db
  .insert(roles)
  .values({ name: `QA Sales: ${Date.now()}`, kind: 'custom', features: SALES })
  .returning()
const [vanzator] = await db
  .insert(users)
  .values({
    email: `qa-sales-profil-${Date.now()}@test.local`,
    passwordHash: await argon2.hash('parola-de-test-123'),
    displayName: 'Ana Popescu',
    roleId: role!.id,
  })
  .returning()
await db.insert(userMailboxes).values({ userId: vanzator!.id, identityKey: 'sales' })
const token = await app.jwt.sign({ sub: vanzator!.id, sv: vanzator!.sessionVersion })

// Contul real al lui Stefan, ca „notițele lui" să aibă un owner diferit de cel al colegului.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const adminUserId = adminUser!.id
const noteIds: string[] = []

// `sales@` trebuie să existe ca identitate, altfel cutia lui n-are adresă și lista e goală.
let identitatiSalvate: EmailIdentity[] | null = null
beforeAll(async () => {
  identitatiSalvate = await getIdentities()
  if (!identitatiSalvate.some((i) => i.key === 'sales')) {
    await db
      .insert(dashboardConfig)
      .values({ key: 'email.identities', value: [...identitatiSalvate, { key: 'sales', label: 'Sales', fromAddress: 'sales@vanadium.systems' }] })
      .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: [...identitatiSalvate, { key: 'sales', label: 'Sales', fromAddress: 'sales@vanadium.systems' }] } })
  }
})

afterAll(async () => {
  if (noteIds.length) await db.delete(notes).where(inArray(notes.id, noteIds))
  await db.delete(userMailboxes).where(eq(userMailboxes.userId, vanzator!.id))
  await db.delete(users).where(eq(users.id, vanzator!.id))
  await db.delete(roles).where(and(eq(roles.id, role!.id), isNull(roles.deletedAt)))
  await app.close()
})

const get = (url: string) => app.inject({ method: 'GET', url, cookies: { vana_session: token } })

describe('sesiunea unui coleg de vânzări', () => {
  it('îi spune exact ce are și ce nu, și o singură cutie', async () => {
    const res = await get('/api/auth/me')
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.features.sort()).toEqual([...SALES].sort())
    expect(data.mailboxes).toEqual(['sales'])
    expect(data.user).toMatchObject({ displayName: 'Ana Popescu', role: { kind: 'custom' } })
    expect(data.isPlatformAdmin).toBe(false)
  })

  it('nu are funcționalitățile firmei, nici pe cele „doar Vanadium"', async () => {
    const { features } = (await get('/api/auth/me')).json().data as { features: string[] }
    for (const key of ['facturi.view', 'financiar.view', 'investitii.view', 'alerte.view', 'setari.view', 'licitatii.view', 'platforme.view', 'server.view', 'asistent.view', 'arhiva.view', 'notite.view', 'mesaje.view', 'cautare.view', 'echipa.administrare', 'echipa.istoric', 'email.bulk', 'email.setari', 'email.cutii', 'email.sabloane']) {
      expect(features, key).not.toContain(key)
    }
  })
})

describe('ce vede și ce nu', () => {
  // `calculate` e POST (calculatorul trimite formularele), deci nu intră în lista de citit.
  const permis = ['/api/prospects', '/api/prospects/statuses', '/api/calendar/events?from=2026-09-01&to=2026-09-30', '/api/email/threads', '/api/email/unread-counts', '/api/email/labels', '/api/email/recent-addresses']
  const interzis: Array<[string, string]> = [
    ['/api/accounting/records', 'facturi.view'],
    ['/api/invoicing/invoices', 'facturi.view'],
    ['/api/financials/pnl', 'financiar.view'],
    ['/api/reports/monthly-snapshot', 'financiar.rapoarte'],
    ['/api/crypto/markets', 'investitii.view'],
    ['/api/assets/portfolio', 'investitii.view'],
    ['/api/jeffbot/overview', 'investitii.bots'],
    ['/api/notes', 'notite.view'],
    ['/api/plan', 'notite.view'],
    ['/api/wishlist', 'notite.view'],
    ['/api/assistant/models', 'asistent.view'],
    ['/api/alerts', 'alerte.view'],
    ['/api/archive/files', 'arhiva.view'],
    ['/api/email/send-quota', 'email.bulk'],
    ['/api/email/templates', 'email.sabloane'],
    ['/api/email/settings', 'email.setari'],
    ['/api/tenders', 'licitatii.view'],
    ['/api/platforms', 'platforme.view'],
    ['/api/monitoring/health-signals', 'server.view'],
    ['/api/search', 'cautare.view'],
    ['/api/audit', 'echipa.istoric'],
    ['/api/access/matrix', 'echipa.administrare'],
    ['/api/booking/settings', 'calendar.programari'],
    ['/api/settings/company-profile', 'setari.firma'],
    ['/api/settings/ops-jobs', 'setari.joburi'],
    ['/api/reconciliation/transactions', 'reconciliere.view'],
  ]

  it('paginile lui răspund 200', async () => {
    for (const url of permis) expect((await get(url)).statusCode, url).toBe(200)
  })

  it('restul răspunde 403 cu numele funcționalității, nu 404 și nu 500', async () => {
    for (const [url, feature] of interzis) {
      const res = await get(url)
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error, url).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature })
    }
  })

  it('vede echipa (ca să îi scrie cuiva), dar nu și istoricul', async () => {
    const membri = await get('/api/team/members')
    expect(membri.statusCode).toBe(200)
    expect(membri.json().data.length).toBeGreaterThan(0)
    expect((await get('/api/team/members')).json().data.map((m: { id: string }) => m.id)).toContain(vanzator!.id)
  })
})

describe('datele altcuia', () => {
  it('notițele: pagina e interzisă, iar filtrul e pe owner', async () => {
    const [aLui] = await db
      .insert(notes)
      .values({ ownerUserId: vanzator!.id, title: 'QA notiță a colegului', body: 'privată' })
      .returning()
    const [aLuiStefan] = await db
      .insert(notes)
      .values({ ownerUserId: adminUserId, title: 'QA notiță a lui Stefan', body: 'privată' })
      .returning()
    noteIds.push(aLui!.id, aLuiStefan!.id)

    expect((await get('/api/notes')).statusCode).toBe(403)

    // Iar dacă poarta s-ar deschide vreodată, filtrul e pe owner — nu pe rol.
    const { listNotes } = await import('../notes/service.js')
    const notitele = await listNotes({ id: vanzator!.id, mailboxes: ['sales'] } as never, {})
    expect(notitele.map((n: { title: string }) => n.title)).toContain('QA notiță a colegului')
    expect(notitele.map((n: { title: string }) => n.title)).not.toContain('QA notiță a lui Stefan')
  })

  it('căutarea din Ctrl K nu îi arată nimic, fiindcă nu are `cautare.view`', async () => {
    // Grupa fără funcționalitate nu e interogată deloc, deci răspunsul e 403, nu o listă goală —
    // altfel un coleg ar deduce că există rânduri pe care nu le poate vedea.
    const res = await get('/api/search?q=vanadium')
    expect(res.statusCode).toBe(403)
  })
})
