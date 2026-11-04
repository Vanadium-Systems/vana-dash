/**
 * A person's own email settings (/api/email/me): signature per mailbox, a lower outreach cap,
 * and what a colleague without the company's Settings (email.setari) can and cannot reach.
 * The company configuration is only read here, never changed.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailSuppressions, emailUserSettings, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { getEmailSettings } from './settings-service.js'
import { buildSignature } from './signature.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []
const suppressed: string[] = []

async function makePerson(label: string, features: string[], mailboxes: string[]): Promise<{ id: string; token: string }> {
  const [role] = await db.insert(roles).values({ name: `Test me ${label} ${RUN}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: label, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  if (mailboxes.length) await db.insert(userMailboxes).values(mailboxes.map((identityKey) => ({ userId: row!.id, identityKey })))
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

// A colleague who can send and keep her own settings, but has no company Settings.
const anna = await makePerson('anna', ['email.view', 'email.trimitere', 'email.setari_proprii'], ['contact'])
const manager = await makePerson('manager', ['email.view', 'email.setari'], [])

const call = (who: { token: string }, method: 'GET' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

afterAll(async () => {
  if (suppressed.length) await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressed))
  await db.delete(emailUserSettings).where(inArray(emailUserSettings.userId, userIds))
  for (const id of userIds) {
    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

describe('PATCH /api/email/me/settings', () => {
  it('refuses a cap above the company cap with 400 CAP_ABOVE_COMPANY', async () => {
    const { outreachDailyCap: companyCap } = await getEmailSettings()
    const res = await call(anna, 'PATCH', '/api/email/me/settings', { outreachDailyCap: companyCap + 1 })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'CAP_ABOVE_COMPANY', limit: companyCap })
  })

  it('accepts a cap at or below the company cap and reads it back', async () => {
    const { outreachDailyCap: companyCap } = await getEmailSettings()
    const res = await call(anna, 'PATCH', '/api/email/me/settings', { outreachDailyCap: companyCap })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().data).toMatchObject({ outreachDailyCap: companyCap, companyOutreachCap: companyCap })
  })

  it('refuses a signature for a mailbox that is not hers with 400 MAILBOX_NOT_MINE', async () => {
    const res = await call(anna, 'PATCH', '/api/email/me/settings', { signatures: { stefan: '<p>Not my mailbox</p>' } })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'MAILBOX_NOT_MINE', identityKey: 'stefan' })
    const [row] = await db.select().from(emailUserSettings).where(eq(emailUserSettings.userId, anna.id))
    expect(row?.signatureByMailbox ?? {}).not.toHaveProperty('stefan')
  })

  it('strips active HTML from a signature it stores', async () => {
    const res = await call(anna, 'PATCH', '/api/email/me/settings', {
      signatures: { contact: '<p onclick="steal()">Anna</p><script>steal()</script>' },
    })
    expect(res.statusCode, res.body).toBe(200)
    const stored: string = res.json().data.signatures.contact
    expect(stored).toContain('Anna')
    expect(stored).not.toMatch(/script|onclick/i)
  })
})

describe('buildSignature(fromKey, userId)', () => {
  it("uses the person's signature when set, and the mailbox's when hers is blank", async () => {
    const mailboxSignature = await buildSignature('contact')

    const set = await call(anna, 'PATCH', '/api/email/me/settings', { signatures: { contact: '<p>Anna from Acme</p>' } })
    expect(set.statusCode, set.body).toBe(200)
    const mine = await buildSignature('contact', anna.id)
    expect(mine.html).toContain('<p>Anna from Acme</p>')
    expect(mine.text).toContain('Anna from Acme')
    expect(mine.html).not.toBe(mailboxSignature.html)
    // Someone else's signature does not follow the mailbox.
    expect(await buildSignature('contact', manager.id)).toEqual(mailboxSignature)

    const cleared = await call(anna, 'PATCH', '/api/email/me/settings', { signatures: { contact: '   ' } })
    expect(cleared.statusCode, cleared.body).toBe(200)
    expect(cleared.json().data.signatures).not.toHaveProperty('contact')
    expect(await buildSignature('contact', anna.id)).toEqual(mailboxSignature)
  })
})

describe('feature guard: email.setari_proprii without email.setari', () => {
  it('reads her own settings and the company lists', async () => {
    const settings = await call(anna, 'GET', '/api/email/me/settings')
    expect(settings.statusCode, settings.body).toBe(200)
    expect(settings.json().data.mailboxes.map((m: { key: string }) => m.key)).toEqual(['contact'])

    expect((await call(anna, 'GET', '/api/email/me/suppressions')).statusCode).toBe(200)
    expect((await call(anna, 'GET', '/api/email/me/blocklist')).statusCode).toBe(200)
  })

  it('cannot remove an unsubscribe or open the company settings (403)', async () => {
    const address = `unsub-${RUN}@example.com`
    suppressed.push(address)
    await db.insert(emailSuppressions).values({ email: address })

    const removed = await call(anna, 'DELETE', `/api/email/suppressions/${address}`)
    expect(removed.statusCode, removed.body).toBe(403)
    expect(await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, address))).toHaveLength(1)

    expect((await call(anna, 'GET', '/api/email/settings')).statusCode).toBe(403)

    // The company side still works for the person who has email.setari.
    expect((await call(manager, 'DELETE', `/api/email/suppressions/${address}`)).statusCode).toBe(200)
  })

  it('may undo her own send with only email.trimitere (not 403)', async () => {
    const res = await call(anna, 'DELETE', `/api/email/sends/${randomUUID()}/scheduled`)
    expect(res.statusCode, res.body).toBe(404)
  })
})
