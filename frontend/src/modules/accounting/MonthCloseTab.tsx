import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileCheck,
  Mail,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Money } from '@/shared/components/Money'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions, type RowAction } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Input } from '@/shared/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableDetails,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { useMe } from '@/shared/hooks/use-me'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { MonthCloseItem } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import {
  ConfirmSupplierInvoiceDialog,
  type ConfirmSupplierInvoiceDialogTarget,
} from './ConfirmSupplierInvoiceDialog'
import {
  downloadMonthPackageZip,
  useArchiveMissingMonth,
  useArchiveRecord,
  useMonthClose,
  useSetMonthClosureStatus,
} from './hooks'
import { toastError } from '@/shared/lib/errors'

export type MonthCloseFilterKey =
  | 'all'
  | 'issued'
  | 'receivedEfactura'
  | 'receivedEmailOrManual'
  | 'expectedMissing'
  | 'unarchived'

const FILTER_KEYS: MonthCloseFilterKey[] = [
  'all',
  'issued',
  'receivedEfactura',
  'receivedEmailOrManual',
  'expectedMissing',
  'unarchived',
]

export function defaultMonthClosePeriod(now = new Date()): string {
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const day = now.getDate()
  if (day <= 25) {
    const prevYear = monthIndex === 0 ? year - 1 : year
    const prevMonth = monthIndex === 0 ? 12 : monthIndex
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
  }
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [yStr, mStr] = month.split('-')
  const year = Number(yStr)
  const monthIndex = Number(mStr) - 1
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return defaultMonthClosePeriod()
  }
  const d = new Date(Date.UTC(year, monthIndex + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function sourceLabel(item: MonthCloseItem): string {
  if (item.kind === 'expected') {
    return item.expectedSource === 'recurring_expense'
      ? t('accounting:monthClose.sources.expectedRecurring')
      : t('accounting:monthClose.sources.expectedRule')
  }
  if (item.source === 'anaf_efactura') return t('accounting:monthClose.sources.efactura')
  if (item.source === 'email') return t('accounting:monthClose.sources.email')
  if (item.source === 'recurring_expense') return t('accounting:monthClose.sources.recurring')
  if (item.source === 'generated' || item.direction === 'out') {
    return t('accounting:monthClose.sources.generated')
  }
  return t('accounting:monthClose.sources.manual')
}

function matchesFilter(item: MonthCloseItem, filter: MonthCloseFilterKey): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'issued':
      return item.kind === 'record' && item.direction === 'out'
    case 'receivedEfactura':
      return item.kind === 'record' && item.direction === 'in' && item.source === 'anaf_efactura'
    case 'receivedEmailOrManual':
      return (
        item.kind === 'record' &&
        item.direction === 'in' &&
        item.source !== 'anaf_efactura'
      )
    case 'expectedMissing':
      return (
        item.kind === 'expected' ||
        (item.kind === 'record' && item.source === 'recurring_expense' && !item.hasPdf)
      )
    case 'unarchived':
      return item.kind === 'record' && (item.hasPdf || item.hasXml) && !item.isArchived
  }
}

export function MonthCloseTab() {
  const navigate = useNavigate()
  const { can } = useMe()
  const canIssue = can('facturi.emitere')
  const canEmail = can('email.view')
  const canArchiveView = can('arhiva.view')

  const [searchParams, setSearchParams] = useSearchParams()
  const rawMonth = searchParams.get('month')
  const month = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : defaultMonthClosePeriod()
  const rawFilter = searchParams.get('mcFilter')
  const activeFilter: MonthCloseFilterKey = FILTER_KEYS.includes(rawFilter as MonthCloseFilterKey)
    ? (rawFilter as MonthCloseFilterKey)
    : 'all'

  const [dialogTarget, setDialogTarget] = useState<ConfirmSupplierInvoiceDialogTarget | null>(null)
  const [downloadingZip, setDownloadingZip] = useState(false)

  const monthClose = useMonthClose(month)
  const archiveMissing = useArchiveMissingMonth()
  const archiveRecord = useArchiveRecord()
  const setClosureStatus = useSetMonthClosureStatus()

  const updateParams = (next: { month?: string; mcFilter?: MonthCloseFilterKey }) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', 'luna')
    if (next.month !== undefined) params.set('month', next.month)
    else params.set('month', month)
    const f = next.mcFilter !== undefined ? next.mcFilter : activeFilter
    if (f === 'all') params.delete('mcFilter')
    else params.set('mcFilter', f)
    setSearchParams(params)
  }

  const data = monthClose.data
  const filteredItems = useMemo(
    () => (data?.items ?? []).filter((item) => matchesFilter(item, activeFilter)),
    [data?.items, activeFilter],
  )

  const handleArchiveMissing = () => {
    archiveMissing.mutate(
      { month },
      {
        onSuccess: (res) => {
          toast.success(t('accounting:monthClose.archivedToast', { count: res.archivedCount }))
        },
        onError: (err) => toastError(err),
      },
    )
  }

  const handleToggleClosure = (closed: boolean) => {
    setClosureStatus.mutate(
      { month, closed, note: null },
      {
        onSuccess: () => {
          toast.success(
            closed
              ? t('accounting:monthClose.closureSaved')
              : t('accounting:monthClose.closureReopened'),
          )
        },
        onError: (err) => toastError(err),
      },
    )
  }

  const handleDownloadZip = async () => {
    if (downloadingZip) return
    try {
      setDownloadingZip(true)
      await downloadMonthPackageZip(month)
    } catch (err) {
      toastError(err)
    } finally {
      setDownloadingZip(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('common:actions.back')}
              onClick={() => updateParams({ month: shiftMonth(month, -1) })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="month"
              aria-label={t('accounting:monthClose.monthLabel')}
              value={month}
              onChange={(e) => {
                if (e.target.value) updateParams({ month: e.target.value })
              }}
              className="w-auto bg-background px-2.5 tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('common:actions.nextPage')}
              onClick={() => updateParams({ month: shiftMonth(month, 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {data?.closure.closed ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatePill tone="success">{t('accounting:monthClose.closedBadge')}</StatePill>
              {data.closure.closedAt ? (
                <span className="text-xs text-muted-foreground">
                  {t('accounting:monthClose.closedByAt', {
                    name: data.closure.closedBy?.name ?? t('accounting:records.timeline.system'),
                    date: formatDate(data.closure.closedAt),
                  })}
                </span>
              ) : null}
              {canIssue ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={setClosureStatus.isPending}
                  onClick={() => handleToggleClosure(false)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t('accounting:monthClose.reopenMonth')}
                </Button>
              ) : null}
            </div>
          ) : canIssue && data ? (
            <Button
              type="button"
              variant="outline"
              disabled={setClosureStatus.isPending}
              onClick={() => handleToggleClosure(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> {t('accounting:monthClose.markMonthComplete')}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data && data.counts.unarchived > 0 && canIssue ? (
            <Button
              type="button"
              variant="outline"
              disabled={archiveMissing.isPending}
              onClick={handleArchiveMissing}
              data-testid="month-close-archive-missing"
            >
              <Archive className="h-3.5 w-3.5" />
              {archiveMissing.isPending
                ? t('accounting:monthClose.archiving')
                : t('accounting:monthClose.archiveAllMissing', { count: data.counts.unarchived })}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={downloadingZip}
            onClick={() => void handleDownloadZip()}
            data-testid="month-close-download-zip"
          >
            <Download className="h-3.5 w-3.5" />
            {downloadingZip
              ? t('common:states.generating')
              : t('accounting:monthClose.downloadMonthPackage')}
          </Button>
        </div>
      </div>

      {data ? (
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {FILTER_KEYS.map((key) => {
            const count = data.counts[key]
            const active = activeFilter === key
            return (
              // native: filter tabs
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`month-close-filter-${key}`}
                onClick={() => updateParams({ mcFilter: key })}
                className={cn(
                  'inline-flex h-control-md items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-foreground/30 bg-accent text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                <span>{t(`accounting:monthClose.filters.${key}` as const)}</span>
                <span className="tabular-nums text-muted-foreground">{formatNumber(count)}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {monthClose.isPending ? (
            <ListSkeleton rows={6} />
          ) : monthClose.isError || !data ? (
            <Alert
              tone="critical"
              title={t('accounting:records.loadFailed')}
              action={
                <Button variant="outline" onClick={() => void monthClose.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {t('accounting:records.loadFailedHint')}
            </Alert>
          ) : filteredItems.length === 0 ? (
            activeFilter !== 'all' ? (
              <EmptyState
                kind="filtered"
                title={t('accounting:monthClose.empty.filtered')}
                onReset={() => updateParams({ mcFilter: 'all' })}
              />
            ) : (
              <EmptyState kind="new" title={t('accounting:monthClose.empty.all')} />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accounting:monthClose.columns.counterparty')}</TableHead>
                  <TableHead priority="md">{t('accounting:monthClose.columns.document')}</TableHead>
                  <TableHead priority="lg">{t('accounting:monthClose.columns.source')}</TableHead>
                  <TableHead priority="lg">{t('accounting:monthClose.columns.archive')}</TableHead>
                  <TableHead priority="md">{t('accounting:monthClose.columns.status')}</TableHead>
                  <TableHead className="text-right">
                    {t('accounting:monthClose.columns.amount')}
                  </TableHead>
                  <TableHead className="w-1 text-right">
                    <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const rowKey = item.kind === 'record' ? item.id : item.expectedId
                  const partner = item.counterpartyName || '—'
                  const srcText = sourceLabel(item)
                  const docText =
                    item.kind === 'record'
                      ? [item.documentNumber, formatDate(item.issuedAt)].filter(Boolean).join(' · ')
                      : formatDate(item.expectedDate)

                  const archiveBadge =
                    item.kind === 'record' ? (
                      item.isArchived ? (
                        item.archiveFileId && canArchiveView ? (
                          <Link
                            to="/archive"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex"
                            title={t('accounting:monthClose.archive.openInArchive')}
                          >
                            <StatePill tone="success">
                              {t('accounting:monthClose.archive.archived')}
                            </StatePill>
                          </Link>
                        ) : (
                          <StatePill tone="success">
                            {t('accounting:monthClose.archive.archived')}
                          </StatePill>
                        )
                      ) : item.hasPdf || item.hasXml ? (
                        <StatePill tone="warning">
                          {t('accounting:monthClose.archive.missing')}
                        </StatePill>
                      ) : (
                        <StatePill tone="neutral">
                          {t('accounting:monthClose.archive.notApplicable')}
                        </StatePill>
                      )
                    ) : (
                      <StatePill tone="neutral">
                        {t('accounting:monthClose.archive.notApplicable')}
                      </StatePill>
                    )

                  const statusBadge =
                    item.kind === 'record' && item.needsReview ? (
                      <StatePill tone="warning">
                        {t('accounting:monthClose.status.needsReview')}
                      </StatePill>
                    ) : item.kind === 'expected' ? (
                      <StatePill tone="warning">
                        {t('accounting:monthClose.status.expectedMissing')}
                      </StatePill>
                    ) : item.kind === 'record' &&
                      item.source === 'recurring_expense' &&
                      !item.hasPdf ? (
                      <StatePill tone="warning">
                        {t('accounting:monthClose.status.awaitingPdf')}
                      </StatePill>
                    ) : item.kind === 'record' ? (
                      <StatePill
                        tone={
                          item.paymentStatus === 'paid'
                            ? 'success'
                            : item.paymentStatus === 'partial'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`accounting:status.${item.paymentStatus}` as const)}
                      </StatePill>
                    ) : null

                  const inlineActions: RowAction[] = []
                  const menuActions: RowAction[] = []

                  if (item.kind === 'record') {
                    if (item.needsReview && canIssue) {
                      inlineActions.push({
                        key: 'confirm',
                        icon: FileCheck,
                        label: t('accounting:monthClose.actions.confirmReview'),
                        onClick: () =>
                          setDialogTarget({
                            mode: 'confirm',
                            recordId: item.id,
                            counterpartyName: item.counterpartyName,
                            counterpartyCif: item.counterpartyCif,
                            counterpartyCountry: item.counterpartyCountry,
                            documentNumber: item.documentNumber,
                            issuedAt: item.issuedAt,
                            amount: item.amount,
                            currency: item.currency,
                            reverseChargeType: item.reverseChargeType,
                            reverseChargeVatRate: item.reverseChargeVatRate,
                          }),
                      })
                    }

                    if ((item.hasPdf || item.hasXml) && !item.isArchived && canIssue) {
                      const archiveAction: RowAction = {
                        key: 'archive',
                        icon: Archive,
                        label: t('accounting:monthClose.actions.archiveNow'),
                        disabled: archiveRecord.isPending,
                        onClick: () =>
                          archiveRecord.mutate(item.id, {
                            onSuccess: () =>
                              toast.success(
                                t('accounting:monthClose.archivedToast', { count: 1 }),
                              ),
                            onError: (err) => toastError(err),
                          }),
                      }
                      if (inlineActions.length === 0) inlineActions.push(archiveAction)
                      else menuActions.push(archiveAction)
                    }

                    if (!item.hasPdf && item.direction === 'in' && canIssue) {
                      const uploadAction: RowAction = {
                        key: 'upload-pdf',
                        icon: Upload,
                        label: t('accounting:monthClose.actions.uploadPdf'),
                        onClick: () =>
                          setDialogTarget({
                            mode: 'upload-pdf',
                            recordId: item.id,
                            counterpartyName: item.counterpartyName,
                            documentNumber: item.documentNumber,
                          }),
                      }
                      if (inlineActions.length === 0) inlineActions.push(uploadAction)
                      else menuActions.push(uploadAction)
                    }

                    if (item.emailMessageId && canEmail) {
                      const query = item.senderSearchHint || item.counterpartyName || ''
                      menuActions.push({
                        key: 'open-email',
                        icon: Mail,
                        label: t('accounting:monthClose.actions.openEmail'),
                        onClick: () =>
                          navigate(`/email?q=${encodeURIComponent(query)}`),
                      })
                    }

                    menuActions.push({
                      key: 'open-record',
                      icon: ExternalLink,
                      label: t('accounting:monthClose.actions.openRecord'),
                      onClick: () => navigate(`/accounting/records/${item.id}`),
                    })
                  } else {
                    if (canIssue) {
                      inlineActions.push({
                        key: 'fulfill',
                        icon: Upload,
                        label: t('accounting:monthClose.actions.uploadPdf'),
                        onClick: () =>
                          setDialogTarget({
                            mode: 'fulfill',
                            month,
                            expected: item,
                          }),
                      })
                    }
                    if (item.senderSearchHint && canEmail) {
                      menuActions.push({
                        key: 'search-email',
                        icon: Mail,
                        label: t('accounting:monthClose.actions.searchInEmail'),
                        onClick: () =>
                          navigate(`/email?q=${encodeURIComponent(item.senderSearchHint ?? '')}`),
                      })
                    }
                  }

                  return (
                    <TableRow
                      key={rowKey}
                      data-row-id={rowKey}
                      className={item.kind === 'record' ? 'cursor-pointer' : undefined}
                      onClick={() => {
                        if (item.kind === 'record') navigate(`/accounting/records/${item.id}`)
                      }}
                    >
                      <TableCell className="tbl-fill font-medium">
                        <div className="truncate">{partner}</div>
                        <TableDetails
                          items={[
                            docText,
                            srcText,
                            item.kind === 'record' && item.isArchived
                              ? t('accounting:monthClose.archive.archived')
                              : item.kind === 'record' && (item.hasPdf || item.hasXml)
                                ? t('accounting:monthClose.archive.missing')
                                : null,
                            statusBadge,
                          ]}
                        />
                      </TableCell>
                      <TableCell priority="md" className="whitespace-nowrap text-xs">
                        {docText || '—'}
                      </TableCell>
                      <TableCell priority="lg" className="whitespace-nowrap text-xs">
                        {srcText}
                      </TableCell>
                      <TableCell priority="lg">{archiveBadge}</TableCell>
                      <TableCell priority="md">{statusBadge}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {item.amount !== null ? (
                          <Money amount={item.amount} currency={item.currency} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="w-1 text-right">
                        <RowActions
                          title={partner}
                          actions={inlineActions}
                          menu={menuActions}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmSupplierInvoiceDialog
        target={dialogTarget}
        onOpenChange={(open) => {
          if (!open) setDialogTarget(null)
        }}
      />
    </div>
  )
}
