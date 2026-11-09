import type { MouseEvent } from 'react'
import type { ArchiveItem, } from './items'
import type { ItemActions } from './ItemMenu'

/** What a row or a card needs from the page: state of the selection and the handlers. */
export interface ListEnv {
  actions: ItemActions
  selectedIds: Set<string>
  focusId: string | null
  /** The search text, to highlight in names. */
  query: string
  /** A right click or ⋯ on a selected row acts on the whole selection. */
  targetsFor: (item: ArchiveItem) => ArchiveItem[]
  onActivate: (e: MouseEvent, item: ArchiveItem) => void
  onToggle: (id: string) => void
  longPress: { start: (id: string) => void; cancel: () => void }
  /** Mouse only: touch has long press for selecting and no room for drag. */
  draggable: boolean
  /** The folder row a file from the desktop hovers over, to light it up. */
  osDropFolderId: string | null
  fileDrop: {
    over: (folderId: string | null) => void
    drop: (files: File[], folderId: string) => void
  } | null
}

export const carriesFiles = (e: { dataTransfer: DataTransfer | null }) => Boolean(e.dataTransfer?.types.includes('Files'))
