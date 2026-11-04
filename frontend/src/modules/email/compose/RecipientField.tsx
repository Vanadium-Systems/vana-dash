import { X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

const fold = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const EMAIL_RE = /^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/

export function isValidAddress(value: string): boolean {
  return EMAIL_RE.test(value)
}

/** Splits pasted or typed text into addresses; "Name <a@b.ro>" keeps the address. */
export function parseAddresses(text: string): string[] {
  // Commas and semicolons separate entries; inside one, a display name may hold spaces, so
  // spaces split only entries without "<…>".
  return text.split(/[,;]+/).flatMap((entry) => {
    const bracketed = /<([^>]+)>/.exec(entry)?.[1]
    if (bracketed) return [bracketed.trim()]
    return entry.split(/\s+/).map((part) => part.trim()).filter(Boolean)
  })
}

// To and Cc as chips (E18): comma, semicolon, space or Enter closes a chip, Backspace on an empty
// input removes the last one, ↑↓ Enter pick a suggestion. An invalid address stays as a red chip
// with its reason, so the person sees what to fix instead of losing what they typed.
export function RecipientField({
  id,
  label,
  value,
  onChange,
  suggestions,
  max = 10,
  autoFocus,
  trailing,
  problemFor,
}: {
  id: string
  label: string
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  max?: number
  autoFocus?: boolean
  trailing?: React.ReactNode
  /** Why a well-formed address still cannot receive (unsubscribed); null when it can. */
  problemFor?: (address: string) => string | null
}) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const matches = useMemo(() => {
    const term = fold(text.trim())
    const chosen = new Set(value.map((v) => v.toLowerCase()))
    return suggestions.filter((s) => !chosen.has(s.toLowerCase()) && (!term || fold(s).includes(term))).slice(0, 6)
  }, [suggestions, text, value])

  const commit = (raw: string) => {
    const added = parseAddresses(raw).filter((a) => !value.some((v) => v.toLowerCase() === a.toLowerCase()))
    if (added.length) onChange([...value, ...added].slice(0, max))
    setText('')
    setActive(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const open = focused && matches.length > 0
    if (open && e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (open && e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      if (open && text.trim() === '' && matches[active]) {
        e.preventDefault()
        commit(matches[active] as string)
      } else if (text.trim()) {
        e.preventDefault()
        commit(open && matches[active] && !isValidAddress(text.trim()) ? (matches[active] as string) : text)
      }
    } else if (e.key === ',' || e.key === ';' || e.key === ' ') {
      if (text.trim()) {
        e.preventDefault()
        commit(text)
      }
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="relative flex min-h-9 items-start gap-2 border-b py-1">
      <label htmlFor={id} className="w-10 shrink-0 pt-1.5 text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {value.map((address, i) => {
          const problem = isValidAddress(address) ? (problemFor?.(address) ?? null) : t('email:compose.invalidAddress', { address })
          return (
            <span
              key={`${address}-${i}`}
              title={problem ?? address}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-sm',
                problem ? 'bg-destructive/15 text-destructive' : 'bg-muted',
              )}
            >
              <span className="truncate">{address}</span>
              <button
                type="button"
                className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                aria-label={t('email:compose.removeRecipient', { address })}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(value.filter((_, idx) => idx !== i))
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          id={id}
          autoFocus={autoFocus}
          autoComplete="off"
          inputMode="email"
          role="combobox"
          aria-expanded={focused && matches.length > 0}
          aria-controls={listId}
          className="h-7 min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          value={text}
          onChange={(e) => {
            const next = e.target.value
            // A paste with separators becomes chips at once.
            if (/[,;\s]/.test(next) && parseAddresses(next).length > 1) commit(next)
            else {
              setText(next)
              setActive(0)
            }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (text.trim()) commit(text)
          }}
        />
      </div>
      {trailing}
      {focused && matches.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-12 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {matches.map((address, i) => (
            <li key={address} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cn('block w-full truncate px-3 py-1.5 text-left text-sm', i === active ? 'bg-muted' : 'hover:bg-muted')}
                onClick={() => commit(address)}
              >
                {address}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
