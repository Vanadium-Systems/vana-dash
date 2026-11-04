import { useQuery } from '@tanstack/react-query'
import { Mail, Plus, Search, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Highlight } from '@/shared/components/Highlight'
import { DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenu, ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { formatListDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailSearchSuggestions } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { senderName } from './ThreadRow'

const PERIODS = [7, 30, 90, 365] as const

export interface MailFilters {
  from: string
  unread: boolean
  attachment: boolean
  starred: boolean
  days: number | null
}

/** The chips under the search, kept in the URL with the search itself (E23, E25). */
export function useMailFilters() {
  const [from, setFrom] = useUrlState('from')
  const [unread, setUnread] = useUrlState('unread')
  const [attachment, setAttachment] = useUrlState('att')
  const [starred, setStarred] = useUrlState('star')
  const [days, setDays] = useUrlState('days')
  const filters: MailFilters = {
    from,
    unread: unread === '1',
    attachment: attachment === '1',
    starred: starred === '1',
    days: PERIODS.includes(Number(days) as (typeof PERIODS)[number]) ? Number(days) : null,
  }
  const active = Boolean(filters.from || filters.unread || filters.attachment || filters.starred || filters.days)
  const clear = () => {
    setFrom('')
    setUnread('')
    setAttachment('')
    setStarred('')
    setDays('')
  }
  return {
    filters,
    active,
    clear,
    setFrom,
    setUnread: (on: boolean) => setUnread(on ? '1' : ''),
    setAttachment: (on: boolean) => setAttachment(on ? '1' : ''),
    setStarred: (on: boolean) => setStarred(on ? '1' : ''),
    setDays: (value: number | null) => setDays(value ? String(value) : ''),
  }
}

export type MailFiltersState = ReturnType<typeof useMailFilters>

/** Query-string params for /api/email/threads from the chips. */
export function filterParams(filters: MailFilters, now = new Date()): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.from) params.from = filters.from
  if (filters.unread) params.unread = 'true'
  if (filters.attachment) params.hasAttachment = 'true'
  if (filters.starred) params.isStarred = 'true'
  if (filters.days) params.after = new Date(now.getTime() - filters.days * 86_400_000).toISOString()
  return params
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs">
      <span className="truncate">{label}</span>
      <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={t('email:filters.remove', { label })} onClick={onRemove}>
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

export function MailSearch({
  query,
  onQuery,
  state,
  onOpenThread,
  inputRef,
}: {
  query: string
  onQuery: (value: string) => void
  state: MailFiltersState
  onOpenThread: (threadId: string) => void
  inputRef?: React.RefObject<HTMLInputElement>
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const term = useDebounced(query.trim(), 200)

  // E22: five addresses and five threads while typing; Enter keeps the search on the list.
  const suggest = useQuery({
    queryKey: ['email', 'suggest', term],
    queryFn: () => api.get<EmailSearchSuggestions>(`/api/email/search/suggest?q=${encodeURIComponent(term)}`),
    enabled: open && term.length >= 2,
    staleTime: 30_000,
  })
  const addresses = suggest.data?.addresses ?? []
  const threads = suggest.data?.threads ?? []
  const options = [...addresses.map((a) => ({ kind: 'address' as const, value: a })), ...threads.map((th) => ({ kind: 'thread' as const, value: th.id }))]
  const showList = open && term.length >= 2 && options.length > 0

  const pick = (index: number) => {
    const option = options[index]
    if (!option) return
    setOpen(false)
    if (option.kind === 'address') {
      // Picking a person is "from:", as in Gmail: the chip filters, the box is free again.
      state.setFrom(option.value)
      onQuery('')
    } else onOpenThread(option.value)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && showList) {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (showList && active >= 0) {
        e.preventDefault()
        pick(active)
      } else setOpen(false)
    } else if (e.key === 'Escape') {
      if (showList) {
        e.stopPropagation()
        setOpen(false)
      } else if (query) onQuery('')
      else ref.current?.blur()
    }
  }

  const { filters } = state
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={ref}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-label={t('email:list.searchAria')}
          placeholder={t('email:list.searchPlaceholder')}
          className="h-control-md w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {showList ? (
          <ul id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()} className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover py-1 shadow-md">
            {addresses.map((address, i) => (
              <li key={`a-${address}`} role="option" aria-selected={active === i}>
                <button type="button" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', active === i ? 'bg-muted' : 'hover:bg-muted')} onClick={() => pick(i)}>
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    <Highlight text={address} query={term} />
                  </span>
                </button>
              </li>
            ))}
            {threads.map((thread, j) => {
              const i = addresses.length + j
              return (
                <li key={`t-${thread.id}`} role="option" aria-selected={active === i}>
                  <button type="button" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', active === i ? 'bg-muted' : 'hover:bg-muted')} onClick={() => pick(i)}>
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      <Highlight text={thread.subject || t('email:labels.noSubject')} query={term} />
                      <span className="text-muted-foreground"> · {senderName(thread.fromAddress)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatListDate(thread.lastMessageAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.from ? <Chip label={t('email:filters.fromChip', { address: filters.from })} onRemove={() => state.setFrom('')} /> : null}
        {filters.unread ? <Chip label={t('email:filters.unread')} onRemove={() => state.setUnread(false)} /> : null}
        {filters.attachment ? <Chip label={t('email:filters.attachment')} onRemove={() => state.setAttachment(false)} /> : null}
        {filters.starred ? <Chip label={t('email:filters.starred')} onRemove={() => state.setStarred(false)} /> : null}
        {filters.days ? <Chip label={t('email:filters.periodChip', { count: filters.days })} onRemove={() => state.setDays(null)} /> : null}
        <ResponsiveMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="h-3 w-3" aria-hidden="true" /> {t('email:filters.add')}
          </DropdownMenuTrigger>
          <ResponsiveMenuContent title={t('email:filters.add')} align="start">
            {filters.unread ? null : <DropdownMenuItem onClick={() => state.setUnread(true)}>{t('email:filters.unread')}</DropdownMenuItem>}
            {filters.attachment ? null : <DropdownMenuItem onClick={() => state.setAttachment(true)}>{t('email:filters.attachment')}</DropdownMenuItem>}
            {filters.starred ? null : <DropdownMenuItem onClick={() => state.setStarred(true)}>{t('email:filters.starred')}</DropdownMenuItem>}
            {PERIODS.map((days) => (
              <DropdownMenuItem key={days} onClick={() => state.setDays(days)}>
                {t('email:filters.periodChip', { count: days })}
              </DropdownMenuItem>
            ))}
            {filters.from ? null : (
              <DropdownMenuItem
                onClick={() => {
                  ref.current?.focus()
                  setOpen(true)
                }}
              >
                {t('email:filters.fromHint')}
              </DropdownMenuItem>
            )}
          </ResponsiveMenuContent>
        </ResponsiveMenu>
      </div>
    </div>
  )
}
