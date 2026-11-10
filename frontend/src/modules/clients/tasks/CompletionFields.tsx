import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { t, type TKey } from '@/shared/lib/i18n'
import { NEXT_KINDS, NEXT_STEPS, type CompletionDraft, type NextStepChoice } from './completion'
import { SnippetTextarea } from './SnippetTextarea'
import { CALL_OUTCOMES, type CallOutcome } from './types'

export const OUTCOME_LABEL: Record<CallOutcome, TKey> = {
  answered: 'clients:tasks.outcomes.answered',
  no_answer: 'clients:tasks.outcomes.no_answer',
  voicemail: 'clients:tasks.outcomes.voicemail',
  wrong_number: 'clients:tasks.outcomes.wrong_number',
  callback: 'clients:tasks.outcomes.callback',
}

const NEXT_LABEL: Record<NextStepChoice, TKey> = {
  none: 'clients:tasks.next.none',
  callback2: 'clients:tasks.next.callback2',
  week: 'clients:tasks.next.week',
  offer: 'clients:tasks.next.offer',
  custom: 'clients:tasks.next.custom',
}

const KIND_LABEL: Record<(typeof NEXT_KINDS)[number], TKey> = {
  call: 'clients:sheet.schedule.kinds.call',
  email: 'clients:sheet.schedule.kinds.email',
  meeting: 'clients:sheet.schedule.kinds.meeting',
  task: 'clients:sheet.schedule.kinds.task',
  linkedin_message: 'clients:sheet.schedule.kinds.linkedin_message',
}

interface Props {
  draft: CompletionDraft
  onChange: (next: CompletionDraft) => void
  /** Outcomes only exist for calls; other task types go straight to the note and the follow-up. */
  isCall: boolean
  /** Phones of the prospect, so "wrong number" can mark the one that was dialled. */
  phones?: Array<{ id: string; value: string }>
  /** Number keys beside the outcomes (the call session). */
  keyHints?: boolean
}

/** Outcome, note and next step: the same fields in the completion dialog and in the call session. */
export function CompletionFields({ draft, onChange, isCall, phones = [], keyHints = false }: Props) {
  const patch = (next: Partial<CompletionDraft>) => onChange({ ...draft, ...next })
  const pickOutcome = (outcome: CallOutcome) => patch({ outcome, next: outcome === 'callback' && draft.next === 'none' ? 'callback2' : draft.next })

  return (
    <div className="space-y-4">
      {isCall ? (
        <div className="space-y-1.5" role="group" aria-label={t('clients:tasks.outcome')}>
          <span className="text-sm font-medium">{t('clients:tasks.outcome')}</span>
          <div className="flex flex-wrap gap-2">
            {CALL_OUTCOMES.map((outcome, index) => (
              <Button key={outcome} type="button" size="md" variant={draft.outcome === outcome ? 'default' : 'outline'} aria-pressed={draft.outcome === outcome} onClick={() => pickOutcome(outcome)}>
                {keyHints ? <kbd className="font-sans text-xs opacity-70">{index + 1}</kbd> : null}
                {t(OUTCOME_LABEL[outcome])}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {draft.outcome === 'wrong_number' && phones.length > 1 ? (
        <Field label={t('clients:tasks.wrongPhone')}>
          <Select value={draft.contactPointId} onValueChange={(contactPointId) => patch({ contactPointId })} options={phones.map((phone) => ({ value: phone.id, label: phone.value }))} />
        </Field>
      ) : null}

      <Field label={t('clients:tasks.note')} optional>
        <SnippetTextarea rows={3} maxLength={2000} value={draft.note} onValueChange={(note) => patch({ note })} />
      </Field>

      <div className="space-y-1.5" role="group" aria-label={t('clients:tasks.nextStep')}>
        <span className="text-sm font-medium">{t('clients:tasks.nextStep')}</span>
        <div className="flex flex-wrap gap-2">
          {NEXT_STEPS.map((choice) => (
            <Button key={choice} type="button" size="sm" variant={draft.next === choice ? 'default' : 'outline'} aria-pressed={draft.next === choice} onClick={() => patch({ next: choice })}>
              {t(NEXT_LABEL[choice])}
            </Button>
          ))}
        </div>
      </div>

      {draft.next === 'custom' ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label={t('clients:sheet.schedule.kind')}>
            <Select value={draft.customKind} onValueChange={(customKind) => patch({ customKind: customKind as CompletionDraft['customKind'] })} options={NEXT_KINDS.map((value) => ({ value, label: t(KIND_LABEL[value]) }))} />
          </Field>
          <Field label={t('clients:tasks.inDays')}>
            <Input inputMode="numeric" maxLength={3} value={draft.customDays} onChange={(e) => patch({ customDays: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label={t('common:labels.title')} optional className="sm:col-span-2">
            <Input maxLength={255} value={draft.customTitle} onChange={(e) => patch({ customTitle: e.target.value })} />
          </Field>
        </div>
      ) : null}
    </div>
  )
}
