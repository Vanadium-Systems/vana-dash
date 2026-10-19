import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, Package, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import type { AnafStatusInfo, InvoiceSequence, QuarterlyPackageSummary } from '@/shared/lib/types'
import { formatDate, formatMoney } from './badges'
import { parseRoDecimal } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'
import { BASE_CURRENCY } from '@/shared/lib/locale'

function currentQuarter(): string {
  const now = new Date()
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

// Oglindește formatInvoiceNumber din backend/src/shared/lib/sequences.ts — separatorul
// apare STRICT între părți existente, nu inserat necondiționat (bug: producea "VAN--0002"
// când yearFormat='none', separatorul de dinaintea anului rămânea cu string gol după el).
function formatSequencePreview(seq: InvoiceSequence): string {
  const year = new Date().getFullYear()
  const parts: string[] = []
  if (seq.prefix !== '') parts.push(seq.prefix)
  if (seq.yearFormat === 'yyyy') parts.push(String(year))
  else if (seq.yearFormat === 'yy') parts.push(String(year % 100).padStart(2, '0'))
  parts.push(String(seq.currentValue + 1).padStart(seq.padding, '0'))
  return parts.join(seq.separator)
}

// The quarterly package for the accountant: a preview (no zip is rebuilt) when the quarter
// changes, and an explicit build on the button, which can take a while because it downloads
// everything from R2. Sending stays manual: the zip is downloaded and sent by a person.
function QuarterlyPackageCard() {
  const queryClient = useQueryClient()
  const [quarter, setQuarter] = useState(currentQuarter())

  const summary = useQuery({
    queryKey: ['accounting', 'quarterly-package', quarter],
    queryFn: () => api.get<QuarterlyPackageSummary>(`/api/accounting/quarterly-package?quarter=${quarter}`),
  })

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ summary: QuarterlyPackageSummary; downloadUrl: string }>(
        `/api/accounting/quarterly-package/generate?quarter=${quarter}`,
      ),
    onSuccess: ({ downloadUrl }) => {
      window.open(downloadUrl, '_blank')
      // regenerarea schimbă starea pachetului afișată pe card
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'quarterly-package', quarter] })
      toast.success(t('accounting:quarterly.generated'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-4 w-4" /> {t('accounting:quarterly.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('accounting:quarterly.hint')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="qp-quarter">{t('accounting:quarterly.quarter')}</Label>
            <Input
              id="qp-quarter"
              className="w-32"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value.toUpperCase())}
              placeholder="2026-Q3"
            />
          </div>
          <Button variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
            <Download className="h-4 w-4" /> {generate.isPending ? t('common:states.generating') : t('accounting:quarterly.generate')}
          </Button>
        </div>
        {summary.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : summary.isError ? (
          <p className="text-sm text-destructive">{t('accounting:quarterly.invalidFormat')}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.issuedInvoices')}</dt><dd className="font-medium">{summary.data.invoicesIssued}</dd></div>
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.receivedInvoices')}</dt><dd className="font-medium">{summary.data.invoicesReceived}</dd></div>
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.revenue')}</dt><dd className="font-medium">{formatMoney(summary.data.revenueRon, BASE_CURRENCY)}</dd></div>
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.expenses')}</dt><dd className="font-medium">{formatMoney(summary.data.expensesRon, BASE_CURRENCY)}</dd></div>
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.unreconciled')}</dt><dd className="font-medium">{summary.data.unmatchedBankTransactions}</dd></div>
            <div><dt className="text-muted-foreground">{t('accounting:quarterly.reverseChargeLines')}</dt><dd className="font-medium">{summary.data.reverseChargeLines}</dd></div>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function AnafConnectionCard() {
  const queryClient = useQueryClient()
  const [cif, setCif] = useState('')
  const [code, setCode] = useState('')

  const status = useQuery({
    queryKey: ['anaf-status'],
    queryFn: () => api.get<AnafStatusInfo>('/api/accounting/anaf/status'),
  })

  const openAuthorize = useMutation({
    mutationFn: () => api.get<{ url: string }>('/api/accounting/anaf/authorize-url'),
    onSuccess: ({ url }) => window.open(url, '_blank'),
    onError: (err) => toast.error(err.message),
  })

  const exchange = useMutation({
    mutationFn: () => api.post<AnafStatusInfo>('/api/accounting/anaf/exchange-code', { code, cif }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anaf-status'] })
      setCode('')
      toast.success(t('accounting:anaf.connectedToast'))
    },
    onError: (err) => toast.error(err.message),
  })

  const refresh = useMutation({
    mutationFn: () => api.post<AnafStatusInfo>('/api/accounting/anaf/refresh', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['anaf-status'] })
      toast.success(t('accounting:anaf.refreshedToast'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (status.isPending) return <Skeleton className="h-40 w-full" />
  const info = status.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          ANAF SPV / e-Factura
          {info?.status === 'active' ? (
            <StatePill tone="success">{t('accounting:anaf.connected')}</StatePill>
          ) : info?.status === 'needs_reauth' ? (
            <StatePill tone="critical">{t('accounting:anaf.needsReauth')}</StatePill>
          ) : (
            <StatePill>{t('accounting:anaf.notConfigured')}</StatePill>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {info?.status === 'active' ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-muted-foreground">
              {tNodes('accounting:anaf.tokenInfo', {
                cif: <span className="font-mono text-foreground">{info.cif}</span>,
                expires: formatDate(info.expiresAt),
                refreshed: formatDate(info.lastRefreshedAt),
              })}
            </div>
            <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw className="h-4 w-4" />
              {refresh.isPending ? t('accounting:anaf.refreshing') : t('accounting:anaf.refreshNow')}
            </Button>
          </div>
        ) : null}

        {!info?.oauthConfigured ? (
          <p className="text-sm text-muted-foreground">
            {tNodes('accounting:anaf.setEnv', {
              clientId: <code className="font-mono">ANAF_CLIENT_ID</code>,
              clientSecret: <code className="font-mono">ANAF_CLIENT_SECRET</code>,
              envFile: <code className="font-mono">.env</code>,
            })}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('accounting:anaf.steps')}
            </p>
            <Button variant="outline" disabled={openAuthorize.isPending} onClick={() => openAuthorize.mutate()}>
              <ExternalLink className="h-4 w-4" /> {t('accounting:anaf.openConsent')}
            </Button>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                exchange.mutate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="anaf-cif">{t('common:labels.cif')}</Label>
                <Input id="anaf-cif" className="w-36" value={cif} onChange={(e) => setCif(e.target.value)} required />
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="anaf-code">{t('accounting:anaf.authCode')}</Label>
                <Input id="anaf-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <Button type="submit" disabled={exchange.isPending}>
                {exchange.isPending ? t('common:states.connecting') : t('common:actions.connect')}
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SequenceCard() {
  const queryClient = useQueryClient()
  const sequence = useQuery({
    queryKey: ['invoice-sequence'],
    queryFn: () => api.get<InvoiceSequence>('/api/invoicing/sequence'),
  })

  const [prefix, setPrefix] = useState<string | null>(null)
  const [padding, setPadding] = useState<string | null>(null)
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.patch<InvoiceSequence>('/api/invoicing/sequence', {
        ...(prefix !== null ? { prefix } : {}),
        ...(padding !== null ? { padding: parseRoDecimal(padding) } : {}),
        ...(defaultPaymentTermsDays !== null ? { defaultPaymentTermsDays: parseRoDecimal(defaultPaymentTermsDays) } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice-sequence'] })
      setPrefix(null)
      setPadding(null)
      setDefaultPaymentTermsDays(null)
      toast.success(t('accounting:sequence.updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (sequence.isPending) return <Skeleton className="h-32 w-full" />
  const seq = sequence.data
  if (!seq) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('accounting:sequence.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {tNodes('accounting:sequence.currentFormat', {
            preview: <span className="font-mono text-foreground">{formatSequencePreview(seq)}</span>,
            last: seq.currentValue,
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('accounting:sequence.paymentTermHint')}
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="seq-prefix">{t('accounting:sequence.prefix')}</Label>
            <Input
              id="seq-prefix"
              className="w-28"
              value={prefix ?? seq.prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seq-padding">{t('accounting:sequence.padding')}</Label>
            <Input
              id="seq-padding"
              className="w-24"
              inputMode="numeric"
              value={padding ?? String(seq.padding)}
              onChange={(e) => setPadding(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seq-payment-terms">{t('accounting:sequence.defaultPaymentTerm')}</Label>
            <Input
              id="seq-payment-terms"
              className="w-40"
              inputMode="numeric"
              value={defaultPaymentTermsDays ?? String(seq.defaultPaymentTermsDays)}
              onChange={(e) => setDefaultPaymentTermsDays(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={save.isPending || (prefix === null && padding === null && defaultPaymentTermsDays === null)}
          >
            {t('common:actions.save')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {t(seq.resetOn === 'year' ? 'accounting:sequence.yearlyResetOn' : 'accounting:sequence.yearlyResetOff')}
        </p>
      </CardContent>
    </Card>
  )
}

export function SettingsTab() {
  return (
    <div className="space-y-6">
      <AnafConnectionCard />
      <SequenceCard />
      <QuarterlyPackageCard />
    </div>
  )
}
