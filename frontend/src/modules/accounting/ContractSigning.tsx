import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Copy, Download, FileCheck, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { RowActions, type RowAction } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { errorCode, errorText, toastError } from '@/shared/lib/errors'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'
import type { RegistryContract, SignRequest, SignRequestCreated, SignRequestStatus } from './contracts-api'

const DEFAULT_ROLE = 'Colaborator'
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const STATUS_TONE: Record<SignRequestStatus, StateTone> = {
  sent: 'neutral',
  opened: 'neutral',
  signed: 'success',
  declined: 'critical',
  revoked: 'neutral',
  expired: 'warning',
  locked: 'critical',
}

interface Prefill {
  signerName: string
  signerEmail: string
  signerRole: string
}

function copyLink(link: string) {
  void navigator.clipboard?.writeText(link).then(
    () => toast.success(t('common:states.copied')),
    () => toast.error(t('messages:actions.copyFailed')),
  )
}

function SendToSignForm({ contractId, prefill, onClose }: { contractId: string; prefill: Prefill; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [signerName, setSignerName] = useState(prefill.signerName)
  const [signerEmail, setSignerEmail] = useState(prefill.signerEmail)
  const [signerRole, setSignerRole] = useState(prefill.signerRole)
  const [unsigned, setUnsigned] = useState(false)
  const [errors, setErrors] = useState<{ signerName?: string; signerEmail?: string; signerRole?: string }>({})
  const [serverProblem, setServerProblem] = useState<{ code: string; message: string } | null>(null)
  const [created, setCreated] = useState<SignRequestCreated | null>(null)

  const send = useMutation({
    mutationFn: () =>
      api.post<SignRequestCreated>(`/api/contracts/registry/${contractId}/sign-requests`, {
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        signerRole: signerRole.trim(),
        unsigned,
      }),
    onSuccess: (row) => {
      setServerProblem(null)
      setCreated(row)
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
    },
    onError: (err) => {
      const code = errorCode(err)
      if (code === 'CONTRACT_SIGN_OWN_SIGNATURE_MISSING' || code === 'CONTRACT_SIGNING_CERT_MISSING') {
        setServerProblem({ code, message: errorText(err) })
        return
      }
      toastError(err)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (!signerName.trim()) next.signerName = t('accounting:contracts.signing.dialog.nameRequired')
    if (!EMAIL_SHAPE.test(signerEmail.trim())) next.signerEmail = t('accounting:contracts.signing.dialog.emailInvalid')
    if (!signerRole.trim()) next.signerRole = t('accounting:contracts.signing.dialog.roleRequired')
    setErrors(next)
    if (Object.keys(next).length > 0) return
    send.mutate()
  }

  if (created) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>{t('accounting:contracts.signing.created.title')}</DialogTitle>
          <DialogDescription>{t('accounting:contracts.signing.created.body', { email: signerEmail.trim() })}</DialogDescription>
        </DialogHeader>
        <Field label={t('accounting:contracts.signing.created.linkLabel')}>
          <Input readOnly className="font-mono text-xs" value={created.link} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <p className="text-xs text-muted-foreground">{t('accounting:contracts.signing.created.expires', { date: formatDateTime(created.expiresAt) })}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
          <Button type="button" onClick={() => copyLink(created.link)}>
            <Copy aria-hidden="true" /> {t('accounting:contracts.signing.created.copy')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t('accounting:contracts.signing.dialog.title')}</DialogTitle>
      </DialogHeader>
      <Field label={t('accounting:contracts.signing.dialog.name')} error={errors.signerName}>
        <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={t('accounting:contracts.signing.dialog.email')} error={errors.signerEmail}>
        <Input type="email" inputMode="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label={t('accounting:contracts.signing.dialog.role')} error={errors.signerRole}>
        <Input value={signerRole} onChange={(e) => setSignerRole(e.target.value)} />
      </Field>
      {serverProblem ? (
        <Alert tone="warning">
          <p>{serverProblem.message}</p>
          {serverProblem.code === 'CONTRACT_SIGNING_CERT_MISSING' ? <p>{t('accounting:contracts.signing.dialog.certMissing')}</p> : null}
          {serverProblem.code === 'CONTRACT_SIGN_OWN_SIGNATURE_MISSING' ? (
            <label className="mt-1.5 flex items-center gap-2">
              <Checkbox checked={unsigned} onChange={(e) => setUnsigned(e.target.checked)} />
              {t('accounting:contracts.signing.dialog.unsigned')}
            </label>
          ) : null}
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? t('common:states.sending') : t('accounting:contracts.signing.dialog.submit')}
        </Button>
      </div>
    </form>
  )
}

function dateOf(request: SignRequest): string | null {
  if (request.status === 'signed' && request.signedAt) return t('accounting:contracts.signing.signedAtValue', { date: formatDateTime(request.signedAt) })
  if (request.status === 'sent' || request.status === 'opened' || request.status === 'expired') {
    return t('accounting:contracts.signing.expiresValue', { date: formatDate(request.expiresAt) })
  }
  return null
}

/** The "Sign by link" card of a contract that is not a SaaS one: send a link, follow the requests, download the result. */
export function SigningSection({ contract }: { contract: RegistryContract }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<Prefill | null>(null)

  const requests = useQuery({
    queryKey: ['contracts', 'registry', contract.id, 'sign-requests'],
    queryFn: () => api.get<SignRequest[]>(`/api/contracts/registry/${contract.id}/sign-requests`),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/api/contracts/sign-requests/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:contracts.signing.cancelled'))
    },
    onError: (err) => toastError(err),
  })

  const askCancel = async (request: SignRequest) => {
    const ok = await confirm({
      title: t('accounting:contracts.signing.cancelTitle', { name: request.signerName }),
      consequence: t('accounting:contracts.signing.cancelBody'),
      confirmLabel: t('accounting:contracts.signing.cancelConfirm'),
      destructive: true,
    })
    if (ok) cancel.mutate(request.id)
  }

  const open = (prefill: Prefill) => setDialog(prefill)
  const download = (documentId: string) => openFile(`/api/contracts/documents/${documentId}/pdf`, 'document.pdf')

  const actionsOf = (request: SignRequest): RowAction[] => {
    const list: RowAction[] = []
    if (request.status === 'signed') {
      if (request.signedDocumentId) {
        const documentId = request.signedDocumentId
        list.push({ key: 'signed', icon: Download, label: t('accounting:contracts.signing.downloadSigned'), onClick: () => download(documentId) })
      }
      if (request.certificateDocumentId) {
        const documentId = request.certificateDocumentId
        list.push({ key: 'certificate', icon: FileCheck, label: t('accounting:contracts.signing.downloadCertificate'), onClick: () => download(documentId) })
      }
    }
    if (request.status === 'sent' || request.status === 'opened') {
      list.push({ key: 'cancel', icon: Ban, label: t('accounting:contracts.signing.cancel'), disabled: cancel.isPending, onClick: () => void askCancel(request) })
    }
    if (request.status !== 'signed') {
      list.push({
        key: 'resend',
        icon: Send,
        label: t('accounting:contracts.signing.resend'),
        onClick: () => open({ signerName: request.signerName, signerEmail: request.signerEmail, signerRole: request.signerRole }),
      })
    }
    return list
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('accounting:contracts.signing.title')}</CardTitle>
        <Button type="button" onClick={() => open({ signerName: contract.counterpartyName, signerEmail: '', signerRole: DEFAULT_ROLE })}>
          <Send aria-hidden="true" /> {t('accounting:contracts.signing.send')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('accounting:contracts.signing.hint')}</p>
        {requests.isPending ? (
          <ListSkeleton rows={2} />
        ) : requests.isError ? (
          <Alert
            tone="critical"
            title={t('accounting:contracts.signing.loadFailed')}
            action={
              <Button variant="outline" onClick={() => void requests.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          />
        ) : requests.data.length === 0 ? (
          <EmptyState kind="new" title={t('accounting:contracts.signing.empty')} className="py-6" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('accounting:contracts.signing.colSigner')}</TableHead>
                <TableHead>{t('common:labels.status')}</TableHead>
                <TableHead priority="md">{t('accounting:contracts.signing.colDate')}</TableHead>
                <TableHead className="text-right">
                  <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data.map((request) => {
                const date = dateOf(request)
                return (
                  <TableRow key={request.id}>
                    <TableCell className="tbl-fill">
                      <div className="truncate">{request.signerName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {request.signerEmail} · {request.signerRole}
                      </div>
                      <TableDetails items={date ? [date] : []} />
                    </TableCell>
                    <TableCell>
                      <StatePill tone={STATUS_TONE[request.status]}>{t(`accounting:contracts.signing.status.${request.status}`)}</StatePill>
                      {request.status === 'declined' && request.declineReason ? (
                        <p className="mt-1 max-w-48 break-words text-xs text-muted-foreground">{t('accounting:contracts.signing.declineReason', { reason: request.declineReason })}</p>
                      ) : null}
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">
                      {date ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions actions={actionsOf(request)} title={request.signerName} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={dialog !== null} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="max-w-md">{dialog ? <SendToSignForm contractId={contract.id} prefill={dialog} onClose={() => setDialog(null)} /> : null}</DialogContent>
      </Dialog>
    </Card>
  )
}
