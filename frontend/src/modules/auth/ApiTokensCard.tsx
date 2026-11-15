import { useQuery } from '@tanstack/react-query'
import { Ban, Copy, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { expiresText, featuresText, lastUsedText, prefixText, useCreateApiToken, useMyApiTokens, useRevokeApiToken, type ApiTokenItem } from './api-tokens'

// Personal tokens in "Profilul meu", for scripts and Claude Code. The clear token lives only in the
// dialog state after creation; closing the dialog drops it.

type ExpiryChoice = '30' | '90' | '365' | 'never'

const EXPIRY_DAYS: Record<ExpiryChoice, 30 | 90 | 365 | null> = { '30': 30, '90': 90, '365': 365, never: null }

// Labels for the person's own features only; the Modules catalog needs `echipa.administrare`.
function useFeatureLabels(enabled: boolean) {
  const own = useQuery({
    queryKey: ['api-tokens', 'features'],
    queryFn: () => api.get<Array<{ key: string; label: string }>>('/api/me/api-tokens/features'),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
  return useMemo(() => new Map((own.data ?? []).map((feature) => [feature.key, feature.label])), [own.data])
}

export function ApiTokensCard() {
  const tokens = useMyApiTokens()
  const revoke = useRevokeApiToken(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiTokenItem | null>(null)

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t('auth:apiTokens.title')}</CardTitle>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            {t('auth:apiTokens.new')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t('auth:apiTokens.intro')}</p>

        {tokens.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : tokens.isError ? (
          <div className="space-y-2 text-sm">
            <p>{t('auth:apiTokens.loadFailed')}</p>
            <Button variant="outline" onClick={() => void tokens.refetch()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : tokens.data.length === 0 ? (
          <EmptyState kind="new" title={t('auth:apiTokens.emptyTitle')} description={t('auth:apiTokens.emptyHint')} />
        ) : (
          <Table>
            <caption className="sr-only">{t('auth:apiTokens.tableCaption')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.name')}</TableHead>
                <TableHead priority="md">{t('auth:apiTokens.columns.prefix')}</TableHead>
                <TableHead priority="lg">{t('auth:apiTokens.columns.features')}</TableHead>
                <TableHead priority="md">{t('auth:apiTokens.columns.lastUsed')}</TableHead>
                <TableHead priority="md">{t('auth:apiTokens.columns.expires')}</TableHead>
                <TableHead className="text-right">
                  <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map((token) => (
                <TableRow key={token.id} className={cn(token.revokedAt && 'opacity-60')}>
                  <TableCell className="font-medium tbl-fill">
                    <div className="truncate">{token.name}</div>
                    <TableDetails
                      items={[
                        <span key="prefix" className="font-mono">{prefixText(token)}</span>,
                        featuresText(token),
                        lastUsedText(token, true),
                        expiresText(token),
                      ]}
                    />
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap font-mono text-xs">
                    {prefixText(token)}
                  </TableCell>
                  <TableCell priority="lg" className="whitespace-nowrap">
                    {featuresText(token)}
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap">
                    {lastUsedText(token)}
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap">
                    {expiresText(token)}
                  </TableCell>
                  <TableCell className="text-right">
                    {token.revokedAt ? null : (
                      <RowActions
                        title={token.name}
                        actions={[{ key: 'revoke', icon: Ban, label: t('auth:apiTokens.revoke'), destructive: true, onClick: () => setRevoking(token) }]}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateTokenDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('auth:apiTokens.revokeDialog.title', { name: revoking?.name ?? '' })}
        consequence={t('auth:apiTokens.revokeDialog.body')}
        confirmLabel={t('auth:apiTokens.revokeDialog.confirm')}
        destructive
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </Card>
  )
}

function CreateTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useMe()
  const labels = useFeatureLabels(open)
  const create = useCreateApiToken()
  const roleFeatures = useMemo(
    () => [...(session?.features ?? [])].sort((a, b) => (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b)),
    [session?.features, labels],
  )
  const [name, setName] = useState('')
  // Read-only by default: only the page gates (`<page>.view`) start ticked; anything that writes,
  // sends or moves money has to be ticked on purpose.
  const [picked, setPicked] = useState<string[] | null>(null)
  const chosen = picked ?? roleFeatures.filter((key) => key.endsWith('.view'))
  const [expiry, setExpiry] = useState<ExpiryChoice>('90')
  const [nameError, setNameError] = useState<string | null>(null)
  const [featuresError, setFeaturesError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const close = () => {
    setName('')
    setPicked(null)
    setExpiry('90')
    setNameError(null)
    setFeaturesError(null)
    setCreated(null)
    create.reset()
    onClose()
  }

  const submit = () => {
    if (chosen.length === 0) {
      setFeaturesError(t('auth:apiTokens.create.noFeatures'))
      return
    }
    setNameError(null)
    setFeaturesError(null)
    create.mutate(
      { name: name.trim(), features: chosen, expiresInDays: EXPIRY_DAYS[expiry] },
      {
        onSuccess: (data) => setCreated(data.token),
        onError: (error) => {
          if (error instanceof ApiError && (error.message === 'FEATURES_NOT_IN_ROLE' || error.code === 'FEATURES_NOT_IN_ROLE')) setFeaturesError(t('auth:apiTokens.create.notInRole'))
          else setNameError(error instanceof ApiError ? error.message : t('auth:apiTokens.create.failed'))
        },
      },
    )
  }

  const copy = () => {
    if (!created) return
    navigator.clipboard.writeText(created).then(
      () => toast.success(t('common:states.copied')),
      () => toast.error(t('auth:apiTokens.create.copyFailed')),
    )
  }

  // While the token is on screen a click outside or Esc does not close: it would lose the only copy.
  const keepWhileShown = (event: Event) => {
    if (created) event.preventDefault()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined} onInteractOutside={keepWhileShown} onEscapeKeyDown={keepWhileShown}>
        <DialogHeader>
          <DialogTitle className="text-base">{created ? t('auth:apiTokens.created.title') : t('auth:apiTokens.create.title')}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="min-w-0 space-y-4">
            <p className="text-sm font-medium">{t('auth:apiTokens.created.warning')}</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={created} aria-label={t('auth:apiTokens.created.field')} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
              <Button type="button" variant="outline" size="icon" title={t('auth:apiTokens.created.copy')} aria-label={t('auth:apiTokens.created.copy')} onClick={copy}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={close}>
                {t('auth:apiTokens.created.done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Field label={t('auth:apiTokens.create.name')} hint={t('auth:apiTokens.create.nameHint')} error={nameError}>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus />
            </Field>
            <fieldset className="min-w-0 space-y-1.5">
              <legend className="mb-1 text-sm font-medium">{t('auth:apiTokens.create.features')}</legend>
              <p className="text-xs text-muted-foreground">{t('auth:apiTokens.create.featuresHint')}</p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md bg-muted/40 p-3">
                {roleFeatures.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={chosen.includes(key)}
                      onChange={(event) => setPicked(event.target.checked ? [...chosen, key] : chosen.filter((k) => k !== key))}
                    />
                    <span className="min-w-0 truncate">{labels.get(key) ?? key}</span>
                  </label>
                ))}
              </div>
              {featuresError ? <p className="text-xs text-destructive-text">{featuresError}</p> : null}
            </fieldset>
            <Field label={t('auth:apiTokens.create.expiry')}>
              <Select
                value={expiry}
                onValueChange={(value) => setExpiry(value as ExpiryChoice)}
                options={[
                  { value: '30', label: t('auth:apiTokens.create.expiry30') },
                  { value: '90', label: t('auth:apiTokens.create.expiry90') },
                  { value: '365', label: t('auth:apiTokens.create.expiry365') },
                  { value: 'never', label: t('auth:apiTokens.create.expiryNever') },
                ]}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
                {t('auth:apiTokens.create.submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
