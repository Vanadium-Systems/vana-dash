import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Star } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { downloadCsv } from '@/shared/lib/csv'
import type { TenderOpportunity, TenderSource } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { formatNumber, intlTag } from '@/shared/lib/format'
import { TenderWatchRulesCard } from './TenderWatchRulesCard'

const SOURCE_LABEL: Record<TenderSource, string> = {
  direct_acquisition: 'Achiziție directă',
  contract_notice: 'Licitație publică',
}

const SOURCE_FILTERS: { key: TenderSource | 'all'; label: string }[] = [
  { key: 'all', label: 'Toate' },
  { key: 'direct_acquisition', label: 'Achiziții directe' },
  { key: 'contract_notice', label: 'Licitații publice' },
]

const DEADLINE_SOON_DAYS = 5

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

function DeadlineCell({ deadlineAt, isOpen }: { deadlineAt: string | null; isOpen: boolean }) {
  if (!deadlineAt) return <span className="text-muted-foreground">—</span>
  const days = daysUntil(deadlineAt)
  const soon = isOpen && days >= 0 && days <= DEADLINE_SOON_DAYS
  return (
    <span className={cn(soon ? 'font-medium text-destructive' : undefined)}>
      {new Date(deadlineAt).toLocaleDateString(intlTag())}
      {soon ? ` (${days} zile)` : ''}
    </span>
  )
}

export function TendersPage() {
  const queryClient = useQueryClient()
  const [sourceFilter, setSourceFilter] = useState<TenderSource | 'all'>('all')
  const [onlyPriority, setOnlyPriority] = useState(false)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const params = new URLSearchParams()
  if (sourceFilter !== 'all') params.set('source', sourceFilter)
  if (onlyPriority) params.set('isPriority', 'true')
  if (search) params.set('search', search)
  if (showArchived) params.set('dismissed', 'only')
  const queryString = params.toString()

  const tenders = useQuery({
    queryKey: ['tenders', { sourceFilter, onlyPriority, search, showArchived }],
    queryFn: () => api.get<TenderOpportunity[]>(`/api/tenders${queryString ? `?${queryString}` : ''}`),
  })

  const setDismissed = useMutation({
    mutationFn: ({ id, dismissed }: { id: string; dismissed: boolean }) => api.patch<TenderOpportunity>(`/api/tenders/${id}`, { dismissed }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenders'] })
      toast.success('Actualizat')
    },
    onError: (err) => toast.error(err.message),
  })

  const rows = tenders.data ?? []

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error('Niciun rezultat de exportat')
      return
    }
    downloadCsv(`licitatii-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Sursă', 'Titlu', 'Autoritate contractantă', 'CPV', 'Valoare estimată RON', 'Deadline', 'Stare', 'Link'],
      ...rows.map((t) => [
        SOURCE_LABEL[t.source],
        t.title,
        t.contractingAuthority ?? '',
        t.cpvCode ?? '',
        t.estimatedValueRon ?? '',
        t.deadlineAt ? new Date(t.deadlineAt).toLocaleDateString(intlTag()) : '',
        t.stateText ?? '',
        t.detailUrl,
      ]),
    ])
    toast.success(`${rows.length} oportunități exportate`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Licitații"
        description="Achiziții directe și licitații publice deschise pe e-licitatie.ro, filtrate pe regulile tale de urmărire."
        actions={
          <Button type="button" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <TenderWatchRulesCard />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">Căutare (titlu/autoritate)</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex: digitalizare, primăria..." />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Sursă</label>
          <div className="flex flex-wrap gap-1">
            {SOURCE_FILTERS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSourceFilter(s.key)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity',
                  sourceFilter === s.key ? 'border-transparent bg-primary text-primary-foreground' : 'border-input bg-transparent text-muted-foreground opacity-60 hover:opacity-100',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyPriority} onChange={(e) => setOnlyPriority(e.target.checked)} />
          Doar importante
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Arată arhivate
        </label>
      </div>

      <Card>
        <CardContent className="pt-6">
          {tenders.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : tenders.isError ? (
            <p className="text-sm text-destructive">Nu am putut încărca oportunitățile.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nicio oportunitate pentru filtrele curente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titlu</TableHead>
                  <TableHead>Autoritate</TableHead>
                  <TableHead>CPV</TableHead>
                  <TableHead>Sursă</TableHead>
                  <TableHead className="text-right">Valoare estimată</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className={cn(t.dismissedAt ? 'opacity-60' : undefined, t.isPriority ? 'bg-warning/10' : undefined)}>
                    <TableCell className="max-w-xs font-medium">
                      <a href={t.detailUrl} target="_blank" rel="noreferrer" className="flex items-start gap-1 hover:underline">
                        {t.isPriority ? <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" /> : null}
                        <span className="line-clamp-2">{t.title}</span>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </a>
                      {t.minTurnoverRon ? (
                        <span
                          className="mt-1 block w-fit rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive"
                          title={t.eligibilityNote ?? undefined}
                        >
                          CA min: {formatNumber(Number(t.minTurnoverRon), 'RON')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">{t.contractingAuthority ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.cpvCode ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{SOURCE_LABEL[t.source]}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.estimatedValueRon ? formatNumber(Number(t.estimatedValueRon), 'RON') : '—'}
                    </TableCell>
                    <TableCell>
                      <DeadlineCell deadlineAt={t.deadlineAt} isOpen={t.isOpen} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={setDismissed.isPending}
                        onClick={() => setDismissed.mutate({ id: t.id, dismissed: !t.dismissedAt })}
                      >
                        {t.dismissedAt ? 'Restaurează' : 'Nu mă interesează'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
