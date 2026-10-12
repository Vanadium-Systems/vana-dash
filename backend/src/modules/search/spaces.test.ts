/**
 * Ctrl K pe Arhivă și Calendar (Wave 6): grupele trec prin filtrul de acces al modulului lor,
 * deci un fișier sau un eveniment din spațiul altcuia nu apare nici aici. pg real.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders, calendarEvents } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'

vi.mock('../../shared/lib/r2.js', () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  downloadFromR2: vi.fn().mockResolvedValue(Buffer.from('bytes')),
  getPresignedDownloadUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned-fake'),
  uploadToR2: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../shared/lib/thumbnail.js', () => ({
  generatePdfThumbnail: vi.fn().mockResolvedValue(null),
}))

const archive = await import('../archive/service.js')
const calendar = await import('../calendar/service.js')
const { search } = await import('./service.js')

const marker = `qa-ctrlk-${Math.random().toString(36).slice(2)}`
const userIds: string[] = []
const eventIds: string[] = []
const features = ['cautare.view', 'arhiva.view', 'calendar.view']

const stefan = await createTestUser('ctrlk stefan', userIds, { features })
const ana = await createTestUser('ctrlk ana', userIds, { features })
const fara = await createTestUser('ctrlk fără arhivă', userIds, { features: ['cautare.view'] })

afterAll(async () => {
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  const folders = await db
    .select({ id: archiveFolders.id })
    .from(archiveFolders)
    .where(inArray(archiveFolders.ownerUserId, userIds))
  const ids = folders.map((f) => f.id)
  if (ids.length) {
    await db.delete(archiveFiles).where(inArray(archiveFiles.folderId, ids))
    await db.delete(archiveFolders).where(inArray(archiveFolders.id, ids))
  }
  await cleanupTestUsers(userIds)
})

const contracte = (await archive.createFolder(stefan, 'Contracte'))!
await archive.createFileRecord(stefan, {
  folderId: contracte.id,
  name: `Contract ${marker}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 10,
  r2Key: `archive/${marker}`,
  tags: [],
})
const start = new Date('2026-07-20T21:30:00.000Z')
const event = (await calendar.createEvent(stefan, {
  title: `Întâlnire ${marker}`,
  startAt: start,
  endAt: new Date(start.getTime() + 60 * 60 * 1000),
}))!
eventIds.push(event.id)

const groupsOf = async (me: typeof stefan) => (await search(me, marker)).map((g) => g.group).sort()

describe('Ctrl K — Arhivă și Calendar', () => {
  it('proprietarul își găsește fișierul și evenimentul, cu drumul folderului și ziua din București', async () => {
    const groups = await search(stefan, marker)
    const file = groups.find((g) => g.group === 'Arhivă')!.items[0]!
    expect(file.to).toBe(`/archive?folder=${contracte.id}`)
    expect(file.sublabel).toContain('Contracte')
    const ev = groups.find((g) => g.group === 'Calendar')!.items[0]!
    // 21:30 UTC e deja 21 iulie la București.
    expect(ev.to).toBe('/calendar?date=2026-07-21')
    expect(ev.sublabel).not.toContain(stefan.displayName!)
  })

  it('un coleg fără share nu vede nici fișierul, nici evenimentul', async () => {
    expect(await groupsOf(ana)).toEqual([])
  })

  it('după share, apar amândouă, iar evenimentul poartă numele proprietarului', async () => {
    await archive.setShare(stefan, contracte.id, ana.id, 'view')
    await calendar.setCalendarShare(stefan, stefan.id, ana.id, 'view')
    const groups = await search(ana, marker)
    expect(groups.map((g) => g.group).sort()).toEqual(['Arhivă', 'Calendar'])
    expect(groups.find((g) => g.group === 'Calendar')!.items[0]!.sublabel).toContain(stefan.displayName!)
  })

  it('fără arhiva.view / calendar.view, grupele nu se interoghează deloc', async () => {
    expect(await groupsOf(fara)).toEqual([])
  })
})
