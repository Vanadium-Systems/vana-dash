import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'

// Conexiunea exchange + kill-switch (Setări → Crypto, Contract D). Cheile pleacă o singură
// dată spre backend (criptate AES-GCM în DB) și nu se mai afișează niciodată — doar masked.
export function CryptoSettingsCard() {
  const queryClient = useQueryClient()
  const exchanges = useQuery({
    queryKey: ['crypto', 'exchanges'],
    queryFn: () => api.get<Array<{ exchange: string; mode: string; enabled: boolean; apiKeyMasked: string }>>('/api/crypto/exchanges'),
  })
  const settings = useQuery({
    queryKey: ['crypto', 'settings'],
    queryFn: () => api.get<{ tradingEnabled: boolean }>('/api/crypto/settings'),
  })

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')

  const connect = useMutation({
    mutationFn: () =>
      api.put('/api/crypto/exchanges/binance', { apiKey, apiSecret, mode: 'paper', enabled: true }),
    onSuccess: () => {
      toast.success('Exchange conectat — cheia e criptată în DB')
      setApiKey('')
      setApiSecret('')
      void queryClient.invalidateQueries({ queryKey: ['crypto'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const disconnect = useMutation({
    mutationFn: () => api.delete('/api/crypto/exchanges/binance'),
    onSuccess: () => {
      toast.success('Exchange deconectat')
      void queryClient.invalidateQueries({ queryKey: ['crypto'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleKillSwitch = useMutation({
    mutationFn: (enabled: boolean) => api.put<{ tradingEnabled: boolean }>('/api/crypto/settings', { tradingEnabled: enabled }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['crypto', 'settings'] })
      toast.success(result.tradingEnabled ? 'Trading live ACTIVAT' : 'Trading live OPRIT')
    },
    onError: (err) => toast.error(err.message),
  })

  const binance = exchanges.data?.find((e) => e.exchange === 'binance')

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h3 className="text-sm font-semibold">Crypto · Binance</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cheie cu permisiuni de citire + spot trading, FĂRĂ withdrawal. IP whitelist pe IP-ul serverului recomandat.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
          <div>
            <p className="text-sm font-medium">Kill-switch trading live</p>
            <p className="text-xs text-muted-foreground">Oprit = ordinele live sunt respinse; paper-ul rămâne disponibil.</p>
          </div>
          <Button
            variant={settings.data?.tradingEnabled ? 'destructive' : 'outline'}
            data-testid="crypto-kill-switch"
            disabled={settings.isPending || toggleKillSwitch.isPending}
            onClick={() => toggleKillSwitch.mutate(!settings.data?.tradingEnabled)}
          >
            {settings.data?.tradingEnabled ? 'Oprește' : 'Activează'}
          </Button>
        </div>

        {binance ? (
          <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Binance <span className={binance.mode === 'live' ? 'text-destructive-text' : 'text-muted-foreground'}>({binance.mode})</span>
              </p>
              <p className="font-mono text-xs text-muted-foreground">{binance.apiKeyMasked}</p>
            </div>
            <Button variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Deconectează
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <Label htmlFor="crypto-api-key">API key</Label>
            <Input id="crypto-api-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            <Label htmlFor="crypto-api-secret">API secret</Label>
            <Input id="crypto-api-secret" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="off" />
            <Button disabled={!apiKey || !apiSecret || connect.isPending} onClick={() => connect.mutate()}>
              {connect.isPending ? 'Se salvează…' : 'Conectează'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
