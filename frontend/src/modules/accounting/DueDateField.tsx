import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { DUE_PRESETS, daysBetween } from './invoice-editor-logic'

interface DueDateFieldProps {
  issuedAt: string
  dueAt: string
  /** A preset in days, 'custom' for a date picked by hand, null while nothing is chosen. */
  choice: number | 'custom' | null
  disabled?: boolean
  onPreset: (days: number) => void
  onCustom: () => void
  onDate: (day: string) => void
}

// Noon UTC so a date-only value never slides to the neighbouring day in the company's zone.
const written = (day: string) => formatDate(`${day}T12:00:00Z`)

export function DueDateField({ issuedAt, dueAt, choice, disabled, onPreset, onCustom, onDate }: DueDateFieldProps) {
  const days = dueAt && issuedAt ? daysBetween(issuedAt, dueAt) : null
  return (
    <div className="space-y-1.5">
      <Label id="due-label">{t('accounting:editor.due.label')}</Label>
      <div role="group" aria-labelledby="due-label" className="flex flex-wrap gap-1.5">
        {DUE_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-pressed={choice === preset}
            className={cn(choice === preset && 'bg-accent font-semibold')}
            onClick={() => onPreset(preset)}
          >
            {t('accounting:editor.due.presetDays', { count: preset })}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-pressed={choice === 'custom'}
          className={cn(choice === 'custom' && 'bg-accent font-semibold')}
          onClick={onCustom}
        >
          {t('accounting:editor.due.custom')}
        </Button>
      </div>
      {choice === 'custom' ? (
        <Field label={t('accounting:editor.due.customLabel')}>
          <Input type="date" value={dueAt} min={issuedAt} disabled={disabled} onChange={(e) => onDate(e.target.value)} />
        </Field>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {dueAt
          ? days !== null && days >= 0
            ? t('accounting:editor.due.summary', { days: t('accounting:editor.due.daysCount', { count: days }), date: written(dueAt) })
            : written(dueAt)
          : t('accounting:editor.due.none')}
      </p>
    </div>
  )
}
