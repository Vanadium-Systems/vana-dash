import { Link } from 'react-router-dom'
import { buttonVariants } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'
import { rasina } from '@/shared/lib/rasina'
import { cn } from '@/shared/lib/utils'

export interface NextStep {
  /** Stable id of the thing (seeds the resin's pouring). */
  id: string
  title: string
  detail?: string
  to: string
}

/** "Următorul pas": the first thing to do today, with its action; one of the four places that carry resin. */
export function NextStepCard({ step }: { step: NextStep | null }) {
  if (!step) return null
  const resin = rasina(step.id)
  return (
    <aside className={cn(resin.className, 'flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-4')} style={resin.style} aria-label={t('overview:next.label')}>
      <span className="text-xs text-muted-foreground">{t('overview:next.label')}</span>
      <h2 className="line-clamp-2 text-base font-semibold">{step.title}</h2>
      {step.detail ? <p className="truncate text-sm text-muted-foreground">{step.detail}</p> : null}
      <div className="mt-2">
        <Link to={step.to} className={buttonVariants({ size: 'sm' })}>
          {t('overview:next.open')}
        </Link>
      </div>
    </aside>
  )
}
