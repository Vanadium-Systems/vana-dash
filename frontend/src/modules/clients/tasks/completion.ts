import { companyDay, zonedInstant } from '../sheet/schedule-time'
import { t } from '@/shared/lib/i18n'
import type { CallOutcome } from './types'

/** Quick follow-ups after a task; `custom` opens the type, day and title fields. */
export const NEXT_STEPS = ['none', 'callback2', 'week', 'offer', 'custom'] as const
export type NextStepChoice = (typeof NEXT_STEPS)[number]

export const NEXT_KINDS = ['call', 'email', 'meeting', 'task', 'linkedin_message'] as const

export interface CompletionDraft {
  outcome: CallOutcome | null
  note: string
  next: NextStepChoice
  customKind: (typeof NEXT_KINDS)[number]
  customDays: string
  customTitle: string
  contactPointId: string
}

export const emptyDraft = (): CompletionDraft => ({ outcome: null, note: '', next: 'none', customKind: 'call', customDays: '1', customTitle: '', contactPointId: '' })

const PRESETS = {
  callback2: { kind: 'call', days: 2, title: 'clients:tasks.next.titles.callback2' },
  week: { kind: 'call', days: 7, title: 'clients:tasks.next.titles.week' },
  offer: { kind: 'email', days: 1, title: 'clients:tasks.next.titles.offer' },
} as const

const FOLLOW_UP_TIME = '10:00'

/** Body of `POST /api/prospects/tasks/:id/done`: what happened and, if chosen, the follow-up task. */
export function buildCompleteBody(draft: CompletionDraft, prospectName: string, timeZone: string) {
  const body: Record<string, unknown> = {}
  if (draft.outcome) body.outcome = draft.outcome
  if (draft.note.trim()) body.outcomeNote = draft.note.trim()
  if (draft.outcome === 'wrong_number' && draft.contactPointId) body.contactPointId = draft.contactPointId

  if (draft.next !== 'none') {
    const preset = draft.next === 'custom' ? null : PRESETS[draft.next]
    const days = preset ? preset.days : Math.max(0, Number.parseInt(draft.customDays, 10) || 0)
    body.nextTask = {
      kind: preset ? preset.kind : draft.customKind,
      title: preset ? t(preset.title, { name: prospectName }) : draft.customTitle.trim() || t('clients:tasks.next.titles.custom', { name: prospectName }),
      dueAt: zonedInstant(companyDay(new Date(), timeZone, days), FOLLOW_UP_TIME, timeZone).toISOString(),
    }
  }
  return body
}
