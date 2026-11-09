import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { DragEvent } from 'react'
import type { ArchiveItem } from './items'
import { carriesFiles, type ListEnv } from './list-env'

/**
 * Both kinds of dragging on one row or card. dnd-kit moves items already in the Archive (it starts
 * after 6px, so a click stays a click); files from the desktop arrive as native drag events and
 * are told apart by `Files` in the data types. Only a folder the person can write to takes a drop.
 */
export function useItemDnd(item: ArchiveItem, env: ListEnv) {
  const isFolder = item.kind === 'folder'
  const drag = useDraggable({ id: item.id, disabled: !env.draggable || !item.canWrite })
  const drop = useDroppable({ id: item.id, disabled: !isFolder || !item.canWrite })
  const takesFiles = isFolder && item.canWrite && env.fileDrop !== null

  const osDrop = takesFiles
    ? {
        onDragEnter: (e: DragEvent) => {
          if (carriesFiles(e)) env.fileDrop?.over(item.id)
        },
        onDragOver: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          e.preventDefault()
          e.stopPropagation()
          env.fileDrop?.over(item.id)
        },
        onDrop: (e: DragEvent) => {
          if (!carriesFiles(e)) return
          e.preventDefault()
          e.stopPropagation()
          env.fileDrop?.drop(Array.from(e.dataTransfer.files), item.id)
        },
      }
    : {}

  return {
    ref: (node: HTMLElement | null) => {
      drag.setNodeRef(node)
      drop.setNodeRef(node)
    },
    listeners: drag.listeners,
    isDragging: drag.isDragging,
    dropLit: drop.isOver || env.osDropFolderId === item.id,
    osDrop,
  }
}
