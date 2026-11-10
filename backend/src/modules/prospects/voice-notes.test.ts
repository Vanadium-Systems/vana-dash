/**
 * Voice notes over HTTP with real roles and a real DB; R2 is mocked, nothing leaves the machine.
 * Agents: A (own prospect), B (a colleague, no clienti.toti), an admin.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const r2 = vi.hoisted(() => ({
  uploaded: new Map<string, number>(),
  deleted: [] as string[],
}))

vi.mock('../../shared/lib/r2.js', () => ({
  uploadToR2: vi.fn(async (key: string, body: AsyncIterable<Buffer>) => {
    let size = 0
    for await (const chunk of body) size += chunk.length
    r2.uploaded.set(key, size)
  }),
  deleteFromR2: vi.fn(async (key: string) => {
    r2.deleted.push(key)
    r2.uploaded.delete(key)
  }),
  getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.example.com/${key}?sig=1`),
}))

import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { auditLog, prospects, prospectTasks, prospectVoiceNotes, roles, users } from '../../shared/db/schema/index.js'
import { createTestUser } from '../../shared/testing/users.js'
import * as health from './health-service.js'
import { prospectTimeline } from './service.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const AGENT = ['clienti.view', 'clienti.prospectare']
const userIds: string[] = []
const roleIds: string[] = []
const prospectIds: string[] = []

interface Person {
  id: string
  token: string
}

async function makePerson(label: string, kind: 'custom' | 'admin' = 'custom'): Promise<Person> {
  const [role] = await db.insert(roles).values({ name: `QA voice ${label} ${RUN}`, kind, features: kind === 'admin' ? [] : AGENT }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `voice-${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const newProspect = async (name: string, assignedUserId: string | null) => {
  const [row] = await db.insert(prospects).values({ name: `QAVN ${RUN} ${name}`, assignedUserId }).returning()
  prospectIds.push(row!.id)
  return row!.id
}

const call = (who: Person, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

// A minimal WebM header is enough: only the first bytes are inspected.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)])

function multipartBody(file: Buffer, fields: Record<string, string> = { durationSeconds: '12' }) {
  const boundary = `----vn${RUN}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="n.webm"\r\nContent-Type: audio/webm\r\n\r\n`))
  parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

const upload = (who: Person, prospectId: string, file: Buffer = WEBM, fields?: Record<string, string>) => {
  const { payload, headers } = multipartBody(file, fields)
  return app.inject({ method: 'POST', url: `/api/prospects/${prospectId}/voice-notes`, cookies: { vana_session: who.token }, headers, payload })
}

let a: Person
let b: Person
let admin: Person
let mine: string
let theirs: string

beforeAll(async () => {
  a = await makePerson('a')
  b = await makePerson('b')
  admin = await makePerson('admin', 'admin')
  mine = await newProspect('mine', a.id)
  theirs = await newProspect('theirs', b.id)
  Object.assign(config.r2, { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucketName: 'bucket' })
})

beforeEach(() => {
  r2.uploaded.clear()
  r2.deleted.length = 0
})

afterAll(async () => {
  if (prospectIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, prospectIds))
    await db.update(prospects).set({ mergedIntoId: null }).where(inArray(prospects.id, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  }
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
})

describe('a prospect the agent cannot see', () => {
  it('answers 404 on every voice route', async () => {
    const [note] = await db
      .insert(prospectVoiceNotes)
      .values({ prospectId: theirs, authorUserId: b.id, r2Key: `prospect-voice/${randomUUID()}.webm`, mime: 'audio/webm', sizeBytes: 10, durationSeconds: 3 })
      .returning()
    const base = `/api/prospects/${theirs}/voice-notes`
    expect((await call(a, 'GET', base)).statusCode).toBe(404)
    expect((await upload(a, theirs)).statusCode).toBe(404)
    expect((await call(a, 'PATCH', `${base}/${note!.id}`, { caption: 'x' })).statusCode).toBe(404)
    expect((await call(a, 'DELETE', `${base}/${note!.id}`)).statusCode).toBe(404)
    expect((await call(a, 'GET', `${base}/${note!.id}/audio`)).statusCode).toBe(404)
    expect(r2.uploaded.size).toBe(0)
  })

  it('and a note of another prospect is 404 even on a visible one', async () => {
    const [note] = await db
      .insert(prospectVoiceNotes)
      .values({ prospectId: theirs, authorUserId: b.id, r2Key: `prospect-voice/${randomUUID()}.webm`, mime: 'audio/webm', sizeBytes: 10, durationSeconds: 3 })
      .returning()
    expect((await call(a, 'GET', `/api/prospects/${mine}/voice-notes/${note!.id}/audio`)).statusCode).toBe(404)
    expect((await call(a, 'DELETE', `/api/prospects/${mine}/voice-notes/${note!.id}`)).statusCode).toBe(404)
  })
})

describe('upload', () => {
  it('stores audio under prospect-voice/ with the sniffed mime and lists it', async () => {
    const res = await upload(a, mine, WEBM, { durationSeconds: '5000', caption: 'after the call' })
    expect(res.statusCode).toBe(201)
    const created = res.json().data
    expect(created.durationSeconds).toBe(900)
    expect(created.mime).toBe('audio/webm')
    const [row] = await db.select().from(prospectVoiceNotes).where(eq(prospectVoiceNotes.id, created.id))
    expect(row!.r2Key).toMatch(/^prospect-voice\/[0-9a-f-]{36}\.webm$/)
    expect(r2.uploaded.get(row!.r2Key)).toBe(WEBM.length)

    const list = await call(a, 'GET', `/api/prospects/${mine}/voice-notes`)
    expect(list.json().data).toHaveLength(1)
    expect(list.json().data[0].canManage).toBe(true)

    const audio = await call(a, 'GET', `/api/prospects/${mine}/voice-notes/${created.id}/audio`)
    expect(audio.statusCode).toBe(302)
    expect(audio.headers.location).toContain(row!.r2Key)
  })

  it('refuses a PNG with 415 and leaves nothing in R2', async () => {
    const res = await upload(a, mine, PNG)
    expect(res.statusCode).toBe(415)
    expect(res.json().code).toBe('VOICE_UNSUPPORTED')
    expect(r2.uploaded.size).toBe(0)
  })

  it('refuses more than 25 MB with 413 and removes the cut-off object', async () => {
    const res = await upload(a, mine, Buffer.concat([WEBM, Buffer.alloc(25 * 1024 * 1024)]))
    expect(res.statusCode).toBe(413)
    expect(r2.uploaded.size).toBe(0)
    expect(r2.deleted).toHaveLength(1)
  })

  it('rejects a task of another prospect with 400', async () => {
    const [task] = await db.insert(prospectTasks).values({ prospectId: theirs, assigneeUserId: b.id, kind: 'call', title: 'x', dueAt: new Date() }).returning()
    const res = await upload(a, mine, WEBM, { durationSeconds: '3', taskId: task!.id })
    expect(res.statusCode).toBe(400)
  })

  it('answers 503 VOICE_STORAGE_OFF without R2 keys', async () => {
    const saved = { ...config.r2 }
    Object.assign(config.r2, { bucketName: '' })
    const res = await upload(a, mine)
    Object.assign(config.r2, saved)
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('VOICE_STORAGE_OFF')
  })
})

describe('caption and delete', () => {
  it('lets the author and an admin, not another agent', async () => {
    // B sees `mine` through collaboration-free means: make it visible by leaving it unassigned.
    const shared = await newProspect('shared', null)
    const made = (await upload(a, shared)).json().data.id as string
    const url = `/api/prospects/${shared}/voice-notes/${made}`

    expect((await call(b, 'PATCH', url, { caption: 'mine now' })).statusCode).toBe(403)
    expect((await call(b, 'DELETE', url)).statusCode).toBe(403)
    expect(r2.deleted).toHaveLength(0)

    expect((await call(a, 'PATCH', url, { caption: 'fixed' })).statusCode).toBe(200)
    expect((await call(a, 'DELETE', url)).statusCode).toBe(200)
    expect(r2.deleted).toHaveLength(1)
    expect((await call(a, 'GET', `/api/prospects/${shared}/voice-notes`)).json().data).toHaveLength(0)

    const second = (await upload(a, shared)).json().data.id as string
    expect((await call(admin, 'DELETE', `/api/prospects/${shared}/voice-notes/${second}`)).statusCode).toBe(200)
    expect(r2.deleted).toHaveLength(2)
  })
})

describe('timeline and merge', () => {
  it('shows a voice entry in the timeline', async () => {
    const prospectId = await newProspect('timeline', a.id)
    await upload(a, prospectId, WEBM, { durationSeconds: '8', caption: 'hi' })
    const me = await createTestUser('tl', userIds, { features: [...AGENT, 'clienti.toti'] })
    const timeline = await prospectTimeline(me, prospectId)
    const voice = timeline!.entries.find((e) => e.kind === 'voice')
    expect(voice).toBeTruthy()
    expect(voice!.data).toMatchObject({ durationSeconds: 8, caption: 'hi' })
  })

  it('moves voice notes to the master and counts them in the preview', async () => {
    const master = await newProspect('merge-m', a.id)
    const other = await newProspect('merge-o', a.id)
    await upload(a, other)
    const me = await createTestUser('mg', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
    const preview = await health.previewMerge(me, master, other)
    expect(preview!.moves.voiceNotes).toBe(1)
    await health.mergeProspects(me, master, other, {})
    const rows = await db.select().from(prospectVoiceNotes).where(eq(prospectVoiceNotes.prospectId, master))
    expect(rows).toHaveLength(1)
  })
})
