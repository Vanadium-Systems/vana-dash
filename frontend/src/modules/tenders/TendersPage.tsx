import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, EyeOff, Star, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { downloadCsv } from '@/shared/lib/csv'
import type { TenderOpportunity, TenderSource } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { formatNumber, intlTag } from '@/shared/lib/format'
import { TenderWatchRulesCard } from './TenderWatchRulesCard'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'

const SOURCE_LABEL: Record<TenderSource, string> = {
  direct_acquisition: t('tenders:types.direct'),
  contract_notice: t('tenders:types.public'),
}

const SOURCE_FILTERS: { key: TenderSource | 'all'; label: string }[] = [
  { key: 'all', label: t('common:labels.all') },
  { key: 'direct_acquisition', label: t('tenders:types.directPlural') },
  { key: 'contract_notice', label: t('tenders:types.publicPlural') },
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
      {soon ? ` (${t('common:count.days', { count: days })})` : ''}
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
      toast.success(t('common:states.updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const rows = tenders.data ?? []
  const [pageSize, setPageSize] = useState(25)
  // The page belongs to one set of filters; changing a filter starts again from the first page.
  const [paging, setPaging] = useState({ filters: queryString, page: 0 })
  const page = paging.filters === queryString ? Math.min(paging.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)) : 0
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error(t('tenders:exportEmpty'))
      return
    }
    downloadCsv(`licitatii-${new Date().toISOString().slice(0, 10)}.csv`, [
      [t('common:labels.source'), t('common:labels.title'), t('tenders:labels.authorityFull'), 'CPV', t('tenders:labels.estimatedValueRon'), t('tenders:labels.deadline'), t('common:labels.state'), 'Link'],
      ...rows.map((tender) => [
        SOURCE_LABEL[tender.source],
        tender.title,
        tender.contractingAuthority ?? '',
        tender.cpvCode ?? '',
        tender.estimatedValueRon ?? '',
        tender.deadlineAt ? new Date(tender.deadlineAt).toLocaleDateString(intlTag()) : '',
        tender.stateText ?? '',
        tender.detailUrl,
      ]),
    ])
    toast.success(t('tenders:exported', { count: rows.length }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.tenders')}
        description={t('tenders:description')}
        actions={
          <Button type="button" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4" /> {t('common:actions.exportCsv')}
          </Button>
        }
      />

      <TenderWatchRulesCard />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">{t('tenders:searchLabel')}</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('tenders:searchPlaceholder')} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('common:labels.source')}</label>
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
          {t('tenders:onlyImportant')}
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('tenders:showArchived')}
        </label>
      </div>

      <Card>
        <CardContent className="pt-6">
          {tenders.isPending ? (
            <ListSkeleton rows={4} />
          ) : tenders.isError ? (
            <p className="text-sm text-destructive">{t('tenders:loadFailed')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tenders:empty')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:labels.title')}</TableHead>
                    <TableHead priority="md">{t('tenders:labels.authority')}</TableHead>
                    <TableHead priority="lg">CPV</TableHead>
                    <TableHead priority="lg">{t('common:labels.source')}</TableHead>
                    <TableHead priority="md" className="text-right">{t('tenders:labels.estimatedValue')}</TableHead>
                    <TableHead>{t('tenders:labels.deadline')}</TableHead>
                    <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((tender) => (
                    <TableRow key={tender.id} className={cn(tender.dismissedAt ? 'opacity-60' : undefined, tender.isPriority ? 'bg-warning/10' : undefined)}>
                      <TableCell className="font-medium tbl-fill md:min-w-[12rem] md:max-w-xs">
                        <a href={tender.detailUrl} target="_blank" rel="noreferrer" className="flex items-start gap-1 hover:underline">
                          {tender.isPriority ? <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" /> : null}
                          <span className="line-clamp-2">{tender.title}</span>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </a>
                        {tender.minTurnoverRon ? (
                          <span
                            className="mt-1 block w-fit rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive"
                            title={tender.eligibilityNote ?? undefined}
                          >
                            {t('tenders:minTurnover', { value: formatNumber(Number(tender.minTurnoverRon), BASE_CURRENCY) })}
                          </span>
                        ) : null}
                        <TableDetails items={[tender.contractingAuthority, tender.estimatedValueRon ? formatNumber(Number(tender.estimatedValueRon), BASE_CURRENCY) : null]} />
                      </TableCell>
                      <TableCell priority="md" className="max-w-[14rem] truncate">{tender.contractingAuthority ?? '—'}</TableCell>
                      <TableCell priority="lg" className="whitespace-nowrap text-sm text-muted-foreground">{tender.cpvCode ?? '—'}</TableCell>
                      <TableCell priority="lg">
                        <Badge variant="outline">{SOURCE_LABEL[tender.source]}</Badge>
                      </TableCell>
                      <TableCell priority="md" className="whitespace-nowrap text-right text-sm tabular-nums">
                        {tender.estimatedValueRon ? formatNumber(Number(tender.estimatedValueRon), BASE_CURRENCY) : '—'}
                      </TableCell>
                      <TableCell>
                        <DeadlineCell deadlineAt={tender.deadlineAt} isOpen={tender.isOpen} />
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActions
                          actions={[
                            {
                              key: 'dismiss',
                              icon: tender.dismissedAt ? Undo2 : EyeOff,
                              label: tender.dismissedAt ? t('common:actions.restore') : t('tenders:notInterested'),
                              disabled: setDismissed.isPending,
                              onClick: () => setDismissed.mutate({ id: tender.id, dismissed: !tender.dismissedAt }),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={rows.length}
                onPage={(next) => setPaging({ filters: queryString, page: next })}
                onPageSize={(size) => {
                  setPageSize(size)
                  setPaging({ filters: queryString, page: 0 })
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
