import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import { STATUS_COLOR_TOKENS, type ProspectStatusEntry, type StatusColorToken } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { StatusDot } from './status-colors'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Select } from '@/shared/components/ui/select'

// Wave 0/1, sprint de-hardcodare (2026-08-20) — gestiunea catalogului de statusuri prospect,
// înlocuiește STATUS_OPTIONS/STATUS_LABELS/STATUS_COLORS hardcodate. Pattern reorder identic
// PlanPage.tsx (dnd-kit, deja dependință folosită), pattern card colapsabil identic ScoringConfigCard.

function StatusRow({ status }: { status: ProspectStatusEntry }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [label, setLabel] = useState(status.label)

  const update = useMutation({
    mutationFn: (patch: { label?: string; colorToken?: StatusColorToken }) =>
      api.patch<ProspectStatusEntry>(`/api/prospects/statuses/${status.id}`, patch),
    onSuccess: (data) => queryClient.setQueryData<ProspectStatusEntry[]>(['prospects', 'statuses'], (rows) => rows?.map((r) => (r.id === data.id ? data : r))),
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/prospects/statuses/${status.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects', 'statuses'] })
      toast.success('Status șters')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex flex-wrap items-center gap-2 rounded-md border p-2', isDragging ? 'opacity-50' : '')}
    >
      <button type="button" className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-xs font-medium">
        <StatusDot token={status.colorToken} />
        {status.key}
      </span>
      <Input
        className="w-40"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== status.label && update.mutate({ label })}
      />
      <Select
        className="w-auto"
        size="sm"
        value={status.colorToken}
        onChange={(e) => update.mutate({ colorToken: e.target.value as StatusColorToken })}
      >
        {STATUS_COLOR_TOKENS.map((token) => (
          <option key={token} value={token}>
            {token}
          </option>
        ))}
      </Select>
      {status.isDefault ? <span className="text-xs text-muted-foreground">implicit</span> : null}
      <Button
        type="button"
        variant="ghost"
        className="ml-auto"
        disabled={remove.isPending}
        onClick={() => {
          void confirm({ title: `Șterge statusul „${status.label}”`, consequence: 'Nu se poate șterge cât timp îl mai folosește vreun prospect.', confirmLabel: 'Șterge statusul', destructive: true }).then((ok) => ok && remove.mutate())
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

function NewStatusForm() {
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [colorToken, setColorToken] = useState<StatusColorToken>('slate')

  const create = useMutation({
    mutationFn: () => api.post<ProspectStatusEntry>('/api/prospects/statuses', { key, label, colorToken }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects', 'statuses'] })
      setKey('')
      setLabel('')
      toast.success('Status adăugat')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="w-36 space-y-1">
        <label className="text-xs text-muted-foreground">Key (ex: negociere)</label>
        <Input value={key} onChange={(e) => setKey(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
      </div>
      <div className="w-40 space-y-1">
        <label className="text-xs text-muted-foreground">Etichetă</label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Culoare</label>
        <Select
          className="w-auto"
          value={colorToken}
          onChange={(e) => setColorToken(e.target.value as StatusColorToken)}
        >
          {STATUS_COLOR_TOKENS.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </Select>
      </div>
      <Button type="button" disabled={!key || !label || create.isPending} onClick={() => create.mutate()}>
        <Plus className="h-4 w-4" /> Adaugă status
      </Button>
    </div>
  )
}

export function ProspectStatusesCard() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const statuses = useQuery({
    queryKey: ['prospects', 'statuses'],
    queryFn: () => api.get<ProspectStatusEntry[]>('/api/prospects/statuses'),
  })

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.post<ProspectStatusEntry[]>('/api/prospects/statuses/reorder', { orderedIds }),
    onSuccess: (data) => queryClient.setQueryData(['prospects', 'statuses'], data),
    onError: (err) => {
      toast.error(err.message)
      void queryClient.invalidateQueries({ queryKey: ['prospects', 'statuses'] })
    },
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const rows = statuses.data ?? []

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rows.findIndex((r) => r.id === active.id)
    const newIndex = rows.findIndex((r) => r.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const nextOrder = arrayMove(rows, oldIndex, newIndex)
    queryClient.setQueryData(['prospects', 'statuses'], nextOrder)
    reorder.mutate(nextOrder.map((r) => r.id))
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Gestionare statusuri</CardTitle>
        <Button type="button" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Ascunde' : 'Arată'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {statuses.isPending ? (
            <p className="text-sm text-muted-foreground">Se încarcă…</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {rows.map((status) => (
                    <StatusRow key={status.id} status={status} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          <NewStatusForm />
        </CardContent>
      )}
    </Card>
  )
}
