import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { api } from '@/shared/lib/api'
import { formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import type { FinancialRecord } from '@/shared/lib/types'
import type { DocumentKind } from './invoice-editor-logic'
import { useInvalidateRecords } from './records-api'

interface IssueConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: DocumentKind
  recordId: string
  clientName: string
  totalCents: number
  currency: string
  /** facturi.anaf: without it the invoice can only be issued, not sent. */
  canAnaf: boolean
}

export function IssueConfirmDialog({ open, onOpenChange, kind, recordId, clientName, totalCents, currency, canAnaf }: IssueConfirmDialogProps) {
  const navigate = useNavigate()
  const invalidate = useInvalidateRecords()
  const proforma = kind === 'proforma'
  const base = proforma ? '/api/invoicing/proformas' : '/api/invoicing/invoices'

  // Read when the dialog opens, never cached: another person may have taken the number since the page loaded.
  const next = useQuery({
    queryKey: ['invoicing', 'next-number', kind, 'confirm', open],
    queryFn: () => api.get<{ number: string; defaultPaymentTermsDays: number }>(`/api/invoicing/invoices/next-number?key=${kind}`),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  })

  const issue = useMutation({
    mutationFn: async (sendToAnaf: boolean) => {
      const record = await api.post<FinancialRecord>(`${base}/${recordId}/issue`)
      let anafError: string | null = null
      if (sendToAnaf) {
        try {
          await api.post<FinancialRecord>(`/api/invoicing/invoices/${recordId}/send-anaf`)
        } catch (err) {
          anafError = err instanceof Error ? err.message : String(err)
        }
      }
      return { record, anafError }
    },
    onSuccess: ({ record, anafError }) => {
      invalidate()
      const number = record.documentNumber ?? ''
      navigate(`/accounting/records/${recordId}`)
      if (anafError) toast.error(t('accounting:editor.confirm.anafFailed', { number, message: anafError }))
      else {
        toast.success(t('accounting:editor.confirm.issued', { number }), {
          action: { label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/accounting/records/${recordId}/pdf`, 'document.pdf') },
        })
      }
    },
  })

  const number = next.data?.number
  const total = formatMoney(totalCents / 100, currency)
  const titleKey = proforma ? 'accounting:editor.confirm.titleProforma' : 'accounting:editor.confirm.title'
  const title = number ? t(titleKey, { number, client: clientName, total }) : t('accounting:editor.confirm.titleNoNumber', { client: clientName, total })
  const send = !proforma && canAnaf

  return (
    <Dialog open={open} onOpenChange={(value) => !issue.isPending && onOpenChange(value)}>
      <DialogContent className="md:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{number ? t('accounting:editor.confirm.getsNumber', { number }) : t('accounting:editor.confirm.getsNumberLater')}</li>
          <li>{proforma ? t('accounting:editor.confirm.pdfProforma') : t('accounting:editor.confirm.pdfXml')}</li>
          {proforma ? <li>{t('accounting:editor.confirm.notFiscal')}</li> : null}
          <li>{t('accounting:editor.confirm.locked')}</li>
        </ul>
        {next.isError ? <Alert tone="warning">{t('accounting:editor.confirm.numberFailed')}</Alert> : null}
        {issue.isError ? (
          <Alert tone="critical" title={t('accounting:editor.confirm.failed')}>
            <span className="whitespace-pre-line">{issue.error.message}</span>
          </Alert>
        ) : null}
        <DialogFooter>
          {send ? (
            <Button variant="outline" disabled={issue.isPending} onClick={() => issue.mutate(false)}>
              {t('accounting:editor.confirm.issueOnly')}
            </Button>
          ) : null}
          <Button disabled={issue.isPending} onClick={() => issue.mutate(send)} data-testid="confirm-issue">
            {issue.isPending ? t('accounting:editor.confirm.issuing') : send ? t('accounting:editor.confirm.issueAndSend') : t('accounting:editor.confirm.issue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
