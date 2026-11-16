import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { useHomeLayout, useResetHomeLayout, useSaveHomeLayout, type HomeLayoutItem, type WidgetSize } from './home-layout'
import { availableWidgets, WIDGET_BY_ID } from './widgets/registry'
import type { WidgetDef } from './widgets/types'

// The grid of Home (DESIGN.md): 4 columns on a desktop, 2 on a phone; small 1×1, wide 2×1,
// large 2×2, band 4×1 (2×1 on a phone). `grid-auto-flow: dense` fills the holes a large widget
// leaves. Editing is explicit ("Editează"): drag handles and × appear, nothing moves by accident.
const SIZE_CLASS: Record<WidgetSize, string> = {
  s: 'col-span-1 row-span-1',
  w: 'col-span-2 row-span-1',
  l: 'col-span-2 row-span-2',
  band: 'col-span-2 row-span-1 lg:col-span-4',
}

function sizeLabel(size: WidgetSize): string {
  return t(`overview:sizes.${size}`)
}

function SortableWidget({
  item,
  def,
  editing,
  onRemove,
  onResize,
}: {
  item: HomeLayoutItem
  def: WidgetDef
  editing: boolean
  onRemove: () => void
  onResize: (size: WidgetSize) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.widget, disabled: !editing })
  const Widget = def.component
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative min-w-0', SIZE_CLASS[item.size], isDragging && 'z-10 opacity-80')}
    >
      <Widget size={item.size} preview={editing} />
      {editing ? (
        <div className="absolute inset-x-2 top-2 flex items-center justify-end gap-1 rounded-md bg-card/95 p-1 shadow-sm">
          {def.sizes.length > 1 ? (
            <Select
              size="sm"
              className="w-28"
              aria-label={t('overview:edit.size', { widget: def.title() })}
              value={item.size}
              onValueChange={(size) => onResize(size as WidgetSize)}
              options={def.sizes.map((size) => ({ value: size, label: sizeLabel(size) }))}
            />
          ) : null}
          <Button variant="ghost" size="icon-sm" className="cursor-grab touch-none" aria-label={t('overview:edit.move', { widget: def.title() })} {...attributes} {...listeners}>
            <GripVertical />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('overview:edit.remove', { widget: def.title() })} onClick={onRemove}>
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Catalog({ open, onOpenChange, placed, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; placed: Set<string>; onAdd: (def: WidgetDef) => void }) {
  const { can } = useMe()
  const groups = useMemo(() => {
    const byModule = new Map<string, WidgetDef[]>()
    for (const def of availableWidgets(can)) {
      const list = byModule.get(def.module()) ?? []
      list.push(def)
      byModule.set(def.module(), list)
    }
    return [...byModule.entries()]
  }, [can])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('overview:catalog.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {groups.map(([module, defs]) => (
            <section key={module} aria-label={module}>
              <h3 className="mb-2 text-xs font-medium text-text-3">{module}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {defs.map((def) => {
                  const Widget = def.component
                  const added = placed.has(def.id)
                  return (
                    <div key={def.id} className="flex flex-col gap-2 rounded-lg border p-3">
                      {/* A live preview, in the widget's first size, with nothing clickable inside. */}
                      <div className="pointer-events-none h-40 overflow-hidden" aria-hidden="true" ref={(node) => node?.setAttribute('inert', '')}>
                        <Widget size={def.sizes[0]!} preview />
                      </div>
                      <p className="text-xs text-muted-foreground">{def.description()}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-text-3">{def.sizes.map(sizeLabel).join(' · ')}</span>
                        <Button variant="outline" size="sm" disabled={added} onClick={() => onAdd(def)}>
                          {added ? t('overview:catalog.added') : t('overview:catalog.add')}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function HomeGrid() {
  const { can } = useMe()
  const layout = useHomeLayout()
  const save = useSaveHomeLayout()
  const reset = useResetHomeLayout()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<HomeLayoutItem[] | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Unknown or no-longer-allowed widgets are dropped here too, so a stale layout never shows a hole.
  const saved = (layout.data?.layout ?? [])
    .filter((item) => {
      const def = WIDGET_BY_ID.get(item.widget)
      return def && (def.feature === null || can(def.feature))
    })
    .sort((a, b) => a.order - b.order)
  const items = draft ?? saved

  const startEditing = () => {
    setDraft(saved)
    setEditing(true)
  }
  const update = (next: HomeLayoutItem[]) => setDraft(next.map((item, order) => ({ ...item, order })))

  const finish = () => {
    if (!draft) return setEditing(false)
    save.mutate(draft, {
      onSuccess: () => {
        setEditing(false)
        setDraft(null)
      },
      onError: () => toast.error(t('overview:edit.notSaved')),
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.widget === active.id)
    const to = items.findIndex((item) => item.widget === over.id)
    update(arrayMove(items, from, to))
  }

  if (layout.isPending) {
    return <div className="home-grid" aria-busy="true" />
  }

  return (
    <section aria-label={t('overview:grid.label')} className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <>
            {layout.data?.source === 'user' ? (
              <Button
                variant="ghost"
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: () => {
                      setEditing(false)
                      setDraft(null)
                    },
                  })
                }
              >
                {t('overview:edit.reset')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setCatalogOpen(true)}>
              <Plus />
              {t('overview:edit.add')}
            </Button>
            <Button onClick={finish} disabled={save.isPending}>
              {t('overview:edit.done')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={startEditing}>
            {t('overview:edit.start')}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">{t('overview:grid.empty')}</p>
          <Button variant="outline" className="mt-3" onClick={() => (editing ? setCatalogOpen(true) : startEditing())}>
            {t('overview:edit.add')}
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((item) => item.widget)} strategy={rectSortingStrategy}>
            <div className="home-grid">
              {items.map((item, index) => {
                const def = WIDGET_BY_ID.get(item.widget)!
                return (
                  <SortableWidget
                    key={item.widget}
                    item={item}
                    def={def}
                    editing={editing}
                    onRemove={() => update(items.filter((_, i) => i !== index))}
                    onResize={(size) => update(items.map((it, i) => (i === index ? { ...it, size } : it)))}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Catalog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        placed={new Set(items.map((item) => item.widget))}
        onAdd={(def) => {
          update([...items, { widget: def.id, size: def.sizes[0]!, order: items.length }])
          setCatalogOpen(false)
        }}
      />
    </section>
  )
}
