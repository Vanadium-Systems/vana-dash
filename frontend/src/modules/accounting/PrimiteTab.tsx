import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Download, FileText, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { FinancialRecord } from '@/shared/lib/types'
import { PaymentStatusBadge, formatDate, formatMoney } from './badges'
import { PastRecordFormDialog } from './PastRecordFormDialog'
import { RecurringExpensesSection } from './RecurringExpensesSection'
import { t } from '@/shared/lib/i18n'

const PAGE_SIZE = 10

export function PrimiteTab() {
  const queryClient = useQueryClient()
  const [pastDialogOpen, setPastDialogOpen] = useState(false)
  const [page, setPage] = useState(0)

  const records = useQuery({
    queryKey: ['accounting', 'records', 'in'],
    queryFn: () => api.get<FinancialRecord[]>('/api/accounting/records?direction=in'),
  })

  const total = records.data?.length ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const safePage = Math.min(page, maxPage)
  const pageRecords = records.data?.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const syncAnaf = useMutation({
    mutationFn: () => api.post<{ imported: number }>('/api/accounting/anaf/sync'),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('accounting:received.syncDone', { imported: data.imported }))
    },
    onError: (err) => toast.error(err.message),
  })

  const markPaid = useMutation({
    mutationFn: (id: string) =>
      api.patch<FinancialRecord>(`/api/accounting/records/${id}/payment`, { paymentStatus: 'paid' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('accounting:received.markedPaid'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setPastDialogOpen(true)}>
          <Plus className="h-4 w-4" /> {t('accounting:received.addExpense')}
        </Button>
        <Button variant="outline" disabled={syncAnaf.isPending} onClick={() => syncAnaf.mutate()}>
          <RefreshCw className={syncAnaf.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('accounting:received.syncNow')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {records.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !records.data?.length ? (
            <p className="text-sm text-muted-foreground">
              {t('accounting:received.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accounting:labels.supplier')}</TableHead>
                  <TableHead>{t('common:labels.cif')}</TableHead>
                  <TableHead>{t('common:labels.document')}</TableHead>
                  <TableHead>{t('accounting:labels.issued')}</TableHead>
                  <TableHead>{t('accounting:labels.due')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                  <TableHead>{t('common:labels.source')}</TableHead>
                  <TableHead>{t('accounting:labels.payment')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pageRecords ?? []).map((r, i) => (
                  <TableRow
                    key={r.id}
                    className="animate-in fade-in-0 duration-200 ease-out"
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  >
                    <TableCell className="font-medium">{r.counterpartyName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.counterpartyCif ?? '—'}</TableCell>
                    <TableCell>{r.description ?? '—'}</TableCell>
                    <TableCell>{formatDate(r.issuedAt)}</TableCell>
                    <TableCell>{formatDate(r.dueAt)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(r.amount, r.currency)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source === 'anaf_efactura' ? 'e-Factura' : r.source}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={r.paymentStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.paymentStatus !== 'paid' ? (
                          <Button
                            variant="outline"
                            title={t('accounting:received.markPaid')}
                            disabled={markPaid.isPending}
                            onClick={() => markPaid.mutate(r.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {r.hasXml ? (
                          <Button
                            variant="outline"
                            title={t('accounting:actions.downloadXml')}
                            onClick={() => void api.download(`/api/accounting/records/${r.id}/xml`, `${r.id}.xml`)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {r.hasPdf ? (
                          <Button
                            variant="outline"
                            title={t('common:actions.downloadPdf')}
                            onClick={() => void api.download(`/api/accounting/records/${r.id}/pdf`, `${r.id}.pdf`)}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
      <RecurringExpensesSection />
      <PastRecordFormDialog open={pastDialogOpen} onOpenChange={setPastDialogOpen} direction="in" />
    </div>
  )
}
