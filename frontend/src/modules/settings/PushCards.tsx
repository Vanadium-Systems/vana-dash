import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import {
  getPushPermissionState,
  isSubscribedToPush,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/shared/lib/push-client'
import { api } from '@/shared/lib/api'
import { isNative } from '@/shared/lib/native'
import { t } from '@/shared/lib/i18n'

// Notificările push pe device-ul ăsta sunt ale omului, nu ale firmei (PLAN.md, C2), deci
// stau la „Profilul meu" alături de notificările pe canale. Deblocarea per browser rămâne
// un lucru pe care omul îl face o singură dată, pe device-ul lui.

interface PushPreferences {
  alerts: boolean
  email: boolean
  invoiceStatus: boolean
  calendarReminder: boolean
  paymentMatch: boolean
}

const PREFERENCE_LABELS: { key: keyof PushPreferences; label: string }[] = [
  { key: 'alerts', label: t('settings:push.types.alerts') },
  { key: 'email', label: t('settings:push.types.email') },
  { key: 'invoiceStatus', label: t('settings:push.types.anaf') },
  { key: 'calendarReminder', label: t('settings:push.types.calendar') },
  { key: 'paymentMatch', label: t('settings:push.types.payment') },
]

export function PushSubscriptionCard() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported' | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setPermission(await getPushPermissionState())
    setSubscribed(await isSubscribedToPush())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleEnable = async () => {
    setBusy(true)
    try {
      await subscribeToPush()
      await refresh()
      toast.success(t('settings:push.enabled'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:push.enableFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = async () => {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      await refresh()
      toast.success(t('settings:push.disabled'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:push.disableFailed'))
    } finally {
      setBusy(false)
    }
  }

  const testPush = useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number }>('/api/push/test'),
    onSuccess: (result) => toast.success(t('settings:push.testSent', { sent: result.sent, failed: result.failed })),
    onError: (err) => toast.error(err.message),
  })

  if (permission === null) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">{t('settings:push.title')}</CardTitle>
        </div>

        {isNative ? (
          <p className="text-sm text-muted-foreground">
            {t('settings:push.nativeNote')}
          </p>
        ) : permission === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">{t('settings:push.unsupported')}</p>
        ) : permission === 'denied' ? (
          <p className="text-sm text-muted-foreground">
            {t('settings:push.deniedHint')}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('settings:push.status')} <span className="font-medium text-foreground">{subscribed ? t('settings:push.activeOnDevice') : t('settings:push.inactiveOnDevice')}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {subscribed ? (
                <Button variant="outline" disabled={busy} onClick={() => void handleDisable()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('settings:push.disableOnDevice')}
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void handleEnable()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('settings:push.enable')}
                </Button>
              )}
              <Button variant="outline" disabled={testPush.isPending} onClick={() => testPush.mutate()}>
                {testPush.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('settings:push.sendTest')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function PushPreferencesCard() {
  const queryClient = useQueryClient()
  const prefs = useQuery({
    queryKey: ['push', 'preferences'],
    queryFn: () => api.get<PushPreferences>('/api/push/preferences'),
  })

  const update = useMutation({
    mutationFn: (patch: Partial<PushPreferences>) => api.put<PushPreferences>('/api/push/preferences', patch),
    onSuccess: (data) => queryClient.setQueryData(['push', 'preferences'], data),
    onError: (err) => toast.error(err.message),
  })

  if (prefs.isPending || !prefs.data) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('settings:push.typesTitle')}</CardTitle>
        <div className="space-y-2">
          {PREFERENCE_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.data[key]}
                onChange={(e) => update.mutate({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
