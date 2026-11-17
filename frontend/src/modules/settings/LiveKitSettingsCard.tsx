import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Switch } from '@/shared/components/ui/switch'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { toastError } from '@/shared/lib/errors'

interface LiveKitSettingsView {
  url: string
  enabled: boolean
  hasApiKey: boolean
  apiKeyPreview: string | null
  hasApiSecret: boolean
  hasEnvFallback: boolean
  configured: boolean
}

export function LiveKitSettingsCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['settings', 'livekit'],
    queryFn: () => api.get<LiveKitSettingsView>('/api/settings/livekit'),
  })

  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!settings.data) return
    setUrl(settings.data.url)
    setEnabled(settings.data.enabled)
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<LiveKitSettingsView>('/api/settings/livekit', {
        url: url.trim(),
        enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'livekit'], data)
      void queryClient.invalidateQueries({ queryKey: ['calls', 'status'] })
      setApiKey('')
      setApiSecret('')
      toast.success(t('common:states.saved'))
    },
    onError: (err) => toastError(err),
  })

  const test = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; roomCount: number }>('/api/settings/livekit/test', {
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
      }),
    onSuccess: (data) => toast.success(t('settings:livekit.testOk', { count: data.roomCount })),
    onError: (err) => toastError(err),
  })

  if (settings.isPending || !settings.data) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t('settings:livekit.title')}</CardTitle>
          <StatePill tone={settings.data.configured ? 'success' : 'neutral'}>
            {settings.data.configured ? t('settings:livekit.configured') : t('settings:livekit.notConfigured')}
          </StatePill>
        </div>
        <p className="text-sm text-muted-foreground">{t('settings:livekit.hint')}</p>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span>{t('settings:livekit.enabled')}</span>
        </label>

        <Field label={t('settings:livekit.url')}>
          <Input
            value={url}
            placeholder={t('settings:livekit.urlPlaceholder')}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('settings:livekit.apiKey')}
            hint={
              settings.data.apiKeyPreview
                ? t('settings:livekit.stored', { preview: settings.data.apiKeyPreview })
                : settings.data.hasEnvFallback
                  ? t('settings:livekit.fromEnv')
                  : undefined
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={settings.data.hasApiKey ? '••••••••' : ''}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <Field
            label={t('settings:livekit.apiSecret')}
            hint={settings.data.hasApiSecret ? t('settings:livekit.keepHint') : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              value={apiSecret}
              placeholder={settings.data.hasApiSecret ? '••••••••' : ''}
              onChange={(e) => setApiSecret(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {t('settings:livekit.test')}
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {t('common:actions.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
