/**
 * POST /mcp over a personal API token: the tool list follows the token's features, tools reuse the
 * normal routes (so history names the token), and the endpoint refuses cookies and browsers.
 */
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { apiTokens, auditLog, prospectPeople, prospects, roles, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select().from(users).where(eq(users.roleId, adminRole!.id)).limit(1)
const adminCookie = app.jwt.sign({ sub: adminUser!.id, sv: adminUser!.sessionVersion })

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA mcp ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-mcp-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, cookie: app.jwt.sign({ sub: person!.id, sv: person!.sessionVersion }) }
}

const owner = await createPerson('owner', ['clienti.view', 'clienti.prospectare', 'echipa.tokenuri'])

async function mint(name: string, features?: string[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/me/api-tokens',
    cookies: { vana_session: owner.cookie },
    payload: features ? { name, features } : { name },
  })
  expect(res.statusCode).toBe(201)
  return res.json().data.token as string
}

const viewToken = await mint('mcp-view', ['clienti.view'])
const writeToken = await mint('mcp-write', ['clienti.view', 'clienti.prospectare'])

afterAll(async () => {
  const names = [`Acme MCP ${stamp}`, `Acme MCP research ${stamp}`, `Acme MCP bad ${stamp}`, `Acme MCP free ${stamp}`]
  const created = await db.select({ id: prospects.id }).from(prospects).where(inArray(prospects.name, names))
  const prospectIds = created.map((row) => row.id)
  const tokenIds = (await db.select({ id: apiTokens.id }).from(apiTokens).where(inArray(apiTokens.userId, userIds))).map((row) => row.id)
  if (prospectIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
  if (tokenIds.length) await db.delete(auditLog).where(inArray(auditLog.entityId, tokenIds))
  await db.delete(apiTokens).where(inArray(apiTokens.userId, userIds))
  await db.delete(auditLog).where(inArray(auditLog.entityId, userIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const name = typeof params.name === 'string' ? params.name : undefined
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
      ...headers,
    },
    payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { _meta: META, ...params } }),
  })
}

const withToken = (token: string) => ({ authorization: `Bearer ${token}` })

async function toolNames(token: string): Promise<string[]> {
  const res = await rpc('tools/list', {}, withToken(token))
  expect(res.statusCode).toBe(200)
  return (res.json().result.tools as { name: string }[]).map((tool) => tool.name)
}

describe('mcp endpoint', () => {
  it('tools/list for a view-only token has the read tools and none of the write ones', async () => {
    const names = await toolNames(viewToken)
    expect(names).toEqual(expect.arrayContaining(['list_prospects', 'get_prospect', 'api_routes']))
    for (const hidden of ['add_prospect', 'add_prospect_note', 'list_notes']) expect(names).not.toContain(hidden)
  })

  it('no tool reaches the paths refused to tokens', async () => {
    for (const token of [viewToken, writeToken]) {
      const names = await toolNames(token)
      expect(names.filter((name) => /token|team/i.test(name))).toEqual([])
    }
  })

  it('list_prospects returns the route data as JSON text', async () => {
    const res = await rpc('tools/call', { name: 'list_prospects', arguments: {} }, withToken(viewToken))
    expect(res.statusCode).toBe(200)
    const result = res.json().result
    expect(result.isError).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(data).toHaveProperty('rows')
    expect(data).toHaveProperty('total')
  })

  it('add_prospect creates through the route and the history names the token', async () => {
    expect(await toolNames(writeToken)).toContain('add_prospect')
    const res = await rpc('tools/call', { name: 'add_prospect', arguments: { body: { name: `Acme MCP ${stamp}` } } }, withToken(writeToken))
    expect(res.statusCode).toBe(200)
    const result = res.json().result
    expect(result.isError).toBeFalsy()
    const created = JSON.parse(result.content[0].text)

    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id))
    expect(row!.action).toBe('prospect.creat')
    expect(row!.apiTokenId).not.toBeNull()
  })

  it('add_prospect takes the research answers and update_prospect changes them later', async () => {
    const body = {
      name: `Acme MCP research ${stamp}`,
      revenue: 2_000_000,
      revenuePrev: 1_500_000,
      revenueYear: 2025,
      contactName: 'Ion Popescu',
      contactIsDecisionMaker: true,
      researchFines: 'no',
      researchNews: 'sometimes',
      researchGrowth: 'yes',
      researchedAt: '2026-11-16',
    }
    const created = await rpc('tools/call', { name: 'add_prospect', arguments: { body } }, withToken(writeToken))
    expect(created.json().result.isError).toBeFalsy()
    const { id } = JSON.parse(created.json().result.content[0].text) as { id: string }

    const updated = await rpc('tools/call', { name: 'update_prospect', arguments: { id, body: { researchFines: 'yes', researchCompetitor: 'yes', researchCompetitorName: 'Acme Waste' } } }, withToken(writeToken))
    expect(updated.json().result.isError).toBeFalsy()

    const [row] = await db.select().from(prospects).where(eq(prospects.id, id))
    expect(row).toMatchObject({ revenuePrev: '1500000.00', revenueYear: 2025, researchFines: 'yes', researchNews: 'sometimes', researchGrowth: 'yes', researchCompetitor: 'yes', researchCompetitorName: 'Acme Waste', researchedAt: '2026-11-16' })
    const [person] = await db.select().from(prospectPeople).where(eq(prospectPeople.prospectId, id))
    expect(person!.isDecisionMaker).toBe(true)
  })

  it('add_prospect with assignedUserId null leaves the prospect free for the team', async () => {
    const created = await rpc('tools/call', { name: 'add_prospect', arguments: { body: { name: `Acme MCP free ${stamp}`, assignedUserId: null } } }, withToken(writeToken))
    expect(created.json().result.isError).toBeFalsy()
    const { id } = JSON.parse(created.json().result.content[0].text) as { id: string }
    const [row] = await db.select().from(prospects).where(eq(prospects.id, id))
    expect(row).toMatchObject({ assignedUserId: null, claimedAt: null })
  })

  it('update_prospect refuses an answer outside the list', async () => {
    const created = await rpc('tools/call', { name: 'add_prospect', arguments: { body: { name: `Acme MCP bad ${stamp}` } } }, withToken(writeToken))
    const { id } = JSON.parse(created.json().result.content[0].text) as { id: string }
    const res = await rpc('tools/call', { name: 'update_prospect', arguments: { id, body: { researchFines: 'maybe' } } }, withToken(writeToken))
    expect(res.json().result.isError).toBe(true)
  })

  it('add_prospect called on a view-only token fails and creates nothing', async () => {
    const name = `Acme MCP denied ${stamp}`
    const res = await rpc('tools/call', { name: 'add_prospect', arguments: { body: { name } } }, withToken(viewToken))
    const body = res.json()
    // Unregistered tool: a JSON-RPC error or an isError result, never a success.
    expect(Boolean(body.error) || body.result?.isError === true).toBe(true)
    const rows = await db.select({ id: prospects.id }).from(prospects).where(eq(prospects.name, name))
    expect(rows).toEqual([])
  })

  it('a session cookie without a Bearer is 403 TOKEN_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      cookies: { vana_session: adminCookie },
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } }),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('TOKEN_REQUIRED')
  })

  it('no credentials at all is 401', async () => {
    expect((await rpc('tools/list')).statusCode).toBe(401)
  })

  it('a request with an Origin header is refused', async () => {
    const res = await rpc('tools/list', {}, { ...withToken(viewToken), origin: 'https://example.com' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('ORIGIN_NOT_ALLOWED')
  })

  it('an mcp-name header that disagrees with params.name is 400 with code -32020', async () => {
    const res = await rpc('tools/call', { name: 'list_prospects', arguments: {} }, { ...withToken(viewToken), 'mcp-name': 'get_prospect' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(-32020)
  })
})
