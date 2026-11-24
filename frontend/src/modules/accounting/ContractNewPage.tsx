import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { errorCode, errorDetail, toastError } from '@/shared/lib/errors'
import { formatDate } from '@/shared/lib/format'
import { getLocale, t } from '@/shared/lib/i18n'
import { parseRoDecimal } from '@/shared/lib/utils'
import { ContractPartyField } from './ContractPartyField'
import { ContractOwnerField, ContractTermsFields } from './ContractTermsFields'
import { counterpartyBody, useContractNumbers, useCustomTemplates, type Counterparty, type CustomTemplate, type TemplateField } from './contracts-api'
import { EMPTY_TERMS, termsBody, validateTerms, type TermsErrors, type TermsForm } from './contracts-logic'

const BACK_PATH = '/clients?tab=contracte'

const fieldLabel = (field: TemplateField) => field.label[getLocale()] || field.label.ro

function FieldInput({ field, value, error, onChange }: { field: TemplateField; value: string; error: string | null; onChange: (value: string) => void }) {
  const id = `contract-field-${field.key}`
  return (
    <Field label={fieldLabel(field)} optional={!field.required} error={error}>
      {field.type === 'list' ? (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" />
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : field.type === 'date' ? (
        <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} inputMode={field.type === 'number' || field.type === 'money' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

export function ContractNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const templates = useCustomTemplates()
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [party, setParty] = useState<Counterparty | null>(null)
  const [pickedNumber, setPickedNumber] = useState<number | null>(null)
  const [choosingNumber, setChoosingNumber] = useState(false)
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS)
  const [ownerUserId, setOwnerUserId] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [partyError, setPartyError] = useState<string | null>(null)
  const [numberError, setNumberError] = useState<string | null>(null)
  const [termsErrors, setTermsErrors] = useState<TermsErrors>({})

  const template: CustomTemplate | undefined = templates.data?.find((entry) => entry.id === templateId) ?? (templates.data?.length === 1 ? templates.data[0] : undefined)
  const numbers = useContractNumbers(template?.seriesId ?? null, Boolean(template))

  useEffect(() => {
    if (!template) return
    setValues(Object.fromEntries(template.fields.map((field) => [field.key, field.default ?? ''])))
    setFieldErrors({})
    setPickedNumber(null)
    setChoosingNumber(false)
    setNumberError(null)
  }, [template?.id])

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string; number: string | null; documentId: string }>('/api/contracts/registry', body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      navigate(`/clients/contracte/${created.id}`)
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'CONTRACT_NUMBER_TAKEN') {
        setNumberError(t('accounting:contracts.numbers.taken'))
      } else if (code === 'CONTRACT_DATA_INCOMPLETE' && template) {
        const missing = errorDetail<string[]>(err, 'fields') ?? []
        const next: Record<string, string> = {}
        for (const field of template.fields) {
          if (missing.includes(field.label.ro) || missing.includes(field.label.en)) next[field.key] = t('accounting:contracts.newPage.fieldRequired')
        }
        setFieldErrors(next)
        if (Object.keys(next).length === 0) toastError(err)
      } else toastError(err)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!template) return
    const errors: Record<string, string> = {}
    const fieldValues: Record<string, string | number | null> = {}
    for (const field of template.fields) {
      const raw = (values[field.key] ?? '').trim()
      if (!raw) {
        if (field.required) errors[field.key] = t('accounting:contracts.newPage.fieldRequired')
        fieldValues[field.key] = null
      } else if (field.type === 'number' || field.type === 'money') {
        const parsed = parseRoDecimal(raw)
        if (Number.isNaN(parsed)) errors[field.key] = t('accounting:contracts.newPage.notANumber')
        fieldValues[field.key] = Number.isNaN(parsed) ? null : parsed
      } else fieldValues[field.key] = raw
    }
    const nextTerms = validateTerms(terms)
    const noParty = !party || (party.kind === 'other' && !party.name.trim())
    setFieldErrors(errors)
    setPartyError(noParty ? t('accounting:contracts.party.required') : null)
    setNumberError(null)
    setTermsErrors(nextTerms)
    if (Object.keys(errors).length > 0 || noParty || Object.keys(nextTerms).length > 0) return
    const seriesId = pickedNumber !== null ? numbers.data?.series?.id : (template.seriesId ?? undefined)
    create.mutate({
      templateId: template.id,
      ...(title.trim() ? { title: title.trim() } : {}),
      fieldValues,
      counterparty: counterpartyBody(party!),
      ...(seriesId ? { seriesId } : {}),
      ...(pickedNumber !== null ? { number: pickedNumber } : {}),
      ...termsBody(terms),
      ...(ownerUserId ? { ownerUserId } : {}),
    })
  }

  const proposed = pickedNumber !== null ? numbers.data?.items.find((item) => item.number === pickedNumber)?.label : numbers.data?.nextLabel
  const choices = (numbers.data?.items ?? []).filter((item) => item.kind !== 'used')

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" asChild>
        <Link to={BACK_PATH}>
          <ArrowLeft aria-hidden="true" /> {t('accounting:contracts.page.back')}
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-title">{t('accounting:contracts.newPage.title')}</h1>

      {templates.isPending ? (
        <ListSkeleton rows={5} />
      ) : templates.isError ? (
        <Alert
          tone="critical"
          title={t('accounting:contracts.newPage.loadFailed')}
          action={
            <Button variant="outline" onClick={() => void templates.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {errorCode(templates.error) ? t('common:errors.codeLine', { code: errorCode(templates.error) }) : null}
        </Alert>
      ) : templates.data.length === 0 ? (
        <EmptyState kind="new" title={t('accounting:contracts.newPage.noTemplates')} description={t('accounting:contracts.newPage.noTemplatesHint')} />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          <Field label={t('accounting:contracts.newPage.template')}>
            <Select id="contract-template" value={template?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
              {template ? null : <option value="">{t('accounting:contracts.newPage.pickTemplate')}</option>}
              {templates.data.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>

          {template ? (
            <>
              <Field label={t('common:labels.title')} optional hint={t('accounting:contracts.newPage.titleHint')} className="sm:max-w-md">
                <Input id="contract-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <ContractPartyField id="contract-party" value={party} onChange={setParty} error={partyError} />

              {template.fields.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {template.fields.map((field) => (
                    <FieldInput key={field.key} field={field} value={values[field.key] ?? ''} error={fieldErrors[field.key] ?? null} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-sm font-medium">{t('common:labels.number')}</p>
                {numbers.isPending ? (
                  <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
                ) : (
                  <p className="text-sm">
                    {proposed ? t('accounting:contracts.newPage.proposed', { label: proposed }) : t('accounting:contracts.newPage.noSeries')}
                    {choices.length > 0 ? (
                      <Button type="button" variant="ghost" onClick={() => setChoosingNumber((open) => !open)}>
                        {t('accounting:contracts.newPage.pickOther')}
                      </Button>
                    ) : null}
                  </p>
                )}
                {choosingNumber ? (
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                    {choices.map((item) => (
                      <li key={item.number}>
                        <button
                          type="button"
                          aria-pressed={pickedNumber === item.number}
                          className="flex min-h-control-md w-full items-center gap-3 px-3 text-left text-sm hover:bg-accent aria-pressed:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => {
                            setPickedNumber(item.number)
                            setChoosingNumber(false)
                            setNumberError(null)
                          }}
                        >
                          <span className="tabular-nums">{item.label}</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {item.kind === 'reserved' ? t('accounting:contracts.newPage.reservedFor', { note: item.note ?? '' }) : t('accounting:contracts.numbers.free')}
                            {item.kind === 'reserved' && item.date ? ` · ${formatDate(item.date)}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {numberError ? <p className="text-xs text-destructive-text">{numberError}</p> : null}
              </div>

              <ContractTermsFields idPrefix="new" value={terms} errors={termsErrors} onChange={setTerms} />
              <ContractOwnerField id="new-owner" value={ownerUserId} onChange={setOwnerUserId} />

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link to={BACK_PATH}>{t('common:actions.cancel')}</Link>
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {t('accounting:contracts.newPage.submit')}
                </Button>
              </div>
            </>
          ) : null}
        </form>
      )}
    </div>
  )
}
