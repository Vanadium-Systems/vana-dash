import { Checkbox } from '@/shared/components/ui/checkbox'
import { useContextMenu } from '@/shared/components/ui/context-menu'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { ItemContextMenu, ItemMenu } from './ItemMenu'
import { FolderGlyph } from './FolderGlyph'
import { ItemGlyph, ItemName } from './ItemName'
import { sizeText, typeText } from './ArchiveRow'
import type { ArchiveItem } from './items'
import { useItemDnd } from './item-dnd'
import type { ListEnv } from './list-env'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import type { ListPagination } from './ArchiveList'

const FINE_POINTER = '[@media(hover:hover)_and_(pointer:fine)]'

function FolderTile({ item, env }: { item: ArchiveItem; env: ListEnv }) {
  const contextMenu = useContextMenu()
  const dnd = useItemDnd(item, env)
  const selected = env.selectedIds.has(item.id)
  const targets = env.targetsFor(item)
  return (
    <div
      ref={dnd.ref}
      data-row-id={item.id}
      data-selecting={env.selectedIds.size > 0 ? '' : undefined}
      className={cn(
        'hover-row group relative flex h-12 cursor-pointer select-none items-center gap-2 rounded-lg border bg-card px-3 hover:bg-muted/50',
        selected && 'bg-muted',
        env.focusId === item.id && 'ring-1 ring-ring',
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
      <FolderGlyph color={item.color} className="h-5 w-5" />
      <button type="button" className="min-w-0 flex-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ItemName item={item} query={env.query} />
      </button>
      <div className="hover-reveal flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <ItemMenu targets={targets} actions={env.actions} title={targets.length > 1 ? t('archive:selection.count', { count: targets.length }) : item.name} />
      </div>
      <ItemContextMenu state={contextMenu} targets={targets} actions={env.actions} />
    </div>
  )
}

function FileCard({ item, env }: { item: ArchiveItem; env: ListEnv }) {
  const contextMenu = useContextMenu()
  const dnd = useItemDnd(item, env)
  const selected = env.selectedIds.has(item.id)
  const targets = env.targetsFor(item)
  return (
    <div
      ref={dnd.ref}
      data-row-id={item.id}
      data-selecting={env.selectedIds.size > 0 ? '' : undefined}
      className={cn(
        'hover-row group relative cursor-pointer select-none overflow-hidden rounded-lg border bg-card hover:bg-muted/50',
        selected && 'bg-muted',
        env.focusId === item.id && 'ring-1 ring-ring',
        dnd.isDragging && 'opacity-50',
      )}
      onClick={(e) => env.onActivate(e, item)}
      onContextMenu={contextMenu.onContextMenu}
      onTouchStart={() => env.longPress.start(item.id)}
      onTouchEnd={env.longPress.cancel}
      onTouchMove={env.longPress.cancel}
      {...dnd.listeners}
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {item.previewUrl ? <img src={item.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ItemGlyph item={item} className="h-10 w-10" />}
      </div>
      <div className="min-w-0 px-3 py-2">
        <button type="button" className="block w-full min-w-0 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ItemName item={item} query={env.query} />
        </button>
        <p className="truncate text-xs text-muted-foreground">
          {typeText(item)} · {sizeText(item)}
        </p>
      </div>
      <Checkbox
        className={cn('hover-reveal absolute left-2 top-2', selected || `hidden ${FINE_POINTER}:inline-flex`)}
        checked={selected}
        onChange={() => env.onToggle(item.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={item.name}
      />
      <div className="hover-reveal absolute right-1 top-1 rounded-md bg-card/80" onClick={(e) => e.stopPropagation()}>
        <ItemMenu targets={targets} actions={env.actions} title={targets.length > 1 ? t('archive:selection.count', { count: targets.length }) : item.name} />
      </div>
      <ItemContextMenu state={contextMenu} targets={targets} actions={env.actions} />
    </div>
  )
}

// Folders first, as compact tiles; files below as cards with the thumbnail large (Drive).
export function ArchiveGrid({ items, env, pagination }: { items: ArchiveItem[]; env: ListEnv; pagination?: ListPagination }) {
  const folders = items.filter((item) => item.kind === 'folder')
  const files = items.filter((item) => item.kind === 'file')
  return (
    <div className="space-y-4">
      {folders.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {folders.map((item) => (
            <FolderTile key={item.id} item={item} env={env} />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {files.map((item) => (
            <FileCard key={item.id} item={item} env={env} />
          ))}
        </div>
      ) : null}
      {pagination ? (
        <TablePagination
          page={pagination.page - 1}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPage={(page) => pagination.onPage(page + 1)}
          onPageSize={pagination.onPageSize}
        />
      ) : null}
    </div>
  )
}
