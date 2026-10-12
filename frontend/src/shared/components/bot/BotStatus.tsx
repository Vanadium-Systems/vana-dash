import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/shared/lib/utils'
import { botStatus, formatAge, minutesSince, type BotService } from './types'
import { t } from '@/shared/lib/i18n'

// Începutul benzii de stare, comun ambelor piețe: vârsta ultimului snapshot + serviciile.
export function BotHealth({ receivedAt, services }: { receivedAt: string; services: BotService[] }) {
  const age = minutesSince(receivedAt)
  const status = botStatus(age)
  const offline = status === 'offline'
  const late = status === 'late'
  const down = services.filter((s) => s.state !== 'active')

  return (
    <>
      <span className="inline-flex items-center gap-2 font-medium">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', offline ? 'bg-destructive-text' : late ? 'bg-warning' : 'bg-success')} />
        {offline
          ? t('common:bot.status.offline', { age: formatAge(age) })
          : late
            ? t('common:bot.status.late', { age: formatAge(age) })
            : t('common:bot.status.online', { age: formatAge(age) })}
      </span>
      <span className="text-muted-foreground">
        {t('common:bot.status.services')}{' '}
        <span className={cn('tnum', down.length ? 'font-medium text-foreground' : undefined)}>
          {services.length - down.length}/{services.length}
        </span>
        {down.length ? t('common:bot.status.stopped', { value: down.map((s) => s.name).join(', ') }) : ''}
      </span>
    </>
  )
}

export function PaperBadge() {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t('common:bot.status.paperTrading')}</span>
}

export function BotSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-5 w-3/4" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
      <Skeleton className="h-[280px] w-full" />
    </div>
  )
}
