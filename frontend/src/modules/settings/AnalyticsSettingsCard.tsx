import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

interface AnalyticsSettings {
  posthogKey: string
  posthogHost: string
}

export function AnalyticsSettingsCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['settings', 'analytics'],
    queryFn: () => api.get<AnalyticsSettings>('/api/settings/analytics'),
  })
  const [draft, setDraft] = useState<AnalyticsSettings>({ posthogKey: '', posthogHost: '' })
  useEffect(() => {
    if (settings.data) setDraft(settings.data)
  }, [settings.data])

  const save = useMutation({
    mutationFn: (body: AnalyticsSettings) => api.put<AnalyticsSettings>('/api/settings/analytics', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'analytics'], data)
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'client-config'] })
      toast.success(t('common:states.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.isPending || !settings.data) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <CardTitle className="text-base">{t('settings:analytics.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('settings:analytics.hint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="posthog-key">{t('settings:analytics.key')}</Label>
            <Input
              id="posthog-key"
              value={draft.posthogKey}
              placeholder={t('settings:analytics.keyPlaceholder')}
              onChange={(e) => setDraft({ ...draft, posthogKey: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="posthog-host">{t('settings:analytics.host')}</Label>
            <Input
              id="posthog-host"
              value={draft.posthogHost}
              placeholder="https://eu.i.posthog.com"
              onChange={(e) => setDraft({ ...draft, posthogHost: e.target.value })}
            />
          </div>
        </div>
        <Button disabled={save.isPending} onClick={() => save.mutate(draft)}>
          {t('common:actions.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
