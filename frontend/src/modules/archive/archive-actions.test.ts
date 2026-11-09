import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/shared/lib/api'
import { undoToast } from '@/shared/lib/undo-toast'
import { moveItems, trashItems, trashMessage } from './archive-actions'
import type { ArchiveItem } from './items'

vi.mock('@/shared/lib/api', () => ({
  api: { delete: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}))
vi.mock('@/shared/lib/undo-toast', () => ({ undoToast: vi.fn(async () => true) }))

const item = (kind: 'file' | 'folder', id: string, name: string): ArchiveItem => ({
  kind,
  id,
  name,
  mimeType: '',
  sizeBytes: 0,
  updatedAt: null,
  previewUrl: null,
  tags: [],
  color: null,
  starred: false,
  fileCount: 0,
  subfolderCount: 0,
  canWrite: true,
  canShare: false,
  ownerUserId: null,
  autoMonthlySubfolders: false,
  location: null,
})

const batch = (batchId: string, itemCount: number) => ({ batchId, itemCount, totalBytes: 10 })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('trashMessage', () => {
  it('names the item, and the rest of a folder', () => {
    const folder = item('folder', 'f1', 'Facturi 2025')
    expect(trashMessage([folder], [batch('b1', 1)])).toBe('„Facturi 2025” mutat în Coș')
    expect(trashMessage([folder], [batch('b1', 35)])).toBe('„Facturi 2025” și 34 de elemente mutate în Coș')
  })

  it('counts everything when several rows go at once', () => {
    const rows = [item('file', 'a', 'a.pdf'), item('folder', 'b', 'B')]
    expect(trashMessage(rows, [batch('b1', 1), batch('b2', 4)])).toBe('5 elemente mutate în Coș')
  })
})

describe('trashItems', () => {
  it('goes through the undo toast, with no dialog before', async () => {
    await trashItems([item('file', 'f1', 'a.pdf')], vi.fn())
    expect(undoToast).toHaveBeenCalledTimes(1)
    expect(api.delete).not.toHaveBeenCalled() // nothing happens until the toast runs its effect
  })

  it('deletes one row on its own route and undoes by restoring its batch', async () => {
    vi.mocked(api.delete).mockResolvedValue(batch('b1', 1))
    const invalidate = vi.fn()
    await trashItems([item('file', 'f1', 'a.pdf')], invalidate)
    const [message, effect, undo] = vi.mocked(undoToast).mock.calls[0]!

    const batches = (await effect()) as ReturnType<typeof batch>[]
    expect(api.delete).toHaveBeenCalledWith('/api/archive/files/f1')
    expect(typeof message === 'function' ? message(batches as never) : message).toBe('„a.pdf” mutat în Coș')

    await undo(batches as never)
    expect(api.post).toHaveBeenCalledWith('/api/archive/trash/b1/restore')
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('sends several rows to the bulk route and restores every batch on undo', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ batches: [batch('b1', 1), batch('b2', 3)] })
    await trashItems([item('file', 'f1', 'a.pdf'), item('folder', 'd1', 'D')], vi.fn())
    const [, effect, undo] = vi.mocked(undoToast).mock.calls[0]!

    const batches = (await effect()) as ReturnType<typeof batch>[]
    expect(api.post).toHaveBeenCalledWith('/api/archive/bulk/delete', {
      items: [
        { type: 'file', id: 'f1' },
        { type: 'folder', id: 'd1' },
      ],
    })
    await undo(batches as never)
    expect(api.post).toHaveBeenCalledWith('/api/archive/trash/b1/restore')
    expect(api.post).toHaveBeenCalledWith('/api/archive/trash/b2/restore')
  })
})

describe('moveItems', () => {
  it('undoes with the locations the server reported', async () => {
    const previous = [{ type: 'file', id: 'f1', folderId: 'old' }]
    vi.mocked(api.post).mockResolvedValueOnce({ moved: 1, previous })
    await moveItems([item('file', 'f1', 'a.pdf')], { id: 'new', name: 'Contracte' }, vi.fn())
    const [message, effect, undo] = vi.mocked(undoToast).mock.calls[0]!
    expect(message).toBe('„a.pdf” mutat în „Contracte”')

    const result = await effect()
    expect(api.post).toHaveBeenCalledWith('/api/archive/bulk/move', { items: [{ type: 'file', id: 'f1' }], targetFolderId: 'new' })
    await undo(result as never)
    expect(api.post).toHaveBeenLastCalledWith('/api/archive/bulk/put-back', { previous })
  })
})
