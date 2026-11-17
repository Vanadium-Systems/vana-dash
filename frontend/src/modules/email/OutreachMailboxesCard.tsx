import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pause, Pencil, Play, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Switch } from '@/shared/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailSettings, OutreachMailbox } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { SettingsSection } from './SettingsLayout'
import { errorText, toastError } from '@/shared/lib/errors'

interface MailboxFormState {
  address: string
  displayName: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  imapHost: string
  imapPort: string
  imapSecure: boolean
  secret: string
  dailyCap: number
  warmupUntil: string
}

const EMPTY_FORM: MailboxFormState = {
  address: '',
  displayName: '',
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  secret: '',
  dailyCap: 30,
  warmupUntil: '',
}

function toFormState(m: OutreachMailbox): MailboxFormState {
  return {
    address: m.address,
    displayName: m.displayName,
    smtpHost: m.smtpHost,
    smtpPort: m.smtpPort,
    smtpSecure: m.smtpSecure,
    imapHost: m.imapHost ?? '',
    imapPort: m.imapPort ? String(m.imapPort) : '',
    imapSecure: m.imapSecure,
    secret: '',
    dailyCap: m.dailyCap,
    warmupUntil: m.warmupUntil ? m.warmupUntil.slice(0, 10) : '',
  }
}

const STATUS_TONE: Record<OutreachMailbox['status'], 'success' | 'neutral' | 'critical'> = {
  active: 'success',
  paused: 'neutral',
  error: 'critical',
}

export function OutreachMailboxesCard() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<OutreachMailbox | null>(null)
  const [form, setForm] = useState<MailboxFormState>(EMPTY_FORM)

  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
  })

  const mailboxes = useQuery({
    queryKey: ['email', 'outreach-mailboxes'],
    queryFn: () => api.get<OutreachMailbox[]>('/api/email/outreach-mailboxes'),
  })

  const toggleRealSending = useMutation({
    mutationFn: (enabled: boolean) => api.put<EmailSettings>('/api/email/settings', { outreachRealSendingEnabled: enabled }),
    onSuccess: (data) => {
      queryClient.setQueryData(['email', 'settings'], data)
    },
    onError: (err) => toastError(err),
  })

  const saveMailbox = useMutation({
    mutationFn: async () => {
      const payload = {
        address: form.address.trim(),
        displayName: form.displayName.trim(),
        smtpHost: form.smtpHost.trim(),
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        imapHost: form.imapHost.trim() || null,
        imapPort: form.imapHost.trim() && form.imapPort ? Number(form.imapPort) : null,
        imapSecure: form.imapSecure,
        ...(form.secret ? { secret: form.secret } : {}),
        dailyCap: form.dailyCap,
        warmupUntil: form.warmupUntil ? new Date(`${form.warmupUntil}T23:59:59Z`).toISOString() : null,
      }
      if (editing) {
        return api.patch<OutreachMailbox>(`/api/email/outreach-mailboxes/${editing.id}`, payload)
      }
      return api.post<OutreachMailbox>('/api/email/outreach-mailboxes', { ...payload, secret: form.secret })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-mailboxes'] })
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-summary'] })
      setDialogOpen(false)
      setEditing(null)
      toast.success(t('email:outreachMailboxes.saved'))
    },
    onError: (err) => toastError(err),
  })

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'paused' }) =>
      api.patch<OutreachMailbox>(`/api/email/outreach-mailboxes/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-mailboxes'] })
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-summary'] })
    },
    onError: (err) => toastError(err),
  })

  const removeMailbox = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/email/outreach-mailboxes/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-mailboxes'] })
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-summary'] })
      toast.success(t('email:outreachMailboxes.deleted'))
    },
    onError: (err) => toastError(err),
  })

  const testMailbox = useMutation({
    mutationFn: (id: string) => api.post<{ sentTo: string }>(`/api/email/outreach-mailboxes/${id}/test`),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-mailboxes'] })
      toast.success(t('email:outreachMailboxes.testSuccess', { email: res.sentTo }))
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'outreach-mailboxes'] })
      toast.error(t('email:outreachMailboxes.testFailed', { code: errorText(err) }))
    },
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (m: OutreachMailbox) => {
    setEditing(m)
    setForm(toFormState(m))
    setDialogOpen(true)
  }

  if (mailboxes.isPending) return <Skeleton className="h-48 w-full" />

  const realSending = settings.data?.outreachRealSendingEnabled ?? false

  return (
    <SettingsSection title={t('email:outreachMailboxes.title')} description={t('email:outreachMailboxes.hint')}>
      {!realSending ? (
        <Alert tone="warning">{t('email:outreachMailboxes.realSendingDisabled')}</Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={realSending}
            onCheckedChange={(checked) => toggleRealSending.mutate(checked)}
            disabled={toggleRealSending.isPending}
          />
          <span>{t('email:outreachMailboxes.realSendingLabel')}</span>
        </label>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t('email:outreachMailboxes.add')}
        </Button>
      </div>

      {!mailboxes.data?.length ? (
        <EmptyState kind="new" title={t('email:outreachMailboxes.empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('email:outreachMailboxes.address')}</TableHead>
              <TableHead priority="md">{t('email:outreachMailboxes.todayQuota')}</TableHead>
              <TableHead priority="lg">{t('email:outreachMailboxes.lastSent')}</TableHead>
              <TableHead>{t('email:outreachMailboxes.status')}</TableHead>
              <TableHead className="text-right">
                <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mailboxes.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="tbl-fill">
                  <div className="font-medium">{m.address}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.smtpHost}:{m.smtpPort}
                  </div>
                </TableCell>
                <TableCell priority="md" className="tabular-nums">
                  {m.usedToday} / {m.effectiveCap}
                </TableCell>
                <TableCell priority="lg" className="text-muted-foreground">
                  {m.lastSentAt ? formatDateTime(m.lastSentAt) : t('email:outreachMailboxes.never')}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <StatePill tone={STATUS_TONE[m.status]}>
                      {m.status === 'active'
                        ? t('email:outreachMailboxes.statusActive')
                        : m.status === 'paused'
                          ? t('email:outreachMailboxes.statusPaused')
                          : t('email:outreachMailboxes.statusError')}
                    </StatePill>
                    {m.lastErrorCode ? <span className="font-mono text-xs text-destructive">{m.lastErrorCode}</span> : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <RowActions
                    actions={[
                      {
                        key: 'test',
                        icon: Send,
                        label: t('email:outreachMailboxes.test'),
                        onClick: () => testMailbox.mutate(m.id),
                      },
                      {
                        key: 'toggle',
                        icon: m.status === 'active' ? Pause : Play,
                        label: m.status === 'active' ? t('email:outreachMailboxes.pause') : t('email:outreachMailboxes.resume'),
                        onClick: () => toggleStatus.mutate({ id: m.id, status: m.status === 'active' ? 'paused' : 'active' }),
                      },
                      {
                        key: 'edit',
                        icon: Pencil,
                        label: t('common:actions.edit'),
                        onClick: () => openEdit(m),
                      },
                      {
                        key: 'delete',
                        icon: Trash2,
                        label: t('common:actions.delete'),
                        destructive: true,
                        onClick: () => {
                          void confirm({
                            title: t('email:outreachMailboxes.deleteTitle', { address: m.address }),
                            consequence: t('email:outreachMailboxes.deleteBody'),
                            confirmLabel: t('email:outreachMailboxes.deleteConfirm'),
                            destructive: true,
                          }).then((ok) => ok && removeMailbox.mutate(m.id))
                        },
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('email:outreachMailboxes.editTitle') : t('email:outreachMailboxes.createTitle')}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              saveMailbox.mutate()
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="om-address">{t('email:outreachMailboxes.address')}</Label>
                <Input
                  id="om-address"
                  type="email"
                  required
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="om-display">{t('email:outreachMailboxes.displayName')}</Label>
                <Input
                  id="om-display"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="om-smtp-host">{t('email:outreachMailboxes.smtpHost')}</Label>
                <Input
                  id="om-smtp-host"
                  required
                  value={form.smtpHost}
                  onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="om-smtp-port">{t('email:outreachMailboxes.smtpPort')}</Label>
                <Input
                  id="om-smtp-port"
                  inputMode="numeric"
                  required
                  value={form.smtpPort}
                  onChange={(e) => setForm((f) => ({ ...f, smtpPort: Math.max(1, parseRoDecimal(e.target.value) || 465) }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.smtpSecure} onChange={(e) => setForm((f) => ({ ...f, smtpSecure: e.target.checked }))} />
              {t('email:outreachMailboxes.smtpSecure')}
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="om-secret">{t('email:outreachMailboxes.secret')}</Label>
              <Input
                id="om-secret"
                type="password"
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              />
              {editing ? <p className="text-xs text-muted-foreground">{t('email:outreachMailboxes.secretKeepHint')}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="om-cap">{t('email:outreachMailboxes.dailyCap')}</Label>
                <Input
                  id="om-cap"
                  inputMode="numeric"
                  required
                  value={form.dailyCap}
                  onChange={(e) => setForm((f) => ({ ...f, dailyCap: Math.max(1, parseRoDecimal(e.target.value) || 1) }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="om-warmup">{t('email:outreachMailboxes.warmupUntil')}</Label>
                <Input
                  id="om-warmup"
                  type="date"
                  value={form.warmupUntil}
                  onChange={(e) => setForm((f) => ({ ...f, warmupUntil: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="om-imap-host">{t('email:outreachMailboxes.imapHost')}</Label>
                <Input
                  id="om-imap-host"
                  value={form.imapHost}
                  onChange={(e) => setForm((f) => ({ ...f, imapHost: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="om-imap-port">{t('email:outreachMailboxes.imapPort')}</Label>
                <Input
                  id="om-imap-port"
                  inputMode="numeric"
                  value={form.imapPort}
                  onChange={(e) => setForm((f) => ({ ...f, imapPort: e.target.value }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={saveMailbox.isPending}>
                {saveMailbox.isPending ? t('common:states.saving') : t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
