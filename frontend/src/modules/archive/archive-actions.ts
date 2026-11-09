import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { undoToast } from '@/shared/lib/undo-toast'
import type { ArchiveBulkPrevious, ArchiveFile, ArchiveFolder, ArchiveTrashResult } from '@/shared/lib/types'
import type { ArchiveItem } from './items'

// The Archive's writes, each as an action with an "Undo" in its toast. Nothing asks first: a delete
// goes to the Trash, a move and a rename have their exact opposite.

const asRef = (item: ArchiveItem) => ({ type: item.kind, id: item.id })
const route = (item: ArchiveItem) => `/api/archive/${item.kind === 'file' ? 'files' : 'folders'}/${item.id}`

export function trashMessage(items: ArchiveItem[], batches: ArchiveTrashResult[]): string {
  const total = batches.reduce((sum, batch) => sum + batch.itemCount, 0)
  const [only] = items
  if (only && items.length === 1) {
    return total > 1 ? t('archive:toasts.trashedWith', { name: only.name, count: total - 1 }) : t('archive:toasts.trashed', { name: only.name })
  }
  return t('archive:toasts.trashedMany', { count: total })
}

export function trashItems(items: ArchiveItem[], invalidate: () => void): Promise<boolean> {
  return undoToast<ArchiveTrashResult[]>(
    (batches) => trashMessage(items, batches),
    async () => {
      const [only] = items
      const batches =
        only && items.length === 1
          ? [await api.delete<ArchiveTrashResult>(route(only))]
          : (await api.post<{ batches: ArchiveTrashResult[] }>('/api/archive/bulk/delete', { items: items.map(asRef) })).batches
      invalidate()
      return batches
    },
    async (batches) => {
      for (const batch of batches) await api.post(`/api/archive/trash/${batch.batchId}/restore`)
      invalidate()
    },
  )
}

export function moveItems(items: ArchiveItem[], target: { id: string; name: string }, invalidate: () => void): Promise<boolean> {
  const [only] = items
  return undoToast<{ moved: number; previous: ArchiveBulkPrevious[] }>(
    only && items.length === 1
      ? t('archive:toasts.moved', { name: only.name, folder: target.name })
      : t('archive:toasts.movedMany', { count: items.length, folder: target.name }),
    async () => {
      const result = await api.post<{ moved: number; previous: ArchiveBulkPrevious[] }>('/api/archive/bulk/move', {
        items: items.map(asRef),
        targetFolderId: target.id,
      })
      invalidate()
      return result
    },
    async (result) => {
      await api.post('/api/archive/bulk/put-back', { previous: result.previous })
      invalidate()
    },
  )
}

export function renameItem(item: ArchiveItem, name: string, invalidate: () => void): Promise<boolean> {
  type Renamed = (ArchiveFile | ArchiveFolder) & { previousName: string }
  return undoToast<Renamed>(
    (renamed) => t('archive:toasts.renamed', { from: renamed.previousName, to: name }),
    async () => {
      const renamed = await api.patch<Renamed>(route(item), { name })
      invalidate()
      return renamed
    },
    async (renamed) => {
      await api.patch(route(item), { name: renamed.previousName })
      invalidate()
    },
  )
}

export async function setStarred(items: Pick<ArchiveItem, 'kind' | 'id'>[], starred: boolean): Promise<void> {
  for (const item of items) {
    const path = `/api/archive/stars/${item.kind}/${item.id}`
    if (starred) await api.put(path, {})
    else await api.delete(path)
  }
}

export async function downloadItems(items: ArchiveItem[]): Promise<void> {
  for (const item of items) {
    if (item.kind === 'file') await api.download(`/api/archive/files/${item.id}/download`, item.name)
    else await api.download(`/api/archive/folders/${item.id}/download`, `${item.name}.zip`)
  }
}
