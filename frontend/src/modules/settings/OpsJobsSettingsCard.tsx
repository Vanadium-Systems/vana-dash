import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

interface OpsJobToggles {
  bankSync: boolean
  tenderWatch: boolean
  bnrFeed: boolean
}

const JOBS: { key: keyof OpsJobToggles; label: string; description: string }[] = [
  {
    key: 'bankSync',
    label: t('settings:jobs.bankSync'),
    description: t('settings:jobs.bankSyncHint'),
  },
  {
    key: 'tenderWatch',
    label: t('settings:jobs.tenders'),
    description: t('settings:jobs.tendersHint'),
  },
  {
    key: 'bnrFeed',
    label: t('settings:jobs.bnr'),
    description: t('settings:jobs.bnrHint'),
  },
]

// Kill-switch per cron operațional (Setări, 2026-09-21) — oprit = job-ul sare peste rularea de
// azi, nu doar alerta rămâne tăcută. Gândit pt. situațiile în care sursa externă e deja
// cunoscută ca picată (blocaj SICAP, blip BNR) și repetarea nu ajută la nimic.
export function OpsJobsSettingsCard() {
  const queryClient = useQueryClient()
  const toggles = useQuery({
    queryKey: ['settings', 'ops-jobs'],
    queryFn: () => api.get<OpsJobToggles>('/api/settings/ops-jobs'),
  })

  const update = useMutation({
    mutationFn: (patch: Partial<OpsJobToggles>) => api.put<OpsJobToggles>('/api/settings/ops-jobs', patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'ops-jobs'], data)
      toast.success(t('common:states.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (toggles.isPending || !toggles.data) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <CardTitle className="text-base">{t('settings:jobs.title')}</CardTitle>
        <div className="space-y-2">
          {JOBS.map((job) => {
            const enabled = toggles.data[job.key]
            return (
              <div key={job.key} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{job.label}</p>
                    {enabled ? <Badge variant="success">{t('common:states.active')}</Badge> : <Badge variant="outline">{t('settings:jobs.off')}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{job.description}</p>
                </div>
                <Button
                  variant={enabled ? 'destructive' : 'outline'}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ [job.key]: !enabled })}
                >
                  {enabled ? t('common:actions.stop') : t('common:actions.enable')}
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
