import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Eye } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Input } from '@/shared/components/ui/input'
import { KPICard } from '@/shared/components/KPICard'
import { PeriodSelector, usePeriod } from '@/shared/components/PeriodSelector'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import type { EmailSend, EmailSendsReport, EmailSequence } from '@/shared/lib/types'
import { EngagementBadges } from './EngagementBadges'
import { STATUS_LABEL, STATUS_TONE } from './send-status'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Select } from '@/shared/components/ui/select'

type SourceFilter = 'all' | 'manual' | 'sequence' | 'bulk'
const SOURCE_LABELS: Record<SourceFilter, string> = { all: 'Toate', manual: 'Manual', sequence: 'Secvență', bulk: 'Bulk' }

type EngagementFilter = 'all' | 'engaged' | 'unengaged' | 'unsubscribed'
const ENGAGEMENT_LABELS: Record<EngagementFilter, string> = {
  all: 'Toate mesajele',
  engaged: 'Cu engagement',
  unengaged: 'Fără engagement',
  unsubscribed: 'Dezabonați',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
}

// Rată 0..1 → procent cu o zecimală, pt. KPICard (unit="%").
function pct(rate: number): number {
  return Math.round(rate * 1000) / 10
}

function ReportPanel({ report, isPending }: { report: EmailSendsReport | undefined; isPending: boolean }) {
  const totals = report?.totals
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KPICard label="Trimise" value={totals?.sent ?? null} isPending={isPending} />
        <KPICard
          label="Rată deschidere"
          value={totals ? pct(totals.openRate) : null}
          unit="%"
          isPending={isPending}
          hint={totals ? `${totals.opened} din ${totals.sent} trimise` : undefined}
        />
        <KPICard
          label="Rată click"
          value={totals ? pct(totals.clickRate) : null}
          unit="%"
          isPending={isPending}
          hint={totals ? `${totals.clicked} din ${totals.sent} trimise` : undefined}
        />
        <KPICard label="Răspunsuri" value={totals?.replied ?? null} isPending={isPending} hint={totals && totals.sent > 0 ? `${pct(totals.replyRate)}% din trimise` : undefined} />
        <KPICard label="Bounce" value={totals?.bounced ?? null} isPending={isPending} tone={totals && totals.bounced > 0 ? 'negative' : undefined} />
        <KPICard label="Spam" value={totals?.complained ?? null} isPending={isPending} tone={totals && totals.complained > 0 ? 'negative' : undefined} />
        <KPICard label="Dezabonări" value={totals?.unsubscribed ?? null} isPending={isPending} tone={totals && totals.unsubscribed > 0 ? 'negative' : undefined} hint="pur — fără bounce (card separat)" />
      </div>

      {!isPending && report && (report.bySequence.length > 0 || report.byTemplate.length > 0) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {report.bySequence.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Secvență</TableHead>
                    <TableHead className="text-right">Trimise</TableHead>
                    <TableHead className="text-right">Deschidere</TableHead>
                    <TableHead className="text-right">Click</TableHead>
                    <TableHead className="text-right">Răspuns</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.bySequence.map((row) => (
                    <TableRow key={row.sequenceId}>
                      <TableCell className="text-sm">{row.sequenceName}</TableCell>
                      <TableCell className="text-right text-sm">{row.sent}</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.openRate)}%</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.clickRate)}%</TableCell>
                      <TableCell className="text-right text-sm">
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
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Trimise</TableHead>
                    <TableHead className="text-right">Deschidere</TableHead>
                    <TableHead className="text-right">Click</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byTemplate.map((row) => (
                    <TableRow key={row.templateId}>
                      <TableCell className="text-sm">{row.templateName}</TableCell>
                      <TableCell className="text-right text-sm">{row.sent}</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.openRate)}%</TableCell>
                      <TableCell className="text-right text-sm">{pct(row.clickRate)}%</TableCell>
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
            <span>De la</span>
            <span className="text-foreground">{send.fromAddress ?? '—'}</span>
            <span>Către</span>
            <span className="text-foreground">{send.recipient}</span>
            <span>Când</span>
            <span className="text-foreground">{formatDate(send.createdAt)}</span>
            <span>Stare</span>
            <span>
              <StatePill tone={STATUS_TONE[send.status]}>{STATUS_LABEL[send.status]}</StatePill>
            </span>
            <span>Engagement</span>
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
                Conținutul nu a fost salvat pentru acest mesaj (trimis înainte de a păstra corpul emailului).
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
  const [q, setQ] = useState('')
  const debouncedQ = useDebounced(q, 300)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const period = usePeriod()

  // Filtru schimbat → pagina 1, altfel rămâi pe o pagină care poate să nu mai existe în noul set.
  useEffect(() => {
    setPage(0)
  }, [source, sequenceId, engagement, debouncedQ, period, pageSize])

  const sequences = useQuery({
    queryKey: ['email', 'sequences'],
    queryFn: () => api.get<EmailSequence[]>('/api/email/sequences'),
    staleTime: 5 * 60 * 1000,
  })

  // Filtrele comune listei/raportului/exportului — sursă, secvență, engagement, perioadă.
  const filterParams = new URLSearchParams()
  if (source !== 'all') filterParams.set('source', source)
  if (source === 'sequence' && sequenceId) filterParams.set('sequenceId', sequenceId)
  if (source === 'sequence' && engagement !== 'all') filterParams.set('engagement', engagement)
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
        <ReportPanel report={report.data} isPending={report.isPending} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Input
              placeholder="Caută destinatar, subiect, expeditor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-[45vw] sm:max-w-xs"
            />
            <Select
              className="w-auto max-w-[45vw] sm:max-w-none"
              value={source}
              onChange={(e) => setSource(e.target.value as SourceFilter)}
            >
              {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
            {source === 'sequence' ? (
              <Select
                className="w-auto max-w-[45vw] sm:max-w-none"
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
              >
                <option value="">Toate secvențele</option>
                {sequences.data?.map((seq) => (
                  <option key={seq.id} value={seq.id}>
                    {seq.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {source === 'sequence' ? (
              <Select
                className="w-auto max-w-[45vw] sm:max-w-none"
                value={engagement}
                onChange={(e) => setEngagement(e.target.value as EngagementFilter)}
              >
                {(Object.keys(ENGAGEMENT_LABELS) as EngagementFilter[]).map((e) => (
                  <option key={e} value={e}>
                    {ENGAGEMENT_LABELS[e]}
                  </option>
                ))}
              </Select>
            ) : null}
            <PeriodSelector />
          </div>
          <Button
            variant="outline"
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
            <Download className="h-4 w-4" /> {exporting ? 'Se exportă…' : 'Export CSV'}
          </Button>
        </div>

        {sends.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : sends.isError ? (
          <p className="text-sm text-destructive">Nu am putut încărca istoricul.</p>
        ) : !items.length ? (
          <p className="text-sm text-muted-foreground">Niciun email trimis încă.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Când</TableHead>
                <TableHead>De la</TableHead>
                <TableHead>Către</TableHead>
                <TableHead>Subiect</TableHead>
                <TableHead>Stare</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead className="text-right">Acțiuni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setViewing(s)}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  <TableCell className="text-sm">{s.fromAddress ?? '—'}</TableCell>
                  <TableCell className="text-sm">{s.recipient}</TableCell>
                  <TableCell className="text-sm">{s.subject}</TableCell>
                  <TableCell>
                    <StatePill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatePill>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <EngagementBadges send={s} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" title="Vezi conținutul" onClick={(e) => { e.stopPropagation(); setViewing(s) }}>
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
              title="Rânduri pe pagină"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / pagină
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} din {total}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title="Pagina precedentă"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title="Pagina următoare"
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
