import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Download, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Timeline, type TimelineEntry } from '@/shared/components/Timeline'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { RowActions } from '@/shared/components/ui/row-actions'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api, ApiError } from '@/shared/lib/api'
import { actionLabel } from '@/shared/lib/audit'
import { errorCode, toastError } from '@/shared/lib/errors'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import { useMe } from '@/shared/hooks/use-me'
import { ContractDetail } from './ContractDetail'
import { SigningSection } from './ContractSigning'
import { ContractOwnerField, ContractTermsFields } from './ContractTermsFields'
import type { DocumentSignature, RegistryContract, RegistryDocument, RegistryHistoryItem } from './contracts-api'
import { NEXT_STATUSES, noticeText, STATUS_TONE, statusLabel, termsBody, termsFormOf, validateTerms, type TermsErrors, type TermsForm } from './contracts-logic'

const BACK_PATH = '/clients?tab=contracte'

const DOC_TYPE_LABEL: Record<RegistryDocument['docType'], () => string> = {
  contract: () => t('accounting:docTypes.contract'),
  anexa: () => t('accounting:docTypes.priceAnnex'),
  act_aditional: () => t('accounting:docTypes.addendum'),
  document: () => t('accounting:contracts.page.uploadedDocument'),
  sign_certificate: () => t('accounting:contracts.signing.certificateDoc'),
}

const HISTORY_LABEL: Record<string, () => string> = {
  'contract.creat': () => t('accounting:contracts.page.history.created'),
  'contract.incarcat': () => t('accounting:contracts.page.history.uploaded'),
  'contract.modificat': () => t('accounting:contracts.page.history.changed'),
  'contract.sters': () => t('accounting:contracts.page.history.deleted'),
}

const FIELD_LABEL: Record<string, () => string> = {
  title: () => t('common:labels.title'),
  category: () => t('common:labels.category'),
  status: () => t('common:labels.state'),
  signedOn: () => t('accounting:contracts.page.signedOn'),
  startsOn: () => t('accounting:contracts.terms.startsOn'),
  endsOn: () => t('accounting:contracts.terms.endsOn'),
  autoRenew: () => t('accounting:contracts.terms.autoRenew'),
  renewalMonths: () => t('accounting:contracts.terms.renewalMonths'),
  noticeDays: () => t('accounting:contracts.terms.noticeDays'),
  ownerUserId: () => t('accounting:contracts.terms.owner'),
  externalNumber: () => t('accounting:contracts.page.externalNumber'),
}

function historyText(item: RegistryHistoryItem): string {
  const label = HISTORY_LABEL[item.action]?.() ?? actionLabel(item.action)
  const changes = item.changes ?? {}
  if (item.action !== 'contract.modificat') return label
  const parts = Object.entries(changes).map(([key, [from, to]]) => {
    const field = FIELD_LABEL[key]?.() ?? key
    return key === 'status' ? `${field}: ${statusLabel(from as RegistryContract['status'])} → ${statusLabel(to as RegistryContract['status'])}` : field
  })
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : label
}

function toTimeline(history: RegistryHistoryItem[]): TimelineEntry[] {
  return history
    .map((item) => ({
      id: item.id,
      author: null,
      at: item.at,
      text: (
        <>
          {historyText(item)}
          <span className="text-muted-foreground"> · {item.actor?.name ?? t('common:labels.system')}</span>
        </>
      ),
    }))
    .reverse()
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function TermsSection({ contract }: { contract: RegistryContract }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [terms, setTerms] = useState<TermsForm>(() => termsFormOf(contract))
  const [signedOn, setSignedOn] = useState(contract.signedOn ?? '')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [errors, setErrors] = useState<TermsErrors>({})

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<RegistryContract>(`/api/contracts/registry/${contract.id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:contracts.page.termsSaved'))
      setEditing(false)
    },
    onError: (err) => toastError(err),
  })

  const startEditing = () => {
    setTerms(termsFormOf(contract))
    setSignedOn(contract.signedOn ?? '')
    setOwnerUserId('')
    setErrors({})
    setEditing(true)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = validateTerms(terms)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    save.mutate({ ...termsBody(terms), signedOn: signedOn || null, ...(ownerUserId ? { ownerUserId } : {}) })
  }

  const notice = noticeText(contract)
  return (
    <Section
      title={t('accounting:contracts.page.term')}
      actions={
        editing ? null : (
          <Button type="button" variant="outline" onClick={startEditing}>
            <Pencil aria-hidden="true" /> {t('common:actions.edit')}
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t('accounting:contracts.page.signedOn')} optional className="sm:max-w-xs">
            <Input id="term-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
          </Field>
          <ContractTermsFields idPrefix="term" value={terms} errors={errors} onChange={setTerms} />
          <ContractOwnerField id="term-owner" value={ownerUserId} onChange={setOwnerUserId} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('common:actions.save')}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t('accounting:contracts.page.signedOn')}>{contract.signedOn ? formatDate(contract.signedOn) : '—'}</Detail>
          <Detail label={t('accounting:contracts.terms.startsOn')}>{contract.startsOn ? formatDate(contract.startsOn) : '—'}</Detail>
          <Detail label={t('accounting:contracts.terms.endsOn')}>{contract.endsOn ? formatDate(contract.endsOn) : '—'}</Detail>
          <Detail label={t('accounting:contracts.terms.autoRenew')}>
            {contract.autoRenew ? t('accounting:contracts.page.renewsEvery', { count: contract.renewalMonths ?? 0 }) : t('accounting:contracts.page.noRenewal')}
          </Detail>
          <Detail label={t('accounting:contracts.terms.noticeDays')}>{contract.noticeDays ? t('accounting:contracts.page.noticeDaysValue', { count: contract.noticeDays }) : '—'}</Detail>
          <Detail label={t('accounting:contracts.page.noticeDeadline')}>
            {contract.noticeDeadline ? formatDate(contract.noticeDeadline) : '—'}
            {notice ? <span className="text-warning-text"> · {notice}</span> : null}
          </Detail>
          <Detail label={t('accounting:contracts.registry.owner')}>{contract.ownerName ?? '—'}</Detail>
        </dl>
      )}
    </Section>
  )
}

function signatureText(signature: DocumentSignature): string {
  const date = signature.signingTime ? formatDate(signature.signingTime) : null
  const name = signature.signerName
  const base =
    name && date
      ? t('accounting:contracts.signing.signatures.signedByAt', { name, date })
      : name
        ? t('accounting:contracts.signing.signatures.signedBy', { name })
        : date
          ? t('accounting:contracts.signing.signatures.signedAt', { date })
          : t('accounting:contracts.signing.signatures.signedPlain')
  if (signature.intact === null || signature.intact === undefined) return base
  return `${base} · ${signature.intact ? t('accounting:contracts.signing.signatures.intact') : t('accounting:contracts.signing.signatures.modified')}`
}

function DocumentsSection({ contract }: { contract: RegistryContract }) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<string | null>(null)
  const uploadSigned = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload(`/api/contracts/documents/${id}/signed`, fd)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:sign.uploaded'))
    },
    onError: (err) => toastError(err),
  })
  const toggleSigned = useMutation({
    mutationFn: ({ id, isSigned }: { id: string; isSigned: boolean }) => api.patch(`/api/contracts/documents/${id}`, { isSigned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contracts'] }),
    onError: (err) => toastError(err),
  })
  return (
    <Section title={t('accounting:contracts.page.documents')}>
      {contract.documents.length === 0 ? (
        <EmptyState kind="new" title={t('accounting:contracts.noDocuments')} className="py-6" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.type')}</TableHead>
              <TableHead priority="md">{t('accounting:contracts.generated')}</TableHead>
              <TableHead>{t('common:labels.status')}</TableHead>
              <TableHead className="text-right">
                <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contract.documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="tbl-fill">
                  <div className="truncate">{DOC_TYPE_LABEL[doc.docType]()}</div>
                  <TableDetails items={[formatDateTime(doc.createdAt)]} />
                </TableCell>
                <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(doc.createdAt)}
                </TableCell>
                <TableCell>
                  {doc.docType === 'sign_certificate' ? (
                    '—'
                  ) : (
                    <StatePill tone={doc.isSigned ? 'success' : 'neutral'}>{doc.isSigned ? t('accounting:contracts.signed') : t('accounting:contracts.unsigned')}</StatePill>
                  )}
                  {(doc.signatures ?? []).map((signature, index) => (
                    <p key={index} className="mt-1 max-w-60 break-words text-xs text-muted-foreground">
                      {signatureText(signature)}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="text-right">
                  <RowActions
                    actions={[
                      { key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/contracts/documents/${doc.id}/pdf`, 'document.pdf') },
                      ...(doc.docType === 'sign_certificate'
                        ? []
                        : [
                            {
                              key: 'upload',
                              icon: Upload,
                              label: t('accounting:contracts.signing.uploadSigned'),
                              disabled: uploadSigned.isPending,
                              onClick: () => {
                                uploadTarget.current = doc.id
                                fileInputRef.current?.click()
                              },
                            },
                            {
                              key: 'signed',
                              icon: doc.isSigned ? X : Check,
                              label: doc.isSigned ? t('accounting:contracts.markUnsigned') : t('accounting:contracts.markSigned'),
                              disabled: toggleSigned.isPending,
                              onClick: () => toggleSigned.mutate({ id: doc.id, isSigned: !doc.isSigned }),
                            },
                          ]),
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* native: hidden file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && uploadTarget.current) uploadSigned.mutate({ id: uploadTarget.current, file })
          e.target.value = ''
        }}
      />
    </Section>
  )
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <ListSkeleton rows={4} />
    </div>
  )
}

export function ContractPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useMe()
  const detail = useQuery({
    queryKey: ['contracts', 'registry', id],
    queryFn: () => api.get<RegistryContract>(`/api/contracts/registry/${id}`),
    // Missing or someone else's: asking again gives the same answer and keeps the skeleton up.
    retry: (failures, err) => !(err instanceof ApiError && err.status === 404) && failures < 1,
  })

  const changeStatus = useMutation({
    mutationFn: (status: RegistryContract['status']) => api.patch<RegistryContract>(`/api/contracts/registry/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contracts'] }),
    onError: (err) => toastError(err),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/contracts/registry/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:contracts.page.draftDeleted'))
      navigate(BACK_PATH, { replace: true })
    },
    onError: (err) => toastError(err),
  })

  const back = (
    <Button variant="ghost" asChild>
      <Link to={BACK_PATH}>
        <ArrowLeft aria-hidden="true" /> {t('accounting:contracts.page.back')}
      </Link>
    </Button>
  )

  if (detail.isPending) return <PageSkeleton />
  if (detail.isError || !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {back}
        {missing ? (
          <EmptyState kind="new" title={t('accounting:contracts.page.missing')} description={t('accounting:contracts.page.missingHint')} />
        ) : (
          <Alert
            tone="critical"
            title={t('accounting:contracts.page.loadFailed')}
            action={
              <Button variant="outline" onClick={() => void detail.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {errorCode(detail.error) ? t('common:errors.codeLine', { code: errorCode(detail.error) }) : null}
          </Alert>
        )}
      </div>
    )
  }

  const contract = detail.data
  const number = contract.numberLabel ?? contract.externalNumber
  const partyLink = contract.counterpartyKind === 'client' && contract.billingClientId ? `/clients?tab=activi&client=${contract.billingClientId}` : contract.counterpartyKind === 'prospect' && contract.prospectId ? `/clients/${contract.prospectId}` : null
  const nextStatuses = NEXT_STATUSES[contract.status]
  const canDelete = contract.status === 'draft' && contract.origin !== 'saas'

  const move = async (status: RegistryContract['status']) => {
    if (status === 'terminated') {
      const ok = await confirm({
        title: t('accounting:contracts.page.terminateTitle', { title: contract.title }),
        consequence: t('accounting:contracts.page.terminateBody'),
        confirmLabel: t('accounting:contracts.transitions.terminated'),
        destructive: true,
      })
      if (!ok) return
    }
    changeStatus.mutate(status)
  }

  const removeDraft = async () => {
    const ok = await confirm({
      title: t('accounting:contracts.page.deleteTitle', { title: contract.title }),
      consequence: t('accounting:contracts.page.deleteBody'),
      confirmLabel: t('accounting:contracts.page.deleteDraft'),
      destructive: true,
    })
    if (ok) remove.mutate()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {back}
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 space-y-1">
            <h1 className="break-words text-2xl font-semibold tracking-title">{contract.title}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {partyLink ? (
                <Link to={partyLink} className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {contract.counterpartyName}
                </Link>
              ) : (
                <span>{contract.counterpartyName}</span>
              )}
              {number ? <span>· {t('accounting:contracts.page.numberValue', { number })}</span> : null}
              <span>· {contract.category}</span>
              <StatePill tone={STATUS_TONE[contract.status]}>{statusLabel(contract.status)}</StatePill>
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {nextStatuses.map((status) => (
              <Button key={status} type="button" variant={status === 'signed' ? 'default' : 'outline'} disabled={changeStatus.isPending} onClick={() => void move(status)}>
                {t(`accounting:contracts.transitions.${status}`)}
              </Button>
            ))}
            {canDelete ? (
              <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => void removeDraft()}>
                <Trash2 aria-hidden="true" /> {t('accounting:contracts.page.deleteDraft')}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <TermsSection contract={contract} />
      {/* A SaaS contract keeps its own documents and addenda in ContractDetail. */}
      {contract.origin === 'saas' && contract.billingClientId ? (
        <ContractDetail clientId={contract.billingClientId} />
      ) : (
        <>
          <DocumentsSection contract={contract} />
          {can('facturi.semnare-contracte') ? <SigningSection contract={contract} /> : null}
        </>
      )}
      {contract.history.length > 0 ? (
        <Section title={t('accounting:contracts.page.history.title')}>
          <Timeline entries={toTimeline(contract.history)} />
        </Section>
      ) : null}
    </div>
  )
}
