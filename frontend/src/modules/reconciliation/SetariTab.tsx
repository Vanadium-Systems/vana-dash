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
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { ChartError } from '@/shared/components/charts/chart-states'
import { api } from '@/shared/lib/api'
import type { BankAccount, VanagreenExtensionLogEntry, VanagreenSettings } from '@/shared/lib/types'
import { intlTag } from '@/shared/lib/format'
import { tRich } from '@/shared/lib/i18n-nodes'
import { t } from '@/shared/lib/i18n'
import { openExternal } from '@/shared/lib/open-file'

const GUIDE_STEPS = [
  'reconciliation:guide.step1',
  'reconciliation:guide.step2',
  'reconciliation:guide.step3',
  'reconciliation:guide.step4',
  'reconciliation:guide.step5',
  'reconciliation:guide.step6',
  'reconciliation:guide.step7',
  'reconciliation:guide.step8',
] as const

function SetupGuide() {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <button
        className="flex w-full items-center gap-2 p-4 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {t('reconciliation:guide.title')}
      </button>
      {open ? (
        <CardContent className="space-y-3 pt-0 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            {GUIDE_STEPS.map((step) => (
              <li key={step}>{tRich(step)}</li>
            ))}
          </ol>
          <p className="border-t pt-3">{tRich('reconciliation:guide.vpsNote')}</p>
        </CardContent>
      ) : null}
    </Card>
  )
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString(intlTag()) : '—'
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
      toast.success(t('reconciliation:revolut.clientIdSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const generateCert = useMutation({
    mutationFn: () => api.post<{ certificatePem: string }>(`/api/reconciliation/accounts/${account.id}/generate-certificate`),
    onSuccess: () => {
      invalidate()
      toast.success(t('reconciliation:revolut.certGenerated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const openAuthorize = useMutation({
    mutationFn: () => api.get<{ url: string }>(`/api/reconciliation/accounts/${account.id}/authorize-url`),
    onSuccess: ({ url }) => openExternal(url),
    onError: (err) => toast.error(err.message),
  })

  const exchange = useMutation({
    mutationFn: () => api.post<BankAccount>(`/api/reconciliation/accounts/${account.id}/exchange-code`, { code }),
    onSuccess: () => {
      invalidate()
      setCode('')
      toast.success(t('reconciliation:revolut.connectedToast'))
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
            <StatePill tone="success">{t('reconciliation:revolut.connected')}</StatePill>
          ) : account.authStatus === 'needs_reauth' ? (
            <StatePill tone="critical">{t('reconciliation:revolut.needsReauth')}</StatePill>
          ) : (
            <StatePill>{t('reconciliation:revolut.notConfigured')}</StatePill>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {account.authStatus === 'active' ? (
          <div className="text-sm text-muted-foreground">
            {t('reconciliation:revolut.tokenInfo', { tokenExpiresAt: formatDateTime(account.tokenExpiresAt), lastRefreshedAt: formatDateTime(account.lastRefreshedAt) })}
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          {t('reconciliation:revolut.steps')}
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor={`client-${account.id}`}>{t('reconciliation:revolut.clientId')}</Label>
            <Input id={`client-${account.id}`} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <Button
            variant="outline"
            disabled={saveClientId.isPending || !clientId || clientId === account.clientId}
            onClick={() => saveClientId.mutate()}
          >
            {t('common:actions.save')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={generateCert.isPending} onClick={() => generateCert.mutate()}>
            {account.certificatePem ? t('reconciliation:revolut.regenerateCert') : t('reconciliation:revolut.generateCert')}
          </Button>
          {account.certificatePem ? (
            <Button variant="outline" onClick={() => downloadCertificate(account)}>
              <Download className="h-4 w-4" /> {t('reconciliation:revolut.downloadCert')}
            </Button>
          ) : null}
        </div>

        {readyForConsent ? (
          <div className="space-y-3 border-t pt-4">
            <Button variant="outline" disabled={openAuthorize.isPending} onClick={() => openAuthorize.mutate()}>
              <ExternalLink className="h-4 w-4" /> {t('reconciliation:revolut.openConsent')}
            </Button>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                exchange.mutate()
              }}
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor={`code-${account.id}`}>{t('reconciliation:revolut.authCode')}</Label>
                <Input id={`code-${account.id}`} value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <Button type="submit" disabled={exchange.isPending}>
                {exchange.isPending ? t('common:states.connecting') : t('common:actions.connect')}
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('reconciliation:revolut.setClientIdFirst')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function formatMonths(months: number): string {
  return t('common:count.months', { count: months })
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
      toast.success(data.autoExtendEnabled ? t('reconciliation:extension.on') : t('reconciliation:extension.off'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reconciliation:extension.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('reconciliation:extension.hint')}
        </p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.data?.autoExtendEnabled ?? false}
            disabled={settings.isPending || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          {t('reconciliation:extension.toggle')}
        </label>

        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-medium">{t('reconciliation:extension.history')}</p>
          {log.isPending ? (
            <ListSkeleton rows={3} />
          ) : !log.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('reconciliation:extension.none')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.when')}</TableHead>
                  <TableHead priority="lg">{t('common:labels.source')}</TableHead>
                  <TableHead priority="md">{t('reconciliation:extension.mode')}</TableHead>
                  <TableHead priority="md">{t('reconciliation:extension.months')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead priority="md">{t('common:labels.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs tbl-fill">
                      <div className="whitespace-nowrap">{new Date(entry.createdAt).toLocaleString(intlTag())}</div>
                      <TableDetails items={[formatMonths(entry.months), entry.mode === 'live' ? 'live' : 'dry-run', entry.responseMessage]} />
                    </TableCell>
                    <TableCell priority="lg" className="text-xs">
                      {entry.source === 'auto_match' ? t('reconciliation:extension.sourceBankMatch') : t('reconciliation:extension.sourceManual')}
                    </TableCell>
                    <TableCell priority="md">
                      {entry.mode === 'live' ? (
                        <StatePill tone="neutral">live</StatePill>
                      ) : (
                        <StatePill>dry-run</StatePill>
                      )}
                    </TableCell>
                    <TableCell priority="md" className="text-xs">{formatMonths(entry.months)}</TableCell>
                    <TableCell>
                      {entry.status === 'success' ? (
                        <StatePill tone="success">{t('reconciliation:extension.success')}</StatePill>
                      ) : (
                        <StatePill tone="critical">{t('reconciliation:extension.failed')}</StatePill>
                      )}
                    </TableCell>
                    <TableCell priority="md" className="max-w-xs truncate text-xs text-muted-foreground">
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
  if (accounts.isError) return <ChartError message={t('reconciliation:accounts.loadFailed')} />

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
          {t('reconciliation:revolut.noAccount')}
        </p>
      )}
    </div>
  )
}
