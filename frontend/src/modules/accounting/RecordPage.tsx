import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Ban, CircleDollarSign, Copy, Download, FileCheck, FileInput, MessageSquareShare, MoreVertical, Pencil, Send, Trash2, Undo2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Money } from '@/shared/components/Money'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Timeline, type TimelineEntry } from '@/shared/components/Timeline'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { useCollapsingTitle } from '@/shared/hooks/use-collapsing-title'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelativeTime } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import type { FinancialRecord, RecordDetail, RecordPayment, RecordTimelineEntry } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { AnafStatusBadge } from './badges'
import { PaymentPeek } from './PaymentPeek'
import { proformaMessage, useProformaActions } from './proforma-actions'
import { useInvalidateRecords, useRecordDetail, useRemovePayment } from './records-api'
import { canRecordPayment, daysOverdue, statusFor } from './records-logic'
import { DueDate, RecordPaymentBadge, methodLabel, paymentWord } from './records-ui'
import { StornoDialog } from './StornoDialog'
import { isFullyStornoed } from './storno-logic'

const TIMELINE_LABELS: Record<string, TKey> = {
  'record.created': 'accounting:records.timeline.created',
  'factura.ciorna.creata': 'accounting:records.timeline.draftCreated',
  'factura.ciorna.editata': 'accounting:records.timeline.draftEdited',
  'factura.ciorna.stearsa': 'accounting:records.timeline.draftDeleted',
  'factura.emitata': 'accounting:records.timeline.issued',
  'factura.trimisa.anaf': 'accounting:records.timeline.sentAnaf',
  'factura.anaf.validata': 'accounting:records.timeline.anafValidated',
  'factura.anaf.respinsa': 'accounting:records.timeline.anafRejected',
  'factura.plata.adaugata': 'accounting:records.timeline.paymentAdded',
  'factura.plata.stearsa': 'accounting:records.timeline.paymentRemoved',
  'factura.duplicata': 'accounting:records.timeline.duplicated',
  'factura.storno.creata': 'accounting:records.timeline.stornoCreated',
  'factura.storno.emisa': 'accounting:records.timeline.stornoIssued',
  'factura.din.proforma': 'accounting:records.timeline.fromProforma',
  'reconciliere.potrivire.manuala': 'accounting:records.timeline.bankMatched',
}

// Audit details are `{ field: [before, after] }`; a payment row from the payments table carries plain fields.
function firstOf(detail: Record<string, unknown> | null, key: string): string | null {
  const value = detail?.[key]
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null
}

function timelineLabel(entry: RecordTimelineEntry): string {
  // A key this build does not know yet still reads as a line, not as a crash.
  const key = TIMELINE_LABELS[entry.kind] ?? 'accounting:records.timeline.unknown'
  if (entry.kind === 'factura.plata.adaugata') {
    const amount = typeof entry.detail?.amount === 'number' ? formatMoney(entry.detail.amount, String(entry.detail.currency ?? '')) : ''
    return t(key, { amount })
  }
  if (entry.kind === 'factura.plata.stearsa') return t(key, { amount: firstOf(entry.detail, 'suma') ?? '' })
  return t(key)
}

function toTimeline(entries: RecordTimelineEntry[]): TimelineEntry[] {
  return entries
    .map((entry, index) => ({
      id: `${entry.at}-${index}`,
      author: null,
      at: entry.at,
      text: (
        <>
          {timelineLabel(entry)}
          <span className="text-muted-foreground"> · {entry.actor?.name ?? t('accounting:records.timeline.system')}</span>
        </>
      ),
    }))
    .reverse()
}

export function RecordPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const detail = useRecordDetail(id)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleCollapsed = useCollapsingTitle(titleRef)

  const back = (direction: 'in' | 'out' | undefined, tab = direction === 'in' ? 'primite' : 'emise') => {
    if (location.key !== 'default') navigate(-1)
    else navigate(`/accounting?tab=${tab}`)
  }

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError || !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => back(undefined)}>
          <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
        </Button>
        {missing ? (
          <EmptyState kind="new" title={t('accounting:records.page.missing')} description={t('accounting:records.page.missingHint')} />
        ) : (
          <Alert
            tone="critical"
            title={t('accounting:records.page.loadFailed')}
            action={
              <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {t('accounting:records.loadFailedHint')}
          </Alert>
        )}
      </div>
    )
  }

  const data = detail.data
  const title = data.record.documentNumber ?? (data.record.direction === 'out' ? t('accounting:issued.draftMarker') : (data.record.counterpartyName ?? t('common:labels.document')))
  return (
    <>
      {/* On a phone the title climbs into the top bar once the heading has scrolled away. */}
      <div className="sticky top-0 z-30 h-0 md:hidden">
        <div
          aria-hidden={!titleCollapsed}
          className={cn(
            'glass absolute inset-x-0 top-0 truncate border-b px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-sm font-medium transition-opacity duration-fast',
            titleCollapsed ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {title}
        </div>
      </div>
      <RecordBody data={data} title={title} titleRef={titleRef} onBack={() => back(data.record.direction, data.proforma ? 'proforme' : undefined)} />
    </>
  )
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" aria-hidden="true">
      <Skeleton className="h-control-md w-24" />
      <div className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ListSkeleton rows={4} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-control-md items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function RecordBody({ data, title, titleRef, onBack }: { data: RecordDetail; title: string; titleRef: React.RefObject<HTMLHeadingElement>; onBack: () => void }) {
  const { record, remaining } = data
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can } = useMe()
  const invalidate = useInvalidateRecords()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const [paying, setPaying] = useState(false)
  const [storno, setStorno] = useState(false)
  const proformaActions = useProformaActions()
  const canIssue = can('facturi.emitere')
  const canAnaf = can('facturi.anaf')
  const out = record.direction === 'out'
  const isDraft = record.isDraft
  const isProforma = Boolean(data.proforma)
  // Issued proformas are open, invoiced or cancelled; the last two are read-only (the server refuses changes too).
  const proformaStatus = isDraft ? null : (data.proforma?.status ?? 'open')
  const proformaOpen = isProforma && !isDraft && proformaStatus === 'open'
  // Only an issued, numbered invoice that is not itself a credit note can be reversed, and not once it is fully reversed.
  const canStorno = canIssue && out && !isDraft && !isProforma && record.type === 'invoice' && Boolean(record.documentNumber) && !data.storno.corrects && !isFullyStornoed(Number(record.amount), data.storno.correctedBy)
  const overdue = !isDraft && remaining > 0 && daysOverdue(record.dueAt) > 0
  const canPay = canIssue && !isProforma && canRecordPayment({ isDraft, remaining })
  const canSend = canAnaf && out && !isDraft && !isProforma && (record.anafStatus === 'draft' || record.anafStatus === 'rejected')
  const rejected = record.anafStatus === 'rejected'

  const issue = useMutation({
    mutationFn: () => api.post<FinancialRecord>(`/api/invoicing/invoices/${record.id}/issue`),
    onSuccess: (invoice) => {
      invalidate()
      toast.success(t('accounting:issued.issuedToast', { documentNumber: invoice.documentNumber }))
    },
    onError: (err) => toast.error(err.message),
  })
  const sendAnaf = useMutation({
    mutationFn: () => api.post<FinancialRecord>(`/api/invoicing/invoices/${record.id}/send-anaf`),
    onSuccess: () => {
      invalidate()
      toast.success(t('accounting:issued.sentToAnaf'))
    },
    onError: (err) => toast.error(err.message),
  })
  const removeDraft = useMutation({
    mutationFn: () => api.delete<void>(`/api/invoicing/${isProforma ? 'proformas' : 'invoices'}/${record.id}`),
    onSuccess: () => {
      invalidate()
      toast.success(isProforma ? t('accounting:proformas.deleted') : t('accounting:issued.draftDeleted'))
      navigate(`/accounting?tab=${isProforma ? 'proforme' : 'emise'}`, { replace: true })
    },
    onError: (err) => toast.error(isProforma ? proformaMessage(err) : err.message),
  })
  const duplicate = useMutation({
    mutationFn: () => api.post<FinancialRecord>(`/api/invoicing/invoices/${record.id}/duplicate`),
    onSuccess: (draft) => {
      invalidate()
      toast.success(t('accounting:records.page.duplicated'))
      navigate(`/accounting/records/${draft.id}`)
    },
    onError: (err) => toast.error(err.message),
  })

  // The buttons are the transitions out of the current state, one primary at most.
  const primary = isDraft ? 'issue' : proformaOpen && canIssue ? 'convert' : rejected && canSend ? 'resend' : canPay ? 'pay' : canSend ? 'anaf' : null
  const payLabel = out ? t('accounting:records.recordPaymentOut') : t('accounting:records.recordPaymentIn')
  const menu: Array<{ key: string; icon: typeof Download; label: string; destructive?: boolean; onClick: () => void }> = [
    ...(!isDraft && canIssue && out && !isProforma ? [{ key: 'duplicate', icon: Copy, label: t('accounting:records.page.duplicate'), onClick: () => duplicate.mutate() }] : []),
    ...(canStorno ? [{ key: 'storno', icon: Undo2, label: t('accounting:storno.action'), onClick: () => setStorno(true) }] : []),
    ...(proformaOpen && canIssue ? [{ key: 'cancel-proforma', icon: Ban, label: t('accounting:proformas.cancel'), destructive: true, onClick: () => proformaActions.askCancel(record.id, title) }] : []),
    ...(canShare ? [{ key: 'share', icon: MessageSquareShare, label: t('messages:share.action'), onClick: () => share({ type: 'invoice', id: record.id, title: title }) }] : []),
    ...(record.hasPdf ? [{ key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/accounting/records/${record.id}/pdf`, 'document.pdf') }] : []),
    ...(record.hasXml ? [{ key: 'xml', icon: Download, label: t('accounting:actions.downloadXml'), onClick: () => openFile(`/api/accounting/records/${record.id}/xml`, 'document.xml') }] : []),
    ...(canAnaf && record.hasAnafPdf ? [{ key: 'anaf-pdf', icon: Download, label: t('accounting:issued.downloadEfacturaPdf'), onClick: () => openFile(`/api/accounting/records/${record.id}/anaf-pdf`, 'document.pdf') }] : []),
    ...(out && record.paymentStatus === 'paid' ? [{ key: 'confirmation', icon: Download, label: t('accounting:issued.downloadConfirmation'), onClick: () => openFile(`/api/accounting/records/${record.id}/confirmation-pdf`, 'document.pdf') }] : []),
    ...(isDraft && canIssue
      ? [
          {
            key: 'delete',
            icon: Trash2,
            label: isProforma ? t('accounting:proformas.deleteDraft') : t('accounting:issued.deleteDraft'),
            destructive: true,
            onClick: () => {
              if (isProforma) {
                void confirm({ title: t('accounting:proformas.deleteTitle'), consequence: t('accounting:proformas.deleteBody'), confirmLabel: t('accounting:proformas.deleteDraft'), destructive: true }).then((ok) => ok && removeDraft.mutate())
                return
              }
              void confirm({ title: record.counterpartyName ? t('accounting:issued.deleteDraftFor', { name: record.counterpartyName }) : t('accounting:issued.deleteDraftForClient'), consequence: t('accounting:issued.deleteDraftBody'), confirmLabel: t('accounting:issued.deleteDraft'), destructive: true }).then((ok) => ok && removeDraft.mutate())
            },
          },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8" data-testid="record-page">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isDraft && canIssue ? (
              <>
                <Button variant="outline" onClick={() => navigate(`/accounting/records/${record.id}/edit`)}>
                  <Pencil aria-hidden="true" /> {t('common:actions.edit')}
                </Button>
                {/* A proforma is issued from the editor, which has the confirmation step; the invoice route would refuse it. */}
                <Button disabled={issue.isPending} onClick={() => (isProforma ? navigate(`/accounting/records/${record.id}/edit`) : issue.mutate())} data-testid="record-issue">
                  <FileCheck aria-hidden="true" /> {t('accounting:records.page.issue')}
                </Button>
              </>
            ) : null}
            {proformaOpen && canIssue ? (
              <Button disabled={proformaActions.busy} onClick={() => proformaActions.convert.mutate(record.id)} data-testid="proforma-convert">
                <FileInput aria-hidden="true" /> {t('accounting:proformas.convert')}
              </Button>
            ) : null}
            {canPay ? (
              <Button variant={primary === 'pay' ? 'default' : 'outline'} onClick={() => setPaying(true)} data-testid="record-pay">
                <CircleDollarSign aria-hidden="true" /> {payLabel}
              </Button>
            ) : null}
            {canSend ? (
              <Button variant={primary === 'resend' || primary === 'anaf' ? 'default' : 'outline'} disabled={sendAnaf.isPending} onClick={() => sendAnaf.mutate()}>
                <Send aria-hidden="true" /> {rejected ? t('accounting:issued.resendToAnaf') : t('accounting:issued.sendToAnaf')}
              </Button>
            ) : null}
            {menu.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-control-md w-control-md items-center justify-center rounded-md border border-border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">{t('common:labels.actions')}</span>
                </DropdownMenuTrigger>
                <ResponsiveMenuContent title={title}>
                  {menu.map((action) => (
                    <DropdownMenuItem key={action.key} destructive={action.destructive} onClick={action.onClick}>
                      <action.icon className="h-4 w-4" /> {action.label}
                    </DropdownMenuItem>
                  ))}
                </ResponsiveMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 ref={titleRef} className="text-xl font-semibold">
              {title}
            </h1>
            {isProforma ? <StatePill>{t('accounting:records.page.proforma')}</StatePill> : null}
            {data.storno.corrects ? <StatePill tone="warning">{t('accounting:records.page.storno')}</StatePill> : null}
            {out && canAnaf && !isDraft && !isProforma ? <AnafStatusBadge status={record.anafStatus} /> : null}
            {isDraft ? (
              <StatePill>{t('accounting:records.page.draft')}</StatePill>
            ) : isProforma ? (
              <StatePill tone={proformaStatus === 'invoiced' ? 'success' : 'neutral'}>{t(`accounting:proformas.status.${proformaStatus === 'invoiced' || proformaStatus === 'cancelled' ? proformaStatus : 'open'}` as const)}</StatePill>
            ) : (
              <RecordPaymentBadge direction={record.direction} status={record.paymentStatus} remaining={remaining} currency={record.currency} overdue={overdue} />
            )}
          </div>
          <p className="text-3xl font-semibold" data-testid="record-amount">
            <Money amount={record.amount} currency={record.currency} />
          </p>
          {!isDraft && !isProforma && record.paymentStatus === 'partial' ? (
            <p className="text-sm text-muted-foreground">{t('accounting:records.page.paidOf', { paid: formatMoney(record.paidAmount, record.currency), rest: formatMoney(remaining, record.currency) })}</p>
          ) : null}
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <PartnerLink record={record} canClients={can('facturi.clienti')} />
            <span>
              {t('accounting:labels.issued')} {formatDate(record.issuedAt)}
            </span>
            {record.dueAt ? (
              <span>
                {t('accounting:labels.due')} <DueDate dueAt={record.dueAt} overdue={overdue} />
              </span>
            ) : null}
          </p>
          <LinkedDocs data={data} />
          {isProforma && (proformaStatus === 'invoiced' || proformaStatus === 'cancelled') ? (
            <p className="text-sm text-muted-foreground">{proformaStatus === 'invoiced' ? t('accounting:proformas.invoicedHint') : t('accounting:proformas.cancelledHint')}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-8">
          {data.lines.length > 0 ? <Lines data={data} /> : null}
          {!isDraft && !isProforma ? <Payments data={data} canIssue={canIssue} canPay={canPay} onPay={() => setPaying(true)} /> : null}
        </div>
        <aside className="min-w-0 space-y-8">
          <Section title={t('accounting:records.page.history')}>
            <Timeline entries={toTimeline(data.timeline)} />
          </Section>
          {data.sameClient.count > 0 ? (
            <Section title={out ? t('accounting:records.page.sameClient') : t('accounting:records.page.sameSupplier')}>
              <p className="text-sm" data-testid="same-client">
                {t('accounting:records.page.sameClientLine', { total: formatMoney(data.sameClient.total, data.sameClient.currency), count: data.sameClient.count })}
              </p>
            </Section>
          ) : null}
          {can('mesaje.view') ? <DiscussedIn recordId={record.id} /> : null}
        </aside>
      </div>

      <PaymentPeek
        record={paying ? { id: record.id, direction: record.direction, currency: record.currency, amount: record.amount, documentNumber: record.documentNumber, counterpartyName: record.counterpartyName, paymentStatus: record.paymentStatus, remaining } : null}
        onClose={() => setPaying(false)}
      />
      {canStorno ? <StornoDialog data={data} open={storno} onOpenChange={setStorno} /> : null}
      {shareDialog}
    </div>
  )
}

function PartnerLink({ record, canClients }: { record: FinancialRecord; canClients: boolean }) {
  const name = record.counterpartyName
  if (!name) return null
  return (
    <span className="min-w-0 truncate">
      {record.direction === 'out' && record.billingClientId && canClients ? (
        <Link to="/clients?tab=activi" className="font-medium text-foreground underline-offset-2 hover:underline">
          {name}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{name}</span>
      )}
      {record.counterpartyCif ? <span className="ml-2 font-mono text-xs">{record.counterpartyCif}</span> : null}
    </span>
  )
}

function LinkedDocs({ data }: { data: RecordDetail }) {
  const { corrects, correctedBy } = data.storno
  const convertedTo = data.proforma?.convertedTo
  const items: ReactNode[] = []
  if (corrects) {
    items.push(
      <span key="corrects">
        {t('accounting:records.page.corrects')}{' '}
        <Link to={`/accounting/records/${corrects.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
          {corrects.documentNumber}
        </Link>
      </span>,
    )
  }
  if (correctedBy.length > 0) {
    items.push(
      <span key="by">
        {isFullyStornoed(Number(data.record.amount), correctedBy) ? t('accounting:storno.correctedFull') : t('accounting:storno.correctedPartial')}{' '}
        {correctedBy.map((doc, index) => (
          <span key={doc.id}>
            {index > 0 ? ', ' : null}
            <Link to={`/accounting/records/${doc.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
              {doc.documentNumber}
            </Link>
          </span>
        ))}
      </span>,
    )
  }
  if (convertedTo) {
    items.push(
      <span key="converted">
        {t('accounting:records.page.invoicedAs')}{' '}
        <Link to={`/accounting/records/${convertedTo.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
          {convertedTo.documentNumber}
        </Link>
      </span>,
    )
  }
  if (items.length === 0) return null
  return <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">{items}</p>
}

function Lines({ data }: { data: RecordDetail }) {
  const { record, lines, totals } = data
  return (
    <Section title={t('accounting:records.page.lines')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:labels.description')}</TableHead>
            <TableHead priority="md" className="text-right">{t('accounting:records.page.quantity')}</TableHead>
            <TableHead priority="md" className="text-right">{t('accounting:records.page.unitPrice')}</TableHead>
            <TableHead priority="lg" className="text-right">{t('accounting:records.page.vat')}</TableHead>
            <TableHead className="text-right">{t('accounting:records.page.lineTotal')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="tbl-fill">
                <div className="truncate">{line.description}</div>
                <TableDetails items={[`${formatNumber(line.quantity)} × ${formatMoney(line.unitPrice, record.currency)}`, `${t('accounting:records.page.vat')} ${formatNumber(line.vatRate)}%`]} />
              </TableCell>
              <TableCell priority="md" className="whitespace-nowrap text-right tabular-nums">{formatNumber(line.quantity)}</TableCell>
              <TableCell priority="md" className="whitespace-nowrap text-right"><Money amount={line.unitPrice} currency={record.currency} /></TableCell>
              <TableCell priority="lg" className="whitespace-nowrap text-right tabular-nums">{formatNumber(line.vatRate)}%</TableCell>
              <TableCell className="whitespace-nowrap text-right"><Money amount={line.quantity * line.unitPrice} currency={record.currency} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {totals.net !== null && totals.vat !== null ? (
          <>
            <dt className="text-muted-foreground">{t('accounting:records.page.net')}</dt>
            <dd className="text-right"><Money amount={totals.net} currency={record.currency} /></dd>
            <dt className="text-muted-foreground">{t('accounting:records.page.vatAmount')}</dt>
            <dd className="text-right"><Money amount={totals.vat} currency={record.currency} /></dd>
          </>
        ) : null}
        <dt className="font-medium">{t('accounting:records.page.grossTotal')}</dt>
        <dd className="text-right font-semibold"><Money amount={totals.gross} currency={record.currency} /></dd>
      </dl>
    </Section>
  )
}

function Payments({ data, canIssue, canPay, onPay }: { data: RecordDetail; canIssue: boolean; canPay: boolean; onPay: () => void }) {
  const { record, payments, remaining } = data
  const confirm = useConfirm()
  const remove = useRemovePayment(record.direction, record.id)
  const out = record.direction === 'out'
  const amount = Number(record.amount)

  const askRemove = (payment: RecordPayment) => {
    const after = Math.round((remaining + payment.amount) * 100) / 100
    const next = statusFor(after, amount)
    void confirm({
      title: t('accounting:records.payments.removeTitle', { amount: formatMoney(payment.amount, payment.currency), date: formatDate(payment.paidAt) }),
      consequence: t('accounting:records.payments.removeBody', { from: paymentWord(record.direction, record.paymentStatus), to: paymentWord(record.direction, next), rest: formatMoney(after, record.currency) }),
      confirmLabel: t('accounting:records.payments.removeConfirm'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      remove.mutate(payment.id, {
        onSuccess: () => toast.success(t('accounting:records.payments.removed', { amount: formatMoney(payment.amount, payment.currency) })),
        onError: (err) => toast.error(err.message),
      })
    })
  }

  return (
    <Section
      title={out ? t('accounting:records.payments.titleOut') : t('accounting:records.payments.titleIn')}
      action={
        canPay && payments.length > 0 ? (
          <Button variant="outline" size="sm" onClick={onPay}>
            {out ? t('accounting:records.recordPaymentOut') : t('accounting:records.recordPaymentIn')}
          </Button>
        ) : null
      }
    >
      {payments.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{out ? t('accounting:records.payments.emptyOut') : t('accounting:records.payments.emptyIn')}</span>
          {canPay ? (
            <Button variant="outline" size="sm" onClick={onPay}>
              {out ? t('accounting:records.recordPaymentOut') : t('accounting:records.recordPaymentIn')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y text-sm" data-testid="record-payments">
          {payments.map((payment) => (
            <li key={payment.id} className="flex min-h-control-lg items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="whitespace-nowrap">{formatDate(payment.paidAt)}</span>
                  <span className="text-muted-foreground">{methodLabel(payment.method)}{payment.fromBank ? ` · ${t('accounting:records.payments.fromBank')}` : ''}</span>
                </div>
                {payment.reference || payment.note ? <div className="truncate text-xs text-muted-foreground">{[payment.reference, payment.note].filter(Boolean).join(' · ')}</div> : null}
                <div className="text-xs text-muted-foreground" title={formatDateTime(payment.createdAt)}>
                  {payment.createdBy?.name ? `${payment.createdBy.name} · ` : ''}
                  {formatRelativeTime(payment.createdAt)}
                </div>
              </div>
              <span className="whitespace-nowrap text-right font-medium"><Money amount={payment.amount} currency={payment.currency} /></span>
              {canIssue ? (
                <Button variant="ghost" size="icon" aria-label={t('accounting:records.payments.removeLabel', { amount: formatMoney(payment.amount, payment.currency), date: formatDate(payment.paidAt) })} disabled={remove.isPending} onClick={() => askRemove(payment)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {payments.length > 0 ? (
        <p className="text-right text-sm" data-testid="record-rest">
          {remaining > 0 ? t('accounting:records.payments.rest', { rest: formatMoney(remaining, record.currency) }) : out ? t('accounting:records.payments.settledOut') : t('accounting:records.payments.settledIn')}
        </p>
      ) : null}
    </Section>
  )
}

interface DiscussedRow {
  conversationId: string
  title: string
  lastSharedAt: string
}

function DiscussedIn({ recordId }: { recordId: string }) {
  const discussed = useQuery({
    queryKey: ['accounting', 'records', 'discussed', recordId],
    queryFn: () => api.get<DiscussedRow[]>(`/api/chat/refs?type=invoice&id=${recordId}`),
  })
  const rows = discussed.data ?? []
  return (
    <Section title={t('accounting:records.page.discussed')}>
      {discussed.isPending ? (
        <ListSkeleton rows={1} lines={1} />
      ) : discussed.isError ? (
        <p className="text-sm text-muted-foreground">{t('accounting:records.page.discussedFailed')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('accounting:records.page.discussedEmpty')}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.conversationId} className="flex min-w-0 items-baseline justify-between gap-3">
              <Link to={`/messages/${row.conversationId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
                {row.title || t('accounting:records.page.discussedUntitled')}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(row.lastSharedAt)}>
                {formatRelativeTime(row.lastSharedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
