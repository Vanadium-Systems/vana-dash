import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Select } from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { formatDate, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useAssignees } from '../prospects/use-prospect-data'
import type { ProspectSheet } from './types'
import { useContactCheck } from './use-sheet'
import { useTeamActions } from './use-team-actions'

const personName = (person: { displayName: string | null; email: string }) => person.displayName ?? person.email

export function TransferDialog({ sheet, open, onOpenChange }: { sheet: ProspectSheet; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useTeamActions(sheet.id)
  const assignees = useAssignees().data ?? []
  const [toUserId, setToUserId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setToUserId('')
      setNote('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (!toUserId) return setError(t('clients:sheet.team.recipientRequired'))
    setSaving(true)
    const done = await actions.transfer(toUserId, note)
    setSaving(false)
    if (done) onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:sheet.team.transferTitle', { name: sheet.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('clients:sheet.team.recipient')} error={error}>
            <Select value={toUserId} onValueChange={setToUserId}>
              <option value="" disabled>
                {t('clients:sheet.team.pickPerson')}
              </option>
              {assignees
                .filter((person) => person.id !== sheet.assignedUserId)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {personName(person)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('clients:sheet.team.handoverNote')} optional hint={t('clients:sheet.team.handoverHint')}>
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('clients:sheet.team.transferConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RequestDialog({ sheet, open, onOpenChange, kind }: { sheet: ProspectSheet; open: boolean; onOpenChange: (open: boolean) => void; kind: 'transfer' | 'access' }) {
  const actions = useTeamActions(sheet.id)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) setNote('')
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(kind === 'transfer' ? 'clients:sheet.team.requestTransferTitle' : 'clients:sheet.team.requestAccessTitle', { name: sheet.name })}</DialogTitle>
          <DialogDescription>{t('clients:sheet.team.requestBody', { owner: sheet.ownerName ?? '' })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setSaving(true)
            void actions.request(kind, note).then((done) => {
              setSaving(false)
              if (done) onOpenChange(false)
            })
          }}
        >
          <Field label={t('clients:sheet.team.requestNote')} optional>
            <Textarea autoFocus rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('clients:sheet.team.requestSend')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CollaboratorsDialog({ sheet, open, onOpenChange, canManage }: { sheet: ProspectSheet; open: boolean; onOpenChange: (open: boolean) => void; canManage: boolean }) {
  const actions = useTeamActions(sheet.id)
  const assignees = useAssignees().data ?? []
  const [userId, setUserId] = useState('')
  const [level, setLevel] = useState<'view' | 'edit'>('edit')
  useEffect(() => {
    if (open) {
      setUserId('')
      setLevel('edit')
    }
  }, [open])
  const taken = new Set([sheet.assignedUserId, ...sheet.collaborators.map((c) => c.userId)])
  const levelOptions = [
    { value: 'view', label: t('clients:sheet.team.levelView') },
    { value: 'edit', label: t('clients:sheet.team.levelEdit') },
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:sheet.team.collaboratorsTitle')}</DialogTitle>
          <DialogDescription>{t('clients:sheet.team.collaboratorsBody')}</DialogDescription>
        </DialogHeader>
        {sheet.collaborators.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:sheet.team.noCollaborators')}</p> : null}
        <ul className="space-y-2">
          {sheet.collaborators.map((collaborator) => (
            <li key={collaborator.userId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{collaborator.name}</span>
              {canManage ? (
                <>
                  <Select size="sm" className="w-36" aria-label={collaborator.name} value={collaborator.level} options={levelOptions} onValueChange={(next) => void actions.setCollaborator(collaborator.userId, next as 'view' | 'edit')} />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.remove')} title={t('common:actions.remove')} onClick={() => void actions.removeCollaborator(collaborator.userId)}>
                    <X />
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{t(collaborator.level === 'edit' ? 'clients:sheet.team.levelEdit' : 'clients:sheet.team.levelView')}</span>
              )}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!userId) return
              void actions.setCollaborator(userId, level).then(() => setUserId(''))
            }}
          >
            <Field label={t('clients:sheet.team.addCollaborator')}>
              <Select value={userId} onValueChange={setUserId}>
                <option value="" disabled>
                  {t('clients:sheet.team.pickPerson')}
                </option>
                {assignees
                  .filter((person) => !taken.has(person.id))
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {personName(person)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('clients:sheet.team.level')}>
              <Select value={level} options={levelOptions} onValueChange={(next) => setLevel(next as 'view' | 'edit')} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={!userId}>
                {t('common:actions.add')}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** KM10: before calling, writing or enrolling someone else's prospect, say whose it is and when it was last touched. */
export function ContactCheckDialog({ sheet, open, canRequest, onContinue, onRequestTransfer, onOpenChange }: { sheet: ProspectSheet; open: boolean; canRequest: boolean; onContinue: () => void; onRequestTransfer: () => void; onOpenChange: (open: boolean) => void }) {
  const check = useContactCheck(sheet.id, open)
  const data = check.data
  const owner = data?.ownerName ?? sheet.ownerName ?? ''
  const since = data?.claimedAt ? formatDate(data.claimedAt) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">{t('clients:sheet.team.checkTitle', { name: sheet.name })}</DialogTitle>
          <DialogDescription>
            {check.isPending
              ? t('common:states.loading')
              : [
                  since ? t('clients:sheet.team.checkOwnerSince', { owner, date: since }) : t('clients:sheet.team.checkOwner', { owner }),
                  data?.lastActivityAt && data.lastActivityKind
                    ? t('clients:sheet.team.checkLast', { when: formatRelativeTime(data.lastActivityAt), kind: t(`clients:sheet.team.kinds.${data.lastActivityKind}`) })
                    : t('clients:sheet.team.checkNone'),
                ].join(', ')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {canRequest ? (
            <Button type="button" variant="outline" onClick={onRequestTransfer}>
              {t('clients:sheet.team.requestTransfer')}
            </Button>
          ) : null}
          <Button type="button" onClick={onContinue}>
            {t('common:actions.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Discută cu responsabilul": a DM with the prospect's card, optionally with a line of your own. */
export function DiscussDialog({ sheet, open, onOpenChange }: { sheet: ProspectSheet; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  useEffect(() => {
    if (open) setComment('')
  }, [open])
  const send = async () => {
    if (!sheet.assignedUserId) return
    setSending(true)
    try {
      const { id } = await api.post<{ id: string }>('/api/chat/conversations', { kind: 'dm', userId: sheet.assignedUserId })
      await api.post(`/api/chat/conversations/${id}/messages`, { body: comment.trim(), clientId: crypto.randomUUID(), refs: [{ type: 'prospect', id: sheet.id }] })
      onOpenChange(false)
      navigate(`/messages/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:sheet.team.discussTitle', { owner: sheet.ownerName ?? '' })}</DialogTitle>
          <DialogDescription>{t('clients:sheet.team.discussBody', { name: sheet.name })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <Field label={t('clients:sheet.team.discussComment')} optional>
            <Textarea autoFocus rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={sending}>
              {t('common:actions.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
