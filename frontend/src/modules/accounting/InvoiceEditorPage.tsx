import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Money } from '@/shared/components/Money'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { companyTimeZone, formatDate, formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { InvoiceTemplate, InvoicingClient, RecordDetail } from '@/shared/lib/types'
import { DueDateField } from './DueDateField'
import { EditorSkeleton, LoadFailed } from './InvoiceEditorStates'
import { InvoiceLines, type RateInfo } from './InvoiceLines'
import { ClientCombobox } from './ClientCombobox'
import { IssueConfirmDialog } from './IssueConfirmDialog'
import { NewClientDialog } from './NewClientDialog'
import {
  EMPTY_LINE,
  addDays,
  buildPayload,
  duePresetOf,
  emptyForm,
  evaluateLines,
  formFromDetail,
  missingOf,
  todayIn,
  totalsOf,
  type DocumentKind,
  type DraftRecord,
  type EditorForm,
  type LineDraft,
  type Missing,
  type Rates,
} from './invoice-editor-logic'
import { INVOICING_CLIENTS_KEY, recordDetailKey } from './records-api'
import { useDraftAutosave } from './use-draft-autosave'

const WIDE = '(min-width: 1280px)'
const fetchDetail = (id: string) => api.get<RecordDetail>(`/api/accounting/records/${id}/detail`)
const MISSING_KEYS: Record<Missing, 'accounting:editor.missing.client' | 'accounting:editor.missing.line' | 'accounting:editor.missing.rate'> = {
  client: 'accounting:editor.missing.client',
  line: 'accounting:editor.missing.line',
  rate: 'accounting:editor.missing.rate',
}

export function InvoiceEditorPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  // The route changes from /new to /:id/edit after the first save, but this page instance stays; only a fresh mount loads from the id.
  const bootId = useRef(id).current
  const detail = useQuery({ queryKey: recordDetailKey(bootId ?? ''), queryFn: () => fetchDetail(bootId ?? ''), enabled: Boolean(bootId), refetchOnMount: 'always' })
  const first = useRef<RecordDetail | null>(null)
  const [reloaded, setReloaded] = useState<RecordDetail | null>(null)
  const [generation, setGeneration] = useState(0)
  // The first answer that is not a stale cache hit: its updatedAt is what saves are checked against.
  if (!first.current && detail.data && !detail.isFetching) first.current = detail.data
  const snapshot = reloaded ?? first.current

  if (bootId && !snapshot) {
    if (detail.isError) {
      const missing = detail.error instanceof ApiError && detail.error.status === 404
      return <LoadFailed missing={missing} onRetry={() => void detail.refetch()} />
    }
    return <EditorSkeleton />
  }
  if (snapshot && (!snapshot.record.isDraft || snapshot.record.direction !== 'out')) return <Navigate to={`/accounting/records/${snapshot.record.id}`} replace />

  return (
    <Editor
      key={generation}
      detail={snapshot}
      onReload={async (draftId) => {
        const fresh = await queryClient.fetchQuery({ queryKey: recordDetailKey(draftId), queryFn: () => fetchDetail(draftId), staleTime: 0 })
        setReloaded(fresh)
        setGeneration((n) => n + 1)
      }}
    />
  )
}

function Editor({ detail, onReload }: { detail: RecordDetail | null; onReload: (draftId: string) => Promise<void> }) {
  const navigate = useNavigate()
  const location = useLocation()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { can } = useMe()
  const [search] = useSearchParams()
  const wide = useMediaQuery(WIDE)
  const [view, setView] = useState<'form' | 'preview'>('form')

  const [kind] = useState<DocumentKind>(() => (detail ? (detail.proforma ? 'proforma' : 'invoice') : search.get('kind') === 'proforma' ? 'proforma' : 'invoice'))
  // A storno draft keeps the lines it was checked against; only note and dates change.
  const locked = Boolean(detail?.storno.corrects)
  const [form, setForm] = useState<EditorForm>(() => (detail ? formFromDetail(detail) : emptyForm(BASE_CURRENCY, todayIn(companyTimeZone()))))
  const [dueChoice, setDueChoice] = useState(() => duePresetOf(form.issuedAt, form.dueAt))
  const [dueTouched, setDueTouched] = useState(Boolean(form.dueAt))
  const [templateId, setTemplateId] = useState('')
  const [resolvingTemplate, setResolvingTemplate] = useState(false)
  const [newClientName, setNewClientName] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const patch = (changes: Partial<EditorForm>) => setForm((f) => ({ ...f, ...changes }))

  // The picker list under the invoices prefix: a colleague who issues invoices has no access to the client file.
  const clients = useQuery({ queryKey: INVOICING_CLIENTS_KEY, queryFn: () => api.get<InvoicingClient[]>('/api/invoicing/invoices/clients') })
  const nextNumber = useQuery({ queryKey: ['invoicing', 'next-number', kind], queryFn: () => api.get<{ number: string; defaultPaymentTermsDays: number }>(`/api/invoicing/invoices/next-number?key=${kind}`) })

  // One query per currency, not per line: react-query shares the answer between lines.
  const needsRate = (cur: 'EUR' | 'USD') => form.currency !== cur && form.lines.some((l) => l.priceCurrency === cur)
  const rateQuery = (cur: 'EUR' | 'USD') => ({
    queryKey: ['invoicing', 'exchange-rate', cur, form.issuedAt],
    queryFn: () => api.get<{ date: string; rate: string }>(`/api/invoicing/exchange-rate?currency=${cur}&date=${form.issuedAt}`),
    enabled: Boolean(form.issuedAt) && needsRate(cur),
  })
  const eur = useQuery(rateQuery('EUR'))
  const usd = useQuery(rateQuery('USD'))
  const rates: Rates = { EUR: eur.data ? Number(eur.data.rate) : undefined, USD: usd.data ? Number(usd.data.rate) : undefined }
  const rateInfo: Record<'EUR' | 'USD', RateInfo> = {
    EUR: { pending: eur.isPending, failed: eur.isError, rate: eur.data?.rate, date: eur.data?.date },
    USD: { pending: usd.isPending, failed: usd.isError, rate: usd.data?.rate, date: usd.data?.date },
  }

  const states = useMemo(() => evaluateLines(form.lines, form.currency, rates), [form.lines, form.currency, rates.EUR, rates.USD])
  const totals = totalsOf(states)
  const missing = missingOf(form, states, locked)
  const payload = missing.length === 0 ? buildPayload(form, states, locked) : null
  const key = payload ? JSON.stringify(payload) : null
  const missingText = missing.map((m) => t(MISSING_KEYS[m])).join(', ')

  const record = detail?.record as DraftRecord | undefined
  const save = useDraftAutosave({ kind, initial: record ? { id: record.id, updatedAt: record.updatedAt } : null, key, payload })
  const dirty = key !== save.savedKey
  const unsaved = dirty || save.saving || save.status === 'error' || save.status === 'conflict'
  const canIssue = Boolean(save.draftId) && missing.length === 0 && !unsaved

  useEffect(() => {
    if (!unsaved) return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [unsaved])

  // The preview is the real PDF markup; it follows the form 800ms after the last change and only while the form is valid.
  const previewKey = useDebounced(key, 800)
  const previewBase = kind === 'proforma' ? '/api/invoicing/proformas' : '/api/invoicing/invoices'
  const livePreview = useQuery({
    queryKey: ['invoicing', 'editor-preview', kind, previewKey],
    queryFn: () => api.post<{ html: string }>(`${previewBase}/preview`, JSON.parse(previewKey ?? '{}')),
    enabled: Boolean(previewKey) && !locked,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  })
  // A storno has no body to preview; the stored document is the only one, read again after each save.
  const storedPreview = useQuery({
    queryKey: ['invoicing', 'editor-preview', 'stored', save.draftId, save.savedKey],
    queryFn: () => api.get<{ html: string }>(`/api/invoicing/invoices/${save.draftId}/preview`),
    enabled: locked && Boolean(save.draftId),
    placeholderData: keepPreviousData,
    retry: false,
  })
  const previewQuery = locked ? storedPreview : livePreview
  const html = previewQuery.data?.html

  const clientList = clients.data ?? []
  const selectedClient = clientList.find((c) => c.id === form.billingClientId)
  const canClients = can('facturi.clienti')

  const templates = useQuery({
    queryKey: ['invoicing', 'clients', form.billingClientId, 'templates'],
    queryFn: () => api.get<InvoiceTemplate[]>(`/api/invoicing/invoices/clients/${form.billingClientId}/templates`),
    enabled: kind === 'invoice' && !save.draftId && !locked && Boolean(form.billingClientId),
  })

  function applyPreset(days: number, touched: boolean) {
    setDueChoice(days)
    if (touched) setDueTouched(true)
    setForm((f) => ({ ...f, dueAt: addDays(f.issuedAt, days) }))
  }

  function pickClient(client: InvoicingClient) {
    patch({ billingClientId: client.id })
    setTemplateId('')
    const days = client.paymentTermsDays ?? nextNumber.data?.defaultPaymentTermsDays
    if (!dueTouched && days) applyPreset(days, false)
  }

  // Template lines without a fixed price (client subscription) get their current price from the server.
  async function applyTemplate(templateKey: string) {
    setTemplateId(templateKey)
    const template = templates.data?.find((tpl) => tpl.id === templateKey)
    if (!template) return
    patch({ currency: template.currency })
    setResolvingTemplate(true)
    try {
      const resolved = await api.get<{ lines: { description: string; quantity: number; unitPrice: number; vatRate: number }[] }>(
        `/api/invoicing/invoices/clients/${form.billingClientId}/templates/${templateKey}/resolve`,
      )
      patch({
        lines: resolved.lines.map((li) => ({ description: li.description, quantity: String(li.quantity), price: String(li.unitPrice), priceCurrency: '', vatRate: String(li.vatRate) })),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounting:editor.template.failed'))
    } finally {
      setResolvingTemplate(false)
    }
  }

  const setLine = (index: number, field: keyof LineDraft, value: string) => setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)) }))

  async function back() {
    if (unsaved) {
      const leave = await confirm({ title: t('accounting:editor.leave.title'), consequence: t('accounting:editor.leave.body'), confirmLabel: t('accounting:editor.leave.confirm'), destructive: true })
      if (!leave) return
    }
    if (location.key !== 'default') navigate(-1)
    else navigate(save.draftId ? `/accounting/records/${save.draftId}` : '/accounting?tab=emise')
  }

  const title = t(
    kind === 'proforma'
      ? save.draftId ? 'accounting:editor.titleEditProforma' : 'accounting:editor.titleNewProforma'
      : save.draftId ? 'accounting:editor.titleEditInvoice' : 'accounting:editor.titleNewInvoice',
  )
  const statusText = save.saving
    ? t('common:states.saving')
    : save.status === 'error'
      ? t('accounting:editor.status.error')
      : dirty && missing.length > 0
        ? t('accounting:editor.status.unsaved', { what: missingText })
        : dirty
          ? t('common:states.saving')
          : save.draftId
            ? t('accounting:editor.status.saved', { time: formatDate(save.savedAt ?? record?.updatedAt ?? new Date(), { timeStyle: 'short' }) })
            : t('accounting:editor.status.unsaved', { what: missingText })

  const formPanel = (
    <div className={wide || view === 'form' ? 'min-w-0 space-y-6' : 'hidden'}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field
          label={t('common:labels.client')}
          error={clients.isError ? t('accounting:editor.client.loadFailed') : null}
        >
          <ClientCombobox
            clients={clientList}
            value={form.billingClientId}
            disabled={locked}
            onChange={pickClient}
            onCreate={canClients && !locked ? (name) => setNewClientName(name) : undefined}
          />
        </Field>
        <Field label={t('common:labels.currency')}>
          <Select value={form.currency} disabled={locked} onChange={(e) => patch({ currency: e.target.value })}>
            <option value="RON">RON</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
      </div>

      {(templates.data?.length ?? 0) > 0 ? (
        <Field label={t('accounting:editor.template.label')} optional hint={resolvingTemplate ? t('accounting:editor.template.resolving') : t('accounting:editor.template.hint')}>
          <Select value={templateId} disabled={resolvingTemplate} onChange={(e) => void applyTemplate(e.target.value)}>
            <option value="">{t('accounting:editor.template.none')}</option>
            {templates.data!.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} {tpl.isDefaultForAutoInvoice ? t('accounting:editor.template.defaultMarker') : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('accounting:labels.issueDate')}>
          <Input
            type="date"
            value={form.issuedAt}
            onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value, dueAt: typeof dueChoice === 'number' && e.target.value ? addDays(e.target.value, dueChoice) : f.dueAt }))}
          />
        </Field>
        <DueDateField
          issuedAt={form.issuedAt}
          dueAt={form.dueAt}
          choice={dueChoice}
          onPreset={(days) => applyPreset(days, true)}
          onCustom={() => {
            setDueChoice('custom')
            setDueTouched(true)
          }}
          onDate={(day) => patch({ dueAt: day })}
        />
      </div>

      <InvoiceLines
        lines={form.lines}
        states={states}
        currency={form.currency}
        locked={locked}
        rates={rateInfo}
        onChange={setLine}
        onAdd={() => patch({ lines: [...form.lines, { ...EMPTY_LINE }] })}
        onRemove={(index) => patch({ lines: form.lines.filter((_, i) => i !== index) })}
      />

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('accounting:editor.totals.net')}</dt>
        <dd className="text-right tnum">{formatMoney(totals.netCents / 100, form.currency)}</dd>
        <dt className="text-muted-foreground">{t('accounting:editor.totals.vat')}</dt>
        <dd className="text-right tnum">{formatMoney(totals.vatCents / 100, form.currency)}</dd>
        <dt className="pt-1 font-medium">{t('accounting:editor.totals.total')}</dt>
        <dd className="pt-1 text-right text-xl font-semibold" data-testid="editor-total">
          <Money amount={totals.grossCents / 100} currency={form.currency} />
        </dd>
      </dl>

      <Field label={t('accounting:editor.note')} optional>
        <Input value={form.note} onChange={(e) => patch({ note: e.target.value })} />
      </Field>
    </div>
  )

  const previewPanel = (
    <div className={wide || view === 'preview' ? 'min-w-0 space-y-2 xl:sticky xl:top-4 xl:self-start' : 'hidden'}>
      {html ? (
        <iframe
          title={t('accounting:editor.preview.title')}
          // No scripts and no same-origin: the markup is rendered, never run.
          sandbox=""
          srcDoc={html}
          className="h-[70dvh] min-h-[28rem] w-full rounded-md border bg-white xl:h-[calc(100dvh-9rem)]"
        />
      ) : (
        <div className="flex h-[28rem] items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {missing.length > 0 ? t('accounting:editor.preview.missing', { what: missingText }) : t('common:states.loading')}
        </div>
      )}
      {previewQuery.isError ? <p className="text-xs text-muted-foreground">{t('accounting:editor.preview.failed')}</p> : null}
    </div>
  )

  return (
    <div className="mx-auto max-w-[96rem] space-y-6" data-testid="invoice-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void back()}>
          <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
        </Button>
        <Button disabled={!canIssue} onClick={() => setIssuing(true)} data-testid="editor-issue">
          <FileCheck aria-hidden="true" /> {t('accounting:editor.issue')}
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground" role="status" data-testid="editor-status">
          {statusText}
        </p>
      </div>

      {save.status === 'conflict' ? (
        <Alert
          tone="critical"
          title={t('accounting:editor.conflict.title')}
          action={
            <Button variant="outline" size="sm" onClick={() => save.draftId && void onReload(save.draftId)}>
              {t('accounting:editor.conflict.reload')}
            </Button>
          }
        >
          {t('accounting:editor.conflict.body')}
        </Alert>
      ) : save.status === 'error' ? (
        <Alert tone="critical" title={t('accounting:editor.saveError.title')}>
          {t('accounting:editor.saveError.body', { message: save.errorMessage })}
        </Alert>
      ) : null}

      {!wide ? (
        <Tabs value={view} onValueChange={(v) => setView(v as 'form' | 'preview')}>
          <TabsList variant="segmented">
            <TabsTrigger value="form">{t('accounting:editor.tabs.form')}</TabsTrigger>
            <TabsTrigger value="preview">{t('accounting:editor.tabs.preview')}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      <div className="grid items-start gap-8 xl:grid-cols-2">
        {formPanel}
        {previewPanel}
      </div>

      <NewClientDialog
        open={newClientName !== null}
        onOpenChange={(open) => !open && setNewClientName(null)}
        initialName={newClientName ?? ''}
        onCreated={(client) => {
          pickClient(client)
          setNewClientName(null)
          void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
        }}
      />
      {save.draftId ? (
        <IssueConfirmDialog
          open={issuing}
          onOpenChange={setIssuing}
          kind={kind}
          recordId={save.draftId}
          clientName={selectedClient?.name ?? ''}
          totalCents={totals.grossCents}
          currency={form.currency}
          canAnaf={can('facturi.anaf')}
        />
      ) : null}
    </div>
  )
}
