import * as React from 'react'
import { Input } from './input'
import { cn } from '@/shared/lib/utils'

// <input type="time"> ia formatul 12/24h din limba browserului, nu din atributul lang, deci pe un
// Chrome în engleză apare AM/PM oricum. Câmp text cu HH:MM, mereu 24h.

type TimeInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}

const VALID = /^([01]\d|2[0-3]):[0-5]\d$/

// "9" → 09:00, "930" → 09:30, "0930" / "9:30" / "9.30" → 09:30
export function normalizeTime(raw: string): string | null {
  const text = raw.trim()
  const separated = text.match(/^(\d{1,2})[:.](\d{0,2})$/)
  let hours: string
  let minutes: string
  if (separated) {
    hours = separated[1]!
    minutes = separated[2]!
  } else if (/^\d{1,4}$/.test(text)) {
    hours = text.length <= 2 ? text : text.slice(0, -2)
    minutes = text.length <= 2 ? '' : text.slice(-2)
  } else {
    return null
  }
  const value = `${hours.padStart(2, '0')}:${minutes.padEnd(2, '0')}`
  return VALID.test(value) ? value : null
}

export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ value, onChange, onBlur, className, ...props }, ref) => {
    const [draft, setDraft] = React.useState(value)
    React.useEffect(() => setDraft(value), [value])

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="HH:MM"
        className={cn('tnum font-mono', className)}
        value={draft}
        onChange={(e) => {
          let next = e.target.value.replace('.', ':').replace(/[^\d:]/g, '')
          if (/^\d{4}$/.test(next)) next = `${next.slice(0, 2)}:${next.slice(2)}`
          setDraft(next)
          if (VALID.test(next)) onChange(next)
        }}
        onBlur={(e) => {
          const normalized = normalizeTime(draft)
          if (normalized) {
            setDraft(normalized)
            if (normalized !== value) onChange(normalized)
          } else {
            setDraft(value)
          }
          onBlur?.(e)
        }}
        {...props}
      />
    )
  },
)
TimeInput.displayName = 'TimeInput'
