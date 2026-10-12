import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { BrokerStatus, PriceProviderStatus } from './types'
import { t } from '@/shared/lib/i18n'

// Broker + provideri de preț + kill-switch (Setări → Assets, Track D Wave 8). Cheile pleacă o
// singură dată spre backend (criptate AES-GCM în DB) și nu se mai afișează niciodată — doar masked.
export function AssetsSettingsCard() {
  const queryClient = useQueryClient()
  const brokers = useQuery({
    queryKey: ['assets', 'brokers'],
    queryFn: () => api.get<BrokerStatus[]>('/api/assets/brokers'),
  })
  const providers = useQuery({
    queryKey: ['assets', 'price-providers'],
    queryFn: () => api.get<PriceProviderStatus[]>('/api/assets/price-providers'),
  })
  const settings = useQuery({
    queryKey: ['assets', 'settings'],
    queryFn: () => api.get<{ tradingEnabled: boolean }>('/api/assets/settings'),
  })

  const [brokerKey, setBrokerKey] = useState('')
  const [finnhubKey, setFinnhubKey] = useState('')
  const [twelvedataKey, setTwelvedataKey] = useState('')

  const connectBroker = useMutation({
    // Cheia e opțională pe paper — modul paper nu atinge API-ul Trading212 (fill la preț
    // Finnhub/Twelve Data), iar T212 cere cont alimentat înainte să emită o cheie API oricum.
    mutationFn: () =>
      api.put('/api/assets/brokers/trading212', {
        ...(brokerKey ? { apiKey: brokerKey } : {}),
        mode: 'paper',
        enabled: true,
      }),
    onSuccess: () => {
      toast.success(brokerKey ? t('assets:settings.connected') : t('assets:settings.paperOn'))
      setBrokerKey('')
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const disconnectBroker = useMutation({
    mutationFn: () => api.delete('/api/assets/brokers/trading212'),
    onSuccess: () => {
      toast.success(t('assets:settings.disconnected'))
      void queryClient.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const connectProvider = useMutation({
    mutationFn: (input: { provider: 'finnhub' | 'twelvedata'; apiKey: string }) =>
      api.put(`/api/assets/price-providers/${input.provider}`, { apiKey: input.apiKey }),
    onSuccess: (_data, vars) => {
      toast.success(`${vars.provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'} conectat`)
      setFinnhubKey('')
      setTwelvedataKey('')
      void queryClient.invalidateQueries({ queryKey: ['assets', 'price-providers'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const disconnectProvider = useMutation({
    mutationFn: (provider: 'finnhub' | 'twelvedata') => api.delete(`/api/assets/price-providers/${provider}`),
    onSuccess: () => {
      toast.success(t('assets:settings.providerDisconnected'))
      void queryClient.invalidateQueries({ queryKey: ['assets', 'price-providers'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleKillSwitch = useMutation({
    mutationFn: (enabled: boolean) => api.put<{ tradingEnabled: boolean }>('/api/assets/settings', { tradingEnabled: enabled }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assets', 'settings'] })
      toast.success(result.tradingEnabled ? t('crypto:settings.liveOn') : t('crypto:settings.liveOff'))
    },
    onError: (err) => toast.error(err.message),
  })

  const t212 = brokers.data?.find((b) => b.broker === 'trading212')
  const finnhub = providers.data?.find((p) => p.provider === 'finnhub')
  const twelvedata = providers.data?.find((p) => p.provider === 'twelvedata')

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h3 className="text-sm font-semibold">{t('assets:settings.title')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('assets:settings.hint')}
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
          <div>
            <p className="text-sm font-medium">{t('crypto:settings.killSwitch')}</p>
            <p className="text-xs text-muted-foreground">{t('crypto:settings.killSwitchHint')}</p>
          </div>
          <Button
            variant={settings.data?.tradingEnabled ? 'destructive' : 'outline'}
            data-testid="assets-kill-switch"
            disabled={settings.isPending || toggleKillSwitch.isPending}
            onClick={() => toggleKillSwitch.mutate(!settings.data?.tradingEnabled)}
          >
            {settings.data?.tradingEnabled ? t('common:actions.stop') : t('common:actions.enable')}
          </Button>
        </div>

        {t212 ? (
          <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Trading212 <span className={t212.mode === 'live' ? 'text-destructive-text' : 'text-muted-foreground'}>({t212.mode})</span>
              </p>
              <p className="font-mono text-xs text-muted-foreground">{t212.apiKeyMasked}</p>
            </div>
            <Button variant="outline" disabled={disconnectBroker.isPending} onClick={() => disconnectBroker.mutate()}>
              {t('common:actions.disconnect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <Label htmlFor="t212-api-key">{t('assets:settings.t212Key')}</Label>
            <Input id="t212-api-key" value={brokerKey} onChange={(e) => setBrokerKey(e.target.value)} autoComplete="off" />
            <p className="text-xs text-muted-foreground">
              {t('assets:settings.t212Hint')}
            </p>
            <Button disabled={connectBroker.isPending} onClick={() => connectBroker.mutate()}>
              {connectBroker.isPending ? t('common:states.saving') : brokerKey ? t('common:actions.connect') : t('assets:settings.enablePaper')}
            </Button>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {finnhub ? (
            <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Finnhub</p>
                <p className="font-mono text-xs text-muted-foreground">{finnhub.apiKeyMasked}</p>
              </div>
              <Button variant="outline" disabled={disconnectProvider.isPending} onClick={() => disconnectProvider.mutate('finnhub')}>
                {t('common:actions.disconnect')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md bg-muted/50 p-3">
              <Label htmlFor="finnhub-key">{t('assets:settings.finnhubKey')}</Label>
              <Input id="finnhub-key" value={finnhubKey} onChange={(e) => setFinnhubKey(e.target.value)} autoComplete="off" />
              <Button
                disabled={!finnhubKey || connectProvider.isPending}
                onClick={() => connectProvider.mutate({ provider: 'finnhub', apiKey: finnhubKey })}
              >
                {t('common:actions.connect')}
              </Button>
            </div>
          )}

          {twelvedata ? (
            <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Twelve Data</p>
                <p className="font-mono text-xs text-muted-foreground">{twelvedata.apiKeyMasked}</p>
              </div>
              <Button variant="outline" disabled={disconnectProvider.isPending} onClick={() => disconnectProvider.mutate('twelvedata')}>
                {t('common:actions.disconnect')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md bg-muted/50 p-3">
              <Label htmlFor="twelvedata-key">{t('assets:settings.twelveDataKey')}</Label>
              <Input id="twelvedata-key" value={twelvedataKey} onChange={(e) => setTwelvedataKey(e.target.value)} autoComplete="off" />
              <Button
                disabled={!twelvedataKey || connectProvider.isPending}
                onClick={() => connectProvider.mutate({ provider: 'twelvedata', apiKey: twelvedataKey })}
              >
                {t('common:actions.connect')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
