import { useState } from 'react'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { useWrite } from '../use-sheet'
import { InviteNotifyDialog, type InviteNotice } from './InviteNotifyDialog'
import { MeetDialog } from './MeetDialog'
import type { MeetingTask } from './meet-api'

/** "Mută" and "Anulează" on a meeting row, with the "send the update?" step; the row only renders `dialogs`. */
export function useMeetingControls() {
  const { can } = useMe()
  const confirm = useConfirm()
  const write = useWrite()
  const [moving, setMoving] = useState<MeetingTask | null>(null)
  const [notice, setNotice] = useState<InviteNotice | null>(null)

  // Without the right to send there is nobody to ask: the invitees keep the old invitation.
  const askNotify = (meeting: MeetingTask, kind: InviteNotice['kind']) => {
    if (meeting.invitees.length > 0 && can('email.trimitere')) setNotice({ meeting, kind })
  }

  const cancel = async (meeting: MeetingTask) => {
    const ok = await confirm({ title: t('meetings:cancel.title', { title: meeting.title }), consequence: t('meetings:cancel.consequence'), confirmLabel: t('meetings:cancel.confirm'), destructive: true })
    if (!ok) return
    const done = await write(async () => {
      await api.delete(`/api/prospects/${meeting.prospectId}/tasks/${meeting.id}`)
      return true
    }, t('meetings:cancel.done'))
    if (done) askNotify(meeting, 'cancel')
  }

  const dialogs = (
    <>
      <MeetDialog
        prospectId={moving?.prospectId ?? ''}
        prospectName={moving?.prospectName ?? ''}
        task={moving}
        open={moving !== null}
        onOpenChange={(open) => !open && setMoving(null)}
        onMoved={(meeting) => askNotify(meeting, 'update')}
      />
      <InviteNotifyDialog notice={notice} onOpenChange={(open) => !open && setNotice(null)} />
    </>
  )

  return { move: setMoving, cancel, dialogs }
}
