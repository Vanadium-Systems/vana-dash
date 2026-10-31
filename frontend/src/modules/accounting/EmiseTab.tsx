import { Money } from '@/shared/components/Money'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileCheck,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { FinancialRecord } from '@/shared/lib/types'
import { AnafStatusBadge, PaymentStatusBadge, formatDate } from './badges'
import { InvoiceFormDialog } from './InvoiceFormDialog'
import { PastRecordFormDialog } from './PastRecordFormDialog'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useMe } from '@/shared/hooks/use-me'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'

const PAGE_SIZE = 10

export function EmiseTab() {
  const confirm = useConfirm()
  // Emis, editat și trimis la ANAF sunt trei funcționalități diferite: cine vede facturile
  // nu poate neapărat să le emită sau să le urce pe portal.
  const { can } = useMe()
  const canIssue = can('facturi.emitere')
  const canAnaf = can('facturi.anaf')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FinancialRecord | null>(null)
  const [pastDialogOpen, setPastDialogOpen] = useState(false)
  useConsumeParam('new', () => {
    setEditing(null)
    setDialogOpen(true)
  })
  const [page, setPage] = useState(0)

  const records = useQuery({
    queryKey: ['accounting', 'records', 'out'],
    queryFn: () => api.get<FinancialRecord[]>('/api/accounting/records?direction=out'),
  })

  const total = records.data?.length ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const safePage = Math.min(page, maxPage)
  const pageRecords = records.data?.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['accounting'] })

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

  // Confirmare manuală — pt. plăți cash/alt canal, fără match bancar. Declanșează
  // exact același cod ca match-ul bancar automat (extindere abonament vanagreen,
  // dacă clientul e mapat) — utilă mai ales pt. teste, cât timp automatul nu rulează.
  const markPaid = useMutation({
    mutationFn: (id: string) => api.post<FinancialRecord>(`/api/reconciliation/invoices/${id}/mark-paid`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      // confirmarea manuală creează un payment_match — contorul de nematchuite din Reconciliere
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
      toast.success(t('accounting:issued.markedPaid'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canIssue ? (
          <>
            <Button variant="outline" onClick={() => setPastDialogOpen(true)}>
              <Archive className="h-4 w-4" /> {t('accounting:issued.oldRecord')}
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> {t('accounting:invoiceForm.newTitle')}
            </Button>
          </>
        ) : null}
      </div>
      <Card>
        <CardContent className="pt-6">
          {records.isPending ? (
            <ListSkeleton rows={4} />
          ) : !records.data?.length ? (
            <EmptyState
              kind="new"
              title={t('accounting:issued.empty')}
              action={
                canIssue ? (
                  <Button
                    onClick={() => {
                      setEditing(null)
                      setDialogOpen(true)
                    }}
                  >
                    {t('accounting:invoiceForm.newTitle')}
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accounting:labels.number')}</TableHead>
                  <TableHead priority="md">{t('common:labels.client')}</TableHead>
                  <TableHead priority="lg">{t('accounting:labels.issued')}</TableHead>
                  <TableHead priority="md">{t('accounting:labels.due')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                  {canAnaf ? <TableHead priority="lg">ANAF</TableHead> : null}
                  <TableHead priority="md">{t('accounting:labels.payment')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pageRecords ?? []).map((r) => {
                  const isDraft = r.source === 'generated' && !r.documentNumber
                  const isIssued = r.source === 'generated' && Boolean(r.documentNumber)
                  const canSend = canAnaf && isIssued && (r.anafStatus === 'draft' || r.anafStatus === 'rejected')
                  // Arhivă (manual, PastRecordFormDialog) — poate fi marcată plătită la fel ca una emisă.
                  const canMarkPaid = (isIssued || (r.source === 'manual' && r.type === 'invoice')) && r.paymentStatus !== 'paid'
                  return (
                    <TableRow
                      key={r.id}
                    >
                      <TableCell className="tbl-fill font-medium">
                        <div className="whitespace-nowrap">{r.documentNumber ?? t('accounting:issued.draftMarker')}</div>
                        <TableDetails items={[r.counterpartyName, formatDate(r.dueAt), <PaymentStatusBadge key="payment" status={r.paymentStatus} />]} />
                      </TableCell>
                      <TableCell priority="md" truncate>{r.counterpartyName ?? '—'}</TableCell>
                      <TableCell priority="lg" className="whitespace-nowrap">{formatDate(r.issuedAt)}</TableCell>
                      <TableCell priority="md" className="whitespace-nowrap">{formatDate(r.dueAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums"><Money amount={r.amount} currency={r.currency} /></TableCell>
                      {canAnaf ? (
                      <TableCell priority="lg">
                        <AnafStatusBadge status={r.anafStatus} />
                        {r.anafUploadId && (
                          <div
                            className="mt-1 font-mono text-xs text-muted-foreground"
                            title={t('accounting:issued.uploadIndexHint')}
                          >
                            #{r.anafUploadId}
                          </div>
                        )}
                      </TableCell>
                      ) : null}
                      <TableCell priority="md">
                        <PaymentStatusBadge status={r.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <RowActions
                          actions={[
                            ...(isDraft && canIssue
                              ? [
                                  { key: 'issue', icon: FileCheck, label: t('accounting:issued.issueHint'), disabled: issue.isPending, onClick: () => issue.mutate(r.id) },
                                  {
                                    key: 'edit',
                                    icon: Pencil,
                                    label: t('accounting:invoiceForm.editTitle'),
                                    onClick: () => {
                                      setEditing(r)
                                      setDialogOpen(true)
                                    },
                                  },
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
                            ...(canMarkPaid
                              ? [
                                  {
                                    key: 'paid',
                                    icon: CircleDollarSign,
                                    label: t('accounting:issued.markPaidManually'),
                                    disabled: markPaid.isPending,
                                    onClick: () => {
                                      void confirm({ title: r.documentNumber ? t('accounting:issued.markPaidTitle', { number: r.documentNumber }) : t('accounting:issued.markPaidTitleNoNumber'), consequence: t('accounting:issued.markPaidBody'), confirmLabel: t('accounting:issued.markPaid') }).then((ok) => ok && markPaid.mutate(r.id))
                                    },
                                  },
                                ]
                              : []),
                          ]}
                          menu={[
                            ...(r.hasPdf ? [{ key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/accounting/records/${r.id}/pdf`, 'document.pdf') }] : []),
                            ...(r.hasXml ? [{ key: 'xml', icon: Download, label: t('accounting:actions.downloadXml'), onClick: () => openFile(`/api/accounting/records/${r.id}/xml`, 'document.xml') }] : []),
                            ...(canAnaf && r.hasAnafPdf ? [{ key: 'anaf-pdf', icon: Download, label: t('accounting:issued.downloadEfacturaPdf'), onClick: () => openFile(`/api/accounting/records/${r.id}/anaf-pdf`, 'document.pdf') }] : []),
                            ...(r.paymentStatus === 'paid' ? [{ key: 'confirmation', icon: Download, label: t('accounting:issued.downloadConfirmation'), onClick: () => openFile(`/api/accounting/records/${r.id}/confirmation-pdf`, 'document.pdf') }] : []),
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2 border-t px-6 py-3 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">
              {t('accounting:pagination.range', { from: safePage * PAGE_SIZE + 1, to: Math.min((safePage + 1) * PAGE_SIZE, total), total })}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.previousPage')}
                disabled={safePage === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.nextPage')}
                disabled={safePage >= maxPage}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      <InvoiceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} invoice={editing} />
      <PastRecordFormDialog open={pastDialogOpen} onOpenChange={setPastDialogOpen} direction="out" />
    </div>
  )
}
