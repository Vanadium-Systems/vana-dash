import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Sparkline } from '@/shared/components/charts/Sparkline'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { SignalTile } from '@/shared/components/SignalTile'
import { api } from '@/shared/lib/api'
import type { Platform, PlatformOpsSignalsResponse } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

interface PlatformOpsSignalsDialogProps {
  platform: Platform | null
  onOpenChange: (open: boolean) => void
}

export function PlatformOpsSignalsDialog({ platform, onOpenChange }: PlatformOpsSignalsDialogProps) {
  const open = Boolean(platform)

  const opsSignals = useQuery({
    queryKey: ['platforms', platform?.id, 'ops-signals'],
    queryFn: () => api.get<PlatformOpsSignalsResponse>(`/api/platforms/${platform?.id}/ops-signals`),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('platforms:ops.title', { name: platform?.name })}</DialogTitle>
        </DialogHeader>

        {opsSignals.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ChartSkeleton key={i} height={110} />
            ))}
          </div>
        ) : opsSignals.isError ? (
          <ChartError message={t('platforms:ops.loadFailed')} />
        ) : !opsSignals.data?.supported ? (
          <p className="text-sm text-muted-foreground">{t('platforms:ops.none')}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {opsSignals.data.signals.map((s) => (
                <SignalTile key={s.key} signal={s} />
              ))}
            </div>
            {!opsSignals.data.history.length ? (
              <ChartEmpty label={t('platforms:ops.noHistory')} />
            ) : (
              <Sparkline
                data={opsSignals.data.history.map((h) => ({
                  captured_at: h.capturedAt,
                  cpu_pct: h.cpuPct,
                  ram_pct: h.ramPct,
                  disk_pct: h.diskPct,
                }))}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
