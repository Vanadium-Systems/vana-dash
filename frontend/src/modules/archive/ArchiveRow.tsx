import { Check, Download, MessageSquareShare, Users } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useContextMenu } from '@/shared/components/ui/context-menu'
import { TableCell, TableDetails, TableRow } from '@/shared/components/ui/table'
import { fileCategory, fileTypeLabel } from '@/shared/lib/file-type'
import { formatDateTime, formatListDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn, formatBytes } from '@/shared/lib/utils'
import { ItemContextMenu, ItemMenu } from './ItemMenu'
import { ItemGlyph, ItemName } from './ItemName'
import type { ArchiveItem } from './items'
import { useItemDnd } from './item-dnd'
import type { ListEnv } from './list-env'

const FINE_POINTER = '[@media(hover:hover)_and_(pointer:fine)]'

export function typeText(item: ArchiveItem): string {
  return item.kind === 'folder' ? t('archive:types.folder') : fileTypeLabel(fileCategory(item.mimeType))
}

export function sizeText(item: ArchiveItem): string {
  return item.kind === 'folder' ? t('common:count.files', { count: item.fileCount }) : formatBytes(item.sizeBytes)
}

export function ArchiveRow({ item, env }: { item: ArchiveItem; env: ListEnv }) {
  const contextMenu = useContextMenu()
  const selected = env.selectedIds.has(item.id)
  const isFolder = item.kind === 'folder'
  const targets = env.targetsFor(item)

  const dnd = useItemDnd(item, env)

  const date = item.updatedAt ? formatListDate(item.updatedAt) : ''
  const where = item.location ? (item.location.length ? item.location.map((place) => place.name).join(' / ') : t('archive:folders.root')) : null

  return (
    <TableRow
      ref={dnd.ref}
      data-row-id={item.id}
      data-selecting={env.selectedIds.size > 0 ? '' : undefined}
      aria-selected={selected}
      className={cn(
        'hover-row group cursor-pointer select-none',
        selected && 'bg-muted',
        env.focusId === item.id && 'ring-1 ring-inset ring-ring',
        dnd.dropLit && 'bg-accent',
        dnd.isDragging && 'opacity-50',
      )}
      onClick={(e) => env.onActivate(e, item)}
      onContextMenu={contextMenu.onContextMenu}
      onTouchStart={() => env.longPress.start(item.id)}
      onTouchEnd={env.longPress.cancel}
      onTouchMove={env.longPress.cancel}
      {...dnd.listeners}
      {...dnd.osDrop}
    >
      <TableCell className="w-full max-w-0 tbl-fill">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            className={cn('hover-reveal hidden', `${FINE_POINTER}:inline-flex`)}
            checked={selected}
            onChange={() => env.onToggle(item.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={item.name}
          />
          {/* With a mouse the box and the icon sit side by side; on touch a selected row swaps its icon for a check. */}
          {selected ? (
            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', `${FINE_POINTER}:hidden`)}>
              <Check className="h-3 w-3" />
            </span>
          ) : null}
          <span className={cn('shrink-0', selected ? `hidden ${FINE_POINTER}:flex` : 'flex')}>
            <ItemGlyph item={item} />
          </span>
          <div className="min-w-0 flex-1">
            <button type="button" className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ItemName item={item} query={env.query} />
            </button>
            {where ? <p className="truncate text-xs text-muted-foreground">{where}</p> : null}
            <TableDetails items={[typeText(item), date, sizeText(item)]} />
          </div>
        </div>
      </TableCell>
      <TableCell priority="lg" className="whitespace-nowrap text-muted-foreground">
        {typeText(item)}
      </TableCell>
      <TableCell priority="md" className="whitespace-nowrap text-muted-foreground" title={item.updatedAt ? formatDateTime(item.updatedAt) : undefined}>
        {date}
      </TableCell>
      <TableCell priority="md" className="tnum whitespace-nowrap text-right text-muted-foreground">
        {sizeText(item)}
      </TableCell>
      <TableCell className="w-px" onClick={(e) => e.stopPropagation()}>
        <div className="hover-reveal flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('tbl-inline hidden', `${FINE_POINTER}:inline-flex`)}
            title={t('common:actions.download')}
            aria-label={t('common:actions.download')}
            onClick={() => env.actions.download([item])}
          >
            <Download className="h-4 w-4" />
          </Button>
          {isFolder && item.canShare ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('tbl-inline hidden', `${FINE_POINTER}:inline-flex`)}
              title={t('common:actions.share')}
              aria-label={t('common:actions.share')}
              onClick={() => env.actions.share(item)}
            >
              <Users className="h-4 w-4" />
            </Button>
          ) : null}
          {!isFolder && env.actions.canSendToMessages ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('tbl-inline hidden', `${FINE_POINTER}:inline-flex`)}
              title={t('messages:share.action')}
              aria-label={t('messages:share.action')}
              onClick={() => env.actions.sendToMessages(item)}
            >
              <MessageSquareShare className="h-4 w-4" />
            </Button>
          ) : null}
          <ItemMenu targets={targets} actions={env.actions} title={targets.length > 1 ? t('archive:selection.count', { count: targets.length }) : item.name} />
        </div>
        <ItemContextMenu state={contextMenu} targets={targets} actions={env.actions} />
      </TableCell>
    </TableRow>
  )
}
