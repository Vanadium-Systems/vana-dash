import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import type { TenderWatchRule } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'

// Reguli de match CPV/keyword pt. monitorul de licitații — editabile din UI din prima zi
// (pattern ProspectStatusesCard, fără reorder: ordinea regulilor nu contează, e OR simplu).

function RuleRow({ rule }: { rule: TenderWatchRule }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const toggleActive = useMutation({
    mutationFn: () => api.patch<TenderWatchRule>(`/api/tenders/watch-rules/${rule.id}`, { active: !rule.active }),
    onSuccess: (data) => queryClient.setQueryData<TenderWatchRule[]>(['tenders', 'watch-rules'], (rows) => rows?.map((r) => (r.id === data.id ? data : r))),
    onError: (err) => toast.error(err.message),
  })

  const togglePriority = useMutation({
    mutationFn: () => api.patch<TenderWatchRule>(`/api/tenders/watch-rules/${rule.id}`, { highPriority: !rule.highPriority }),
    onSuccess: (data) => queryClient.setQueryData<TenderWatchRule[]>(['tenders', 'watch-rules'], (rows) => rows?.map((r) => (r.id === data.id ? data : r))),
    onError: (err) => toast.error(err.message),
  })

  const toggleExclude = useMutation({
    mutationFn: () => api.patch<TenderWatchRule>(`/api/tenders/watch-rules/${rule.id}`, { exclude: !rule.exclude }),
    onSuccess: (data) => queryClient.setQueryData<TenderWatchRule[]>(['tenders', 'watch-rules'], (rows) => rows?.map((r) => (r.id === data.id ? data : r))),
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/tenders/watch-rules/${rule.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', 'watch-rules'] })
      toast.success('Regulă ștearsă')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-md border p-2', !rule.active ? 'opacity-50' : '')}>
      <button
        type="button"
        className="text-xs text-muted-foreground underline underline-offset-2"
        disabled={toggleActive.isPending}
        onClick={() => toggleActive.mutate()}
      >
        {rule.active ? 'activă' : 'inactivă'}
      </button>
      <button
        type="button"
        title={rule.highPriority ? 'Prioritate înaltă — click pt. a scoate' : 'Marchează ca prioritate înaltă (alertă separată, mai puternică)'}
        disabled={togglePriority.isPending}
        onClick={() => togglePriority.mutate()}
        className={cn('shrink-0', rule.highPriority ? 'text-warning' : 'text-muted-foreground hover:text-warning')}
      >
        <Star className="h-4 w-4" fill={rule.highPriority ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        title={
          rule.exclude
            ? 'Regulă de dezinteres — potrivirile ies din lista principală. Click pt. a o face regulă de urmărire normală'
            : 'Fă regulă de dezinteres (potrivirile ies automat din lista principală)'
        }
        disabled={toggleExclude.isPending}
        onClick={() => toggleExclude.mutate()}
        className={cn('shrink-0', rule.exclude ? 'text-destructive' : 'text-muted-foreground hover:text-destructive')}
      >
        <Ban className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium">{rule.label}</span>
      {rule.exclude ? <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive">dezinteres</span> : null}
      {rule.cpvPrefix ? <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">CPV {rule.cpvPrefix}*</span> : null}
      {rule.keyword ? <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">„{rule.keyword}"</span> : null}
      <Button
        type="button"
        variant="ghost"
        className="ml-auto"
        disabled={remove.isPending}
        onClick={() => {
          void confirm({ title: `Șterge regula „${rule.label}”`, consequence: 'Licitațiile noi nu mai sunt urmărite după ea.', confirmLabel: 'Șterge regula', destructive: true }).then((ok) => ok && remove.mutate())
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

function NewRuleForm() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [cpvPrefix, setCpvPrefix] = useState('')
  const [keyword, setKeyword] = useState('')
  const [highPriority, setHighPriority] = useState(false)
  const [exclude, setExclude] = useState(false)

  const create = useMutation({
    mutationFn: () =>
      api.post<TenderWatchRule>('/api/tenders/watch-rules', {
        label,
        cpvPrefix: cpvPrefix || undefined,
        keyword: keyword || undefined,
        highPriority,
        exclude,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders', 'watch-rules'] })
      setLabel('')
      setCpvPrefix('')
      setKeyword('')
      setHighPriority(false)
      setExclude(false)
      toast.success('Regulă adăugată')
    },
    onError: (err) => toast.error(err.message),
  })

  const canCreate = label.trim().length > 0 && (cpvPrefix.trim().length > 0 || keyword.trim().length > 0)

  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="w-40 space-y-1">
        <label className="text-xs text-muted-foreground">Etichetă</label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Servicii IT" />
      </div>
      <div className="w-32 space-y-1">
        <label className="text-xs text-muted-foreground">Prefix CPV</label>
        <Input value={cpvPrefix} onChange={(e) => setCpvPrefix(e.target.value)} placeholder="ex: 72" />
      </div>
      <div className="w-48 space-y-1">
        <label className="text-xs text-muted-foreground">Cuvânt cheie</label>
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ex: digitalizare" />
      </div>
      {exclude ? null : (
        <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={highPriority} onChange={(e) => setHighPriority(e.target.checked)} />
          Prioritate înaltă
        </label>
      )}
      <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground" title="Potrivirile ies automat din lista principală, dar rămân vizibile cu Arată arhivate">
        <input
          type="checkbox"
          checked={exclude}
          onChange={(e) => {
            setExclude(e.target.checked)
            if (e.target.checked) setHighPriority(false)
          }}
        />
        Regulă de dezinteres
      </label>
      <Button type="button" disabled={!canCreate || create.isPending} onClick={() => create.mutate()}>
        <Plus className="h-4 w-4" /> Adaugă regulă
      </Button>
    </div>
  )
}

export function TenderWatchRulesCard() {
  const [open, setOpen] = useState(false)

  const rules = useQuery({
    queryKey: ['tenders', 'watch-rules'],
    queryFn: () => api.get<TenderWatchRule[]>('/api/tenders/watch-rules'),
  })
  const rows = rules.data ?? []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Reguli de urmărire</CardTitle>
        <Button type="button" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Ascunde' : 'Arată'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {rules.isPending ? (
            <p className="text-sm text-muted-foreground">Se încarcă…</p>
          ) : (
            <div className="space-y-2">
              {rows.map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </div>
          )}
          <NewRuleForm />
        </CardContent>
      )}
    </Card>
  )
}
