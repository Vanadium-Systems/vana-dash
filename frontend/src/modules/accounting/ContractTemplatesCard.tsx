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
  { key: 'penalitateIntarziere', label: 'Penalitate întârziere' },
  { key: 'termenScadenta', label: 'Termen scadență' },
  { key: 'gratiePlata', label: 'Zile grație plată' },
  { key: 'preavizReziliere', label: 'Preaviz reziliere' },
  { key: 'termenConfirmareContinuare', label: 'Termen confirmare continuare' },
  { key: 'lunaGratuitaDurata', label: 'Lună gratuită — durată' },
  { key: 'referralReducere', label: 'Referral — reducere' },
  { key: 'referralDurata', label: 'Referral — durată' },
  { key: 'referralPlafon', label: 'Referral — plafon' },
  { key: 'slaUptime', label: 'SLA — uptime' },
  { key: 'slaMentenanta', label: 'SLA — fereastră mentenanță' },
  { key: 'slaP1', label: 'SLA — P1 răspuns' },
  { key: 'slaP2', label: 'SLA — P2 răspuns' },
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

  const current = templates.data?.find((t) => t.key === selectedKey) ?? null

  const select = (t: ContractTemplate) => {
    setSelectedKey(t.key)
    setBody(t.bodyHtml)
  }

  const save = useMutation({
    mutationFn: () => api.put<ContractTemplate>(`/api/contracts/templates/${selectedKey}`, { bodyHtml: body }),
    onSuccess: (row) => {
      queryClient.setQueryData<ContractTemplate[]>(['contract-templates'], (prev) => prev?.map((t) => (t.key === row.key ? row : t)))
      toast.success('Șablon salvat')
    },
    onError: (err) => toast.error(err.message),
  })

  const restore = useMutation({
    mutationFn: () => api.post<ContractTemplate>(`/api/contracts/templates/${selectedKey}/restore`, {}),
    onSuccess: (row) => {
      queryClient.setQueryData<ContractTemplate[]>(['contract-templates'], (prev) => prev?.map((t) => (t.key === row.key ? row : t)))
      setBody(row.bodyHtml)
      toast.success('Restaurat la versiunea originală')
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
        {(templates.data ?? []).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => select(t)}
            className={`rounded-md border px-3 py-1.5 text-sm ${selectedKey === t.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {!current ? (
        <p className="text-sm text-muted-foreground">Alege un șablon de editat. Textul e HTML sursă — PDF-ul se generează din el.</p>
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
              <Save className="h-4 w-4" /> Salvează
            </Button>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onClick={() => {
                void confirm({ title: 'Restaurează șablonul original', consequence: 'Textul tău e înlocuit cu șablonul de exemplu din aplicație și nu mai poate fi recuperat.', confirmLabel: 'Restaurează', destructive: true }).then((ok) => ok && restore.mutate())
              }}
            >
              <RotateCcw className="h-4 w-4" /> Restaurează originalul
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
      toast.success('Termeni comerciali salvați')
    },
    onError: (err) => toast.error(err.message),
  })

  if (terms.isPending) return null

  const current = terms.data ?? {}
  const value = draft ?? current

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CardTitle className="text-sm">Termeni comerciali (TERMS)</CardTitle>
        {draft ? <StatePill tone="warning">nemodificat încă pe disc</StatePill> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Valorile injectate în șabloane la tokenii <code className="font-mono">{`{{term.*}}`}</code>.
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
        <Save className="h-4 w-4" /> Salvează termenii
      </Button>
    </div>
  )
}

export function ContractTemplatesCard() {
  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <CardTitle className="text-base">Șabloane contracte</CardTitle>
        <TemplateEditor />
        <TermsEditor />
      </CardContent>
    </Card>
  )
}
