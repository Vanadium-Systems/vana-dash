import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { api } from '@/shared/lib/api'

interface OpsJobToggles {
  bankSync: boolean
  tenderWatch: boolean
  bnrFeed: boolean
}

const JOBS: { key: keyof OpsJobToggles; label: string; description: string }[] = [
  {
    key: 'bankSync',
    label: 'Sync bancar automat',
    description: 'La 30 min. Sync-ul manual din Reconciliere rămâne disponibil oricând, indiferent de starea asta.',
  },
  {
    key: 'tenderWatch',
    label: 'Monitor licitații (SICAP)',
    description: 'La 09:00 și 17:00. Util de oprit cât timp SICAP blochează IP-ul — nu are rost să mai încerce degeaba.',
  },
  {
    key: 'bnrFeed',
    label: 'Feed curs valutar BNR',
    description: 'Zilnic la 14:00. Facturarea în valută cade oricum pe fallback-ul de la citire dacă lipsește o zi.',
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
      toast.success('Salvat')
    },
    onError: (err) => toast.error(err.message),
  })

  if (toggles.isPending || !toggles.data) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <CardTitle className="text-base">Cron-uri operaționale</CardTitle>
        <div className="space-y-2">
          {JOBS.map((job) => {
            const enabled = toggles.data[job.key]
            return (
              <div key={job.key} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{job.label}</p>
                    {enabled ? <Badge variant="success">Activ</Badge> : <Badge variant="outline">Oprit</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{job.description}</p>
                </div>
                <Button
                  variant={enabled ? 'destructive' : 'outline'}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ [job.key]: !enabled })}
                >
                  {enabled ? 'Oprește' : 'Activează'}
                </Button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
