import { eq } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { archiveFiles, archiveFolders } from '../../shared/db/schema/index.js'
import { tr } from '../../shared/lib/i18n.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { EDIT_ACCESS, folderAccessLevel } from './access.js'
import { ArchiveConflictError, ArchiveNotFoundError, requireFile, requireFolder, wouldCreateCycle } from './service.js'
import type { BulkItem } from './trash.js'

export interface PlacedItem extends BulkItem {
  folderId: string
}

/**
 * Moves every item to its own destination, or none: each item and each destination is checked
 * before the first write. The answer carries where each item was, which is what undo sends back.
 */
async function moveItems(me: SessionUser, moves: PlacedItem[]) {
  const previous: PlacedItem[] = []
  const checked: PlacedItem[] = []
  for (const move of moves) {
    const target = await requireFolder(me, move.folderId, EDIT_ACCESS).catch(() => {
      throw new ArchiveNotFoundError(move.folderId)
    })
    if (move.type === 'file') {
      const file = await requireFile(me, move.id, EDIT_ACCESS).catch(() => {
        throw new ArchiveNotFoundError(move.id)
      })
      previous.push({ type: 'file', id: file.id, folderId: file.folderId })
    } else {
      const folder = await requireFolder(me, move.id, EDIT_ACCESS).catch(() => {
        throw new ArchiveNotFoundError(move.id)
      })
      // Same rule as deleting: taking a folder out of its parent needs the right on the parent.
      if (!folder.parentId || (await folderAccessLevel(me, folder.parentId)) < EDIT_ACCESS) {
        throw new ArchiveNotFoundError(move.id)
      }
      if (folder.id === target.id || (await wouldCreateCycle(folder.id, target.id))) {
        throw new ArchiveConflictError(tr('errors.archive.moveCycle'))
      }
      if (folder.ownerUserId !== target.ownerUserId) throw new ArchiveConflictError(tr('errors.archive.moveToOtherSpace'))
      previous.push({ type: 'folder', id: folder.id, folderId: folder.parentId })
    }
    checked.push(move)
  }

  await db.transaction(async (tx) => {
    const now = new Date()
    for (const move of checked) {
      if (move.type === 'file') {
        await tx.update(archiveFiles).set({ folderId: move.folderId, updatedAt: now }).where(eq(archiveFiles.id, move.id))
      } else {
        await tx.update(archiveFolders).set({ parentId: move.folderId, updatedAt: now }).where(eq(archiveFolders.id, move.id))
      }
    }
  })
  return { moved: checked.length, previous }
}

export async function bulkMove(me: SessionUser, items: BulkItem[], targetFolderId: string) {
  return moveItems(
    me,
    items.map((item) => ({ ...item, folderId: targetFolderId })),
  )
}

/** Undo of a move: every item back to the folder `bulkMove` reported. */
export async function putBack(me: SessionUser, previous: PlacedItem[]) {
  return moveItems(me, previous)
}
