import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { ChartError } from '@/shared/components/charts/chart-states'
import { api } from '@/shared/lib/api'
import type { BankAccount, VanagreenExtensionLogEntry, VanagreenSettings } from '@/shared/lib/types'

function SetupGuide() {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button
        className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Ghid: cum configurezi Revolut de la zero (sandbox sau producție)
      </button>
      {open ? (
        <CardContent className="space-y-3 pt-0 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Adaugă un cont din tab-ul <strong>Conturi</strong> (provider Revolut, API Key gol — nu mai e nevoie,
              Revolut a trecut pe OAuth).
            </li>
            <li>
              Aici, în <strong>Setări</strong>: apasă <strong>„Generează certificat"</strong>, apoi{' '}
              <strong>„Descarcă certificatul"</strong> (fișier <code className="font-mono">.pem</code>).
            </li>
            <li>
              În Revolut Business (
              <span className="font-mono">business.revolut.com</span> pt. producție,{' '}
              <span className="font-mono">sandbox-business.revolut.com</span> pt. testare) — cont separat, se face
              signup normal acolo — mergi la <strong>Settings → APIs → Business API → Add certificate</strong>.
            </li>
            <li>
              Lipește conținutul certificatului descărcat în câmpul „X509 public key". La{' '}
              <strong>OAuth redirect URI</strong> pune adresa unde rulează vana-dash +{' '}
              <code className="font-mono">/reconciliation/revolut-callback</code> (ex:{' '}
              <code className="font-mono">https://dash.vanadium.systems/reconciliation/revolut-callback</code> pe
              VPS). <strong>Revolut respinge `localhost`</strong> — dacă testezi local fără domeniu propriu, poți
              folosi temporar un URL de la{' '}
              <span className="font-mono">webhook.site</span> ca să vezi codul de autorizare manual.
            </li>
            <li>Salvează — Revolut îți arată <strong>Client ID</strong>. Copiază-l.</li>
            <li>
              Înapoi în vana-dash: lipește Client ID-ul mai jos, „Salvează", apoi{' '}
              <strong>„Deschide consimțirea Revolut"</strong> — te duce în Revolut, aprobi accesul.
            </li>
            <li>
              Ești redirecționat automat aici, pe Setări, cu câmpul „Cod autorizare" deja precompletat (codul e
              valabil doar <strong>~2 minute</strong>, de-aia se face automat). Verifică și apasă „Conectează".
            </li>
            <li>Gata — status „Conectat", refresh automat de acolo încolo (la fiecare ~25 min).</li>
          </ol>
          <p className="border-t pt-3">
            <strong>De reținut pt. VPS:</strong> variabilele <code className="font-mono">REVOLUT_API_URL</code> (
            <span className="font-mono">sandbox-b2b...</span> vs. <span className="font-mono">b2b...</span>) și{' '}
            <code className="font-mono">REVOLUT_REDIRECT_URI</code> din <code className="font-mono">.env</code>{' '}
            trebuie să corespundă exact mediului (sandbox/producție) și domeniului real — dacă schimbi domeniul sau
            treci pe producție, actualizează-le și refă pașii 3-7 (certificat nou nu e nevoie, doar redirect URI-ul
            înregistrat în Revolut trebuie să se potrivească).
          </p>
        </CardContent>
      ) : null}
    </Card>
  )
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('ro-RO') : '—'
}

function downloadCertificate(account: BankAccount) {
  if (!account.certificatePem) return
  const blob = new Blob([account.certificatePem], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${account.name.replace(/\s+/g, '-').toLowerCase()}-revolut-cert.pem`
  link.click()
  URL.revokeObjectURL(url)
}

function RevolutAccountCard({ account }: { account: BankAccount }) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [clientId, setClientId] = useState(account.clientId ?? '')
  const [code, setCode] = useState('')

  // Revolut redirectează aici cu ?code=... — îl preluăm o singură dată în input,
  // apoi îl scoatem din URL (codul e valabil doar ~2 minute, nu vrem să rămână
  // vizibil în istoric/refresh).
  useEffect(() => {
    const paramCode = searchParams.get('code')
    if (!paramCode || account.authStatus === 'active') return
    setCode(paramCode)
    const next = new URLSearchParams(searchParams)
    next.delete('code')
    next.delete('state')
    setSearchParams(next, { replace: true })
  }, [])

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })

  const saveClientId = useMutation({
    mutationFn: () => api.patch<BankAccount>(`/api/reconciliation/accounts/${account.id}`, { clientId }),
    onSuccess: () => {
      invalidate()
      toast.success('Client ID salvat')
    },
    onError: (err) => toast.error(err.message),
  })

  const generateCert = useMutation({
    mutationFn: () => api.post<{ certificatePem: string }>(`/api/reconciliation/accounts/${account.id}/generate-certificate`),
    onSuccess: () => {
      invalidate()
      toast.success('Certificat generat — descarcă-l și urcă-l în Revolut')
    },
    onError: (err) => toast.error(err.message),
  })

  const openAuthorize = useMutation({
    mutationFn: () => api.get<{ url: string }>(`/api/reconciliation/accounts/${account.id}/authorize-url`),
    onSuccess: ({ url }) => window.open(url, '_blank'),
    onError: (err) => toast.error(err.message),
  })

  const exchange = useMutation({
    mutationFn: () => api.post<BankAccount>(`/api/reconciliation/accounts/${account.id}/exchange-code`, { code }),
    onSuccess: () => {
      invalidate()
      setCode('')
      toast.success('Revolut conectat')
    },
    onError: (err) => toast.error(err.message),
  })

  const readyForConsent = Boolean(account.clientId && account.certificatePem)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {account.name}
          {account.authStatus === 'active' ? (
            <StatePill tone="success">Conectat</StatePill>
          ) : account.authStatus === 'needs_reauth' ? (
            <StatePill tone="critical">Necesită re-auth</StatePill>
          ) : (
            <StatePill>Neconfigurat</StatePill>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {account.authStatus === 'active' ? (
          <div className="text-sm text-muted-foreground">
            Token expiră: {formatDateTime(account.tokenExpiresAt)} · Ultimul refresh:{' '}
            {formatDateTime(account.lastRefreshedAt)}
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          1. Salvează Client ID-ul (din aplicația înregistrată în Revolut Business Settings → API) · 2. Generează și
          urcă certificatul acolo · 3. Deschide consimțirea și lipește codul din redirect.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor={`client-${account.id}`}>Client ID</Label>
            <Input id={`client-${account.id}`} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <Button
            variant="outline"
            disabled={saveClientId.isPending || !clientId || clientId === account.clientId}
            onClick={() => saveClientId.mutate()}
          >
            Salvează
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={generateCert.isPending} onClick={() => generateCert.mutate()}>
            {account.certificatePem ? 'Regenerează certificatul' : 'Generează certificat'}
          </Button>
          {account.certificatePem ? (
            <Button variant="outline" onClick={() => downloadCertificate(account)}>
              <Download className="h-4 w-4" /> Descarcă certificatul
            </Button>
          ) : null}
        </div>

        {readyForConsent ? (
          <div className="space-y-3 border-t pt-4">
            <Button variant="outline" disabled={openAuthorize.isPending} onClick={() => openAuthorize.mutate()}>
              <ExternalLink className="h-4 w-4" /> Deschide consimțirea Revolut
            </Button>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                exchange.mutate()
              }}
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor={`code-${account.id}`}>Cod autorizare (din redirect)</Label>
                <Input id={`code-${account.id}`} value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <Button type="submit" disabled={exchange.isPending}>
                {exchange.isPending ? 'Se conectează…' : 'Conectează'}
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Setează Client ID și generează certificatul mai întâi ca să poți deschide consimțirea.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function formatMonths(months: number): string {
  return months === 1 ? '1 lună' : `${months} luni`
}

function VanagreenExtensionCard() {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: ['vanagreen-settings'],
    queryFn: () => api.get<VanagreenSettings>('/api/reconciliation/vanagreen-settings'),
  })

  const log = useQuery({
    queryKey: ['vanagreen-extension-log'],
    queryFn: () => api.get<VanagreenExtensionLogEntry[]>('/api/reconciliation/vanagreen-extension-log'),
  })

  const toggle = useMutation({
    mutationFn: (autoExtendEnabled: boolean) =>
      api.put<VanagreenSettings>('/api/reconciliation/vanagreen-settings', { autoExtendEnabled }),
    onSuccess: (data) => {
      queryClient.setQueryData(['vanagreen-settings'], data)
      toast.success(data.autoExtendEnabled ? 'Extindere automată pornită' : 'Extindere automată oprită (dry-run)')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extindere abonament vanagreen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          La o plată confirmată (match bancar automat sau „Marchează plătit" manual din Contabilitate) pe un client
          mapat la un tenant vanagreen, extinde abonamentul acolo. Cu comutatorul oprit, acțiunile se loghează ca
          dry-run — util pt. testare, fără niciun apel real către vanagreen.
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.data?.autoExtendEnabled ?? false}
            disabled={settings.isPending || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          Extindere automată ON (altfel doar dry-run)
        </label>

        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-medium">Istoric acțiuni (ultimele 100)</p>
          {log.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : !log.data?.length ? (
            <p className="text-sm text-muted-foreground">Nicio acțiune încă.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Când</TableHead>
                  <TableHead>Sursă</TableHead>
                  <TableHead>Mod</TableHead>
                  <TableHead>Luni</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detalii</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs">{new Date(entry.createdAt).toLocaleString('ro-RO')}</TableCell>
                    <TableCell className="text-xs">
                      {entry.source === 'auto_match' ? 'Match bancar' : 'Marcat manual'}
                    </TableCell>
                    <TableCell>
                      {entry.mode === 'live' ? (
                        <StatePill tone="neutral">live</StatePill>
                      ) : (
                        <StatePill>dry-run</StatePill>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{formatMonths(entry.months)}</TableCell>
                    <TableCell>
                      {entry.status === 'success' ? (
                        <StatePill tone="success">succes</StatePill>
                      ) : (
                        <StatePill tone="critical">eșuat</StatePill>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {entry.responseMessage ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function SetariTab() {
  const accounts = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccount[]>('/api/reconciliation/accounts'),
  })

  if (accounts.isPending) return <Skeleton className="h-40 w-full" />
  if (accounts.isError) return <ChartError message="Nu am putut încărca conturile" />

  // OAuth2 + JWT client assertion e specific Revolut — celelalte provideri (viitori) rămân pe api_key_enc,
  // configurat direct din dialogul de cont (tab Conturi), nu au nevoie de acest flow.
  const revolutAccounts = accounts.data?.filter((a) => a.provider === 'revolut') ?? []

  return (
    <div className="space-y-6">
      <VanagreenExtensionCard />
      <SetupGuide />
      {revolutAccounts.length ? (
        revolutAccounts.map((account) => <RevolutAccountCard key={account.id} account={account} />)
      ) : (
        <p className="text-sm text-muted-foreground">
          Niciun cont Revolut încă. Adaugă unul din tab-ul Conturi, apoi revino aici ca să configurezi OAuth-ul.
        </p>
      )}
    </div>
  )
}
