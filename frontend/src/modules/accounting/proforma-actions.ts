import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { FinancialRecord } from '@/shared/lib/types'
import { useInvalidateRecords } from './records-api'

const SERVER_ERRORS = ['PROFORMA_ALREADY_CONVERTED', 'PROFORMA_NOT_ISSUED', 'PROFORMA_CANCELLED', 'PROFORMA_INVOICED'] as const

export function proformaMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && (SERVER_ERRORS as readonly string[]).includes(err.code)) {
    return t(`accounting:proformas.errors.${err.code as (typeof SERVER_ERRORS)[number]}` as const)
  }
  return t('accounting:proformas.errors.generic')
}

/** Convert and cancel are used from the document page and from the Proforme list, so the wording and the errors live once. */
export function useProformaActions() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const invalidate = useInvalidateRecords()

  const convert = useMutation({
    mutationFn: (id: string) => api.post<FinancialRecord>(`/api/invoicing/proformas/${id}/convert`),
    onSuccess: (draft) => {
      invalidate()
      toast.success(t('accounting:proformas.converted'))
      navigate(`/accounting/records/${draft.id}/edit`)
    },
    onError: (err) => toast.error(proformaMessage(err)),
  })

  const cancel = useMutation({
    mutationFn: (proforma: { id: string; number: string }) => api.post<FinancialRecord>(`/api/invoicing/proformas/${proforma.id}/cancel`),
    onSuccess: (_row, proforma) => {
      invalidate()
      toast.success(t('accounting:proformas.cancelled', { number: proforma.number }))
    },
    onError: (err) => {
      // A conflict means the document moved under us (converted elsewhere): show it as it is now.
      invalidate()
      toast.error(proformaMessage(err))
    },
  })

  const askCancel = (id: string, number: string) =>
    void confirm({
      title: t('accounting:proformas.cancelTitle', { number }),
      consequence: t('accounting:proformas.cancelBody'),
      confirmLabel: t('accounting:proformas.cancelConfirm'),
      destructive: true,
    }).then((ok) => ok && cancel.mutate({ id, number }))

  return { convert, askCancel, busy: convert.isPending || cancel.isPending }
}
