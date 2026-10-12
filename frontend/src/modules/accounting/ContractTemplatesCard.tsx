import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Save } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

interface PlaceholderDoc {
  token: string
  descriere: string
}

interface ContractTemplate {
  key: string
  name: string
  bodyHtml: string
  placeholders: PlaceholderDoc[] | null
  updatedAt: string
}

// Pilot — reducere/durată scoase (2026-09-21, Stefan: oferta de Perioadă Pilot nu mai e valabilă)
// — clauza Art. 15 PERIOADA PILOT + Secțiunea 4 Anexă scoase și ele din contract-template-bodies.ts.
const TERMS_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'penalitateIntarziere', label: t('accounting:terms.latePenalty') },
  { key: 'termenScadenta', label: t('accounting:terms.dueTerm') },
  { key: 'gratiePlata', label: t('accounting:terms.paymentGraceDays') },
  { key: 'preavizReziliere', label: t('accounting:terms.terminationNotice') },
  { key: 'termenConfirmareContinuare', label: t('accounting:terms.continuationConfirmTerm') },
  { key: 'lunaGratuitaDurata', label: t('accounting:terms.freeMonthLength') },
  { key: 'referralReducere', label: t('accounting:terms.referralDiscount') },
  { key: 'referralDurata', label: t('accounting:terms.referralLength') },
  { key: 'referralPlafon', label: t('accounting:terms.referralCap') },
  { key: 'slaUptime', label: t('accounting:terms.slaUptime') },
  { key: 'slaMentenanta', label: t('accounting:terms.slaMaintenanceWindow') },
  { key: 'slaP1', label: t('accounting:terms.slaP1Response') },
  { key: 'slaP2', label: t('accounting:terms.slaP2Response') },
]

function TemplateEditor() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [body, setBody] = useState('')

  const templates = useQuery({
    queryKey: ['contract-templates'],
    queryFn: () => api.get<ContractTemplate[]>('/api/contracts/templates'),
  })

  const current = templates.data?.find((template) => template.key === selectedKey) ?? null

  const select = (template: ContractTemplate) => {
    setSelectedKey(template.key)
    setBody(template.bodyHtml)
  }

  const save = useMutation({
    mutationFn: () => api.put<ContractTemplate>(`/api/contracts/templates/${selectedKey}`, { bodyHtml: body }),
    onSuccess: (row) => {
      queryClient.setQueryData<ContractTemplate[]>(['contract-templates'], (prev) => prev?.map((template) => (template.key === row.key ? row : template)))
      toast.success(t('accounting:templates.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const restore = useMutation({
    mutationFn: () => api.post<ContractTemplate>(`/api/contracts/templates/${selectedKey}/restore`, {}),
    onSuccess: (row) => {
      queryClient.setQueryData<ContractTemplate[]>(['contract-templates'], (prev) => prev?.map((template) => (template.key === row.key ? row : template)))
      setBody(row.bodyHtml)
      toast.success(t('accounting:templates.restored'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (templates.isPending) return <Skeleton className="h-40 w-full" />

  const insertToken = (token: string) => {
    const el = textareaRef.current
    if (!el) {
      setBody((prev) => `${prev}{{${token}}}`)
      return
    }
    const start = el.selectionStart ?? body.length
    const next = `${body.slice(0, start)}{{${token}}}${body.slice(el.selectionEnd ?? start)}`
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length + 4
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(templates.data ?? []).map((template) => (
          <button
            key={template.key}
            type="button"
            onClick={() => select(template)}
            className={`rounded-md border px-3 py-1.5 text-sm ${selectedKey === template.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            {template.name}
          </button>
        ))}
      </div>

      {!current ? (
        <p className="text-sm text-muted-foreground">{t('accounting:templates.pickHint')}</p>
      ) : (
        <>
          {current.placeholders?.length ? (
            <div className="flex flex-wrap gap-1">
              {current.placeholders.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  title={p.descriere}
                  onClick={() => insertToken(p.token)}
                  className="tnum rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {`{{${p.token}}}`}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={16}
            spellCheck={false}
            className="w-full rounded-md border bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={save.isPending || body === current.bodyHtml} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" /> {t('common:actions.save')}
            </Button>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onClick={() => {
                void confirm({ title: t('accounting:templates.restoreTitle'), consequence: t('accounting:templates.restoreBody'), confirmLabel: t('common:actions.restore'), destructive: true }).then((ok) => ok && restore.mutate())
              }}
            >
              <RotateCcw className="h-4 w-4" /> {t('accounting:templates.restoreOriginal')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function TermsEditor() {
  const queryClient = useQueryClient()
  const terms = useQuery({
    queryKey: ['contract-terms'],
    queryFn: () => api.get<Record<string, string>>('/api/contracts/terms'),
  })

  const [draft, setDraft] = useState<Record<string, string> | null>(null)

  // useMutation ÎNAINTE de early return-ul de mai jos — un hook chemat condiționat (după
  // return) schimbă numărul de hooks între randări (primul render, cu query pending, iese
  // înainte de linia asta; când datele sosesc, același component instance randează mai
  // departe și cheamă useMutation în plus) → React crash „Rendered more hooks than during
  // the previous render" (whitescreen la tabul Contracte, bug raportat de Stefan).
  const save = useMutation({
    mutationFn: () => api.put<Record<string, string>>('/api/contracts/terms', draft ?? terms.data ?? {}),
    onSuccess: (data) => {
      queryClient.setQueryData(['contract-terms'], data)
      setDraft(null)
      toast.success(t('accounting:terms.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (terms.isPending) return null

  const current = terms.data ?? {}
  const value = draft ?? current

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CardTitle className="text-sm">{t('accounting:terms.title')}</CardTitle>
        {draft ? <StatePill tone="warning">{t('accounting:terms.notYetOnDisk')}</StatePill> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {tNodes('accounting:terms.injectedAtToken', { token: <code className="font-mono">{`{{term.*}}`}</code> })}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TERMS_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <label htmlFor={`term-${key}`} className="text-xs text-muted-foreground">
              {label}
            </label>
            <Input
              id={`term-${key}`}
              value={value[key] ?? ''}
              onChange={(e) => setDraft({ ...(draft ?? current), [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <Button disabled={!draft || save.isPending} onClick={() => save.mutate()}>
        <Save className="h-4 w-4" /> {t('accounting:terms.save')}
      </Button>
    </div>
  )
}

export function ContractTemplatesCard() {
  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <CardTitle className="text-base">{t('accounting:templates.title')}</CardTitle>
        <TemplateEditor />
        <TermsEditor />
      </CardContent>
    </Card>
  )
}
