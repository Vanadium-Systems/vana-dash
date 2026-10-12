import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { BankTransactionRow, OpenInvoice } from '@/shared/lib/types'
import { formatDate, formatMoney } from '../accounting/badges'
import { Select } from '@/shared/components/ui/select'

interface MatchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: BankTransactionRow | null
}

export function MatchDialog({ open, onOpenChange, transaction }: MatchDialogProps) {
  const queryClient = useQueryClient()
  const [financialRecordId, setFinancialRecordId] = useState('')

  const invoices = useQuery({
    queryKey: ['reconciliation', 'open-invoices'],
    queryFn: () => api.get<OpenInvoice[]>('/api/reconciliation/open-invoices'),
    enabled: open,
  })

  useEffect(() => {
    if (open) setFinancialRecordId('')
  }, [open])

  const match = useMutation({
    mutationFn: () =>
      api.post(`/api/reconciliation/transactions/${transaction?.id}/match`, { financialRecordId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success('Match salvat — factura marcată plătită')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!transaction) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">{formatMoney(transaction.amount, transaction.currency)}</div>
            <div className="text-muted-foreground">
              {transaction.counterpartyName ?? '—'} · {formatDate(transaction.valueDate)}
            </div>
            {transaction.reference ? (
              <div className="mt-1 text-xs text-muted-foreground">Ref: {transaction.reference}</div>
            ) : null}
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              match.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="m-invoice">Factura neplătită</Label>
              <Select
                id="m-invoice"
                value={financialRecordId}
                onChange={(e) => setFinancialRecordId(e.target.value)}
                required
              >
                <option value="">— alege —</option>
                {(invoices.data ?? []).map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.documentNumber ?? '(draft)'} · {invoice.counterpartyName ?? '?'} ·{' '}
                    {formatMoney(invoice.amount, invoice.currency)}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={match.isPending || !financialRecordId}>
              {match.isPending ? 'Se salvează…' : 'Salvează match-ul'}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
