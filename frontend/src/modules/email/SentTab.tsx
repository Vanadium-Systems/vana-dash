import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenu, ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { cn } from '@/shared/lib/utils'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Input } from '@/shared/components/ui/input'
import { PERIODS, usePeriod } from '@/shared/components/PeriodSelector'
import { useSearchParams } from 'react-router-dom'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import type { EmailSend, EmailSendsReport, EmailSequence } from '@/shared/lib/types'
import { EngagementBadges } from './EngagementBadges'
import { STATUS_LABEL, STATUS_TONE } from './send-status'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Select } from '@/shared/components/ui/select'
import { formatNumber, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useMe } from '@/shared/hooks/use-me'

type SourceFilter = 'all' | 'manual' | 'sequence' | 'bulk'
const SOURCE_LABELS: Record<SourceFilter, string> = { all: t('common:labels.all'), manual: t('email:sent.sourceManual'), sequence: t('email:labels.sequence'), bulk: t('email:sent.sourceBulk') }

type EngagementFilter = 'all' | 'opened' | 'clicked' | 'engaged' | 'unengaged' | 'unsubscribed'
const ENGAGEMENT_LABELS: Record<EngagementFilter, string> = {
  all: t('email:folders.all'),
  opened: t('email:sent.openedFilter'),
  clicked: t('email:sent.clickedFilter'),
  engaged: t('email:sent.withEngagement'),
  unengaged: t('email:sent.withoutEngagement'),
  unsubscribed: t('email:sent.unsubscribedFilter'),
}

type StatusFilter = 'all' | 'delivered' | 'bounced' | 'complained' | 'failed'
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: t('common:labels.all'),
  delivered: t('email:status.delivered'),
  bounced: t('email:status.bounceShort'),
  complained: t('email:folders.spam'),
  failed: t('email:status.failed'),
}

interface FilterGroup {
  key: string
  title: string
  value: string
  defaultValue: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

/**
 * One "Filters" button instead of a control per filter: the button names what is active
 * ("30 days · Manual · Opened"), the menu holds the four groups. A sheet on a phone.
 */
function FiltersMenu({ groups, onReset }: { groups: FilterGroup[]; onReset: () => void }) {
  const summary = groups
    .filter((g) => g.value !== g.defaultValue || g.key === 'period')
    .map((g) => g.options.find((o) => o.value === g.value)?.label)
    .filter(Boolean)
    .join(' · ')
  const changed = groups.some((g) => g.value !== g.defaultValue)
  return (
    <ResponsiveMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-control-md min-w-0 max-w-full items-center gap-1.5 rounded-md border px-3 text-sm',
          changed ? 'border-foreground/40 bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{t('email:sent.filters')}</span>
        {summary ? <span className="min-w-0 truncate text-muted-foreground">· {summary}</span> : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('email:sent.filters')} align="start">
        {groups.map((group, index) => (
          <div key={group.key}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">{group.title}</p>
            {group.options.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => group.onChange(option.value)}>
                <Check className={cn('h-4 w-4', option.value === group.value ? 'opacity-100' : 'opacity-0')} />
                {option.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
        {changed ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onReset}>{t('email:sent.clearFilters')}</DropdownMenuItem>
          </>
        ) : null}
      </ResponsiveMenuContent>
    </ResponsiveMenu>
  )
}

const entries = <K extends string>(labels: Record<K, string>) => (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }))

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(intlTag(), { dateStyle: 'medium', timeStyle: 'short' })
}

// Rată 0..1 → procent cu o zecimală, pt. KPICard (unit="%").
function pct(rate: number): number {
  return Math.round(rate * 1000) / 10
}

function Stat({
  label,
  value,
  hint,
  isPending,
  warn,
  active,
  onClick,
}: {
  label: string
  value: string | null
  hint?: string
  isPending: boolean
  warn?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      {isPending || value === null ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <span className={cn('mt-0.5 block text-xl font-semibold tabular-nums', warn && 'text-destructive')}>{value}</span>
      )}
      {hint ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span> : null}
    </>
  )
  const base = 'flex min-w-0 flex-col bg-card px-4 py-3 text-left'
  if (!onClick) return <div className={base}>{body}</div>
  return (
    <button type="button" aria-pressed={active} title={t('email:sent.statFilterHint')} onClick={onClick} className={cn(base, 'transition-colors hover:bg-muted', active && 'bg-muted')}>
      {body}
    </button>
  )
}

interface StatFilters {
  engagement: EngagementFilter
  status: StatusFilter
  toggleEngagement: (value: EngagementFilter) => void
  toggleStatus: (value: StatusFilter) => void
}

function ReportPanel({ report, isPending, filters }: { report: EmailSendsReport | undefined; isPending: boolean; filters: StatFilters }) {
  const totals = report?.totals
  return (
    <div className="space-y-3">
      {/* One strip, not a card per number. Each number filters the list to the sends behind it. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4 xl:grid-cols-7">
        <Stat label={t('email:folders.sent')} value={totals ? formatNumber(totals.sent) : null} isPending={isPending} />
        <Stat
          label={t('email:sent.openRate')}
          value={totals ? `${formatNumber(pct(totals.openRate))}%` : null}
          hint={totals ? t('email:sent.openedOfSent', { opened: totals.opened, sent: totals.sent }) : undefined}
          isPending={isPending}
          active={filters.engagement === 'opened'}
          onClick={() => filters.toggleEngagement('opened')}
        />
        <Stat
          label={t('email:sent.clickRate')}
          value={totals ? `${formatNumber(pct(totals.clickRate))}%` : null}
          hint={totals ? t('email:sent.clickedOfSent', { clicked: totals.clicked, sent: totals.sent }) : undefined}
          isPending={isPending}
          active={filters.engagement === 'clicked'}
          onClick={() => filters.toggleEngagement('clicked')}
        />
        <Stat
          label={t('email:sent.replies')}
          value={totals ? formatNumber(totals.replied) : null}
          hint={totals && totals.sent > 0 ? t('email:sent.replyRateOfSent', { replyRate: pct(totals.replyRate) }) : undefined}
          isPending={isPending}
        />
        <Stat
          label={t('email:status.bounceShort')}
          value={totals ? formatNumber(totals.bounced) : null}
          warn={Boolean(totals && totals.bounced > 0)}
          isPending={isPending}
          active={filters.status === 'bounced'}
          onClick={() => filters.toggleStatus('bounced')}
        />
        <Stat
          label={t('email:folders.spam')}
          value={totals ? formatNumber(totals.complained) : null}
          warn={Boolean(totals && totals.complained > 0)}
          isPending={isPending}
          active={filters.status === 'complained'}
          onClick={() => filters.toggleStatus('complained')}
        />
        <Stat
          label={t('email:sent.unsubscribes')}
          value={totals ? formatNumber(totals.unsubscribed) : null}
          hint={t('email:sent.pureHint')}
          isPending={isPending}
          active={filters.engagement === 'unsubscribed'}
          onClick={() => filters.toggleEngagement('unsubscribed')}
        />
      </div>

      {!isPending && report && (report.bySequence.length > 0 || report.byTemplate.length > 0) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {report.bySequence.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('email:labels.sequence')}</TableHead>
                    <TableHead className="text-right">{t('email:folders.sent')}</TableHead>
                    <TableHead className="text-right">{t('email:sent.open')}</TableHead>
                    <TableHead priority="md" className="text-right">{t('email:sent.click')}</TableHead>
                    <TableHead priority="md" className="text-right">{t('email:sent.reply')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.bySequence.map((row) => (
                    <TableRow key={row.sequenceId}>
                      <TableCell truncate className="text-sm">{row.sequenceName}</TableCell>
                      <TableCell className="text-right text-sm">{row.sent}</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.openRate)}%</TableCell>
                      <TableCell priority="md" className="text-right text-sm">{pct(row.clickRate)}%</TableCell>
                      <TableCell priority="md" className="whitespace-nowrap text-right text-sm">
                        {row.replied} ({pct(row.replyRate)}%)
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {report.byTemplate.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('email:labels.template')}</TableHead>
                    <TableHead className="text-right">{t('email:folders.sent')}</TableHead>
                    <TableHead className="text-right">{t('email:sent.open')}</TableHead>
                    <TableHead priority="md" className="text-right">{t('email:sent.click')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byTemplate.map((row) => (
                    <TableRow key={row.templateId}>
                      <TableCell truncate className="text-sm">{row.templateName}</TableCell>
                      <TableCell className="text-right text-sm">{row.sent}</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.openRate)}%</TableCell>
                      <TableCell priority="md" className="text-right text-sm">{pct(row.clickRate)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// Rândurile trimise înainte de acest fix (bodyText/bodyHtml adăugate ulterior) n-au conținut
// salvat — doar metadate. Restul (inclusiv bulk send) au acum corpul complet, exact ce s-a
// trimis efectiv (semnătură + footer de dezabonare incluse, dacă a fost bulk).
function SendDetailDialog({ send, onClose }: { send: EmailSend; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{send.subject}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <span>{t('common:labels.from')}</span>
            <span className="text-foreground">{send.fromAddress ?? '—'}</span>
            <span>{t('common:labels.to')}</span>
            <span className="text-foreground">{send.recipient}</span>
            <span>{t('common:labels.when')}</span>
            <span className="text-foreground">{formatDate(send.createdAt)}</span>
            <span>{t('common:labels.state')}</span>
            <span>
              <StatePill tone={STATUS_TONE[send.status]}>{STATUS_LABEL[send.status]}</StatePill>
            </span>
            <span>{t('email:labels.engagement')}</span>
            <span>
              <EngagementBadges send={send} />
            </span>
          </div>
          {send.errorMessage ? <p className="text-xs text-destructive">{send.errorMessage}</p> : null}
          <div className="max-h-[60vh] overflow-auto rounded-md border p-4">
            {send.bodyHtml ? (
              <div dangerouslySetInnerHTML={{ __html: send.bodyHtml }} />
            ) : send.bodyText ? (
              <pre className="whitespace-pre-wrap font-sans text-sm">{send.bodyText}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('email:sent.contentNotKept')}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SentTab() {
  const [viewing, setViewing] = useState<EmailSend | null>(null)
  const [source, setSource] = useState<SourceFilter>('all')
  const [sequenceId, setSequenceId] = useState<string>('')
  const [engagement, setEngagement] = useState<EngagementFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q, 300)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const period = usePeriod()
  const [, setSearchParams] = useSearchParams()
  // The period lives in the URL (?period=), shared with the other screens' PeriodSelector.
  const setPeriod = (value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('period', value)
      return next
    })

  // Filtru schimbat → pagina 1, altfel rămâi pe o pagină care poate să nu mai existe în noul set.
  useEffect(() => {
    setPage(0)
  }, [source, sequenceId, engagement, status, debouncedQ, period, pageSize])

  // Without email.bulk the folder holds only one's own 1:1 sends, so there is no source to pick.
  const { can } = useMe()
  const seesCampaigns = can('email.bulk')
  const sequences = useQuery({
    queryKey: ['email', 'sequences'],
    queryFn: () => api.get<EmailSequence[]>('/api/email/sequences'),
    staleTime: 5 * 60 * 1000,
    enabled: seesCampaigns,
  })

  // Filtrele comune listei/raportului/exportului — sursă, secvență, engagement, perioadă.
  const filterParams = new URLSearchParams()
  if (source !== 'all') filterParams.set('source', source)
  if (source === 'sequence' && sequenceId) filterParams.set('sequenceId', sequenceId)
  if (engagement !== 'all') filterParams.set('engagement', engagement)
  if (status !== 'all') filterParams.set('status', status)
  filterParams.set('period', period)

  const params = new URLSearchParams(filterParams)
  if (debouncedQ.trim()) params.set('q', debouncedQ.trim())
  params.set('limit', String(pageSize))
  params.set('offset', String(page * pageSize))

  const sends = useQuery({
    queryKey: ['email', 'sends', params.toString()],
    queryFn: () => api.get<{ items: EmailSend[]; total: number }>(`/api/email/sends?${params}`),
    placeholderData: keepPreviousData,
  })
  const items = sends.data?.items ?? []
  const total = sends.data?.total ?? 0

  const report = useQuery({
    queryKey: ['email', 'sends-report', filterParams.toString()],
    queryFn: () => api.get<EmailSendsReport>(`/api/email/sends/report?${filterParams}`),
    placeholderData: keepPreviousData,
  })

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <ReportPanel
          report={report.data}
          isPending={report.isPending}
          filters={{
            engagement,
            status,
            toggleEngagement: (value) => setEngagement((current) => (current === value ? 'all' : value)),
            toggleStatus: (value) => setStatus((current) => (current === value ? 'all' : value)),
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label={t('email:sent.searchPlaceholder')} placeholder={t('email:sent.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <FiltersMenu
            groups={[
              ...(seesCampaigns
                ? [{ key: 'source', title: t('email:sent.filterSource'), value: source, defaultValue: 'all', options: entries(SOURCE_LABELS), onChange: (v: string) => setSource(v as SourceFilter) }]
                : []),
              { key: 'engagement', title: t('email:sent.filterReaction'), value: engagement, defaultValue: 'all', options: entries(ENGAGEMENT_LABELS), onChange: (v) => setEngagement(v as EngagementFilter) },
              { key: 'status', title: t('email:sent.filterStatus'), value: status, defaultValue: 'all', options: entries(STATUS_FILTER_LABELS), onChange: (v) => setStatus(v as StatusFilter) },
              { key: 'period', title: t('common:period.label'), value: period, defaultValue: '30d', options: PERIODS, onChange: setPeriod },
            ]}
            onReset={() => {
              setSource('all')
              setEngagement('all')
              setStatus('all')
              setSequenceId('')
              setPeriod('30d')
            }}
          />
          {source === 'sequence' ? (
            <Select className="w-auto" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} aria-label={t('email:labels.sequence')}>
              <option value="">{t('email:sent.allSequences')}</option>
              {sequences.data?.map((seq) => (
                <option key={seq.id} value={seq.id}>
                  {seq.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={exporting}
            onClick={async () => {
              setExporting(true)
              try {
                await api.download(`/api/email/sends/export?${filterParams}`, 'email-sends.csv')
              } finally {
                setExporting(false)
              }
            }}
          >
            <Download className="h-4 w-4" /> {exporting ? t('email:sent.exporting') : t('common:actions.exportCsv')}
          </Button>
        </div>

        {sends.isPending ? (
          <ListSkeleton rows={4} />
        ) : sends.isError ? (
          <p className="text-sm text-destructive">{t('email:sent.loadFailed')}</p>
        ) : !items.length ? (
          <EmptyState kind="new" title={t('email:sent.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead priority="md">{t('common:labels.when')}</TableHead>
                <TableHead priority="lg">{t('common:labels.from')}</TableHead>
                <TableHead priority="md">{t('common:labels.to')}</TableHead>
                <TableHead>{t('common:labels.subject')}</TableHead>
                <TableHead>{t('common:labels.state')}</TableHead>
                <TableHead priority="md">{t('email:labels.engagement')}</TableHead>
                <TableHead priority="md" className="text-right">{t('common:labels.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setViewing(s)}>
                  <TableCell priority="md" className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  <TableCell priority="lg" className="max-w-[14rem] truncate text-sm">{s.fromAddress ?? '—'}</TableCell>
                  <TableCell priority="md" className="max-w-[14rem] truncate text-sm">{s.recipient}</TableCell>
                  <TableCell className="tbl-truncate w-full max-w-0 text-sm">
                    <div className="truncate">{s.subject}</div>
                    {/* On a phone the engagement column is hidden; opens and clicks come along under the subject. */}
                    <TableDetails items={[s.recipient, formatDate(s.createdAt), <EngagementBadges key="engagement" send={s} />]} />
                  </TableCell>
                  <TableCell>
                    <StatePill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatePill>
                  </TableCell>
                  <TableCell priority="md" onClick={(e) => e.stopPropagation()}>
                    <EngagementBadges send={s} />
                  </TableCell>
                  <TableCell priority="md" className="text-right">
                    <Button variant="outline" title={t('email:sent.viewContent')} onClick={(e) => { e.stopPropagation(); setViewing(s) }}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > 0 ? (
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <Select
              size="sm"
              className="w-auto shrink-0"
              title={t('email:sent.rowsPerPage')}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {t('email:pagination.perPage', { size })}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">
                {t('email:pagination.range', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, total), total })}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.previousPage')}
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.nextPage')}
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
      {viewing ? <SendDetailDialog send={viewing} onClose={() => setViewing(null)} /> : null}
    </Card>
  )
}
