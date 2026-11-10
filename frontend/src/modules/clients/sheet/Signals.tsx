import { Badge } from '@/shared/components/ui/badge'
import { t } from '@/shared/lib/i18n'
import type { SheetSignal } from './types'

/** The active signals as chips, and under them what to say about each (the tip arrives with the company's own figures filled in). */
export function Signals({ signals }: { signals: SheetSignal[] }) {
  if (signals.length === 0) return null
  const tips = signals.filter((signal) => signal.talkingTip)
  return (
    <section aria-label={t('clients:sheet.signals.title')} className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {signals.map((signal) => (
          <li key={signal.id}>
            <Badge variant="outline" className="font-medium" title={t(`clients:sheet.signals.groups.${signal.groupKey}`)}>
              {signal.name}
            </Badge>
          </li>
        ))}
      </ul>
      {tips.length > 0 ? (
        <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2">
          <h3 className="text-xs font-medium text-muted-foreground">{t('clients:sheet.signals.whatToSay')}</h3>
          <ul className="space-y-1 text-sm">
            {tips.map((signal) => (
              <li key={signal.id}>
                <span className="font-medium">{signal.name}: </span>
                {signal.talkingTip}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
