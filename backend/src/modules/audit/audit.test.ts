/**
 * „Cine a făcut ce" (PLAN.md C2, QA-6).
 *
 * `audit_log` e singurul loc unde se vede cine a schimbat ce, deci trebuie să fie complet
 * (acțiunile cu greutate scriu exact o intrare, cu actorul corect), corect (diff pe câmpuri)
 * și curat (niciun secret în el). Actorul vine din contextul requestului, așa că un job — care
 * n-are request — trebuie să lase `actor_user_id` null, nu pe ultimul om care a trecut prin
 * aplicație.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { auditLog, prospects, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { buildAllAssistantTools } from '../assistant/tools/index.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { currentActor, runWithFreshActor } from '../../shared/lib/request-context.js'
import { effectiveFeatures } from '../../shared/lib/session.js'

const app = await buildServer()
await app.ready()

const PASSWORD = 'parola-de-test-123'
const passwordHash = await argon2.hash(PASSWORD)
const prospectIds: string[] = []
const roleIds: string[] = []
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const admin = await app.jwt.sign({ sub: adminUser!.id, sv: adminUser!.sessionVersion })

const [qaRole] = await db
  .insert(roles)
  .values({ name: `QA audit: ${Date.now()}`, kind: 'custom', features: ['clienti.view', 'clienti.prospectare'] })
  .returning()
const [coleg] = await db
  .insert(users)
  .values({ email: `qa-audit-${Date.now()}@test.local`, passwordHash, displayName: 'Coleg', roleId: qaRole!.id })
  .returning()
const colegToken = await app.jwt.sign({ sub: coleg!.id, sv: coleg!.sessionVersion })

// Auditul e append-only, deci nu se poate curăța după fapt. Fiecare rând de test se recunoaște
// după entitatea lui (id-uri noi, create aici) și e adunat ca să fie șters la final — nu după
// oră, pentru că ceasul DB poate rula în urmă față de cel al aplicației.
const auditIds: string[] = []
const intrari = async (action: string, entityId: string) => {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId)))
  auditIds.push(...rows.map((r) => r.id))
  return rows
}
const remember = async (action: string) => {
  const rows = await db.select().from(auditLog).where(eq(auditLog.action, action))
  auditIds.push(...rows.map((r) => r.id))
  return rows
}

afterAll(async () => {
  if (auditIds.length) await db.delete(auditLog).where(inArray(auditLog.id, auditIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await db.delete(userMailboxes).where(eq(userMailboxes.userId, coleg!.id))
  await db.delete(users).where(eq(users.id, coleg!.id))
  await db.delete(roles).where(and(eq(roles.id, qaRole!.id), isNull(roles.deletedAt)))
  await app.close()
})

describe('acțiunile cu greutate scriu exact o intrare', () => {
  it('rol creat, funcționalitate dată, rol redenumit, rol șters', async () => {
    const creat = await app.inject({
      method: 'POST',
      url: '/api/access/roles',
      cookies: { vana_session: admin },
      payload: { name: `QA audit rol ${Date.now()}` },
    })
    expect(creat.statusCode, creat.body).toBe(201)
    const roleId = creat.json().data.id as string
    roleIds.push(roleId)
    expect((await intrari('acces.rol.creat', roleId)).length, 'creat').toBe(1)

    const functionalitate = await app.inject({
      method: 'PUT',
      url: `/api/access/roles/${roleId}/features/clienti.view`,
      cookies: { vana_session: admin },
      payload: { enabled: true },
    })
    expect(functionalitate.statusCode).toBe(200)
    const pornita = await intrari('acces.rol.functionalitate.activata', roleId)
    expect(pornita.length, 'pornita').toBe(1)
    expect(pornita[0]!.changes).toEqual({ feature: [false, true] })

    await app.inject({
      method: 'PATCH',
      url: `/api/access/roles/${roleId}`,
      cookies: { vana_session: admin },
      payload: { name: `QA audit rol redenumit ${Date.now()}` },
    })
    expect((await intrari('acces.rol.redenumit', roleId)).length, 'redenumit').toBe(1)

    await app.inject({ method: 'DELETE', url: `/api/access/roles/${roleId}`, cookies: { vana_session: admin } })
    expect((await intrari('acces.rol.sters', roleId)).length, 'sters').toBe(1)
  })

  it('un prospect creat de un coleg poartă numele lui în coloana de autor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/prospects',
      cookies: { vana_session: colegToken },
      payload: { name: `QA audit prospect ${Date.now()}`, email: 'audit@extern.ro' },
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().data.id as string
    prospectIds.push(id)

    const [prospect] = await db.select().from(prospects).where(eq(prospects.id, id))
    // Coloana de autor vine din contextul requestului, nu din parametrul serviciului — de aceea
    // nu poate ajunge să fie completată cu numele altui om.
    expect(prospect!.createdByUserId).toBe(coleg!.id)
    expect(prospect!.updatedByUserId).toBe(coleg!.id)
  })

  it('invitație, cutii și dezactivare: câte o intrare fiecare, cu actorul care a făcut', async () => {
    const email = `qa-audit-invitat-${Date.now()}@test.local`
    const invitat = await app.inject({
      method: 'POST',
      url: '/api/team/members',
      cookies: { vana_session: admin },
      payload: { email, roleId: qaRole!.id },
    })
    const id = invitat.json().data.id as string
    const [intrare] = await intrari('echipa.invitare', id)
    expect(intrare!.actorUserId).toBe(adminUser!.id)
    expect(intrare!.ip).toBeTruthy()

    await app.inject({
      method: 'PUT',
      url: `/api/team/members/${id}/mailboxes`,
      cookies: { vana_session: admin },
      payload: { identityKeys: ['contact'] },
    })
    const [cutii] = await intrari('echipa.cutii.schimbate', id)
    expect(cutii!.actorUserId).toBe(adminUser!.id)
    expect(cutii!.changes).toEqual({ cutii: [null, 'contact'] })

    await app.inject({
      method: 'PATCH',
      url: `/api/team/members/${id}`,
      cookies: { vana_session: admin },
      payload: { status: 'disabled' },
    })
    const [dezactivare] = await intrari('echipa.dezactivare', id)
    expect(dezactivare!.actorUserId).toBe(adminUser!.id)

    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  })
})

describe('diff-ul nu conține secrete', () => {
  it('câmpurile de chei, token-uri și parole sunt redactate', async () => {
    await runWithFreshActor({ userId: adminUser!.id, ip: '10.0.0.1' }, async () => {
      await recordAudit({
        action: 'qa.redactare',
        entityType: 'qa',
        entityId: null,
        changes: {
          apiKeyEnc: ['old', 'super-secret'],
          accessToken: [null, 'tok_123'],
          passwordHash: ['hash', 'hash'],
          cookie: ['a=b', 'c=d'],
          numeFirma: [null, 'Vanadium Systems SRL'],
        },
      })
    })
    const [intrare] = await remember('qa.redactare')
    expect(intrare!.changes).toEqual({
      apiKeyEnc: ['[redactat]', '[redactat]'],
      accessToken: ['[redactat]', '[redactat]'],
      passwordHash: ['[redactat]', '[redactat]'],
      cookie: ['[redactat]', '[redactat]'],
      numeFirma: [null, 'Vanadium Systems SRL'],
    })
    // Nici măcar valoarea veche nu se păstrează: e tot secret.
    expect(JSON.stringify(intrare!.changes)).not.toContain('super-secret')
  })

  it('nicio intrare din istoric nu conține `api_key_enc` sau un hash de parolă', async () => {
    for (const row of await db.select().from(auditLog).where(inArray(auditLog.id, auditIds))) {
      // Se verifică valorile, nu numele câmpurilor: un câmp redactat se numește `apiKeyEnc`,
      // dar în istoric nu are ce căuta decât `[redactat]`.
      const valori = JSON.stringify(Object.values(row.changes ?? {}).flat())
      expect(valori, row.action).not.toMatch(/api_key|password|secret|token|hash/i)
    }
  })
})

describe('actorul dincolo de request', () => {
  it('într-un job, actorul e null — nu ultimul om care a cerut ceva', async () => {
    // Fără `runWithFreshActor` store-ul e gol, exact ca într-un cron.
    await recordAudit({ action: 'qa.job', entityType: 'qa', entityId: null })
    const [intrare] = await remember('qa.job')
    expect(intrare!.actorUserId).toBeNull()
    expect(intrare!.ip).toBeNull()
  })

  it('coloanele de autor rămân necompletate într-un job, nu copiază un user random', () => {
    expect(createdByUserId()).toEqual({})
    expect(updatedByUserId()).toEqual({})
  })

  it('într-un request, coloanele de autor se completează cu omul din sesiune', async () => {
    await runWithFreshActor({ userId: coleg!.id, ip: null }, async () => {
      expect(createdByUserId()).toEqual({ createdByUserId: coleg!.id })
      expect(updatedByUserId()).toEqual({ updatedByUserId: coleg!.id })
    })
  })

  it('un tool al asistentului scrie cu autorul omului, nu „sistem"', async () => {
    // Tool-urile rulează în requestul omului (store-ul e deschis de `onRequest`), deci
    // `createdByUserId()` din serviciu îl găsește — un prospect creat de asistent îi poartă
    // numele, nu null.
    const ctx = { conversationId: null, user: { ...coleg, features: effectiveFeatures(['clienti.view', 'clienti.prospectare'], 'custom') } }
    const tools = await buildAllAssistantTools(ctx as never)
    const create = tools.find((t) => t.name === 'create_prospect')
    expect(create).toBeTruthy()
    const nume = `QA audit asistent ${Date.now()}`
    await runWithFreshActor({ userId: coleg!.id, ip: null }, () => create!.run({ name: nume } as never))

    const [prospect] = await db.select().from(prospects).where(like(prospects.name, 'QA audit asistent%'))
    prospectIds.push(prospect!.id)
    expect(prospect!.createdByUserId ?? null).not.toBeNull()
  })

  it('store-ul nu ține minte omul de la requestul anterior', () => {
    // Un request fără sesiune lasă actorul null, deci următorul job nu moștenește nimic.
    expect(currentActor().userId).toBeNull()
  })
})

describe('pagina de istoric', () => {
  it('filtrează pe om și pe tip, și ascunde rândurile altui om', async () => {
    const [prima] = await db.select().from(auditLog).where(eq(auditLog.action, 'echipa.invitare')).limit(1)
    if (!prima) return
    // Rândul poate fi de la o rulare anterioară (baza de dev e comună) — nu îl ștergem.
    const intrarie = prima
    const res = await app.inject({
      method: 'GET',
      url: `/api/audit?actorId=${intrarie.actorUserId}&entityType=${intrarie.entityType}`,
      cookies: { vana_session: admin },
    })
    expect(res.statusCode).toBe(200)
    const date = res.json().data as Array<{ actor: { id: string } | null; entityType: string }>
    expect(date.length).toBeGreaterThan(0)
    for (const item of date) {
      expect(item.entityType).toBe(intrarie.entityType)
      expect(item.actor?.id).toBe(intrarie.actorUserId)
    }
    const list = await app.inject({ method: 'GET', url: '/api/audit', cookies: { vana_session: admin } })
    const toate = list.json().data as Array<{ id: string }>
    expect(toate.some((item) => item.id === intrarie.id)).toBe(true)
    // Filtrele sunt pe server: `actorId` nu e acceptat ca listă goală, iar o limită absurdă
    // e respinsă de schemă, nu tăiată în cod.
    const preaMulte = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=500',
      cookies: { vana_session: admin },
    })
    expect(preaMulte.statusCode).toBe(400)
  })

  it('un coleg cu `echipa.istoric` vede istoricul, fără el primește 403', async () => {
    const [rol] = await db.select().from(roles).where(eq(roles.id, qaRole!.id))
    const fara = await app.inject({ method: 'GET', url: '/api/audit', cookies: { vana_session: colegToken } })
    expect(fara.statusCode).toBe(403)
    await db.update(roles).set({ features: [...rol!.features, 'echipa.istoric'] }).where(eq(roles.id, qaRole!.id))
    const cu = await app.inject({ method: 'GET', url: '/api/audit', cookies: { vana_session: colegToken } })
    expect(cu.statusCode).toBe(200)
    await db.update(roles).set({ features: rol!.features }).where(eq(roles.id, qaRole!.id))
  })
})
