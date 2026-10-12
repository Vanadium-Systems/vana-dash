import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  FileCheck,
  MoreVertical,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { FinancialRecord } from '@/shared/lib/types'
import { AnafStatusBadge, PaymentStatusBadge, formatDate, formatMoney } from './badges'
import { InvoiceFormDialog } from './InvoiceFormDialog'
import { PastRecordFormDialog } from './PastRecordFormDialog'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useMe } from '@/shared/hooks/use-me'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'

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
      toast.success(`Factura ${invoice.documentNumber} emisă — XML generat`)
    },
    onError: (err) => toast.error(err.message),
  })

  const sendAnaf = useMutation({
    mutationFn: (id: string) => api.post<FinancialRecord>(`/api/invoicing/invoices/${id}/send-anaf`),
    onSuccess: () => {
      invalidate()
      toast.success('Trimisă la ANAF — starea se actualizează automat (poll la 10 min)')
    },
    onError: (err) => toast.error(err.message),
  })

  const removeDraft = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/invoicing/invoices/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Draft șters')
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
      toast.success('Factură marcată plătită')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        {canIssue ? (
          <>
            <Button variant="outline" onClick={() => setPastDialogOpen(true)}>
              <Archive className="h-4 w-4" /> Factură/încasare veche
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> Factură nouă
            </Button>
          </>
        ) : null}
      </div>
      <Card>
        <CardContent className="pt-6">
          {records.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !records.data?.length ? (
            <EmptyState
              kind="new"
              title="Nicio factură emisă încă"
              action={
                canIssue ? (
                  <Button
                    onClick={() => {
                      setEditing(null)
                      setDialogOpen(true)
                    }}
                  >
                    Factură nouă
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Număr</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Emisă</TableHead>
                  <TableHead>Scadență</TableHead>
                  <TableHead className="text-right">Sumă</TableHead>
                  {canAnaf ? <TableHead>ANAF</TableHead> : null}
                  <TableHead>Plată</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pageRecords ?? []).map((r, i) => {
                  const isDraft = r.source === 'generated' && !r.documentNumber
                  const isIssued = r.source === 'generated' && Boolean(r.documentNumber)
                  const canSend = canAnaf && isIssued && (r.anafStatus === 'draft' || r.anafStatus === 'rejected')
                  // Arhivă (manual, PastRecordFormDialog) — poate fi marcată plătită la fel ca una emisă.
                  const canMarkPaid = (isIssued || (r.source === 'manual' && r.type === 'invoice')) && r.paymentStatus !== 'paid'
                  return (
                    <TableRow
                      key={r.id}
                      className="animate-in fade-in-0 duration-200 ease-out"
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    >
                      <TableCell className="font-medium">{r.documentNumber ?? '(draft)'}</TableCell>
                      <TableCell>{r.counterpartyName ?? '—'}</TableCell>
                      <TableCell>{formatDate(r.issuedAt)}</TableCell>
                      <TableCell>{formatDate(r.dueAt)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatMoney(r.amount, r.currency)}</TableCell>
                      <TableCell>
                        <AnafStatusBadge status={r.anafStatus} />
                        {r.anafUploadId && (
                          <div
                            className="mt-1 font-mono text-xs text-muted-foreground"
                            title="Index de încărcare — caută-l pe app.anaf.ro/SNMD/facturaProd/RaspunsuriFacturaProd.xhtml"
                          >
                            #{r.anafUploadId}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={r.paymentStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {isDraft && canIssue ? (
                            <>
                              <Button
                                variant="outline"
                                title="Emite (alocă număr + generează XML/PDF)"
                                disabled={issue.isPending}
                                onClick={() => issue.mutate(r.id)}
                              >
                                <FileCheck className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                title="Editează draftul"
                                onClick={() => {
                                  setEditing(r)
                                  setDialogOpen(true)
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                title="Șterge draftul"
                                onClick={() => {
                                  void confirm({ title: `Șterge draftul pentru ${r.counterpartyName ?? 'client'}`, consequence: 'Nu consumă număr de factură; seria rămâne neschimbată.', confirmLabel: 'Șterge draftul', destructive: true }).then((ok) => ok && removeDraft.mutate(r.id))
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          ) : null}
                          {canSend ? (
                            <Button
                              variant="outline"
                              title={r.anafStatus === 'rejected' ? 'Retrimite la ANAF' : 'Trimite la ANAF'}
                              disabled={sendAnaf.isPending}
                              onClick={() => sendAnaf.mutate(r.id)}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canMarkPaid ? (
                            <Button
                              variant="outline"
                              title="Marchează plătit manual"
                              disabled={markPaid.isPending}
                              onClick={() => {
                                void confirm({ title: `Marchează ${r.documentNumber ?? 'factura'} ca plătită`, consequence: 'Dacă clientul e legat de VanaGreen, abonamentul lui se prelungește.', confirmLabel: 'Marchează plătită' }).then((ok) => ok && markPaid.mutate(r.id))
                              }}
                            >
                              <CircleDollarSign className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {r.hasPdf || r.hasXml || r.hasAnafPdf || r.paymentStatus === 'paid' ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card hover:bg-accent">
                                <MoreVertical className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {r.hasPdf ? (
                                  <DropdownMenuItem onClick={() => window.open(`/api/accounting/records/${r.id}/pdf`, '_blank')}>
                                    <Download className="h-4 w-4" /> Descarcă PDF
                                  </DropdownMenuItem>
                                ) : null}
                                {r.hasXml ? (
                                  <DropdownMenuItem onClick={() => window.open(`/api/accounting/records/${r.id}/xml`, '_blank')}>
                                    <Download className="h-4 w-4" /> Descarcă XML
                                  </DropdownMenuItem>
                                ) : null}
                                {canAnaf && r.hasAnafPdf ? (
                                  <DropdownMenuItem
                                    onClick={() => window.open(`/api/accounting/records/${r.id}/anaf-pdf`, '_blank')}
                                  >
                                    <Download className="h-4 w-4" /> Descarcă PDF eFactura
                                  </DropdownMenuItem>
                                ) : null}
                                {r.paymentStatus === 'paid' ? (
                                  <DropdownMenuItem
                                    onClick={() => window.open(`/api/accounting/records/${r.id}/confirmation-pdf`, '_blank')}
                                  >
                                    <Download className="h-4 w-4" /> Descarcă confirmarea
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
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
              {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, total)} din {total}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title="Pagina precedentă"
                disabled={safePage === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title="Pagina următoare"
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
