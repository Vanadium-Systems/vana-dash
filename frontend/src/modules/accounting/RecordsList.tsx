import { useMutation } from '@tanstack/react-query'
import { CircleDollarSign, Download, FileCheck, MessageSquareShare, Pencil, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FilterBar, useFilterState, useSearchState } from '@/shared/components/FilterBar'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PAGE_SIZES, TablePagination } from '@/shared/components/ui/table-pagination'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { dayOf, type FilterField } from '@/shared/lib/filters'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import type { FinancialRecord, RecordRow, RecordTab } from '@/shared/lib/types'
import { AnafStatusBadge } from './badges'
import { PaymentPeek } from './PaymentPeek'
import { useInvalidateRecords, useRecordsPage } from './records-api'
import { canRecordPayment } from './records-logic'
import { AmountCell, DueDate, RecordPaymentBadge, TotalsBand } from './records-ui'

const TABS_OUT: RecordTab[] = ['all', 'draft', 'open', 'overdue', 'paid', 'rejected']
const TABS_IN: RecordTab[] = ['all', 'open', 'overdue', 'paid']
const PERIOD_FIELD = 'issued'

interface RecordsListProps {
  direction: 'in' | 'out'
  /** Emise: the form dialog lives in the tab, the list only asks to open it. */
  onCreate?: () => void
}

// Everything the person narrows by lives in the URL (status, period, search, page) and goes to the
// server, so a pasted link shows the same rows and the totals above them follow the filters.
export function RecordsList({ direction, onCreate }: RecordsListProps) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can } = useMe()
  const canIssue = can('facturi.emitere')
  const canAnaf = can('facturi.anaf')
  const invalidate = useInvalidateRecords()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const [paying, setPaying] = useState<RecordRow | null>(null)

  const [statusParam, setStatus] = useUrlState('status', 'all')
  const [search, setSearch] = useSearchState()
  const [clauses, setClauses] = useFilterState()
  const [pageParam, setPage] = useUrlState('page', '1')
  const [sizeParam, setPageSize] = useUrlState('size', String(PAGE_SIZES[0]))

  const tabs = direction === 'out' ? TABS_OUT.filter((tab) => tab !== 'rejected' || canAnaf) : TABS_IN
  const tab = tabs.find((entry) => entry === statusParam) ?? 'all'
  const pageSize = PAGE_SIZES.find((size) => String(size) === sizeParam) ?? PAGE_SIZES[0]
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)

  const period = clauses.find((clause) => clause.field === PERIOD_FIELD)
  const [from, to] = period?.op === 'between' ? [dayOf(period.value[0]), dayOf(period.value[1])] : [null, null]

  const list = useRecordsPage({ direction, tab, q: search, from, to, page, pageSize })
  const rows = list.data?.items ?? []
  const total = list.data?.total ?? 0

  // Back to the first page whenever the narrowing changes; a page past the end (a shorter list) too.
  const narrowing = `${tab}|${search}|${from}|${to}|${pageSize}`
  const [seen, setSeen] = useState(narrowing)
  useEffect(() => {
    if (seen === narrowing) return
    setSeen(narrowing)
    setPage('1')
  }, [narrowing, seen, setPage])
  useEffect(() => {
    if (list.data && page > 1 && rows.length === 0 && total > 0) setPage(String(Math.ceil(total / pageSize)))
  }, [list.data, page, rows.length, total, pageSize, setPage])

  const fields: FilterField[] = useMemo(() => [{ key: PERIOD_FIELD, label: t('accounting:labels.issued'), type: 'date', defaultPinned: true }], [])
  const narrowed = Boolean(search || period)
  const reset = () => {
    setClauses([])
    setSearch('')
    setStatus('all')
  }

  const issue = useMutation({
    mutationFn: (id: string) => api.post<FinancialRecord>(`/api/invoicing/invoices/${id}/issue`),
    onSuccess: (invoice) => {
      invalidate()
      toast.success(t('accounting:issued.issuedToast', { documentNumber: invoice.documentNumber }))
    },
    onError: (err) => toast.error(err.message),
  })
  const sendAnaf = useMutation({
    mutationFn: (id: string) => api.post<FinancialRecord>(`/api/invoicing/invoices/${id}/send-anaf`),
    onSuccess: () => {
      invalidate()
      toast.success(t('accounting:issued.sentToAnaf'))
    },
    onError: (err) => toast.error(err.message),
  })
  const removeDraft = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/invoicing/invoices/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success(t('accounting:issued.draftDeleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const open = (id: string) => navigate(`/accounting/records/${id}`)
  const firstColumn = direction === 'out' ? t('accounting:labels.number') : t('accounting:labels.supplier')

  return (
    <div className="space-y-4">
      <TotalsBand direction={direction} totals={list.data?.totals} loading={list.isPending} stale={list.isPlaceholderData} />

      <FilterBar
        fields={fields}
        clauses={clauses}
        onChange={setClauses}
        search={search}
        onSearch={setSearch}
        count={list.data ? total : undefined}
        pinnedStorageKey={`vd.filters.records.${direction}`}
      />

      <Tabs value={tab} onValueChange={setStatus}>
        <TabsList variant="segmented">
          {tabs.map((entry) => (
            <TabsTrigger key={entry} value={entry} data-testid={`records-tab-${entry}`}>
              {t(`accounting:records.tabs.${direction}.${entry}` as const)}
              {list.data ? <span className="ml-1.5 tnum text-xs text-muted-foreground">{formatNumber(list.data.counts[entry])}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {list.isPending ? (
            <ListSkeleton rows={pageSize > 10 ? 8 : 5} />
          ) : list.isError && !list.data ? (
            <Alert
              tone="critical"
              title={t('accounting:records.loadFailed')}
              action={
                <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {t('accounting:records.loadFailedHint')}
            </Alert>
          ) : rows.length === 0 ? (
            narrowed || tab !== 'all' ? (
              <EmptyState kind="filtered" title={t('accounting:records.noMatch')} description={t('accounting:records.noMatchHint')} onReset={reset} />
            ) : (
              <EmptyState
                kind="new"
                title={direction === 'out' ? t('accounting:issued.empty') : t('accounting:received.empty')}
                action={
                  direction === 'out' && canIssue && onCreate ? <Button onClick={onCreate}>{t('accounting:editor.titleNewInvoice')}</Button> : null
                }
              />
            )
          ) : (
            <div className={list.isFetching ? 'opacity-70 transition-opacity duration-fast' : 'transition-opacity duration-fast'}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                    <TableHead>{firstColumn}</TableHead>
                    {direction === 'out' ? (
                      <TableHead priority="md">{t('common:labels.client')}</TableHead>
                    ) : (
                      <>
                        <TableHead priority="lg">{t('common:labels.cif')}</TableHead>
                        <TableHead priority="md">{t('common:labels.document')}</TableHead>
                      </>
                    )}
                    <TableHead priority="lg">{t('accounting:labels.issued')}</TableHead>
                    <TableHead priority="md">{t('accounting:labels.due')}</TableHead>
                    <TableHead priority="md">{t('accounting:labels.payment')}</TableHead>
                    {direction === 'out' && canAnaf ? <TableHead priority="lg">ANAF</TableHead> : null}
                    <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isDraft = r.isDraft
                    const isIssued = direction === 'out' && Boolean(r.documentNumber) && r.source === 'generated'
                    const canSend = canAnaf && isIssued && (r.anafStatus === 'draft' || r.anafStatus === 'rejected')
                    const canPay = canIssue && canRecordPayment(r)
                    const name = r.counterpartyName ?? (r.description ?? '—')
                    const payment = isDraft ? null : (
                      <RecordPaymentBadge key="payment" direction={direction} status={r.paymentStatus} remaining={r.remaining} currency={r.currency} overdue={r.isOverdue} />
                    )
                    const todo = direction === 'in' && r.isOverdue && r.paymentStatus !== 'paid'
                    const rowTitle = r.documentNumber ?? (direction === 'out' ? t('accounting:issued.draftMarker') : name)
                    return (
                      <TableRow key={r.id} data-row-id={r.id} className="cursor-pointer" onClick={() => open(r.id)}>
                        <TableCell className="whitespace-nowrap text-right">
                          <AmountCell amount={r.amount} currency={r.currency} secondary={r.companyAmount !== null && list.data ? { amount: r.companyAmount, currency: list.data.companyCurrency } : null} />
                        </TableCell>
                        <TableCell className="tbl-fill font-medium">
                          <button
                            type="button"
                            className="block max-w-full truncate rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(e) => {
                              e.stopPropagation()
                              open(r.id)
                            }}
                          >
                            {rowTitle}
                          </button>
                          <TableDetails
                            items={[
                              direction === 'out' ? name : (r.description ?? null),
                              r.dueAt ? <DueDate key="due" dueAt={r.dueAt} overdue={r.isOverdue && r.paymentStatus !== 'paid'} /> : null,
                              todo ? <span key="todo" className="text-warning-text">{t('accounting:records.todo.pay')}</span> : payment,
                            ]}
                          />
                        </TableCell>
                        {direction === 'out' ? (
                          <TableCell priority="md" truncate>{r.counterpartyName ?? '—'}</TableCell>
                        ) : (
                          <>
                            <TableCell priority="lg" className="whitespace-nowrap font-mono text-xs">{r.counterpartyCif ?? '—'}</TableCell>
                            <TableCell priority="md" truncate>{r.description ?? '—'}</TableCell>
                          </>
                        )}
                        <TableCell priority="lg" className="whitespace-nowrap">{formatDate(r.issuedAt)}</TableCell>
                        <TableCell priority="md">
                          <DueDate dueAt={r.dueAt} overdue={r.isOverdue && r.paymentStatus !== 'paid'} />
                        </TableCell>
                        <TableCell priority="md">
                          {todo ? (
                            // The to-do sits on the row as text with its action next to it, not behind an icon with a tooltip.
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-warning-text">{t('accounting:records.todo.pay')}</span>
                              {canPay ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPaying(r)
                                  }}
                                >
                                  {t('accounting:records.recordPaymentIn')}
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            payment ?? <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {direction === 'out' && canAnaf ? (
                          <TableCell priority="lg">
                            <AnafStatusBadge status={r.anafStatus} />
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right">
                          <RowActions
                            title={rowTitle}
                            actions={[
                              ...(isDraft && canIssue
                                ? [
                                    { key: 'issue', icon: FileCheck, label: t('accounting:issued.issueHint'), disabled: issue.isPending, onClick: () => issue.mutate(r.id) },
                                    { key: 'edit', icon: Pencil, label: t('common:actions.edit'), onClick: () => navigate(`/accounting/records/${r.id}/edit`) },
                                    {
                                      key: 'delete',
                                      icon: Trash2,
                                      label: t('accounting:issued.deleteDraft'),
                                      destructive: true,
                                      onClick: () => {
                                        void confirm({ title: r.counterpartyName ? t('accounting:issued.deleteDraftFor', { name: r.counterpartyName }) : t('accounting:issued.deleteDraftForClient'), consequence: t('accounting:issued.deleteDraftBody'), confirmLabel: t('accounting:issued.deleteDraft'), destructive: true }).then((ok) => ok && removeDraft.mutate(r.id))
                                      },
                                    },
                                  ]
                                : []),
                              ...(canSend
                                ? [{ key: 'anaf', icon: Send, label: r.anafStatus === 'rejected' ? t('accounting:issued.resendToAnaf') : t('accounting:issued.sendToAnaf'), disabled: sendAnaf.isPending, onClick: () => sendAnaf.mutate(r.id) }]
                                : []),
                              ...(canPay
                                ? [{ key: 'pay', icon: CircleDollarSign, label: direction === 'out' ? t('accounting:records.recordPaymentOut') : t('accounting:records.recordPaymentIn'), onClick: () => setPaying(r) }]
                                : []),
                            ]}
                            menu={[
                              ...(canShare
                                ? [{ key: 'share', icon: MessageSquareShare, label: t('messages:share.action'), onClick: () => share({ type: 'invoice', id: r.id, title: r.documentNumber ?? r.counterpartyName ?? t('accounting:issued.draftMarker') }) }]
                                : []),
                              ...(r.hasPdf ? [{ key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/accounting/records/${r.id}/pdf`, 'document.pdf') }] : []),
                              ...(r.hasXml ? [{ key: 'xml', icon: Download, label: t('accounting:actions.downloadXml'), onClick: () => openFile(`/api/accounting/records/${r.id}/xml`, 'document.xml') }] : []),
                              ...(canAnaf && r.hasAnafPdf ? [{ key: 'anaf-pdf', icon: Download, label: t('accounting:issued.downloadEfacturaPdf'), onClick: () => openFile(`/api/accounting/records/${r.id}/anaf-pdf`, 'document.pdf') }] : []),
                              ...(direction === 'out' && r.paymentStatus === 'paid' ? [{ key: 'confirmation', icon: Download, label: t('accounting:issued.downloadConfirmation'), onClick: () => openFile(`/api/accounting/records/${r.id}/confirmation-pdf`, 'document.pdf') }] : []),
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <TablePagination page={page - 1} pageSize={pageSize} total={total} onPage={(next) => setPage(String(next + 1))} onPageSize={(size) => setPageSize(String(size))} />
            </div>
          )}
        </CardContent>
      </Card>
      <PaymentPeek record={paying} onClose={() => setPaying(null)} />
      {shareDialog}
    </div>
  )
}
