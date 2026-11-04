import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api, ApiError } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailMySettings } from '@/shared/lib/types'
import { BlocklistCard, LabelsCard, RulesCard, SuppressionsCard } from './OrganizeCards'
import { SettingsGroup, SettingsSection, SignatureEditor } from './SettingsLayout'

const OUTREACH = 'outreach'

function SignaturesCard({ settings }: { settings: EmailMySettings }) {
  const queryClient = useQueryClient()
  const [signatures, setSignatures] = useState<Record<string, string>>(settings.signatures)
  useEffect(() => setSignatures(settings.signatures), [settings.signatures])

  const save = useMutation({
    mutationFn: () =>
      api.patch<EmailMySettings>('/api/email/me/settings', {
        // Every mailbox is sent: an emptied field clears the person's signature on the server.
        signatures: Object.fromEntries(settings.mailboxes.map((m) => [m.key, signatures[m.key] ?? ''])),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['email', 'me', 'settings'], next)
      toast.success(t('email:mySettings.signatureSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.mailboxes.length === 0) {
    return (
      <SettingsSection title={t('email:mySettings.signature')}>
        <p className="text-sm text-muted-foreground">{t('email:mySettings.noMailboxes')}</p>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title={t('email:mySettings.signature')} description={t('email:mySettings.signatureHint')}>
      <SignatureEditor
        mailboxes={settings.mailboxes.map((m) => ({
          key: m.key,
          label: m.label,
          fromAddress: m.fromAddress,
          fallback: m.companySignature,
        }))}
        values={signatures}
        onChange={(key, html) => setSignatures((prev) => ({ ...prev, [key]: html }))}
        fallbackLabel={t('email:mySettings.companySignatureUsed')}
      />
      <Button disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? t('common:states.saving') : t('common:actions.save')}
      </Button>
    </SettingsSection>
  )
}

function OutreachCapCard({ settings }: { settings: EmailMySettings }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(settings.outreachDailyCap?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setValue(settings.outreachDailyCap?.toString() ?? ''), [settings.outreachDailyCap])

  const save = useMutation({
    mutationFn: (cap: number | null) =>
      api.patch<EmailMySettings>('/api/email/me/settings', {
        outreachDailyCap: cap,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['email', 'me', 'settings'], next)
      toast.success(t('email:mySettings.capSaved'))
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === 'CAP_ABOVE_COMPANY'
          ? t('email:mySettings.capAboveCompany', {
              cap: settings.companyOutreachCap,
            })
          : err.message,
      ),
  })

  return (
    <SettingsSection
      title={t('email:mySettings.cap')}
      description={t('email:mySettings.capHint', {
        cap: formatNumber(settings.companyOutreachCap),
      })}
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          const cap = trimmed === '' ? null : Number(trimmed)
          if (cap !== null && (!Number.isInteger(cap) || cap < 0)) {
            setError(t('email:mySettings.capInvalid'))
            return
          }
          if (cap !== null && cap > settings.companyOutreachCap) {
            setError(
              t('email:mySettings.capAboveCompany', {
                cap: settings.companyOutreachCap,
              }),
            )
            return
          }
          setError(null)
          save.mutate(cap)
        }}
      >
        <Label htmlFor="my-cap">
          {t('email:mySettings.capLabel')} <span className="font-normal text-muted-foreground">{t('common:states.optional')}</span>
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="my-cap"
            inputMode="numeric"
            className="w-32"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'my-cap-error' : undefined}
          />
          <span className="text-sm text-muted-foreground">{t('email:mySettings.perDay')}</span>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </div>
        {error ? (
          <p id="my-cap-error" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </SettingsSection>
  )
}

// ES2-ES7: what a colleague can set for themselves without the company's Email settings:
// a signature per mailbox, a lower outreach cap, their own labels and rules; the blocklist and
// unsubscribes are visible but the company's to change.
export function MySettingsTab() {
  const settings = useQuery({
    queryKey: ['email', 'me', 'settings'],
    queryFn: () => api.get<EmailMySettings>('/api/email/me/settings'),
  })

  return (
    <div data-density="comfortable" className="max-w-5xl">
      <h2 className="pb-4 text-lg font-semibold">{t('email:mySettings.title')}</h2>
      {settings.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : settings.isError || !settings.data ? (
        <p className="text-sm">
          {t('email:mySettings.loadFailed')}{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => void settings.refetch()}>
            {t('common:actions.retry')}
          </button>
        </p>
      ) : (
        <SettingsGroup title={t('email:settings.groups.sending')}>
          <SignaturesCard settings={settings.data} />
          {settings.data.mailboxes.some((m) => m.key === OUTREACH) ? <OutreachCapCard settings={settings.data} /> : null}
        </SettingsGroup>
      )}
      <SettingsGroup title={t('email:settings.groups.organising')}>
        <LabelsCard scope="mine" />
        <RulesCard scope="mine" />
      </SettingsGroup>
      <SettingsGroup title={t('email:settings.groups.companyReadOnly')}>
        <BlocklistCard readOnly />
        <SuppressionsCard readOnly />
      </SettingsGroup>
    </div>
  )
}
