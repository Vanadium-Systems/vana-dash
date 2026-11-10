import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Columns3, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { t } from '@/shared/lib/i18n'
import { normalizeForSearch } from '@/shared/lib/utils'
import { COLUMN_DEFS, DEFAULT_COLUMNS, moveColumn, sameColumns, toggleColumn, type ColumnKey } from './columns'

const columnLabel = (key: ColumnKey) => t(`clients:prospects.columns.${key}`)

function SortableColumn({ columnKey, onToggle, disabled }: { columnKey: ColumnKey; onToggle: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-sm px-1 ${isDragging ? 'z-10 bg-accent' : ''}`}>
      <button type="button" className="touch-target flex h-control-sm w-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-accent active:cursor-grabbing" aria-label={t('clients:prospects.columnsMenu.drag', { column: columnLabel(columnKey) })} {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <label className="flex min-h-control-sm flex-1 items-center gap-2 text-sm">
        <Checkbox checked disabled={disabled} onChange={onToggle} /> {columnLabel(columnKey)}
      </label>
    </div>
  )
}

export function ColumnsMenu({ columns, onChange }: { columns: ColumnKey[]; onChange: (next: ColumnKey[]) => void }) {
  const [query, setQuery] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const needle = normalizeForSearch(query.trim())
  const matches = (key: ColumnKey) => !needle || normalizeForSearch(columnLabel(key)).includes(needle)
  const hidden = COLUMN_DEFS.map((def) => def.key).filter((key) => !columns.includes(key) && matches(key))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onChange(moveColumn(columns, active.id as ColumnKey, over.id as ColumnKey))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Columns3 className="h-4 w-4" aria-hidden="true" /> {t('clients:prospects.columnsMenu.trigger')}
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('clients:prospects.columnsMenu.trigger')} align="end">
        <div className="w-[min(20rem,calc(100vw-2rem))] max-w-full space-y-2 p-1">
          <Input
            value={query}
            aria-label={t('clients:prospects.columnsMenu.search')}
            placeholder={t('clients:prospects.columnsMenu.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation()
            }}
          />
          <p className="px-1 text-xs text-muted-foreground">{t('clients:prospects.columnsMenu.nameFixed')}</p>
          <div className="max-h-72 overflow-y-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={columns} strategy={verticalListSortingStrategy}>
                {columns.filter(matches).map((key) => (
                  <SortableColumn key={key} columnKey={key} disabled={columns.length === 1} onToggle={() => onChange(toggleColumn(columns, key))} />
                ))}
              </SortableContext>
            </DndContext>
            {hidden.map((key) => (
              <label key={key} className="flex min-h-control-sm items-center gap-2 rounded-sm py-1 pl-9 pr-1 text-sm hover:bg-accent">
                <Checkbox checked={false} onChange={() => onChange(toggleColumn(columns, key))} /> {columnLabel(key)}
              </label>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={sameColumns(columns, DEFAULT_COLUMNS)} onClick={() => onChange([...DEFAULT_COLUMNS])}>
            {t('clients:prospects.columnsMenu.defaults')}
          </Button>
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}
