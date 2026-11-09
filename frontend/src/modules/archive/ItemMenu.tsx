import {
  CalendarClock,
  Download,
  FolderInput,
  FolderOpen,
  Info,
  MessageSquareShare,
  MoreVertical,
  Palette,
  Pencil,
  Share2,
  Star,
  StarOff,
  Trash2,
  Users,
} from 'lucide-react'
import { ContextMenu, type useContextMenu } from '@/shared/components/ui/context-menu'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuShortcut } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { ArchiveItem } from './items'

/** What the page can do with rows; the rows, the grid, the menus and the shortcuts all call these. */
export interface ItemActions {
  open: (item: ArchiveItem) => void
  download: (items: ArchiveItem[]) => void
  rename: (item: ArchiveItem) => void
  move: (items: ArchiveItem[]) => void
  toggleStar: (items: ArchiveItem[]) => void
  trash: (items: ArchiveItem[]) => void
  details: (item: ArchiveItem) => void
  share: (item: ArchiveItem) => void
  sendToMessages: (item: ArchiveItem) => void
  sendNative: (item: ArchiveItem) => void
  toggleMonthly: (item: ArchiveItem) => void
  pickColor: (item: ArchiveItem) => void
  showLocation: (item: ArchiveItem) => void
  /** Messages feature on, and a Web Share / native share sheet available. */
  canSendToMessages: boolean
  canSendNative: boolean
}

export function ItemMenuItems({ targets, actions }: { targets: ArchiveItem[]; actions: ItemActions }) {
  const [item] = targets
  if (!item) return null
  const writable = targets.every((target) => target.canWrite)
  const allStarred = targets.every((target) => target.starred)
  const deleteItem = (
    <DropdownMenuItem destructive onClick={() => actions.trash(targets)}>
      <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
      <MenuShortcut>{t('common:keys.delete')}</MenuShortcut>
    </DropdownMenuItem>
  )
  const starItem = (
    <DropdownMenuItem onClick={() => actions.toggleStar(targets)}>
      {allStarred ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
      {allStarred ? t('archive:menu.unstar') : t('archive:menu.star')}
      <MenuShortcut>S</MenuShortcut>
    </DropdownMenuItem>
  )

  if (targets.length > 1) {
    return (
      <>
        <DropdownMenuItem onClick={() => actions.download(targets)}>
          <Download className="h-4 w-4" /> {t('common:actions.download')}
        </DropdownMenuItem>
        {writable ? (
          <DropdownMenuItem onClick={() => actions.move(targets)}>
            <FolderInput className="h-4 w-4" /> {t('common:actions.move')}
            <MenuShortcut>M</MenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {starItem}
        {writable ? (
          <>
            <DropdownMenuSeparator />
            {deleteItem}
          </>
        ) : null}
      </>
    )
  }

  const isFile = item.kind === 'file'
  return (
    <>
      <DropdownMenuItem onClick={() => actions.open(item)}>
        <FolderOpen className="h-4 w-4" /> {isFile ? t('archive:menu.preview') : t('archive:folders.open')}
        <MenuShortcut>{t('common:keys.enter')}</MenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => actions.download([item])}>
        <Download className="h-4 w-4" /> {isFile ? t('common:actions.download') : t('archive:actions.downloadZip')}
      </DropdownMenuItem>
      {item.location ? (
        <DropdownMenuItem onClick={() => actions.showLocation(item)}>
          <FolderOpen className="h-4 w-4" /> {t('archive:menu.showLocation')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {item.canWrite ? (
        <>
          <DropdownMenuItem onClick={() => actions.rename(item)}>
            <Pencil className="h-4 w-4" /> {t('common:actions.rename')}
            <MenuShortcut>F2</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.move([item])}>
            <FolderInput className="h-4 w-4" /> {t('common:actions.move')}
            <MenuShortcut>M</MenuShortcut>
          </DropdownMenuItem>
          {!isFile ? (
            <>
              <DropdownMenuItem onClick={() => actions.pickColor(item)}>
                <Palette className="h-4 w-4" /> {t('archive:menu.color')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.toggleMonthly(item)}>
                <CalendarClock className="h-4 w-4" />
                {item.autoMonthlySubfolders ? t('archive:folders.monthlyDisable') : t('archive:folders.monthlyEnable')}
              </DropdownMenuItem>
            </>
          ) : null}
        </>
      ) : null}
      {starItem}
      <DropdownMenuItem onClick={() => actions.details(item)}>
        <Info className="h-4 w-4" /> {t('archive:menu.details')}
        <MenuShortcut>I</MenuShortcut>
      </DropdownMenuItem>
      {item.canShare ? (
        <DropdownMenuItem onClick={() => actions.share(item)}>
          <Users className="h-4 w-4" /> {t('common:actions.share')}
        </DropdownMenuItem>
      ) : null}
      {isFile && actions.canSendToMessages ? (
        <DropdownMenuItem onClick={() => actions.sendToMessages(item)}>
          <MessageSquareShare className="h-4 w-4" /> {t('messages:share.action')}
        </DropdownMenuItem>
      ) : null}
      {isFile && actions.canSendNative ? (
        <DropdownMenuItem onClick={() => actions.sendNative(item)}>
          <Share2 className="h-4 w-4" /> {t('common:actions.send')}
        </DropdownMenuItem>
      ) : null}
      {item.canWrite ? (
        <>
          <DropdownMenuSeparator />
          {deleteItem}
        </>
      ) : null}
    </>
  )
}

/** The ⋯ of a row or card: a dropdown on a desktop, a bottom sheet titled with the name on a phone. */
export function ItemMenu({ targets, actions, title, className }: { targets: ArchiveItem[]; actions: ItemActions; title: string; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn('touch-target inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent', className)}>
        <MoreVertical className="h-4 w-4" />
        <span className="sr-only">{t('common:labels.actions')}</span>
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={title}>
        <ItemMenuItems targets={targets} actions={actions} />
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}

export function ItemContextMenu({ state, targets, actions }: { state: ReturnType<typeof useContextMenu>; targets: ArchiveItem[]; actions: ItemActions }) {
  return (
    <ContextMenu state={state}>
      <ItemMenuItems targets={targets} actions={actions} />
    </ContextMenu>
  )
}
