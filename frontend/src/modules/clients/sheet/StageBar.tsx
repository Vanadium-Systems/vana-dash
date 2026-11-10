import { RotateCcw, Trophy, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Select } from '@/shared/components/ui/select'
import { StatePill } from '@/shared/components/ui/state-pill'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { LostReasonDialog } from '../prospects/LostReasonDialog'
import type { ProspectStatusEntry } from '@/shared/lib/types'
import type { ProspectSheet } from './types'
import { useWrite } from './use-sheet'

/** The stages in their order with the current one at full contrast, the days spent in it, and the way out: won, lost, reopen. */
export function StageBar({ sheet, statuses }: { sheet: ProspectSheet; statuses: ProspectStatusEntry[] }) {
  const write = useWrite()
  const [lostOpen, setLostOpen] = useState(false)
  const stages = statuses.filter((status) => status.kind === 'open')
  const current = statuses.find((status) => status.key === sheet.status)
  const kind = current?.kind ?? 'open'
  const index = stages.findIndex((stage) => stage.key === sheet.status)
  const won = statuses.find((status) => status.kind === 'won')
  const lost = statuses.find((status) => status.kind === 'lost')
  const editable = sheet.canEdit

  const move = (status: string, extra: Record<string, unknown> = {}) => write(() => api.patch(`/api/prospects/${sheet.id}`, { status, ...extra }))
  const reopen = () => {
    const first = stages[0]
    if (first) void move(first.key, { lostReason: null })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {kind === 'open' ? (
          <>
            {/* On a phone a row of stages would not fit, so it is one select. */}
            <Select size="sm" className="min-w-0 flex-1 sm:hidden" aria-label={t('clients:sheet.stage.label')} value={sheet.status} disabled={!editable} onValueChange={(status) => void move(status)}>
              {current ? null : <option value={sheet.status}>{sheet.status}</option>}
              {stages.map((stage) => (
                <option key={stage.id} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </Select>
            <div role="group" aria-label={t('clients:sheet.stage.label')} className="relative hidden min-w-0 flex-1 rounded-md bg-muted p-0.5 sm:grid" style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))` }}>
              {index >= 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0.5 left-0.5 rounded bg-primary transition-transform duration-200"
                  style={{ width: `calc((100% - 0.25rem) / ${stages.length})`, transform: `translateX(${index * 100}%)`, transitionTimingFunction: 'var(--ease-in-out)' }}
                />
              ) : null}
              {stages.map((stage, position) => (
                <button
                  key={stage.id}
                  type="button"
                  disabled={!editable}
                  aria-current={position === index ? 'step' : undefined}
                  className={cn(
                    'relative z-10 h-control-sm min-w-0 truncate rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    position === index ? 'text-primary-foreground' : 'text-muted-foreground enabled:hover:text-foreground',
                  )}
                  title={stage.label}
                  onClick={() => position !== index && void move(stage.key)}
                >
                  {stage.label}
                </button>
              ))}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t('clients:sheet.stage.inStage', { count: sheet.daysInStage })}</span>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <StatePill tone={kind === 'won' ? 'success' : 'critical'}>{current?.label ?? sheet.status}</StatePill>
            {kind === 'lost' && sheet.lostReason ? <span className="min-w-0 truncate text-sm text-muted-foreground">{sheet.lostReason}</span> : null}
            <span className="text-xs tabular-nums text-muted-foreground">{t('clients:sheet.stage.inStage', { count: sheet.daysInStage })}</span>
          </div>
        )}
        {editable ? (
          <div className="flex shrink-0 items-center gap-2">
            {kind === 'open' ? (
              <>
                {won ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void move(won.key)}>
                    <Trophy aria-hidden="true" /> {t('clients:sheet.stage.won')}
                  </Button>
                ) : null}
                {lost ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setLostOpen(true)}>
                    <XCircle aria-hidden="true" /> {t('clients:sheet.stage.lost')}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={reopen}>
                <RotateCcw aria-hidden="true" /> {t('clients:sheet.stage.reopen')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <LostReasonDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        onConfirm={(reason) => {
          setLostOpen(false)
          if (lost) void move(lost.key, { lostReason: reason })
        }}
      />
    </div>
  )
}
