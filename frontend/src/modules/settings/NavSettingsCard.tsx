import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import { NAV_ITEMS } from '@/shared/lib/nav-items'
import { t } from '@/shared/lib/i18n'

interface NavEntry {
  to: string
  visible: boolean
}

function SortableRow({ entry, label, onToggle }: { entry: NavEntry; label: string; onToggle: (visible: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.to })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border bg-card px-3 py-1 ${isDragging ? 'z-10 shadow-md' : ''}`}
    >
      <button
        type="button"
        className="touch-target -my-1 -ml-1 flex h-8 w-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:bg-accent active:cursor-grabbing"
        aria-label={t('settings:nav.dragToReorder')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 text-sm">{label}</span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={entry.visible} aria-label={t('settings:nav.showInMenu', { label })} onChange={(e) => onToggle(e.target.checked)} />
        {t('settings:nav.visible')}
      </label>
    </div>
  )
}

export function NavSettingsCard() {
  const queryClient = useQueryClient()
  const { can } = useMe()
  // Numai paginile pe care omul le are: o listă cu „Investiții" pentru un coleg de sales
  // ar promite ceva ce nu poate deschide.
  const visibleItems = NAV_ITEMS.filter((item) => can(item.feature))
  const [items, setItems] = useState<NavEntry[]>(visibleItems.map(({ to }) => ({ to, visible: true })))
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    try {
      const res = await api.get<{ items: NavEntry[] | null }>('/api/settings/nav-layout')
      if (res.items) setItems(res.items.filter((entry) => visibleItems.some((item) => item.to === entry.to)))
      setDirty(false)
    } catch {
      // fără config răspunsul e null items — default canonic rămâne în state
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = useMutation({
    mutationFn: (next: NavEntry[]) => api.put<{ items: NavEntry[] }>('/api/settings/nav-layout', { items: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(['nav-layout'], data)
      setDirty(false)
      toast.success(t('settings:nav.updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const from = prev.findIndex((i) => i.to === active.id)
      const to = prev.findIndex((i) => i.to === over.id)
      return arrayMove(prev, from, to)
    })
    setDirty(true)
  }

  const labelOf = (to: string) => NAV_ITEMS.find((n) => n.to === to)?.label ?? to

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('settings:nav.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('settings:nav.hint')}
        </p>
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.to)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {items.map((entry) => (
                <SortableRow
                  key={entry.to}
                  entry={entry}
                  label={labelOf(entry.to)}
                  onToggle={(visible) => {
                    setItems((prev) => prev.map((i) => (i.to === entry.to ? { ...i, visible } : i)))
                    setDirty(true)
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div className="flex gap-2">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(items)}>
            {t('common:actions.save')}
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              void load()
              toast.success(t('settings:nav.resetUnsaved'))
            }}
          >
            {t('settings:nav.cancelChanges')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
