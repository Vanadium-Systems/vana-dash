import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Plus, Save, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMe } from '@/shared/hooks/use-me'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { toastError } from '@/shared/lib/errors'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

type FieldType = 'text' | 'number' | 'date' | 'money' | 'list' | 'party'
const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'money', 'list', 'party']
// The same ones the server knows (template-render.ts BUILTIN_TOKENS).
const BUILTIN_TOKENS = [
  'contract.numar',
  'contract.data',
  'parte.nume',
  'parte.cui',
  'parte.nrRegCom',
  'parte.adresa',
  'parte.reprezentant',
  'parte.functie',
  'parte.email',
  'firma.nume',
  'firma.cui',
  'firma.nrRegCom',
  'firma.adresa',
  'firma.reprezentant',
  'firma.email',
  'firma.telefon',
] as const

interface TemplateField {
  key: string
  label: { ro: string; en: string }
  type: FieldType
  required: boolean
  options?: string[]
}
interface SignerRole {
  role: string
  own: boolean
}
interface CompanyTemplate {
  id: string
  name: string
  category: string | null
  bodyHtml: string
  fields: TemplateField[]
  seriesId: string | null
  signerRoles: SignerRole[]
}
interface Series {
  id: string
  code: string
  name: string
  numberFormat: string
}

interface Draft {
  id: string | null
  name: string
  category: string
  bodyHtml: string
  fields: TemplateField[]
  seriesId: string | null
  signerRoles: SignerRole[]
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  category: '',
  bodyHtml: '',
  fields: [],
  seriesId: null,
  signerRoles: [
    { role: 'Beneficiar', own: true },
    { role: 'Colaborator', own: false },
  ],
}

const toDraft = (template: CompanyTemplate): Draft => ({
  id: template.id,
  name: template.name,
  category: template.category ?? '',
  bodyHtml: template.bodyHtml,
  fields: template.fields,
  seriesId: template.seriesId,
  signerRoles: template.signerRoles,
})

function TemplateForm({ draft, series, onDone }: { draft: Draft; series: Series[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState<Draft>(draft)
  const [nameError, setNameError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(key: K, next: Draft[K]) => setValue((prev) => ({ ...prev, [key]: next }))
  const dirty = JSON.stringify(value) !== JSON.stringify(draft)

  const payload = () => ({
    name: value.name.trim(),
    category: value.category.trim(),
    bodyHtml: value.bodyHtml,
    fields: value.fields.map((f) => ({ ...f, options: f.type === 'list' ? (f.options ?? []).filter(Boolean) : undefined })),
    seriesId: value.seriesId,
    signerRoles: value.signerRoles.filter((r) => r.role.trim()),
  })

  const save = useMutation({
    mutationFn: () =>
      value.id
        ? api.put<CompanyTemplate>(`/api/contracts/templates/custom/${value.id}`, payload())
        : api.post<CompanyTemplate>('/api/contracts/templates', payload()),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['contract-templates'] })
      setValue(toDraft(row))
      toast(t('accounting:companyTemplates.saved'))
    },
    onError: (err) => toastError(err),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/contracts/templates/custom/${value.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['contract-templates'] })
      onDone()
    },
    onError: (err) => toastError(err),
  })

  const preview = useMutation({
    mutationFn: () => api.download(`/api/contracts/templates/custom/${value.id}/preview`, `${value.name || 'sablon'}.pdf`),
    onError: (err) => toastError(err),
  })

  const submit = () => {
    if (!value.name.trim() || !value.category.trim()) {
      setNameError(t('accounting:companyTemplates.nameRequired'))
      return
    }
    setNameError(null)
    save.mutate()
  }

  const insert = (snippet: string) => {
    const el = bodyRef.current
    const start = el?.selectionStart ?? value.bodyHtml.length
    const end = el?.selectionEnd ?? start
    set('bodyHtml', `${value.bodyHtml.slice(0, start)}${snippet}${value.bodyHtml.slice(end)}`)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = start + snippet.length
    })
  }

  const updateField = (index: number, patch: Partial<TemplateField>) =>
    set('fields', value.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))

  const otherRoles = value.signerRoles.filter((r) => !r.own && r.role.trim())

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('accounting:companyTemplates.name')} error={nameError}>
          <Input value={value.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('accounting:companyTemplates.category')} hint={t('accounting:companyTemplates.categoryHint')}>
          <Input value={value.category} onChange={(e) => set('category', e.target.value)} />
        </Field>
        <Field label={t('accounting:companyTemplates.series')} optional>
          <Select value={value.seriesId ?? ''} onValueChange={(v) => set('seriesId', v || null)}>
            <option value="">{t('accounting:companyTemplates.defaultSeries')}</option>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('accounting:companyTemplates.signers')}</h3>
        <p className="text-xs text-muted-foreground">{t('accounting:companyTemplates.signersHint')}</p>
        {value.signerRoles.map((role, index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <Input
              aria-label={t('accounting:companyTemplates.roleName')}
              className="w-48"
              value={role.role}
              onChange={(e) => set('signerRoles', value.signerRoles.map((r, i) => (i === index ? { ...r, role: e.target.value } : r)))}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={role.own}
                onChange={(e) => set('signerRoles', value.signerRoles.map((r, i) => (i === index ? { ...r, own: e.target.checked } : r)))}
              />
              {t('accounting:companyTemplates.ownRole')}
            </label>
            <Button variant="ghost" size="sm" onClick={() => set('signerRoles', value.signerRoles.filter((_, i) => i !== index))}>
              {t('common:actions.remove')}
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set('signerRoles', [...value.signerRoles, { role: '', own: false }])}>
          <Plus className="h-4 w-4" /> {t('accounting:companyTemplates.addRole')}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('accounting:companyTemplates.fields')}</h3>
        <p className="text-xs text-muted-foreground">{t('accounting:companyTemplates.fieldsHint')}</p>
        {value.fields.map((field, index) => (
          <div key={index} className="grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
            <Field label={t('accounting:companyTemplates.fieldKey')}>
              <Input className="font-mono" value={field.key} onChange={(e) => updateField(index, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} />
            </Field>
            <Field label={t('accounting:companyTemplates.fieldType')}>
              <Select value={field.type} onValueChange={(v) => updateField(index, { type: v as FieldType })}>
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`accounting:companyTemplates.types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('accounting:companyTemplates.labelRo')}>
              <Input value={field.label.ro} onChange={(e) => updateField(index, { label: { ...field.label, ro: e.target.value } })} />
            </Field>
            <Field label={t('accounting:companyTemplates.labelEn')}>
              <Input value={field.label.en} onChange={(e) => updateField(index, { label: { ...field.label, en: e.target.value } })} />
            </Field>
            {field.type === 'list' ? (
              <Field label={t('accounting:companyTemplates.options')} hint={t('accounting:companyTemplates.optionsHint')} className="sm:col-span-2">
                <Input value={(field.options ?? []).join('; ')} onChange={(e) => updateField(index, { options: e.target.value.split(';').map((o) => o.trim()) })} />
              </Field>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                {t('accounting:companyTemplates.required')}
              </label>
              <Button variant="outline" size="sm" disabled={!field.key} onClick={() => insert(`{{${field.key}}}`)}>
                {t('accounting:companyTemplates.insertField')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => set('fields', value.fields.filter((_, i) => i !== index))}>
                {t('common:actions.remove')}
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => set('fields', [...value.fields, { key: '', label: { ro: '', en: '' }, type: 'text', required: true }])}
        >
          <Plus className="h-4 w-4" /> {t('accounting:companyTemplates.addField')}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('accounting:companyTemplates.body')}</h3>
        <div className="flex flex-wrap gap-2">
          {BUILTIN_TOKENS.map((token) => (
            <Button key={token} variant="outline" size="sm" className="font-mono" onClick={() => insert(`{{${token}}}`)}>
              {`{{${token}}}`}
            </Button>
          ))}
          {otherRoles.map((role) => (
            <Button
              key={role.role}
              variant="outline"
              size="sm"
              onClick={() => insert(`<div class="signature-line" data-sign-role="${role.role.trim()}">${t('accounting:companyTemplates.signatureLineText')}</div>`)}
            >
              {t('accounting:companyTemplates.insertSignature', { role: role.role.trim() })}
            </Button>
          ))}
        </div>
        <textarea
          ref={bodyRef}
          aria-label={t('accounting:companyTemplates.body')}
          value={value.bodyHtml}
          onChange={(e) => set('bodyHtml', e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={save.isPending || !dirty} onClick={submit}>
          <Save className="h-4 w-4" /> {t('common:actions.save')}
        </Button>
        <Button variant="outline" disabled={!value.id || dirty || preview.isPending} onClick={() => preview.mutate()}>
          <Download className="h-4 w-4" /> {t('accounting:companyTemplates.preview')}
        </Button>
        {value.id ? (
          <Button
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => {
              void confirm({
                title: t('accounting:companyTemplates.deleteTitle', { name: value.name }),
                consequence: t('accounting:companyTemplates.deleteBody'),
                confirmLabel: t('accounting:companyTemplates.deleteConfirm'),
                destructive: true,
              }).then((ok) => ok && remove.mutate())
            }}
          >
            <Trash2 className="h-4 w-4" /> {t('accounting:companyTemplates.delete')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDone}>
          {t('common:actions.close')}
        </Button>
      </div>
    </div>
  )
}

const seriesSample = (s: Series) => s.numberFormat.replace('{code}', s.code)

function SeriesEditor({ series }: { series: Series[] }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Series | { id: null; code: string; name: string; numberFormat: string } | null>(null)
  const save = useMutation({
    mutationFn: (s: { id: string | null; code: string; name: string; numberFormat: string }) => {
      const body = { code: s.code.trim(), name: s.name.trim(), numberFormat: s.numberFormat.trim() }
      return s.id ? api.put(`/api/contracts/series/${s.id}`, body) : api.post('/api/contracts/series', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      setEditing(null)
    },
    onError: (err) => toastError(err),
  })

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t('accounting:companyTemplates.seriesTitle')}</h3>
      <p className="text-xs text-muted-foreground">{t('accounting:companyTemplates.seriesHint')}</p>
      <ul className="space-y-1 text-sm">
        {series.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3">
            <span>{s.name}</span>
            <code className="font-mono text-xs text-muted-foreground">{seriesSample(s)}</code>
            <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
              {t('common:actions.edit')}
            </Button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label={t('accounting:companyTemplates.seriesCode')}>
            <Input className="font-mono" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
          </Field>
          <Field label={t('accounting:companyTemplates.seriesName')}>
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label={t('accounting:companyTemplates.seriesFormat')} hint={t('accounting:companyTemplates.seriesFormatHint')}>
            <Input className="font-mono" value={editing.numberFormat} onChange={(e) => setEditing({ ...editing, numberFormat: e.target.value })} />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <Button disabled={save.isPending} onClick={() => save.mutate(editing)}>
              {t('common:actions.save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common:actions.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setEditing({ id: null, code: '', name: '', numberFormat: '{code}-{n:3}' })}>
          <Plus className="h-4 w-4" /> {t('accounting:companyTemplates.addSeries')}
        </Button>
      )}
    </section>
  )
}

function NoticeSettings() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['contracts', 'settings'], queryFn: () => api.get<{ leadDays: number }>('/api/contracts/settings') })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (leadDays: number) => api.put('/api/contracts/settings', { leadDays }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts', 'settings'] })
      setDraft(null)
    },
    onError: (err) => toastError(err),
  })
  if (settings.isPending) return null
  const value = draft ?? String(settings.data?.leadDays ?? 14)
  return (
    <section className="flex flex-wrap items-end gap-3">
      <Field label={t('accounting:companyTemplates.leadDays')} hint={t('accounting:companyTemplates.leadDaysHint')} error={error}>
        <Input className="w-24" inputMode="numeric" value={value} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <Button
        disabled={draft === null || save.isPending}
        onClick={() => {
          const leadDays = Number(value)
          if (!Number.isInteger(leadDays) || leadDays < 1 || leadDays > 90) {
            setError(t('accounting:companyTemplates.leadDaysInvalid'))
            return
          }
          setError(null)
          save.mutate(leadDays)
        }}
      >
        {t('common:actions.save')}
      </Button>
    </section>
  )
}

interface SigningSettings {
  hasCertificate: boolean
  fingerprint: string | null
  createdAt: string | null
  downloadDays: number
}

const FINGERPRINT_SHOWN = 16

function SigningCertificate() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const settings = useQuery({ queryKey: ['contracts', 'signing'], queryFn: () => api.get<SigningSettings>('/api/contracts/signing') })
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = useMutation({
    mutationFn: () => api.post<SigningSettings>('/api/contracts/signing/certificate', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:signingCertificate.generated'))
    },
    onError: (err) => toastError(err),
  })
  const saveDays = useMutation({
    mutationFn: (downloadDays: number) => api.put<SigningSettings>('/api/contracts/signing', { downloadDays }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      setDraft(null)
      toast.success(t('accounting:signingCertificate.saved'))
    },
    onError: (err) => toastError(err),
  })

  if (settings.isPending) return <Skeleton className="h-24 w-full" />
  if (!settings.data) return null
  const { hasCertificate, fingerprint, createdAt, downloadDays } = settings.data
  const days = draft ?? String(downloadDays)

  const regenerate = async () => {
    const ok = await confirm({
      title: t('accounting:signingCertificate.regenerateTitle'),
      consequence: t('accounting:signingCertificate.regenerateBody'),
      confirmLabel: t('accounting:signingCertificate.regenerate'),
    })
    if (ok) generate.mutate()
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t('accounting:signingCertificate.title')}</h3>
      {hasCertificate ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-muted-foreground">{t('accounting:signingCertificate.fingerprint')}</span>
          <code className="font-mono text-xs">{fingerprint ? `${fingerprint.slice(0, FINGERPRINT_SHOWN)}…` : '—'}</code>
          {fingerprint ? (
            <Button
              variant="outline"
              size="icon"
              title={t('common:actions.copy')}
              aria-label={t('common:actions.copy')}
              onClick={() =>
                void navigator.clipboard?.writeText(fingerprint).then(
                  () => toast.success(t('common:states.copied')),
                  () => toast.error(t('messages:actions.copyFailed')),
                )
              }
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          {createdAt ? <span className="text-xs text-muted-foreground">{t('accounting:signingCertificate.createdAt', { date: formatDate(createdAt) })}</span> : null}
          <Button variant="outline" size="sm" disabled={generate.isPending} onClick={() => void regenerate()}>
            {t('accounting:signingCertificate.regenerate')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('accounting:signingCertificate.intro')}</p>
          <Button variant="outline" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {t('accounting:signingCertificate.generate')}
          </Button>
        </>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('accounting:signingCertificate.downloadDays')} error={error}>
          <Input className="w-24" inputMode="numeric" value={days} onChange={(e) => setDraft(e.target.value)} />
        </Field>
        <Button
          disabled={draft === null || saveDays.isPending}
          onClick={() => {
            const next = Number(days)
            if (!Number.isInteger(next) || next < 1 || next > 365) {
              setError(t('accounting:signingCertificate.downloadDaysInvalid'))
              return
            }
            setError(null)
            saveDays.mutate(next)
          }}
        >
          {t('common:actions.save')}
        </Button>
      </div>
    </section>
  )
}

/** The company's own templates (NDA, collaboration...), the number series and the notice alert. */
export function CompanyTemplatesCard({ canEdit }: { canEdit: boolean }) {
  const { can } = useMe()
  const [editing, setEditing] = useState<Draft | null>(null)
  const templates = useQuery({ queryKey: ['contract-templates'], queryFn: () => api.get<CompanyTemplate[]>('/api/contracts/templates') })
  const series = useQuery({ queryKey: ['contracts', 'series'], queryFn: () => api.get<Series[]>('/api/contracts/series') })

  if (templates.isPending || series.isPending) return <Skeleton className="h-40 w-full" />
  const rows = templates.data ?? []

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <CardTitle className="text-base">{t('accounting:companyTemplates.title')}</CardTitle>
        {editing ? (
          <TemplateForm key={editing.id ?? 'new'} draft={editing} series={series.data ?? []} onDone={() => setEditing(null)} />
        ) : (
          <>
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('accounting:companyTemplates.empty')}</p> : null}
            <ul className="space-y-1">
              {rows.map((template) => (
                <li key={template.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span>{template.name}</span>
                  <span className="text-muted-foreground">{template.category}</span>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(toDraft(template))}>
                      {t('common:actions.edit')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditing(EMPTY_DRAFT)}>
                <Plus className="h-4 w-4" /> {t('accounting:companyTemplates.add')}
              </Button>
            ) : null}
          </>
        )}
        {canEdit && !editing ? <SeriesEditor series={series.data ?? []} /> : null}
        {canEdit && !editing ? <NoticeSettings /> : null}
        {can('facturi.semnare-contracte') && !editing ? <SigningCertificate /> : null}
      </CardContent>
    </Card>
  )
}
