import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { api } from '@/shared/lib/api'
import { errorCode, toastError } from '@/shared/lib/errors'
import { t } from '@/shared/lib/i18n'
import { ContractOwnerField, ContractTermsFields } from './ContractTermsFields'
import { ContractPartyField } from './ContractPartyField'
import { counterpartyBody, useContractCategories, useContractNumbers, type Counterparty } from './contracts-api'
import { EMPTY_TERMS, termsBody, validateTerms, type TermsErrors, type TermsForm } from './contracts-logic'

const MAX_PDF_BYTES = 20 * 1024 * 1024

type NumberMode = 'none' | 'own' | 'external'
interface FormErrors {
  file?: string
  title?: string
  category?: string
  party?: string
  number?: string
}

export function UploadContractDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const categories = useContractCategories(open)
  const numbers = useContractNumbers(null, open)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [party, setParty] = useState<Counterparty | null>(null)
  const [signedOn, setSignedOn] = useState('')
  const [numberMode, setNumberMode] = useState<NumberMode>('none')
  const [number, setNumber] = useState('')
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS)
  const [ownerUserId, setOwnerUserId] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [termsErrors, setTermsErrors] = useState<TermsErrors>({})

  useEffect(() => {
    if (!open) return
    setFile(null)
    setTitle('')
    setCategory('')
    setParty(null)
    setSignedOn('')
    setNumberMode('none')
    setNumber('')
    setTerms(EMPTY_TERMS)
    setOwnerUserId('')
    setErrors({})
    setTermsErrors({})
  }, [open])

  const upload = useMutation({
    mutationFn: (meta: Record<string, unknown>) => {
      const body = new FormData()
      // The server reads the form in order: 'meta' has to come before the file.
      body.append('meta', JSON.stringify(meta))
      body.append('file', file!)
      return api.upload<{ id: string; documentId: string }>('/api/contracts/registry/upload', body)
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      onOpenChange(false)
      navigate(`/clients/contracte/${created.id}`)
    },
    onError: (err) => {
      if (errorCode(err) === 'CONTRACT_NUMBER_TAKEN') setErrors({ number: t('accounting:contracts.numbers.taken') })
      else toastError(err)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: FormErrors = {}
    if (!file) next.file = t('accounting:contracts.upload.errors.file')
    else if (file.type !== 'application/pdf') next.file = t('accounting:contracts.upload.errors.notPdf')
    else if (file.size > MAX_PDF_BYTES) next.file = t('accounting:contracts.upload.errors.tooLarge')
    if (!title.trim()) next.title = t('accounting:contracts.upload.errors.title')
    if (!category.trim()) next.category = t('accounting:contracts.upload.errors.category')
    if (!party || (party.kind === 'other' && !party.name.trim())) next.party = t('accounting:contracts.party.required')
    const ownNumber = /^\d{1,6}$/.test(number.trim()) ? Number(number.trim()) : 0
    if (numberMode === 'own' && ownNumber < 1) next.number = t('accounting:contracts.numbers.digitsOnly')
    if (numberMode === 'external' && !number.trim()) next.number = t('accounting:contracts.upload.errors.externalNumber')
    const nextTerms = validateTerms(terms)
    setErrors(next)
    setTermsErrors(nextTerms)
    if (Object.keys(next).length > 0 || Object.keys(nextTerms).length > 0) return
    upload.mutate({
      title: title.trim(),
      category: category.trim(),
      counterparty: counterpartyBody(party!),
      signedOn: signedOn || null,
      ...termsBody(terms),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(numberMode === 'own' ? { number: ownNumber, ...(numbers.data?.series ? { seriesId: numbers.data.series.id } : {}) } : {}),
      ...(numberMode === 'external' ? { externalNumber: number.trim() } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('accounting:contracts.upload.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
          <Field label={t('accounting:contracts.upload.file')} error={errors.file} hint={t('accounting:contracts.upload.fileHint')}>
            <Input id="upload-file" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common:labels.title')} error={errors.title}>
              <Input id="upload-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t('common:labels.category')} error={errors.category}>
              <Input id="upload-category" list="upload-categories" maxLength={60} autoComplete="off" value={category} onChange={(e) => setCategory(e.target.value)} />
            </Field>
          </div>
          <datalist id="upload-categories">
            {(categories.data ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <ContractPartyField id="upload-party" value={party} onChange={setParty} error={errors.party ?? null} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('accounting:contracts.upload.signedOn')} optional>
              <Input id="upload-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
            </Field>
            <Field label={t('accounting:contracts.upload.numberMode')}>
              <Select
                id="upload-number-mode"
                value={numberMode}
                onChange={(e) => {
                  const mode = e.target.value as NumberMode
                  setNumberMode(mode)
                  setNumber(mode === 'own' && numbers.data?.next ? String(numbers.data.next) : '')
                  setErrors((current) => ({ ...current, number: undefined }))
                }}
              >
                <option value="none">{t('accounting:contracts.upload.numberNone')}</option>
                <option value="own">{t('accounting:contracts.upload.numberOwn')}</option>
                <option value="external">{t('accounting:contracts.upload.numberExternal')}</option>
              </Select>
            </Field>
          </div>
          {numberMode !== 'none' ? (
            <Field label={numberMode === 'own' ? t('accounting:contracts.upload.ownNumber') : t('accounting:contracts.upload.externalNumber')} error={errors.number}>
              <Input id="upload-number" inputMode={numberMode === 'own' ? 'numeric' : undefined} maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
          ) : null}
          <ContractTermsFields idPrefix="upload" value={terms} errors={termsErrors} onChange={setTerms} />
          <ContractOwnerField id="upload-owner" value={ownerUserId} onChange={setOwnerUserId} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              {t('accounting:contracts.upload.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
