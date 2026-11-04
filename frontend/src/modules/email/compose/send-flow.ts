import { toast } from 'sonner'
import { api, ApiError } from '@/shared/lib/api'
import type { EmailScheduledSend, EmailSendOutcome } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

const POLL_MS = 2000
const MAX_POLLS = 20
/** A failure stays long enough to read and act on, then goes; ✕ closes it sooner. */
const FAILURE_TOAST_MS = 12_000

export interface SendFlowHandlers {
  /** Undo worked: reopen the message from its draft, exactly as it was. */
  onUndone: (draftId: string) => void
  onView: (threadId: string) => void
  onOpenDraft: (draftId: string) => void
  onSettled: () => void
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// E9/E11: "Sending · Undo" for the server's undo window, then what really happened. No dialog
// before sending; a failure stays on screen until dismissed, with the way back to the draft.
export function trackScheduledSend(scheduled: EmailScheduledSend, handlers: SendFlowHandlers): void {
  const toastId = `send-${scheduled.sendId}`
  const windowMs = Math.max(0, new Date(scheduled.sendAfter).getTime() - Date.now())
  let undone = false
  const sendAfterMs = new Date(scheduled.sendAfter).getTime()

  const undo = async () => {
    undone = true
    clearInterval(countdown)
    try {
      const { draftId } = await api.delete<{ draftId: string }>(`/api/email/sends/${scheduled.sendId}/scheduled`)
      toast(t('email:send.undone'), { id: toastId })
      handlers.onUndone(draftId)
      handlers.onSettled()
    } catch (err) {
      undone = false
      if (err instanceof ApiError && err.code === 'SEND_ALREADY_DISPATCHED') toast(t('email:send.tooLate'), { id: toastId })
      else toast.error(err instanceof Error ? err.message : t('email:send.undoFailed'), { id: toastId })
    }
  }

  // The seconds left count down in the toast, so "Undo" says how long it still works.
  const showSending = () => {
    const seconds = Math.max(0, Math.ceil((sendAfterMs - Date.now()) / 1000))
    toast(seconds > 0 ? t('email:send.sendingIn', { seconds }) : t('email:send.sending'), {
      id: toastId,
      duration: seconds * 1000 + 1500,
      action: { label: t('common:undo.action'), onClick: () => void undo() },
    })
  }
  showSending()
  const countdown = setInterval(() => {
    showSending()
    if (Date.now() >= sendAfterMs) clearInterval(countdown)
  }, 1000)

  void (async () => {
    await wait(windowMs + 500)
    for (let i = 0; i < MAX_POLLS && !undone; i++) {
      let status: EmailSendOutcome
      try {
        status = await api.get<EmailSendOutcome>(`/api/email/sends/${scheduled.sendId}/status`)
      } catch {
        await wait(POLL_MS)
        continue
      }
      if (undone || status.status === 'cancelled') return
      if (status.status === 'failed') {
        toast.error(t('email:send.failed', { reason: status.error ?? '' }), {
          id: toastId,
          duration: FAILURE_TOAST_MS,
          closeButton: true,
          action: status.draftId
            ? { label: t('email:send.openDraft'), onClick: () => handlers.onOpenDraft(status.draftId as string) }
            : undefined,
        })
        handlers.onSettled()
        return
      }
      if (status.status !== 'scheduled' && status.status !== 'sending') {
        toast.success(t('email:send.sent'), {
          id: toastId,
          action: status.threadId ? { label: t('email:send.view'), onClick: () => handlers.onView(status.threadId as string) } : undefined,
        })
        handlers.onSettled()
        return
      }
      await wait(POLL_MS)
    }
  })()
}
