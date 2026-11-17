import { Check, ChevronDown, Search } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

// One list for the whole app (DESIGN.md): a button and a listbox of our own, because the native
// list is the browser's (huge on Android, no search, no "…"). A hidden native <select> stays in the
// DOM so the API did not change for the call sites: `name` and `required` work in a form,
// `onChange` still gets an event whose `target.value` is the picked value, and `<option>` children
// still work. Written by hand: there is no popover library in the repo, and Radix Select would not
// take <option> children, so all 130 call sites would have had to change.

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options?: SelectOption[]
  onValueChange?: (value: string) => void
  size?: 'sm' | 'md'
}

const MAX_LIST_HEIGHT = 320
const MIN_SPACE_BELOW = 200
const SEARCH_FROM = 8 // a search field above 7 options

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

// <option> children, also inside fragments and arrays, become the same shape as `options`.
function optionsFromChildren(children: React.ReactNode, out: SelectOption[] = []): SelectOption[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: unknown; disabled?: boolean }>(child)) return
    if (child.type === React.Fragment) {
      optionsFromChildren(child.props.children, out)
      return
    }
    if (child.type !== 'option') return
    const label = textOf(child.props.children)
    out.push({
      value: child.props.value === undefined ? label : String(child.props.value),
      label,
      disabled: child.props.disabled,
    })
  })
  return out
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

interface Placement {
  left: number
  width: number
  maxHeight: number
  top?: number
  bottom?: number
}

function placeUnder(trigger: HTMLElement): Placement {
  const rect = trigger.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - 8
  const above = rect.top - 8
  const width = Math.max(rect.width, 160)
  const left = Math.min(rect.left, window.innerWidth - width - 8)
  // Downwards; up only when there is less than 200px below and more room above.
  if (below < MIN_SPACE_BELOW && above > below) {
    return { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(MAX_LIST_HEIGHT, above) }
  }
  return { left, width, top: rect.bottom + 4, maxHeight: Math.min(MAX_LIST_HEIGHT, Math.max(below, 120)) }
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      options,
      onValueChange,
      onChange,
      size = 'md',
      children,
      value,
      defaultValue,
      disabled,
      id,
      name,
      required,
      form,
      autoFocus,
      onBlur,
      onFocus,
      title,
      ...rest
    },
    ref,
  ) => {
    const items = React.useMemo(() => [...(options ?? []), ...optionsFromChildren(children)], [options, children])
    const [inner, setInner] = React.useState<string>(
      defaultValue !== undefined ? String(defaultValue) : (items.find((o) => !o.disabled)?.value ?? ''),
    )
    const current = value !== undefined && value !== null ? String(value) : inner
    const selected = items.find((o) => o.value === current)

    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState('')
    const [active, setActive] = React.useState(-1)
    const [place, setPlace] = React.useState<Placement | null>(null)
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const nativeRef = React.useRef<HTMLSelectElement | null>(null)
    const listRef = React.useRef<HTMLDivElement>(null)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const typed = React.useRef({ text: '', at: 0 })
    const listId = React.useId()
    const withSearch = items.length >= SEARCH_FROM

    const visible = React.useMemo(() => {
      if (!query) return items
      const needle = fold(query)
      return items.filter((o) => fold(o.label).includes(needle))
    }, [items, query])

    // aria-* and data-* go on the button people see, not on the hidden select.
    const ariaProps = Object.fromEntries(
      Object.entries(rest).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-')),
    )

    const close = React.useCallback((refocus: boolean) => {
      setOpen(false)
      setQuery('')
      if (refocus) triggerRef.current?.focus()
    }, [])

    const pick = (option: SelectOption) => {
      if (option.disabled) return
      close(true)
      if (option.value === current) return
      if (value === undefined) setInner(option.value)
      const native = nativeRef.current
      if (native) {
        native.value = option.value
        onChange?.({ target: native, currentTarget: native } as React.ChangeEvent<HTMLSelectElement>)
      }
      onValueChange?.(option.value)
    }

    const openList = () => {
      if (disabled || !triggerRef.current) return
      setPlace(placeUnder(triggerRef.current))
      setActive(Math.max(0, items.findIndex((o) => o.value === current)))
      setOpen(true)
    }

    React.useEffect(() => {
      if (!open) return
      ;(withSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true })
      const onPointer = (event: PointerEvent) => {
        const target = event.target as Node
        if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return
        close(false)
      }
      // The list is fixed to the trigger: when the page scrolls under it, it closes instead of drifting.
      const onScroll = (event: Event) => {
        if (listRef.current?.contains(event.target as Node)) return
        close(false)
      }
      const onResize = () => close(false)
      document.addEventListener('pointerdown', onPointer, true)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)
      return () => {
        document.removeEventListener('pointerdown', onPointer, true)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
      }
    }, [open, withSearch, close])

    React.useEffect(() => {
      if (!open || active < 0) return
      listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
    }, [open, active])

    const move = (from: number, step: 1 | -1) => {
      if (visible.length === 0) return -1
      let next = from
      for (let i = 0; i < visible.length; i++) {
        next = (next + step + visible.length) % visible.length
        if (!visible[next]?.disabled) return next
      }
      return from
    }

    const typeAhead = (key: string) => {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + key.toLowerCase(), at: now }
      const needle = fold(typed.current.text)
      return visible.findIndex((o) => !o.disabled && fold(o.label).startsWith(needle))
    }

    const onListKey = (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setActive((i) => move(i, 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          setActive((i) => move(i < 0 ? 0 : i, -1))
          break
        case 'Home':
          if (withSearch) break
          event.preventDefault()
          setActive(move(-1, 1))
          break
        case 'End':
          if (withSearch) break
          event.preventDefault()
          setActive(move(visible.length, -1))
          break
        case 'Enter': {
          event.preventDefault()
          const option = visible[active]
          if (option) pick(option)
          break
        }
        case 'Escape':
          event.preventDefault()
          event.stopPropagation()
          close(true)
          break
        case 'Tab':
          close(false)
          break
        default:
          if (!withSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            const found = typeAhead(event.key)
            if (found >= 0) setActive(found)
          }
      }
    }

    const onTriggerKey = (event: React.KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
    }

    const activeId = active >= 0 && visible[active] ? `${listId}-${active}` : undefined

    return (
      <div className={cn('relative w-full min-w-0', className)}>
        <select
          ref={(node) => {
            nativeRef.current = node
            if (typeof ref === 'function') ref(node)
            else if (ref) ref.current = node
          }}
          name={name}
          required={required}
          form={form}
          disabled={disabled}
          value={current}
          onChange={() => undefined}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
        >
          {items.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          title={title ?? selected?.label}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={onTriggerKey}
          onBlur={onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
          onFocus={onFocus as unknown as React.FocusEventHandler<HTMLButtonElement>}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card pl-3 pr-2 text-left text-sm transition-[border-color,box-shadow] duration-fast ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive-text',
            size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md',
          )}
          {...ariaProps}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? ''}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
        {open &&
          place &&
          createPortal(
            <div
              ref={listRef}
              role="listbox"
              id={listId}
              tabIndex={-1}
              aria-activedescendant={withSearch ? undefined : activeId}
              onKeyDown={onListKey}
              style={{ left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight }}
              className="menu-pop glass fixed z-viewer flex flex-col overflow-hidden rounded-lg border shadow-float outline-none"
            >
              {withSearch && (
                <div className="flex shrink-0 items-center gap-2 border-b px-3">
                  <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setActive(0)
                    }}
                    onKeyDown={onListKey}
                    role="searchbox"
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    aria-label={t('common:select.search')}
                    placeholder={t('common:select.search')}
                    className="h-control-md w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {visible.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t('common:select.noMatch')}</p>}
                {visible.map((option, index) => {
                  const isSelected = option.value === current
                  return (
                    <div
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      title={option.label}
                      onPointerMove={() => setActive(index)}
                      onClick={() => pick(option)}
                      className={cn(
                        'mx-1 flex min-h-control-md cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm',
                        index === active && 'bg-accent',
                        isSelected && 'font-medium',
                        option.disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {isSelected && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
                    </div>
                  )
                })}
              </div>
            </div>,
            document.body,
          )}
      </div>
    )
  },
)
Select.displayName = 'Select'

export { Select }
