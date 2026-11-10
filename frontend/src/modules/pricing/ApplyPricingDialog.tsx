import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AddendumFormDialog } from '@/modules/accounting/AddendumFormDialog'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import type { PricingApplyBody, PricingChange, PricingPreview } from './offer'

interface ApplyPricingDialogProps {
  client: { id: string; name: string } | null
  body: PricingApplyBody | null
  onOpenChange: (open: boolean) => void
}

const FIELD_LABEL: Record<string, TKey> = {
  subscriptionPriceEur: 'pricing:apply.fields.subscriptionPriceEur',
  contractPlan: 'pricing:apply.fields.contractPlan',
  'details.moduleAddon': 'pricing:apply.fields.details.moduleAddon',
  'details.operatoriGestiune': 'pricing:apply.fields.details.operatoriGestiune',
  'details.operatoriTeren': 'pricing:apply.fields.details.operatoriTeren',
  'details.puncteLucru': 'pricing:apply.fields.details.puncteLucru',
  'details.taxaInitiere': 'pricing:apply.fields.details.taxaInitiere',
}
// What the client pays or gets; the setup fee and the plan label never need an addendum.
const ADDENDUM_FIELDS = new Set(['subscriptionPriceEur', 'details.moduleAddon', 'details.operatoriGestiune', 'details.operatoriTeren', 'details.puncteLucru'])

const fieldLabel = (field: string) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field)
const valueText = (change: PricingChange, value: string | null) => {
  if (value === null || value === '') return t('pricing:apply.empty')
  return change.field === 'subscriptionPriceEur' ? formatNumber(Number(value), 'EUR') : value
}

export function ApplyPricingDialog({ client, body, onOpenChange }: ApplyPricingDialogProps) {
  const queryClient = useQueryClient()
  // Kept here, not derived from `client`: the parent clears `client` when this dialog closes, and the addendum form opens after that.
  const [addendum, setAddendum] = useState<{ clientId: string; changes: PricingChange[] } | null>(null)
  const open = Boolean(client && body)

  const preview = useQuery({
    queryKey: ['billing-clients', client?.id, 'pricing-preview', body],
    queryFn: () => api.post<PricingPreview>(`/api/invoicing/clients/${client!.id}/pricing/preview`, body),
    enabled: open,
    staleTime: 0,
  })

  const apply = useMutation({
    mutationFn: (_withAddendum: boolean) => api.patch<{ needsAddendum: boolean; changes: PricingChange[] }>(`/api/invoicing/clients/${client!.id}/pricing`, body),
    onSuccess: (data, withAddendum) => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      toast.success(t('pricing:apply.applied'))
      if (withAddendum && data.needsAddendum) setAddendum({ clientId: client!.id, changes: data.changes.filter((c) => ADDENDUM_FIELDS.has(c.field)) })
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const line = (changes: PricingChange[], side: 'from' | 'to') => changes.map((c) => `${fieldLabel(c.field)}: ${valueText(c, c[side])}`).join('; ')
  const changes = preview.data?.changes ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-density="comfortable">
          <DialogHeader>
            <DialogTitle>{t('pricing:apply.title', { name: client?.name })}</DialogTitle>
          </DialogHeader>
          {preview.isPending ? (
            <div className="space-y-2" aria-label={t('pricing:apply.loading')}>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : preview.isError ? (
            <p className="text-sm text-destructive">{t('pricing:apply.loadFailed')}</p>
          ) : (
            <div className="space-y-3">
              {changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('pricing:apply.noChanges')}</p>
              ) : (
                <>
                  <p className="text-sm">{t('pricing:apply.intro')}</p>
                  <ul className="space-y-2">
                    {changes.map((change) => (
                      <li key={change.field} className="text-sm">
                        <span className="block text-xs text-muted-foreground">{fieldLabel(change.field)}</span>
                        <span className="flex flex-wrap items-center gap-x-2 break-words">
                          <span className="text-muted-foreground">{valueText(change, change.from)}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="font-medium">{valueText(change, change.to)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {preview.data.needsAddendum ? <Alert tone="warning">{t('pricing:apply.addendumNeeded')}</Alert> : null}
              <div className="flex flex-wrap justify-end gap-2">
                {preview.data.needsAddendum ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(true)}
                  >
                    {t('pricing:apply.confirmAddendum')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(false)}
                >
                  {t('pricing:apply.confirm')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {addendum ? (
        <AddendumFormDialog
          open
          onOpenChange={(next) => !next && setAddendum(null)}
          clientId={addendum.clientId}
          prefill={{ oldPriceNote: line(addendum.changes, 'from'), newPriceNote: line(addendum.changes, 'to'), reason: t('pricing:apply.addendumReason') }}
        />
      ) : null}
    </>
  )
}
