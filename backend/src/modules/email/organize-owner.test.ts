/**
 * Who may touch which label and rule: a person's own ones through /api/email/me, the company's
 * through the Settings routes, never across. And the rule that a person's own rules act only on
 * a mailbox that person holds alone.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailLabels, emailRules, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { soleMailboxHolder } from './mailboxes.js'
import { createLabel, createRule, evaluateRulesForMessage } from './organize-service.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []
const labelIds: string[] = []
const ruleIds: string[] = []

async function makePerson(label: string, features: string[]): Promise<{ id: string; token: string }> {
  const [role] = await db.insert(roles).values({ name: `Test organize ${label} ${RUN}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: label, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const PERSON_FEATURES = ['email.view', 'email.trimitere', 'email.setari_proprii']
const anna = await makePerson('anna', PERSON_FEATURES)
const bogdan = await makePerson('bogdan', PERSON_FEATURES)
const manager = await makePerson('manager', ['email.view', 'email.setari'])

const call = (who: { token: string }, method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

async function ownLabel(who: { token: string }, name: string): Promise<string> {
  const res = await call(who, 'POST', '/api/email/me/labels', { name: `${name} ${RUN}` })
  expect(res.statusCode, res.body).toBe(201)
  labelIds.push(res.json().data.id)
  return res.json().data.id
}

const labelExists = async (id: string) => {
  const [row] = await db.select({ deletedAt: emailLabels.deletedAt }).from(emailLabels).where(eq(emailLabels.id, id))
  return Boolean(row) && row!.deletedAt === null
}

afterAll(async () => {
  if (ruleIds.length) await db.delete(emailRules).where(inArray(emailRules.id, ruleIds))
  if (labelIds.length) await db.delete(emailLabels).where(inArray(emailLabels.id, labelIds))
  for (const id of userIds) {
    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

describe('labels', () => {
  it("another person's own label cannot be updated or deleted by id (404)", async () => {
    const id = await ownLabel(anna, 'Acme invoices')

    const patch = await call(bogdan, 'PATCH', `/api/email/me/labels/${id}`, { name: `Taken over ${RUN}` })
    expect(patch.statusCode, patch.body).toBe(404)
    const del = await call(bogdan, 'DELETE', `/api/email/me/labels/${id}`)
    expect(del.statusCode, del.body).toBe(404)
    expect(await labelExists(id)).toBe(true)

    const own = await call(anna, 'PATCH', `/api/email/me/labels/${id}`, { name: `Acme billing ${RUN}` })
    expect(own.statusCode, own.body).toBe(200)
  })

  it("the company routes cannot touch a person's label (404)", async () => {
    const id = await ownLabel(anna, 'Acme private')

    const patch = await call(manager, 'PATCH', `/api/email/labels/${id}`, { name: `Company took it ${RUN}` })
    expect(patch.statusCode, patch.body).toBe(404)
    const del = await call(manager, 'DELETE', `/api/email/labels/${id}`)
    expect(del.statusCode, del.body).toBe(404)
    expect(await labelExists(id)).toBe(true)
  })

  it("a person cannot touch the company's label through the person routes (404)", async () => {
    const created = await call(manager, 'POST', '/api/email/labels', { name: `Acme company ${RUN}` })
    expect(created.statusCode, created.body).toBe(201)
    const id = created.json().data.id
    labelIds.push(id)

    expect((await call(anna, 'PATCH', `/api/email/me/labels/${id}`, { name: `Mine now ${RUN}` })).statusCode).toBe(404)
    expect((await call(anna, 'DELETE', `/api/email/me/labels/${id}`)).statusCode).toBe(404)
    expect(await labelExists(id)).toBe(true)
  })
})

describe('rules', () => {
  it("another person's rule cannot be updated or deleted, and the company routes cannot reach it (404)", async () => {
    const created = await call(anna, 'POST', '/api/email/me/rules', { matchType: 'from_address', matchValue: `rule-${RUN}@example.com`, action: 'archive' })
    expect(created.statusCode, created.body).toBe(201)
    const id = created.json().data.id
    ruleIds.push(id)

    expect((await call(bogdan, 'PATCH', `/api/email/me/rules/${id}`, { action: 'trash' })).statusCode).toBe(404)
    expect((await call(bogdan, 'DELETE', `/api/email/me/rules/${id}`)).statusCode).toBe(404)
    expect((await call(manager, 'PATCH', `/api/email/rules/${id}`, { action: 'trash' })).statusCode).toBe(404)
    expect((await call(manager, 'DELETE', `/api/email/rules/${id}`)).statusCode).toBe(404)
    // Applying a rule to existing mail is a company action: a person's rule would move colleagues' mail.
    expect((await call(manager, 'POST', `/api/email/rules/${id}/apply-existing`)).statusCode).toBe(400)

    const [row] = await db.select().from(emailRules).where(eq(emailRules.id, id))
    expect(row).toMatchObject({ action: 'archive', deletedAt: null })
  })

  it("a person's rule cannot label with someone else's label", async () => {
    const bogdansLabel = await ownLabel(bogdan, 'Acme bogdan only')
    const res = await call(anna, 'POST', '/api/email/me/rules', {
      matchType: 'from_domain',
      matchValue: `${RUN}.example.com`,
      action: 'label',
      labelId: bogdansLabel,
    })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.json().error.code).toBe('RULE_LABEL_NOT_ALLOWED')
  })

  it("a person's rule applies only when the receiving mailbox is theirs alone", async () => {
    const from = `rule-owner-${RUN}@example.com`
    const rule = await createRule({ matchType: 'from_address', matchValue: from, action: 'archive' }, anna.id)
    ruleIds.push(rule!.id)
    const message = { fromAddress: from, subject: 'Acme hello' }

    // Sole holder: the rule applies.
    expect(await evaluateRulesForMessage({ ...message, mailboxOwnerId: anna.id })).toMatchObject({ matched: true, folder: 'archive' })
    // Shared or unowned mailbox (no owner), or someone else's: ignored.
    expect(await evaluateRulesForMessage(message)).toMatchObject({ matched: false, folder: null })
    expect(await evaluateRulesForMessage({ ...message, mailboxOwnerId: null })).toMatchObject({ matched: false })
    expect(await evaluateRulesForMessage({ ...message, mailboxOwnerId: bogdan.id })).toMatchObject({ matched: false })
  })

  it("a company rule applies on any mailbox, and a person's label on their own rule", async () => {
    const from = `rule-company-${RUN}@example.com`
    const rule = await createRule({ matchType: 'from_address', matchValue: from, action: 'spam' })
    ruleIds.push(rule!.id)
    const label = await createLabel({ name: `Acme mine ${RUN}`, notificationsEnabled: true }, anna.id)
    labelIds.push(label!.id)
    const labelled = await createRule({ matchType: 'from_address', matchValue: from, action: 'label', labelId: label!.id }, anna.id)
    ruleIds.push(labelled!.id)

    expect(await evaluateRulesForMessage({ fromAddress: from, subject: 'x' })).toMatchObject({ folder: 'spam', labelId: null })
    expect(await evaluateRulesForMessage({ fromAddress: from, subject: 'x', mailboxOwnerId: anna.id })).toMatchObject({ folder: 'spam', labelId: label!.id })
  })
})

describe('soleMailboxHolder', () => {
  it('names the person when exactly one holds the mailbox, null when shared or held by nobody', async () => {
    const key = `solo-${RUN}`
    expect(await soleMailboxHolder(key)).toBeNull()

    await db.insert(userMailboxes).values({ userId: anna.id, identityKey: key })
    expect(await soleMailboxHolder(key)).toBe(anna.id)

    await db.insert(userMailboxes).values({ userId: bogdan.id, identityKey: key })
    expect(await soleMailboxHolder(key)).toBeNull()
  })
})
