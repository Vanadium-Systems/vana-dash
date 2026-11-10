/**
 * GET /api/archive/storage-usage over HTTP with a real DB; R2 is never touched (rows are inserted
 * directly). The bucket is shared with other test files, so totals are checked as deltas and
 * people/folders by the ids created here.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import {
  archiveFiles,
  archiveFolders,
  messageAttachments,
  prospects,
  prospectVoiceNotes,
  roles,
  users,
} from '../../shared/db/schema/index.js'
import { assertStorageAvailable, StorageFullError, storageUsage } from '../../shared/lib/storage-quota.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const userIds: string[] = []
const roleIds: string[] = []
const folderIds: string[] = []
const prospectIds: string[] = []

async function makePerson(label: string, kind: 'custom' | 'admin', features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA spatiu ${label} ${RUN}`, kind, features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `spatiu-${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label} ${RUN}`, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, name: row!.displayName!, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

afterAll(async () => {
  if (folderIds.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, folderIds))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, folderIds))
  }
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (userIds.length) {
    await db.delete(messageAttachments).where(inArray(messageAttachments.uploadedByUserId, userIds))
    await db.delete(users).where(inArray(users.id, userIds))
  }
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
})

describe('storage usage', async () => {
  const admin = await makePerson('admin', 'admin', [])
  const viewer = await makePerson('viewer', 'custom', ['arhiva.view'])
  const ana = await makePerson('ana', 'custom', [])
  const bob = await makePerson('bob', 'custom', [])

  const before = await storageUsage()

  const [anaRoot] = await db.insert(archiveFolders).values({ name: `Ana ${RUN}`, ownerUserId: ana.id }).returning()
  const [anaSub] = await db.insert(archiveFolders).values({ name: `Ana sub ${RUN}`, parentId: anaRoot!.id, ownerUserId: ana.id }).returning()
  const [bobRoot] = await db.insert(archiveFolders).values({ name: `Bob ${RUN}`, ownerUserId: bob.id }).returning()
  folderIds.push(anaRoot!.id, anaSub!.id, bobRoot!.id)
  const file = (folderId: string, sizeBytes: number) => ({ folderId, name: 'f.bin', mimeType: 'application/octet-stream', sizeBytes, r2Key: `archive/qa-spatiu-${randomUUID()}` })
  await db.insert(archiveFiles).values([file(anaRoot!.id, 1_000_000), file(anaSub!.id, 500_000), file(bobRoot!.id, 200_000)])
  // A soft-deleted archive file still sits in R2, so it counts.
  await db.insert(archiveFiles).values({ ...file(bobRoot!.id, 3_000), deletedAt: new Date() })

  const [prospect] = await db.insert(prospects).values({ name: `QASP ${RUN}` }).returning()
  prospectIds.push(prospect!.id)
  const note = (authorUserId: string | null, sizeBytes: number) => ({ prospectId: prospect!.id, authorUserId, r2Key: `prospect-voice/${randomUUID()}.webm`, mime: 'audio/webm', sizeBytes, durationSeconds: 10 })
  await db.insert(prospectVoiceNotes).values([note(ana.id, 40_000), note(null, 7_000), { ...note(bob.id, 99_000), deletedAt: new Date() }])

  const attachment = (uploadedByUserId: string, sizeBytes: number) => ({ uploadedByUserId, storagePath: `chat/qa-spatiu-${randomUUID()}`, filename: 'a.png', contentType: 'image/png', sizeBytes })
  await db.insert(messageAttachments).values([attachment(bob.id, 60_000), { ...attachment(bob.id, 77_000), deletedAt: new Date() }])

  async function fetchUsage(token: string) {
    const res = await app.inject({ method: 'GET', url: '/api/archive/storage-usage', cookies: { vana_session: token } })
    return { status: res.statusCode, body: res.json() }
  }

  it('sums by source, person and folder', async () => {
    const after = await storageUsage()
    const delta = (source: string) => {
      const a = after.bySource.find((s) => s.source === source)!
      const b = before.bySource.find((s) => s.source === source)!
      return { bytes: a.bytes - b.bytes, files: a.files - b.files }
    }
    expect(delta('arhiva')).toEqual({ bytes: 1_703_000, files: 4 })
    expect(delta('note_vocale')).toEqual({ bytes: 47_000, files: 2 })
    expect(delta('mesaje')).toEqual({ bytes: 60_000, files: 1 })
    expect(after.usedBytes - before.usedBytes).toBe(1_810_000)
    expect(after.uncounted).toEqual(['quarterly-packages'])

    const person = (id: string) => after.byPerson.find((p) => p.userId === id)!
    expect(person(ana.id)).toMatchObject({ name: ana.name, bytes: 1_540_000, bySource: { arhiva: 1_500_000, note_vocale: 40_000, mesaje: 0 } })
    expect(person(bob.id)).toMatchObject({ bytes: 263_000, bySource: { arhiva: 203_000, note_vocale: 0, mesaje: 60_000 } })
    const system = after.byPerson.find((p) => p.userId === null)!
    expect(system.name).toBeNull()
    expect(system.bySource.note_vocale).toBeGreaterThanOrEqual(7_000)

    const folder = (id: string) => after.topFolders.find((f) => f.folderId === id)
    expect(folder(anaRoot!.id)).toMatchObject({ name: `Ana ${RUN}`, ownerName: ana.name, bytes: 1_000_000, files: 1 })
    expect(folder(anaSub!.id)).toMatchObject({ ownerName: ana.name, bytes: 500_000, files: 1 })
    expect(after.topFolders.length).toBeLessThanOrEqual(10)
  })

  it('counts message attachments in the quota', async () => {
    const used = (await storageUsage()).usedBytes
    const err = await assertStorageAvailable(Number.MAX_SAFE_INTEGER).catch((e) => e)
    expect(err).toBeInstanceOf(StorageFullError)
    expect((err as StorageFullError).usedBytes).toBeGreaterThanOrEqual(used - 1_000_000)
    const bobUsed = (await storageUsage()).byPerson.find((p) => p.userId === bob.id)!
    expect(bobUsed.bySource.mesaje).toBe(60_000)
    await db.delete(messageAttachments).where(eq(messageAttachments.uploadedByUserId, bob.id))
    const afterDelete = (await storageUsage()).byPerson.find((p) => p.userId === bob.id)!
    expect(afterDelete.bySource.mesaje).toBe(0)
  })

  it('is closed without arhiva.spatiu and open for the admin', async () => {
    expect((await fetchUsage(viewer.token)).status).toBe(403)
    const res = await fetchUsage(admin.token)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ uncounted: ['quarterly-packages'] })
    expect(res.body.data.bySource.map((s: { source: string }) => s.source)).toEqual(['arhiva', 'note_vocale', 'mesaje'])
  })
})
