/**
 * POST /api/archive/files over HTTP with a real DB; R2 is mocked. The write check on the target
 * folder has to come before anything is stored in the bucket.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders, roles, users } from '../../shared/db/schema/index.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  deleteManyFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockImplementation(async (_key: string, stream: NodeJS.ReadableStream) => {
    for await (const _chunk of stream) void _chunk
  }),
}))

const { buildServer } = await import('../../app.js')
const { deleteFromR2, uploadToR2 } = await import('../../shared/lib/r2.js')
const { createFolder } = await import('./service.js')

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []

async function makePerson(label: string) {
  const [role] = await db
    .insert(roles)
    .values({ name: `QA upload ${label} ${RUN}`, kind: 'custom', features: ['arhiva.view', 'arhiva.editare'] })
    .returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `upload-${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label} ${RUN}`, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  const token = await app.jwt.sign({ sub: row!.id, sv: 1 })
  const me = {
    id: row!.id,
    email: row!.email,
    displayName: row!.displayName,
    role: { id: role!.id, name: role!.name, kind: role!.kind },
    isPlatformAdmin: false,
    features: ['arhiva.view', 'arhiva.editare'],
    mailboxes: [],
    status: 'active',
    lastSeenAt: null,
    notificationPrefs: null,
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    displayCurrency: 'RON',
    sessionVersion: 1,
  } as unknown as Parameters<typeof createFolder>[0]
  return { me, token }
}

function multipart(fields: Record<string, string>, filename: string, content: string) {
  const boundary = `----qa${RUN}`
  const parts = Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`)
  return { payload: parts.join(''), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

afterAll(async () => {
  const folders = await db.select({ id: archiveFolders.id }).from(archiveFolders).where(inArray(archiveFolders.ownerUserId, userIds))
  const ids = folders.map((f) => f.id)
  if (ids.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, ids))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, ids))
  }
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

describe('POST /api/archive/files', () => {
  it('refuses a folder of someone else with 404 and stores nothing in R2', async () => {
    const owner = await makePerson('owner')
    const intruder = await makePerson('intruder')
    const foreign = (await createFolder(owner.me, 'Privat'))!
    vi.mocked(uploadToR2).mockClear()

    const body = multipart({ folderId: foreign.id }, 'nota.txt', 'continut')
    const res = await app.inject({ method: 'POST', url: '/api/archive/files', headers: body.headers, cookies: { vana_session: intruder.token }, payload: body.payload })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('ARCHIVE_NOT_FOUND')
    expect(uploadToR2).not.toHaveBeenCalled()
  })

  it('refuses a folder that does not exist with 404 and stores nothing in R2', async () => {
    const person = await makePerson('missing')
    vi.mocked(uploadToR2).mockClear()
    const body = multipart({ folderId: randomUUID() }, 'nota.txt', 'continut')
    const res = await app.inject({ method: 'POST', url: '/api/archive/files', headers: body.headers, cookies: { vana_session: person.token }, payload: body.payload })
    expect(res.statusCode).toBe(404)
    expect(uploadToR2).not.toHaveBeenCalled()
  })

  it('stores a file in the own space', async () => {
    const person = await makePerson('own')
    vi.mocked(deleteFromR2).mockClear()
    const body = multipart({}, 'nota.txt', 'continut')
    const res = await app.inject({ method: 'POST', url: '/api/archive/files', headers: body.headers, cookies: { vana_session: person.token }, payload: body.payload })
    expect(res.statusCode).toBe(200)
    expect(uploadToR2).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(archiveFiles).where(eq(archiveFiles.id, res.json().data.id))
    expect(row?.name).toBe('nota.txt')
    expect(deleteFromR2).not.toHaveBeenCalled()
  })
})
