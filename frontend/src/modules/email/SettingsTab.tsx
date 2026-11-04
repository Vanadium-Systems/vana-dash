import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { readFileAsBase64 } from '@/shared/lib/attachments'
import type { EmailIdentity, EmailSettings } from '@/shared/lib/types'
import { BlocklistCard, LabelsCard, RulesCard, SuppressionsCard } from './OrganizeCards'
import { SettingsGroup, SettingsSection, SignatureEditor } from './SettingsLayout'
import { parseRoDecimal } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

function SignatureLogoCard() {
  const queryClient = useQueryClient()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Record<string, string> | null>(null)

  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })

  useEffect(() => {
    if (settings.data) setForm({ ...settings.data.signatures })
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => api.put<EmailSettings>('/api/email/settings', { signatures: form }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({
        queryKey: ['email', 'settings', 'sender-options'],
      })
      setForm({ ...data.signatures })
      toast.success(t('email:settings.signaturesSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const encoded = await readFileAsBase64(file)
      return api.post('/api/email/settings/logo', encoded)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings'] })
      toast.success(t('email:settings.logoUpdated'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (!form) return <Skeleton className="h-48 w-full" />
  const identities = settings.data?.identities ?? []

  const companySignature = form['contact'] ?? ''
  return (
    <>
      <SettingsSection title={t('email:settings.signaturesTitle')} description={t('email:settings.signaturesHint')}>
        <SignatureEditor
          mailboxes={identities.map((identity) => ({
            key: identity.key,
            label: identity.label,
            fromAddress: identity.fromAddress,
            fallback: identity.key === 'contact' ? undefined : companySignature,
          }))}
          values={form}
          onChange={(key, html) => setForm((f) => ({ ...f!, [key]: html }))}
          fallbackLabel={t('email:settings.usesCompanySignature')}
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? t('common:states.saving') : t('email:settings.saveSignatures')}
        </Button>
      </SettingsSection>
      <SettingsSection title={t('email:settings.logoTitle')} description={t('email:settings.logoHint')}>
        <div className="flex items-center gap-4">
          {settings.data?.logoUrl ? <img src={settings.data.logoUrl} alt={t('email:settings.logoAlt')} className="h-12 rounded border bg-white p-1" /> : null}
          <Button type="button" variant="outline" disabled={uploadLogo.isPending} onClick={() => logoInputRef.current?.click()}>
            {uploadLogo.isPending ? t('common:states.loading') : t('email:settings.uploadLogo')}
          </Button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadLogo.mutate(file)
              e.target.value = ''
            }}
          />
        </div>
      </SettingsSection>
    </>
  )
}

function SpamCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    autoSpamEnabled: true,
    spamThreshold: 4,
    spamKeywordsText: '',
  })

  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })

  useEffect(() => {
    if (settings.data) {
      setForm({
        autoSpamEnabled: settings.data.autoSpamEnabled,
        spamThreshold: settings.data.spamThreshold,
        spamKeywordsText: settings.data.spamKeywords.join('\n'),
      })
    }
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<EmailSettings>('/api/email/settings', {
        autoSpamEnabled: form.autoSpamEnabled,
        spamThreshold: form.spamThreshold,
        spamKeywords: form.spamKeywordsText
          .split('\n')
          .map((k) => k.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings'] })
      toast.success(t('email:settings.spamSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.isPending) return <Skeleton className="h-48 w-full" />

  return (
    <SettingsSection title={t('email:settings.spamTitle')} description={t('email:settings.spamHint')}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.autoSpamEnabled} onChange={(e) => setForm((f) => ({ ...f, autoSpamEnabled: e.target.checked }))} />
        {t('common:states.activeF')}
      </label>
      <div className="space-y-2">
        <Label htmlFor="spam-threshold">{t('email:settings.spamThreshold')}</Label>
        <Input
          id="spam-threshold"
          inputMode="numeric"
          className="w-24"
          value={form.spamThreshold}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              spamThreshold: parseRoDecimal(e.target.value) || 0,
            }))
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="spam-keywords">{t('email:settings.spamTriggers')}</Label>
        <Textarea
          id="spam-keywords"
          className="min-h-32 font-mono"
          value={form.spamKeywordsText}
          onChange={(e) => setForm((f) => ({ ...f, spamKeywordsText: e.target.value }))}
        />
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? t('common:states.saving') : t('common:actions.save')}
      </Button>
    </SettingsSection>
  )
}

function OutreachCapCard() {
  const queryClient = useQueryClient()
  const [cap, setCap] = useState(50)
  const [sendHour, setSendHour] = useState(10)
  const [weekdaysOnly, setWeekdaysOnly] = useState(true)

  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })

  useEffect(() => {
    if (settings.data) {
      setCap(settings.data.outreachDailyCap)
      setSendHour(settings.data.outreachSendHour)
      setWeekdaysOnly(settings.data.outreachSendWeekdaysOnly)
    }
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<EmailSettings>('/api/email/settings', {
        outreachDailyCap: cap,
        outreachSendHour: sendHour,
        outreachSendWeekdaysOnly: weekdaysOnly,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings'] })
      toast.success(t('email:settings.outreachSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.isPending) return <Skeleton className="h-48 w-full" />

  return (
    <SettingsSection title={t('email:settings.outreachTitle')} description={t('email:settings.outreachHint')}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="outreach-cap">{t('email:settings.emailsPerDay')}</Label>
          <Input
            id="outreach-cap"
            inputMode="numeric"
            className="w-24"
            value={cap}
            onChange={(e) => setCap(Math.max(1, parseRoDecimal(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="outreach-hour">{t('email:settings.hour')}</Label>
          <Input
            id="outreach-hour"
            inputMode="numeric"
            className="w-20"
            value={sendHour}
            onChange={(e) => setSendHour(Math.min(23, Math.max(0, parseRoDecimal(e.target.value) || 0)))}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
          {t('email:settings.weekdaysOnly')}
        </label>
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? t('common:states.saving') : t('common:actions.save')}
      </Button>
    </SettingsSection>
  )
}

function IdentitiesCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })
  const [rows, setRows] = useState<EmailIdentity[] | null>(null)

  useEffect(() => {
    if (settings.data) setRows(settings.data.identities ?? [])
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => api.put<EmailSettings>('/api/email/settings', { identities: rows }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({
        queryKey: ['email', 'settings', 'sender-options'],
      })
      setRows(data.identities ?? [])
      toast.success(t('email:identities.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (!rows) return null

  return (
    <SettingsSection title={t('email:identities.title')} description={t('email:identities.hint')}>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="w-28 space-y-1">
              <Label htmlFor={`id-key-${i}`} className="text-xs text-muted-foreground">
                {t('email:identities.key')}
              </Label>
              <Input
                id={`id-key-${i}`}
                value={row.key}
                onChange={(e) => setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, key: e.target.value.toLowerCase() } : r)))}
                className="font-mono"
              />
            </div>
            <div className="w-40 space-y-1">
              <Label htmlFor={`id-label-${i}`} className="text-xs text-muted-foreground">
                {t('common:labels.label')}
              </Label>
              <Input
                id={`id-label-${i}`}
                value={row.label}
                onChange={(e) => setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor={`id-from-${i}`} className="text-xs text-muted-foreground">
                {t('email:identities.fromAddress')}
              </Label>
              <Input
                id={`id-from-${i}`}
                type="email"
                placeholder={t('email:identities.fromPlaceholder')}
                value={row.fromAddress}
                onChange={(e) => setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, fromAddress: e.target.value } : r)))}
                className="font-mono"
              />
            </div>
            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('email:identities.delete')}
                onClick={() => setRows((prev) => prev!.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setRows((prev) => [...prev!, { key: '', label: '', fromAddress: '' }])}>
          <Plus className="h-4 w-4" /> {t('email:identities.new')}
        </Button>
        <Button disabled={!save.isPending && rows === (settings.data?.identities ?? null)} onClick={() => save.mutate()}>
          {t('common:actions.save')}
        </Button>
      </div>
    </SettingsSection>
  )
}

function ReadingCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })
  const [autoLoad, setAutoLoad] = useState<boolean | null>(null)

  useEffect(() => {
    if (settings.data) setAutoLoad(settings.data.autoLoadImages ?? false)
  }, [settings.data])

  const save = useMutation({
    mutationFn: (next: boolean) => api.put<EmailSettings>('/api/email/settings', { autoLoadImages: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({
        queryKey: ['email', 'settings', 'sender-options'],
      })
      toast.success(data.autoLoadImages ? t('email:reading.imagesAuto') : t('email:reading.imagesConfirm'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (autoLoad === null) return null

  return (
    <SettingsSection title={t('email:reading.title')}>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={autoLoad}
          onChange={(e) => {
            setAutoLoad(e.target.checked)
            save.mutate(e.target.checked)
          }}
        />
        <span>
          <span className="font-medium">{t('email:reading.autoLoadImages')}</span>
          <span className="block text-xs text-muted-foreground">{t('email:reading.autoLoadHint')}</span>
        </span>
      </label>
    </SettingsSection>
  )
}

export function SettingsTab() {
  return (
    <div className="max-w-5xl">
      <h2 className="pb-4 text-lg font-semibold">{t('email:sidebar.companySettings')}</h2>
      <SettingsGroup title={t('email:settings.groups.sending')}>
        <IdentitiesCard />
        <SignatureLogoCard />
        <OutreachCapCard />
      </SettingsGroup>
      <SettingsGroup title={t('email:settings.groups.receiving')}>
        <ReadingCard />
        <SpamCard />
        <LabelsCard scope="company" />
        <RulesCard scope="company" />
        <BlocklistCard />
      </SettingsGroup>
      <SettingsGroup title={t('email:settings.groups.unsubscribes')}>
        <SuppressionsCard />
      </SettingsGroup>
    </div>
  )
}
