import type { EmailSequence, SequenceStepKind } from '@/shared/lib/types'
import { t, type TKey } from '@/shared/lib/i18n'

export interface StepDraft {
  uid: string
  kind: SequenceStepKind
  delayDays: number
  templateId: string
  hasVariantB: boolean
  variantBTemplateId: string
  taskTitle: string
  taskDescription: string
}

export const STEP_KINDS: Array<{ kind: SequenceStepKind; label: TKey }> = [
  { kind: 'email', label: 'email:sequences.editor.kinds.email' },
  { kind: 'call', label: 'email:sequences.editor.kinds.call' },
  { kind: 'task', label: 'email:sequences.editor.kinds.task' },
  { kind: 'linkedin_connect', label: 'email:sequences.editor.kinds.linkedin_connect' },
  { kind: 'linkedin_message', label: 'email:sequences.editor.kinds.linkedin_message' },
  { kind: 'linkedin_view', label: 'email:sequences.editor.kinds.linkedin_view' },
  { kind: 'linkedin_engage', label: 'email:sequences.editor.kinds.linkedin_engage' },
]

export const stepKindLabel = (kind: SequenceStepKind) => t(STEP_KINDS.find((entry) => entry.kind === kind)!.label)

let counter = 0
// Drag handles need an id that survives reordering; the server ids do not exist for new steps.
const nextUid = () => `step-${++counter}`

export function emptyStep(delayDays = 0): StepDraft {
  return { uid: nextUid(), kind: 'email', delayDays, templateId: '', hasVariantB: false, variantBTemplateId: '', taskTitle: '', taskDescription: '' }
}

export function stepsFromSequence(sequence: EmailSequence | null): StepDraft[] {
  if (!sequence?.steps.length) return [emptyStep()]
  return sequence.steps.map((step) => ({
    uid: nextUid(),
    kind: step.kind,
    delayDays: step.delayDays,
    templateId: step.templateId ?? '',
    hasVariantB: Boolean(step.variantBTemplateId),
    variantBTemplateId: step.variantBTemplateId ?? '',
    taskTitle: step.taskTitle ?? '',
    taskDescription: step.taskDescription ?? '',
  }))
}

export function stepIsComplete(step: StepDraft): boolean {
  return step.kind === 'email' ? Boolean(step.templateId) && (!step.hasVariantB || Boolean(step.variantBTemplateId)) : Boolean(step.taskTitle.trim())
}

/** Only the fields the step's kind uses go to the server; it rejects an email step without a template. */
export function stepsPayload(steps: StepDraft[]) {
  return steps.map((step) =>
    step.kind === 'email'
      ? { kind: step.kind, delayDays: step.delayDays, templateId: step.templateId, ...(step.hasVariantB && step.variantBTemplateId ? { variantBTemplateId: step.variantBTemplateId } : {}) }
      : { kind: step.kind, delayDays: step.delayDays, taskTitle: step.taskTitle.trim(), ...(step.taskDescription.trim() ? { taskDescription: step.taskDescription.trim() } : {}) },
  )
}

/** `BOUNCE_RATE:0.070:50` written by the bounce guard; anything else is shown as pausedByHand. */
export function parseBounceReason(reason: string | null): { rate: number; sends: number } | null {
  const match = reason?.match(/^BOUNCE_RATE:([\d.]+):(\d+)$/)
  return match ? { rate: Number(match[1]), sends: Number(match[2]) } : null
}
