/**
 * Guard de funcționalități + roluri + echipă (PLAN.md C2, BE-1..BE-3).
 *
 * Grupate într-un singur fișier pentru că fixture-ul e același: trei oameni cu roluri diferite
 * (admin, manager, sales) pe aceeași aplicație. Testele verifică ce contează — un coleg nu
 * poate ajunge la date pe care nu le are, nici ocolindând guard-ul pe o rută nouă.
 */
import argon2 from 'argon2'
import { vi } from 'vitest'

// Emailurile de invitație/resetare nu ies în test — fără mock, `sendEmail` ar lovi Resend-ul
// real cu cheia de test și ar încetini fiecare test cu un timeout.
vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))
import { and, eq, inArray, ne } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { auditLog, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { effectiveFeatures } from '../../shared/lib/session.js'
import { config } from '../../shared/config.js'
import { getCatalog } from './service.js'

const app = await buildServer()
await app.ready()

const PASSWORD = 'parola-de-test-123'
const created: string[] = []
const createdRoles: string[] = []

async function createUser(email: string, role: { kind: 'admin' | 'manager' | 'custom'; features?: string[] }) {
  let roleId: string
  if (role.kind === 'admin') {
    const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
    roleId = existing!.id
  } else {
    const name = `Test: ${role.kind} ${email}`
    const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name))
    if (existing) roleId = existing.id
    else {
      const [createdRole] = await db.insert(roles).values({ name, kind: role.kind, features: role.features ?? [] }).returning()
      createdRoles.push(createdRole!.id)
      roleId = createdRole!.id
    }
  }
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash(PASSWORD), displayName: email.split('@')[0], roleId })
    .returning()
  created.push(row!.id)
  // Token semnat direct, ca în prod după login: rate-limit-ul de login e 5/15min și ar
  // bloca un suite care creează zece oameni. Loginul în sine e testat separat, în auth.
  const token = await app.jwt.sign({ sub: row!.id, sv: 1 })
  return { id: row!.id, email, cookie: token, roleId }
}

const SALES_FEATURES = ['clienti.view', 'clienti.prospectare', 'calendar.view', 'calendar.editare', 'email.view', 'email.trimitere', 'notite.view']

const stefan = await createUser('qa-admin@test.local', { kind: 'admin' })
const sales = await createUser('qa-sales@test.local', { kind: 'custom', features: SALES_FEATURES })
const manager = await createUser('qa-manager@test.local', {
  kind: 'custom',
  features: [...SALES_FEATURES, 'echipa.administrare', 'email.cutii', 'email.bulk'],
})
const noRole = await createUser('qa-norole@test.local', { kind: 'custom', features: [] })

afterAll(async () => {
  await db.delete(auditLog).where(eq(auditLog.action, 'echipa.invitare'))
  await db.delete(auditLog).where(eq(auditLog.action, 'echipa.actualizare'))
  await db.delete(auditLog).where(eq(auditLog.action, 'echipa.cutii.schimbate'))
  await db.delete(auditLog).where(eq(auditLog.action, 'echipa.dezactivare'))
  for (const id of created) await db.delete(users).where(eq(users.id, id))
  for (const id of createdRoles) await db.delete(roles).where(eq(roles.id, id))
  await app.close()
})

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, cookies: { vana_session: cookie } })

describe('funcționalitățile efective ale unui rol', () => {
  it('adminul are tot catalogul', () => {
    const all = effectiveFeatures([], 'admin')
    expect(all).toContain('facturi.emitere')
    expect(all).toContain('investitii.bots')
    expect(all.length).toBeGreaterThan(40)
  })

  it('a feature of an integration that is not configured exists for nobody', () => {
    const token = config.jeffbotIngestToken
    config.jeffbotIngestToken = ''
    try {
      expect(effectiveFeatures([], 'admin')).not.toContain('investitii.bots')
      expect(effectiveFeatures(['investitii.view', 'investitii.bots'], 'custom')).toEqual(['investitii.view'])
      const listed = getCatalog().flatMap((page) => page.features.map((feature) => feature.key))
      expect(listed).not.toContain('investitii.bots')
      expect(listed).toContain('investitii.view')
    } finally {
      config.jeffbotIngestToken = token
    }
  })

  it('rolul custom primește doar cheile lui', () => {
    const keys = effectiveFeatures(SALES_FEATURES, 'custom')
    expect(keys).toContain('clienti.view')
    expect(keys).not.toContain('facturi.view')
    expect(keys).not.toContain('echipa.administrare')
  })

  it('.view oprit lasă cheile salvate dar inactive', () => {
    const keys = effectiveFeatures(['email.trimitere', 'email.bulk'], 'custom')
    expect(keys).toEqual([])
  })

  it('o pagină deschisă nu aduce funcționalități pe care rolul nu le are', () => {
    const keys = effectiveFeatures(['calendar.view'], 'custom')
    expect(keys).toEqual(['calendar.view'])
  })
})

describe('guard pe rute', () => {
  it('adminul trece peste tot', async () => {
    for (const url of ['/api/platforms', '/api/invoicing/invoices', '/api/tenders', '/api/jeffbot/overview']) {
      expect((await get(url, stefan.cookie)).statusCode, url).toBe(200)
    }
  })

  it('colegul de vânzări primește 403 cu cod pe ce nu are, și 200 pe ce are', async () => {
    const interzis = await get('/api/invoicing/invoices', sales.cookie)
    expect(interzis.statusCode).toBe(403)
    expect(interzis.json().error).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature: 'facturi.view' })

    const permis = await get('/api/prospects', sales.cookie)
    expect(permis.statusCode).toBe(200)
  })

  it('pagina fără poartă e 403 chiar dacă o funcționalitate a ei e salvată', async () => {
    const res = await get('/api/email/send-quota', noRole.cookie)
    expect(res.statusCode).toBe(403)
  })

  it('user fără rol nu vede nimic', async () => {
    for (const url of ['/api/prospects', '/api/email/unread-counts', '/api/calendar/events']) {
      expect((await get(url, noRole.cookie)).statusCode, url).toBe(403)
    }
  })

  it('rutele self trec oricând (căutarea, /me, lista echipei)', async () => {
    expect((await get('/api/team/members', sales.cookie)).statusCode).toBe(200)
    expect((await get('/api/team/members', noRole.cookie)).statusCode).toBe(200)
  })

  it('un switch oprit are efect la următorul request, fără delogare', async () => {
    const [target] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
    // Oprim funcționalitatea unui rol custom creat ad-hoc, ca să nu atingem rolurile reale.
    const [tempRole] = await db
      .insert(roles)
      .values({ name: `Test: temporar ${Date.now()}`, kind: 'custom', features: ['clienti.view'] })
      .returning()
    createdRoles.push(tempRole!.id)
    await db.update(users).set({ roleId: tempRole!.id }).where(eq(users.id, sales.id))
    const [nou] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, tempRole!.name))
    const res = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${nou!.id}/features/clienti.view`,
      cookies: { vana_session: stefan.cookie },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const dup = await get('/api/prospects', sales.cookie)
    expect(dup.statusCode).toBe(403)
    expect(target).toBeDefined()
    // Înapoi pe rolul lui, ca testele de după să-l găsească ocupat.
    await db.update(users).set({ roleId: sales.roleId }).where(eq(users.id, sales.id))
  })
})

describe('sesiunea', () => {
  it('user dezactivat e delogat la cererea următoare', async () => {
    const om = await createUser('qa-dezactivat@test.local', { kind: 'custom', features: ['clienti.view'] })
    expect((await get('/api/prospects', om.cookie)).statusCode).toBe(200)
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, om.id))
    const res = await get('/api/prospects', om.cookie)
    expect(res.statusCode).toBe(401)
    await db.update(users).set({ status: 'active' }).where(eq(users.id, om.id))
  })

  it('session_version invalidat (parolă schimbată) dă 401, nu doar token expirat', async () => {
    const om = await createUser('qa-sv@test.local', { kind: 'custom', features: ['clienti.view'] })
    await db.update(users).set({ sessionVersion: 99 }).where(eq(users.id, om.id))
    expect((await get('/api/prospects', om.cookie)).statusCode).toBe(401)
  })

  it('loginul unui user dezactivat e același ca pentru o adresă inexistentă', async () => {
    const om = await createUser('qa-login-gresit@test.local', { kind: 'custom', features: [] })
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, om.id))
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: om.email, password: PASSWORD } })
    const inexistent = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nu-exista@test.local', password: PASSWORD } })
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe(inexistent.body)
  })
})

describe('roluri (pagina Module)', () => {
  it('matricea arată rolurile, cu Admin needitabil', async () => {
    const res = await get('/api/access/matrix', stefan.cookie)
    expect(res.statusCode).toBe(200)
    const admin = res.json().data.roles.find((r: { kind: string }) => r.kind === 'admin')
    expect(admin).toMatchObject({ editable: false, name: 'Admin' })
    expect(admin.features).toContain('facturi.emitere')
  })

  it('managerul vede ca poate da doar ce are el', async () => {
    const res = await get('/api/access/matrix', manager.cookie)
    const managerRole = res.json().data.roles.find((r: { name: string }) => r.name.startsWith('Test: custom'))
    expect(managerRole.lockedFeatures).toContain('facturi.emitere')
    expect(managerRole.lockedFeatures).not.toContain('clienti.view')
  })

  it('managerul nu poate da o funcționalitate pe care nu o are', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-manager@test.local'))
    const res = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${rol!.id}/features/facturi.emitere`,
      cookies: { vana_session: manager.cookie },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('PERMISSION_ESCALATION')
  })

  it('rolul Admin nu se modifică (ROLE_LOCKED)', async () => {
    const [admin] = await db.select().from(roles).where(eq(roles.name, 'Admin'))
    const res = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${admin!.id}/features/facturi.view`,
      cookies: { vana_session: stefan.cookie },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ROLE_LOCKED')
  })

  it('managerul nu atinge nici rolurile admin sau manager (nici pe cele de genul)', async () => {
    const [rolManager] = await db.select().from(roles).where(eq(roles.name, 'Manager'))
    for (const [method, url, payload] of [
      ['PUT', `/api/access/roles/${rolManager!.id}/features/clienti.view`, { enabled: false }],
      ['PUT', `/api/access/roles/${rolManager!.id}/pages/clienti`, { enabled: false }],
      ['PATCH', `/api/access/roles/${rolManager!.id}`, { name: 'Manager nou' }],
      ['DELETE', `/api/access/roles/${rolManager!.id}`, undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        cookies: { vana_session: manager.cookie },
        ...(payload ? { payload } : {}),
      })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
      expect(res.json().error.code, `${method} ${url}`).toBe('PERMISSION_ESCALATION')
    }
    // Rolul a rămas neatiners — un manager nu poate nici să-l redenumiască.
    const [dupa] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, rolManager!.id))
    expect(dupa!.name).toBe('Manager')
  })

  it('managerul editează în schimb rolurile custom, pe cele ale lui', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${sales.roleId}/features/clienti.prospectare`,
      cookies: { vana_session: manager.cookie },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.features).toContain('clienti.prospectare')
    await db.update(roles).set({ features: SALES_FEATURES }).where(eq(roles.id, sales.roleId))
  })

  it('.view oprit închide și scrierea paginii, nu doar cititul', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-sales@test.local'))
    // Email cu `trimitere` și `bulk` salvate, dar fără poarta `email.view`.
    await db.update(roles).set({ features: ['email.trimitere', 'email.bulk'] }).where(eq(roles.id, rol!.id))
    try {
      for (const url of ['/api/email/threads', '/api/email/send-quota']) {
        expect((await get(url, sales.cookie)).statusCode, url).toBe(403)
      }
      const scriere = await app.inject({
        method: 'POST',
        url: '/api/email/send',
        cookies: { vana_session: sales.cookie },
        payload: { to: 'client@extern.ro', subject: 'QA', body: 'QA', from: 'contact' },
      })
      // Refuzul numește funcționalitatea rutei (`email.trimitere`), nu poarta: omul o are
      // salvată în rol, dar poarta oprită o ține inactivă.
      expect(scriere.statusCode).toBe(403)
      expect(scriere.json().error.feature).toBe('email.trimitere')
    } finally {
      await db.update(roles).set({ features: SALES_FEATURES }).where(eq(roles.id, rol!.id))
    }
  })

  it('switch pe o pagină pornește/oprește toate funcționalitățile ei', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/access/roles',
      cookies: { vana_session: stefan.cookie },
      payload: { name: `Test: pagină ${Date.now()}` },
    })
    const roleId = res.json().data.id
    createdRoles.push(roleId)
    const on = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${roleId}/pages/clienti`,
      cookies: { vana_session: stefan.cookie },
      payload: { enabled: true },
    })
    expect(on.json().data.features).toEqual(expect.arrayContaining(['clienti.view', 'clienti.prospectare', 'clienti.calculator']))
    const off = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${roleId}/pages/clienti`,
      cookies: { vana_session: stefan.cookie },
      payload: { enabled: false },
    })
    expect(off.json().data.features.filter((f: string) => f.startsWith('clienti.'))).toEqual([])
  })

  it('rol nou copiat dintr-un rol custom', async () => {
    const [sursa] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-manager@test.local'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/access/roles',
      cookies: { vana_session: stefan.cookie },
      payload: { name: `Test: copie ${Date.now()}`, copyFromRoleId: sursa!.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.features).toContain('echipa.administrare')
  })

  it('rol cu oameni nu se șterge (ROLE_IN_USE)', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-sales@test.local'))
    const res = await app.inject({ method: 'DELETE', url: `/api/access/roles/${rol!.id}`, cookies: { vana_session: stefan.cookie } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ROLE_IN_USE')
  })

  it('colegul fără echipa.administrare nu vede matricea', async () => {
    expect((await get('/api/access/matrix', sales.cookie)).statusCode).toBe(403)
  })
})

describe('echipa', () => {
  it('lista e disponibilă oricărui user activ (pentru „Scrie")', async () => {
    const res = await get('/api/team/members', sales.cookie)
    expect(res.statusCode).toBe(200)
    const gasit = res.json().data.find((m: { email: string }) => m.email === sales.email)
    expect(gasit).toBeTruthy()
  })

  it('invitarea creează userul „invited" și scrie o intrare în audit', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-manager@test.local'))
    const email = `qa-invitat-${Date.now()}@test.local`
    const res = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: stefan.cookie },
      payload: { email, displayName: 'Invitat Test', roleId: rol!.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.status).toBe('invited')
    created.push(res.json().data.id)

    // Pe rândul creat acum, nu pe cei rămași de la rulări anterioare în aceeași bază de dev.
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'echipa.invitare'), eq(auditLog.entityId, res.json().data.id)))
    expect(entry).toBeTruthy()
    expect(entry!.actorUserId).toBe(stefan.id)
    expect(JSON.stringify(entry!.changes)).toContain(email)
  })

  it('email deja folosit: 409 EMAIL_TAKEN', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-manager@test.local'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: stefan.cookie },
      payload: { email: sales.email, roleId: rol!.id },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('EMAIL_TAKEN')
  })

  it('managerul nu poate da rolul de Admin', async () => {
    const [admin] = await db.select().from(roles).where(eq(roles.name, 'Admin'))
    const res = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: manager.cookie },
      payload: { email: `qa-reject-${Date.now()}@test.local`, roleId: admin!.id },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('PERMISSION_ESCALATION')
  })

  it('ultimul admin activ nu poate fi dezactivat', async () => {
    const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'))
    // Regula e globală („ultimul" din toată firma), deci testul trebuie să lase exact un admin
    // activ. ceilalți admini — inclusiv contul real din .env — sunt opriți temporar și
    // repuși în `finally`, ca o cursă întreruptă să nu lase aplicația locală fără om.
    const [me] = await db.select().from(users).where(eq(users.email, stefan.email))
    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.roleId, adminRole!.id), ne(users.id, me!.id), eq(users.status, 'active')))
    const saved = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(inArray(users.id, others.map((o) => o.id)))
    await db.update(users).set({ status: 'disabled' }).where(inArray(users.id, others.map((o) => o.id)))
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/team/members/${me!.id}`,
        cookies: { vana_session: stefan.cookie },
        payload: { status: 'disabled' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('LAST_ADMIN')

      const retrogradat = await app.inject({
        method: 'PATCH',
        url: `/api/team/members/${me!.id}`,
        cookies: { vana_session: stefan.cookie },
        payload: { roleId: sales.roleId },
      })
      expect(retrogradat.statusCode).toBe(409)
      expect(retrogradat.json().error.code).toBe('LAST_ADMIN')
    } finally {
      for (const row of saved) await db.update(users).set({ status: row.status }).where(eq(users.id, row.id))
    }
  })

  it('cutii de email: adminul are toate implicit, altfel se scriu explicit', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/team/members/${sales.id}/mailboxes`,
      cookies: { vana_session: stefan.cookie },
      payload: { identityKeys: ['sales'] },
    })
    expect(res.statusCode).toBe(200)
    const rows = await db.select().from(userMailboxes).where(eq(userMailboxes.userId, sales.id))
    expect(rows.map((r) => r.identityKey)).toEqual(['sales'])

    // Pentru un admin nu se scriu rânduri — ar îi restrânge accesul fără motiv.
    await app.inject({
      method: 'PUT',
      url: `/api/team/members/${stefan.id}/mailboxes`,
      cookies: { vana_session: stefan.cookie },
      payload: { identityKeys: ['sales'] },
    })
    const adminRows = await db.select().from(userMailboxes).where(eq(userMailboxes.userId, stefan.id))
    expect(adminRows).toEqual([])
  })

  it('cutii fără email.cutii: 403 chiar dacă omul administrează echipa', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.name, 'Test: custom qa-sales@test.local'))
    const [faraCutii] = await db.select().from(users).where(eq(users.email, sales.email))
    // Dăm userului de vânzări echipa.administrare ca să izolăm lipsa lui email.cutii.
    await db.update(roles).set({ features: [...SALES_FEATURES, 'echipa.administrare'] }).where(eq(roles.id, rol!.id))
    const res = await app.inject({
      method: 'PUT',
      url: `/api/team/members/${faraCutii!.id}/mailboxes`,
      cookies: { vana_session: sales.cookie },
      payload: { identityKeys: ['sales'] },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.feature).toBe('email.cutii')
  })
})
