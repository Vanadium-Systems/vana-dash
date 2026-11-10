import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import { defaultMailbox, inviteTexts, useSenderOptions, useSendInvitation, type MeetingTask } from './meet-api'

export interface InviteNotice {
  meeting: MeetingTask
  kind: 'update' | 'cancel'
}

/** "Send the update / cancellation to N invitees?": the .ics goes out from the chosen mailbox. */
export function InviteNotifyDialog({ notice, onOpenChange }: { notice: InviteNotice | null; onOpenChange: (open: boolean) => void }) {
  const { session } = useMe()
  const sendInvitation = useSendInvitation()
  const senders = useSenderOptions(notice !== null)
  const identities = senders.data?.identities ?? []
  const [from, setFrom] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (notice && identities.length > 0) setFrom(defaultMailbox(identities))
    // Re-pick only when a new notice opens or the list arrives.
  }, [notice, senders.data])

  const meeting = notice?.meeting
  const count = meeting?.invitees.length ?? 0
  const cancel = notice?.kind === 'cancel'

  const send = async () => {
    if (!meeting || !notice) return
    setSending(true)
    const texts = inviteTexts(notice.kind, meeting, session?.user.displayName ?? session?.user.email ?? '')
    onOpenChange(false)
    await sendInvitation({ prospectId: meeting.prospectId, taskId: meeting.id, kind: notice.kind, from, to: meeting.invitees, subject: texts.subject, body: texts.body })
    setSending(false)
  }

  return (
    <Dialog open={notice !== null} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="md:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">{cancel ? t('meetings:notify.cancelTitle', { count }) : t('meetings:notify.updateTitle', { count })}</DialogTitle>
          <DialogDescription>{cancel ? t('meetings:notify.cancelHelp') : t('meetings:notify.updateHelp')}</DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm text-muted-foreground">{t('meetings:notify.to', { emails: meeting?.invitees.join(', ') })}</p>
        {identities.length > 1 ? (
          <Field label={t('meetings:dialog.from')}>
            <Select value={from} onValueChange={setFrom} options={identities.map((identity) => ({ value: identity.key, label: `${identity.label} (${identity.fromAddress})` }))} />
          </Field>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('meetings:notify.skip')}
          </Button>
          <Button type="button" disabled={sending || !from} onClick={() => void send()}>
            {cancel ? t('meetings:notify.sendCancel') : t('meetings:notify.sendUpdate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
