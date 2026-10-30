import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { RichTextEditor } from '@/shared/components/RichTextEditor'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { readFileAsBase64 } from '@/shared/lib/attachments'
import type {
  EmailBlocklistEntry,
  EmailIdentity,
  EmailLabel,
  EmailRule,
  EmailRuleAction,
  EmailRuleMatchType,
  EmailSettings,
  SuppressionsOverview,
} from '@/shared/lib/types'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

function SignatureLogoCard() {
  const queryClient = useQueryClient()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Record<string, string> | null>(null)

  const settings = useQuery({ queryKey: ['email', 'settings'], queryFn: () => api.get<EmailSettings>('/api/email/settings') })

  useEffect(() => {
    if (settings.data) setForm({ ...settings.data.signatures })
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => api.put<EmailSettings>('/api/email/settings', { signatures: form }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings', 'sender-options'] })
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

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <CardTitle className="text-base">{t('email:settings.signaturesTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('email:settings.signaturesHint')}
        </p>
        <div className="flex items-center gap-4">
          {settings.data?.logoUrl ? <img src={settings.data.logoUrl} alt={t('email:settings.logoAlt')} className="h-12 rounded border bg-white p-1" /> : null}
          <Button
            type="button"
            variant="outline"
            disabled={uploadLogo.isPending}
            onClick={() => logoInputRef.current?.click()}
          >
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
        <div className="space-y-4">
          {identities.map((identity) => (
            <div key={identity.key} className="space-y-1">
              <Label htmlFor={`sig-${identity.key}`} className="text-xs text-muted-foreground">
                {identity.label} — {identity.fromAddress || t('email:settings.addressNotConfigured')}
              </Label>
              <RichTextEditor
                id={`sig-${identity.key}`}
                value={form[identity.key] ?? ''}
                onChange={(html) => setForm((f) => ({ ...f!, [identity.key]: html }))}
              />
            </div>
          ))}
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? t('common:states.saving') : t('email:settings.saveSignatures')}
        </Button>
      </CardContent>
    </Card>
  )
}

function SpamCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ autoSpamEnabled: true, spamThreshold: 4, spamKeywordsText: '' })

  const settings = useQuery({ queryKey: ['email', 'settings'], queryFn: () => api.get<EmailSettings>('/api/email/settings') })

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
        spamKeywords: form.spamKeywordsText.split('\n').map((k) => k.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings'] })
      toast.success(t('email:settings.spamSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.isPending) return <Skeleton className="h-48 w-full" />

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('email:settings.spamTitle')}</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoSpamEnabled} onChange={(e) => setForm((f) => ({ ...f, autoSpamEnabled: e.target.checked }))} />
            {t('common:states.activeF')}
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('email:settings.spamHint')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="spam-threshold">{t('email:settings.spamThreshold')}</Label>
          <Input
            id="spam-threshold"
            inputMode="numeric"
            className="w-24"
            value={form.spamThreshold}
            onChange={(e) => setForm((f) => ({ ...f, spamThreshold: parseRoDecimal(e.target.value) || 0 }))}
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
      </CardContent>
    </Card>
  )
}

function OutreachCapCard() {
  const queryClient = useQueryClient()
  const [cap, setCap] = useState(50)
  const [sendHour, setSendHour] = useState(10)
  const [weekdaysOnly, setWeekdaysOnly] = useState(true)

  const settings = useQuery({ queryKey: ['email', 'settings'], queryFn: () => api.get<EmailSettings>('/api/email/settings') })

  useEffect(() => {
    if (settings.data) {
      setCap(settings.data.outreachDailyCap)
      setSendHour(settings.data.outreachSendHour)
      setWeekdaysOnly(settings.data.outreachSendWeekdaysOnly)
    }
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<EmailSettings>('/api/email/settings', { outreachDailyCap: cap, outreachSendHour: sendHour, outreachSendWeekdaysOnly: weekdaysOnly }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings'] })
      toast.success(t('email:settings.outreachSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (settings.isPending) return <Skeleton className="h-48 w-full" />

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <CardTitle className="text-base">{t('email:settings.outreachTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('email:settings.outreachHint')}
        </p>
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
      </CardContent>
    </Card>
  )
}

function LabelsCard() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const labels = useQuery({ queryKey: ['email', 'labels'], queryFn: () => api.get<EmailLabel[]>('/api/email/labels') })

  const create = useMutation({
    mutationFn: () => api.post('/api/email/labels', { name }),
    onSuccess: () => {
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['email', 'labels'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/email/labels/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'labels'] }),
  })

  // 2026-08-20 — rapoartele DMARC (etichetate automat) îl inundau pe Stefan de notificări push.
  // Bifat = fără notificări pt. mesajele cu eticheta asta (tot ajung normal în inbox/etichetate).
  const toggleNotifications = useMutation({
    mutationFn: ({ id, notificationsEnabled }: { id: string; notificationsEnabled: boolean }) =>
      api.patch(`/api/email/labels/${id}`, { notificationsEnabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'labels'] }),
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('email:labels.labels')}</CardTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          <Input placeholder={t('email:settings.newLabelPlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={create.isPending}>
            {t('common:actions.add')}
          </Button>
        </form>
        <div className="space-y-1">
          {labels.data?.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <span>{l.name}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!l.notificationsEnabled}
                    onChange={(e) => toggleNotifications.mutate({ id: l.id, notificationsEnabled: !e.target.checked })}
                  />
                  {t('email:settings.noNotifications')}
                </label>
                <Button variant="outline" onClick={() => remove.mutate(l.id)}>
                  {t('common:actions.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

const MATCH_TYPE_LABEL: Record<EmailRuleMatchType, string> = {
  from_address: t('email:rules.fromExactAddress'),
  from_domain: t('email:rules.fromDomain'),
  subject_contains: t('email:rules.subjectContains'),
}
const ACTION_LABEL: Record<EmailRuleAction, string> = { label: t('email:rules.actionLabel'), archive: t('common:actions.archive'), trash: t('common:actions.delete'), spam: t('email:rules.actionSpam') }

function RulesCard() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<{ matchType: EmailRuleMatchType; matchValue: string; action: EmailRuleAction; labelId: string }>({
    matchType: 'from_domain',
    matchValue: '',
    action: 'label',
    labelId: '',
  })

  const rules = useQuery({ queryKey: ['email', 'rules'], queryFn: () => api.get<EmailRule[]>('/api/email/rules') })
  const labels = useQuery({ queryKey: ['email', 'labels'], queryFn: () => api.get<EmailLabel[]>('/api/email/labels') })

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/email/rules', {
        matchType: form.matchType,
        matchValue: form.matchValue,
        action: form.action,
        ...(form.action === 'label' ? { labelId: form.labelId } : {}),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, matchValue: '' }))
      void queryClient.invalidateQueries({ queryKey: ['email', 'rules'] })
      toast.success(t('email:rules.created'))
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/email/rules/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'rules'] }),
  })

  const applyExisting = useMutation({
    mutationFn: (id: string) => api.post<{ affected: number }>(`/api/email/rules/${id}/apply-existing`),
    // Regula aplicată retroactiv poate muta mesaje între foldere/schimba starea citit
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
      void queryClient.invalidateQueries({ queryKey: ['email', 'unread-counts'] })
      toast.success(t('email:rules.appliedTo', { affected: result.affected }))
    },
    onError: (err) => toast.error(err.message),
  })

  const labelName = (id: string | null) => labels.data?.find((l) => l.id === id)?.name ?? '—'

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('email:rules.title')}</CardTitle>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.matchValue.trim()) create.mutate()
          }}
        >
          <Select
            className="w-auto"
            value={form.matchType}
            onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as EmailRuleMatchType }))}
          >
            {Object.entries(MATCH_TYPE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          <Input placeholder={t('email:rules.valuePlaceholder')} value={form.matchValue} onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))} />
          <Select
            className="w-auto"
            value={form.action}
            onChange={(e) => setForm((f) => ({ ...f, action: e.target.value as EmailRuleAction }))}
          >
            {Object.entries(ACTION_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          {form.action === 'label' ? (
            <Select
              className="w-auto"
              value={form.labelId}
              onChange={(e) => setForm((f) => ({ ...f, labelId: e.target.value }))}
              required
            >
              <option value="">{t('email:rules.pickLabel')}</option>
              {labels.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          ) : (
            <div />
          )}
          <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
            {t('email:rules.add')}
          </Button>
        </form>
        <div className="space-y-1">
          {rules.data?.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <span>
                {MATCH_TYPE_LABEL[r.matchType]} <strong>{r.matchValue}</strong> → {ACTION_LABEL[r.action]}
                {r.action === 'label' ? ` (${labelName(r.labelId)})` : ''}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" onClick={() => applyExisting.mutate(r.id)}>
                  {t('email:rules.applyRetroactively')}
                </Button>
                <Button variant="outline" onClick={() => remove.mutate(r.id)}>
                  {t('common:actions.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BlocklistCard() {
  const queryClient = useQueryClient()
  const [address, setAddress] = useState('')

  const blocklist = useQuery({ queryKey: ['email', 'blocklist'], queryFn: () => api.get<EmailBlocklistEntry[]>('/api/email/blocklist') })

  const add = useMutation({
    mutationFn: () => api.post('/api/email/blocklist', { address }),
    onSuccess: () => {
      setAddress('')
      void queryClient.invalidateQueries({ queryKey: ['email', 'blocklist'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/email/blocklist/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'blocklist'] }),
  })

  const applyExisting = useMutation({
    mutationFn: (id: string) => api.post<{ affected: number }>(`/api/email/blocklist/${id}/apply-existing`),
    // Mesajele mutate în coșul de gunoi schimbă lista de threads și numărătoarea de necitite
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
      void queryClient.invalidateQueries({ queryKey: ['email', 'unread-counts'] })
      toast.success(t('email:blocklist.movedToTrash', { affected: result.affected }))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('email:blocklist.title')}</CardTitle>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) add.mutate()
          }}
        >
          <Input type="email" placeholder={t('email:blocklist.placeholder')} value={address} onChange={(e) => setAddress(e.target.value)} />
          <Button type="submit" disabled={add.isPending}>
            {t('common:actions.block')}
          </Button>
        </form>
        <div className="space-y-1">
          {blocklist.data?.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
              <span>{b.address}</span>
              <div className="flex gap-1">
                <Button variant="outline" onClick={() => applyExisting.mutate(b.id)}>
                  {t('email:rules.applyRetroactively')}
                </Button>
                <Button variant="outline" onClick={() => remove.mutate(b.id)}>
                  {t('common:actions.unblock')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function IdentitiesCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['email', 'settings'], queryFn: () => api.get<EmailSettings>('/api/email/settings') })
  const [rows, setRows] = useState<EmailIdentity[] | null>(null)

  useEffect(() => {
    if (settings.data) setRows(settings.data.identities ?? [])
  }, [settings.data])

  const save = useMutation({
    mutationFn: () => api.put<EmailSettings>('/api/email/settings', { identities: rows }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings', 'sender-options'] })
      setRows(data.identities ?? [])
      toast.success(t('email:identities.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (!rows) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('email:identities.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('email:identities.hint')}
        </p>
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
                <Button type="button" variant="ghost" size="icon" aria-label={t('email:identities.delete')} onClick={() => setRows((prev) => prev!.filter((_, j) => j !== i))}>
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
      </CardContent>
    </Card>
  )
}

function ReadingCard() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['email', 'settings'], queryFn: () => api.get<EmailSettings>('/api/email/settings') })
  const [autoLoad, setAutoLoad] = useState<boolean | null>(null)

  useEffect(() => {
    if (settings.data) setAutoLoad(settings.data.autoLoadImages ?? false)
  }, [settings.data])

  const save = useMutation({
    mutationFn: (next: boolean) => api.put<EmailSettings>('/api/email/settings', { autoLoadImages: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
      void queryClient.invalidateQueries({ queryKey: ['email', 'settings', 'sender-options'] })
      toast.success(data.autoLoadImages ? t('email:reading.imagesAuto') : t('email:reading.imagesConfirm'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (autoLoad === null) return null

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <CardTitle className="text-base">{t('email:reading.title')}</CardTitle>
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
            <span className="block text-xs text-muted-foreground">
              {t('email:reading.autoLoadHint')}
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(intlTag(), { dateStyle: 'medium' })
}

// Închise implicit: listele cresc cu fiecare campanie și, deschise toate, făceau din tabul de
// setări un scroll lung până la ultimul card.
function SuppressionSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button variant="ghost" aria-expanded={open} disabled={count === 0} onClick={() => setOpen((v) => !v)}>
        <ChevronRight className={cn('transition-transform duration-150', open && 'rotate-90')} />
        {title} <span className="tnum text-muted-foreground">({count})</span>
      </Button>
      {open ? <div className="max-h-96 overflow-y-auto">{children}</div> : null}
    </div>
  )
}

// 2026-09-03 — Stefan vedea doar un count pe „Dezabonări" (SentTab.tsx), nu lista efectivă.
// 3 tabele separate: dezabonați manual (click real pe link), auto-dezabonați (bounce/complaint,
// din webhook Resend), și bounce agregat pe destinatar (poate include adrese care n-au trecut
// încă pragul de suprimare — vezi getSuppressionsOverview, backend/unsubscribe-service.ts).
function SuppressionsCard() {
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ['email', 'suppressions-overview'],
    queryFn: () => api.get<SuppressionsOverview>('/api/email/suppressions-overview'),
  })

  // Tabel PUR intern (vezi comentariul din unsubscribe-service.ts) — ștergerea de-aici nu
  // raportează nimic extern, doar oprește sărirea peste adresă la bulk-send/secvențe. Cazuri
  // reale, 2026-09-03: bounce tranzitoriu care bloca trimiterea către un contact real (nu
  // adresă moartă), și adresa proprie a lui Stefan (testare template-uri).
  const remove = useMutation({
    mutationFn: (email: string) => api.delete(`/api/email/suppressions/${encodeURIComponent(email)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'suppressions-overview'] })
      toast.success(t('email:suppressions.removed'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (overview.isPending) return <Skeleton className="h-48 w-full" />

  const data = overview.data
  if (!data) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">{t('email:suppressions.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('email:suppressions.hint')}
        </p>

        <SuppressionSection title={t('email:suppressions.manual')} count={data.unsubscribed.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.email')}</TableHead>
                <TableHead priority="md">{t('email:suppressions.unsubscribedAt')}</TableHead>
                <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.unsubscribed.map((r) => (
                <TableRow key={r.email}>
                  <TableCell className="w-full max-w-0 text-sm">
                    <div className="truncate">{r.email}</div>
                    <TableDetails items={[formatDate(r.unsubscribedAt)]} />
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.unsubscribedAt)}</TableCell>
                  <TableCell className="text-right">
                    <RowActions actions={[{ key: 'remove', icon: Trash2, label: t('common:actions.remove'), disabled: remove.isPending, onClick: () => remove.mutate(r.email) }]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SuppressionSection>

        <SuppressionSection title={t('email:suppressions.auto')} count={data.autoUnsubscribed.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.email')}</TableHead>
                <TableHead>{t('common:labels.reason')}</TableHead>
                <TableHead priority="md">{t('email:suppressions.at')}</TableHead>
                <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.autoUnsubscribed.map((r) => (
                <TableRow key={r.email}>
                  <TableCell className="w-full max-w-0 text-sm">
                    <div className="truncate">{r.email}</div>
                    <TableDetails items={[formatDate(r.unsubscribedAt)]} />
                  </TableCell>
                  <TableCell>
                    <StatePill tone={r.source === 'complaint' ? 'critical' : 'warning'}>
                      {r.source === 'complaint' ? t('email:folders.spam') : t('email:status.bounceShort')}
                    </StatePill>
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.unsubscribedAt)}</TableCell>
                  <TableCell className="text-right">
                    <RowActions actions={[{ key: 'remove', icon: Trash2, label: t('common:actions.remove'), disabled: remove.isPending, onClick: () => remove.mutate(r.email) }]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SuppressionSection>

        <SuppressionSection title={t('email:suppressions.bounced')} count={data.bounced.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:labels.recipient')}</TableHead>
                <TableHead className="text-right">{t('email:suppressions.howManyTimes')}</TableHead>
                <TableHead priority="md" className="text-right">{t('email:suppressions.lastBounce')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bounced.map((r) => (
                <TableRow key={r.recipient}>
                  <TableCell className="w-full max-w-0 text-sm">
                    <div className="truncate">{r.recipient}</div>
                    <TableDetails items={[formatDate(r.lastBouncedAt)]} />
                  </TableCell>
                  <TableCell className="text-right text-sm">{r.count}</TableCell>
                  <TableCell priority="md" className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatDate(r.lastBouncedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SuppressionSection>
      </CardContent>
    </Card>
  )
}

export function SettingsTab() {
  return (
    <div className="max-w-2xl space-y-4">
      <IdentitiesCard />
      <SignatureLogoCard />
      <ReadingCard />
      <OutreachCapCard />
      <SpamCard />
      <LabelsCard />
      <RulesCard />
      <BlocklistCard />
      <SuppressionsCard />
    </div>
  )
}
