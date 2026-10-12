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
  { key: 'alerts', label: 'Alerte (threshold metrici + accounting)' },
  { key: 'email', label: 'Email nou primit' },
  { key: 'invoiceStatus', label: 'Status factură ANAF (validată/respinsă)' },
  { key: 'calendarReminder', label: 'Reminder-e calendar' },
  { key: 'paymentMatch', label: 'Plată matchuită / marcată plătită' },
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
      toast.success('Notificările push sunt active pe acest device')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Activare eșuată')
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = async () => {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      await refresh()
      toast.success('Notificările push au fost dezactivate pe acest device')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dezactivare eșuată')
    } finally {
      setBusy(false)
    }
  }

  const testPush = useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number }>('/api/push/test'),
    onSuccess: (result) => toast.success(`Test trimis — ${result.sent} reușite, ${result.failed} eșuate`),
    onError: (err) => toast.error(err.message),
  })

  if (permission === null) return null

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Notificări push</CardTitle>
        </div>

        {isNative ? (
          <p className="text-sm text-muted-foreground">
            APK-ul nativ nu suportă notificările push web (rulează fără service worker, din motive de cache). Notificările
            funcționează în PWA-ul din browser (dash.vanadium.systems — „Adaugă pe ecranul principal"); varianta nativă
            prin FCM e de adăugat separat.
          </p>
        ) : permission === 'unsupported' ? (
          <p className="text-sm text-muted-foreground">Browserul acesta nu suportă notificări push.</p>
        ) : permission === 'denied' ? (
          <p className="text-sm text-muted-foreground">
            Permisiune refuzată la nivel de browser — activeaz-o manual din setările site-ului, apoi reîncarcă pagina.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Stare: <span className="font-medium text-foreground">{subscribed ? 'Active pe acest device' : 'Neactivate pe acest device'}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {subscribed ? (
                <Button variant="outline" disabled={busy} onClick={() => void handleDisable()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Dezactivează pe acest device
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void handleEnable()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Activează notificările
                </Button>
              )}
              <Button variant="outline" disabled={testPush.isPending} onClick={() => testPush.mutate()}>
                {testPush.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Trimite test
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
        <CardTitle className="text-base">Tipuri de notificări</CardTitle>
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
