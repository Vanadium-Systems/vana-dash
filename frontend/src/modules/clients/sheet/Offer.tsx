import { Calculator, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ProspectSheet } from './types'
import { useWrite } from './use-sheet'

/** The quote saved from the calculator; it moves to the client when the prospect is promoted. */
export function Offer({ sheet }: { sheet: ProspectSheet }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const write = useWrite()
  const { can } = useMe()
  const offer = sheet.offer
  if (!offer) return null

  const details = [offer.details.moduleAddon, offer.details.operatoriGestiune && `${t('pricing:apply.fields.details.operatoriGestiune')}: ${offer.details.operatoriGestiune}`, offer.details.puncteLucru && `${t('pricing:apply.fields.details.puncteLucru')}: ${offer.details.puncteLucru}`].filter(Boolean)

  return (
    <section className="space-y-2" aria-label={t('pricing:apply.offer.title')}>
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{t('pricing:apply.offer.title')}</h3>
        {sheet.canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('pricing:apply.offer.delete')}
            onClick={() =>
              void confirm({ title: t('pricing:apply.offer.deleteTitle', { name: sheet.name }), consequence: t('pricing:apply.offer.deleteBody'), confirmLabel: t('pricing:apply.offer.deleteConfirm'), destructive: true }).then(
                (ok) => ok && write(() => api.delete(`/api/prospects/${sheet.id}/offer`), t('pricing:apply.offer.deleted')),
              )
            }
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted-foreground">{t('pricing:apply.offer.monthly')}</dt>
          <dd className="font-medium tabular-nums">{formatNumber(offer.subscriptionPriceEur, 'EUR')}</dd>
        </div>
        {offer.contractPlan ? (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-muted-foreground">{t('pricing:apply.offer.plan')}</dt>
            <dd className="min-w-0 break-words">{offer.contractPlan}</dd>
          </div>
        ) : null}
      </dl>
      {details.length > 0 ? <p className="break-words text-xs text-muted-foreground">{details.join(' · ')}</p> : null}
      <p className="text-xs text-muted-foreground">{t('pricing:apply.offer.savedAt', { date: formatDate(offer.savedAt) })}</p>
      {can('clienti.calculator') ? (
        <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/clients?tab=calculator&prospectId=${sheet.id}`)}>
          <Calculator aria-hidden="true" /> {t('pricing:apply.offer.reopen')}
        </Button>
      ) : null}
    </section>
  )
}
