import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { trackScheduledSend } from '@/modules/email/compose/send-flow'
import { api } from '@/shared/lib/api'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailScheduledSend, EmailSenderOptions } from '@/shared/lib/types'

export type InviteMethod = 'request' | 'cancel'
export type InviteKind = 'request' | 'update' | 'cancel'

/** A meeting task as the sheet and the Tasks page both hold it. */
export interface MeetingTask {
  id: string
  prospectId: string
  prospectName: string
  title: string
  description: string | null
  dueAt: string
  durationMinutes: number | null
  location: string | null
  invitees: string[]
  attendeeUserIds: string[]
}

interface MeetingSource {
  id: string
  title: string
  description: string | null
  dueAt: string
  durationMinutes?: number | null
  location?: string | null
  invitees?: string[]
  attendeeUserIds?: string[]
}

export const DEFAULT_MEETING_MINUTES = 30

export const meetingOf = (task: MeetingSource, prospectId: string, prospectName: string): MeetingTask => ({
  id: task.id,
  prospectId,
  prospectName,
  title: task.title,
  description: task.description,
  dueAt: task.dueAt,
  durationMinutes: task.durationMinutes ?? null,
  location: task.location ?? null,
  invitees: task.invitees ?? [],
  attendeeUserIds: task.attendeeUserIds ?? [],
})

export const endOf = (task: { dueAt: string; durationMinutes?: number | null }) => new Date(new Date(task.dueAt).getTime() + (task.durationMinutes ?? DEFAULT_MEETING_MINUTES) * 60_000)

const MAILBOX_KEY = 'vana.meetMailbox'

export const rememberedMailbox = (): string | null => {
  try {
    return localStorage.getItem(MAILBOX_KEY)
  } catch {
    return null
  }
}

export const rememberMailbox = (key: string) => {
  try {
    localStorage.setItem(MAILBOX_KEY, key)
  } catch {
    // No storage: the first mailbox is the default next time.
  }
}

/** The mailbox to start from: the last one used, if the person still has it. */
export const defaultMailbox = (identities: Array<{ key: string }>): string => {
  const saved = rememberedMailbox()
  return identities.find((identity) => identity.key === saved)?.key ?? identities[0]?.key ?? ''
}

/** Only the person's own mailboxes; readable without `email.setari`. */
export function useSenderOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The message box is plain text; the send route takes HTML. */
export const messageToHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')

export function inviteTexts(kind: InviteKind, meeting: { title: string; dueAt: string; durationMinutes: number | null; location: string | null }, organizer: string) {
  const subjectKey = { request: 'meetings:email.subject', update: 'meetings:email.updateSubject', cancel: 'meetings:email.cancelSubject' } as const
  const bodyKey = { request: 'meetings:email.body', update: 'meetings:email.updateBody', cancel: 'meetings:email.cancelBody' } as const
  const place = meeting.location?.trim() ? t('meetings:email.place', { location: meeting.location.trim() }) : ''
  return {
    subject: t(subjectKey[kind], { title: meeting.title }),
    body: t(bodyKey[kind], {
      title: meeting.title,
      date: formatDate(meeting.dueAt, { dateStyle: 'full' }),
      time: formatDate(meeting.dueAt, { timeStyle: 'short' }),
      duration: meeting.durationMinutes ?? DEFAULT_MEETING_MINUTES,
      place,
      organizer,
    }),
  }
}

export interface InviteInput {
  prospectId: string
  taskId: string
  kind: InviteKind
  from: string
  to: string[]
  subject: string
  body: string
}

interface InviteIcs {
  filename: string
  content: string
}

const FAILED_KEY = { request: 'meetings:inviteFailed', update: 'meetings:updateFailed', cancel: 'meetings:cancelFailed' } as const

/**
 * Fetches the .ics, then sends it through the ordinary email route (own mailbox, signature,
 * unsubscribe guard, undo window). A failure keeps the meeting and offers a retry.
 */
export function useSendInvitation() {
  const navigate = useNavigate()
  const send = useCallback(
    async (input: InviteInput): Promise<boolean> => {
      try {
        const method: InviteMethod = input.kind === 'cancel' ? 'cancel' : 'request'
        const ics = await api.get<InviteIcs>(`/api/prospects/${input.prospectId}/tasks/${input.taskId}/invite.ics?method=${method}&from=${encodeURIComponent(input.from)}`)
        const scheduled = await api.post<EmailScheduledSend>('/api/email/send', {
          from: input.from,
          to: input.to,
          subject: input.subject,
          body: messageToHtml(input.body),
          attachments: [{ filename: ics.filename, content: ics.content }],
        })
        rememberMailbox(input.from)
        trackScheduledSend(scheduled, {
          onUndone: () => undefined,
          onView: (threadId) => navigate(`/email?thread=${threadId}`),
          onOpenDraft: () => navigate('/email'),
          onSettled: () => undefined,
        })
        return true
      } catch (err) {
        toast.error(t(FAILED_KEY[input.kind], { reason: err instanceof Error ? err.message : '' }), {
          duration: 12_000,
          closeButton: true,
          action: { label: t('common:actions.retry'), onClick: () => void send(input) },
        })
        return false
      }
    },
    [navigate],
  )
  return send
}
