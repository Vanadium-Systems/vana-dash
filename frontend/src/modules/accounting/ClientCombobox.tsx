import { useId, useState } from 'react'
import { Input } from '@/shared/components/ui/input'
import { t } from '@/shared/lib/i18n'
import type { InvoicingClient } from '@/shared/lib/types'
import { cn, normalizeForSearch } from '@/shared/lib/utils'

const MAX_SHOWN = 50

interface ClientComboboxProps {
  id?: string
  clients: InvoicingClient[]
  value: string
  disabled?: boolean
  invalid?: boolean
  /** Present only with facturi.clienti: adds the "+ Client nou" option. */
  onCreate?: (typedName: string) => void
  onChange: (client: InvoicingClient) => void
}

// A filtered list under the input, not <select>: the client list grows past what a native list can scan.
export function ClientCombobox({ id, clients, value, disabled, invalid, onCreate, onChange }: ClientComboboxProps) {
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const selected = clients.find((c) => c.id === value)

  const needle = normalizeForSearch(text.trim())
  const matches = clients
    .filter((c) => !needle || normalizeForSearch(`${c.name} ${c.cif}`).includes(needle))
    .slice(0, MAX_SHOWN)
  const options = [...matches.map((client) => ({ client })), ...(onCreate ? [{ client: null }] : [])]
  const shown = focused ? text : selected ? `${selected.name} (${selected.cif})` : ''

  function pick(index: number) {
    const option = options[index]
    if (!option) return
    if (option.client) onChange(option.client)
    else onCreate?.(text.trim())
    setText('')
    setFocused(false)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-expanded={focused}
        aria-controls={listId}
        placeholder={t('accounting:editor.client.search')}
        value={shown}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
        }}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          setText('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && focused) {
            e.preventDefault()
            pick(active)
          } else if (e.key === 'Escape') {
            setFocused(false)
            setText('')
          }
        }}
      />
      {focused ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('accounting:editor.client.listLabel')}
          // Keeps the input focused, so a click on an option is not eaten by the blur.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {matches.length === 0 ? <li className="px-3 py-1.5 text-sm text-muted-foreground">{t('accounting:editor.client.empty')}</li> : null}
          {options.map((option, i) => (
            <li key={option.client?.id ?? 'new'} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cn('block w-full truncate px-3 py-1.5 text-left text-sm', i === active ? 'bg-muted' : 'hover:bg-muted', !option.client && 'font-medium')}
                onClick={() => pick(i)}
              >
                {option.client ? (
                  <>
                    {option.client.name} <span className="text-muted-foreground">{option.client.cif}</span>
                  </>
                ) : text.trim() ? (
                  t('accounting:editor.client.newNamed', { name: text.trim() })
                ) : (
                  t('accounting:editor.client.new')
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
