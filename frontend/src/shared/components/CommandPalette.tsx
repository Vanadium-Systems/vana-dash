import { useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarOff, CalendarPlus, FilePlus2, Gift, LineChart, Mail, Rocket, Search, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Highlight } from '@/shared/components/Highlight'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { NAV_ITEMS, navGroupLabel, canOpenNavItem } from '@/shared/lib/nav-items'
import { useRegisteredPageActions } from '@/shared/lib/page-actions'
import type { FeatureKey } from '@/shared/lib/types'
import { normalizeForSearch } from '@/shared/lib/utils'

// Ctrl K (DESIGN.md): no opening animation because it is triggered from the keyboard dozens of
// times a day. Pages come from NAV_ITEMS filtered by features; data search goes through `/api/search`.

interface PaletteAction {
  id: string
  label: string
  icon: LucideIcon
  to: string
  feature?: FeatureKey
  keywords?: string[]
}

const ACTIONS: PaletteAction[] = [
  { id: 'invoice', label: t('common:palette.newInvoice'), icon: FilePlus2, to: '/accounting?tab=emise&new=1', feature: 'facturi.emitere', keywords: ['emite', 'factura', 'new invoice', 'factura noua'] },
  { id: 'event', label: t('common:palette.newEvent'), icon: CalendarPlus, to: '/calendar?new=1', feature: 'calendar.editare', keywords: ['calendar', 'intalnire', 'meeting', 'new event', 'eveniment nou'] },
  { id: 'note', label: t('common:palette.newNote'), icon: StickyNote, to: '/notes?new=1', feature: 'notite.view', keywords: ['notita', 'new note', 'notita noua'] },
  { id: 'compose', label: t('common:palette.composeEmail'), icon: Mail, to: '/email?compose=1', feature: 'email.trimitere', keywords: ['mail', 'trimite', 'compose', 'scrie un email', 'write an email'] },
  { id: 'block', label: t('common:palette.blockBookingSlot'), icon: CalendarOff, to: '/calendar?block=1', feature: 'calendar.programari', keywords: ['programari', 'ocupat', 'site', 'bookings', 'busy', 'block'] },
]

const SUB_PAGES: Array<{ to: string; label: string; icon: LucideIcon; parent: string; feature?: FeatureKey; keywords?: string[] }> = [
  { to: '/financials?tab=rapoarte', label: t('common:nav.reports'), icon: BarChart3, parent: 'Financiar', feature: 'financiar.rapoarte', keywords: ['rapoarte', 'reports'] },
  { to: '/notes?tab=plan', label: t('common:nav.plan'), icon: Rocket, parent: t('common:nav.notes'), feature: 'notite.view', keywords: ['obiective', 'goals'] },
  { to: '/notes?tab=wishlist', label: t('common:nav.wishlist'), icon: Gift, parent: t('common:nav.notes'), feature: 'notite.view', keywords: ['dorinte', 'wishes'] },
  { to: '/assets', label: t('common:nav.stocks'), icon: LineChart, parent: t('common:nav.investments'), feature: 'investitii.view', keywords: ['actiuni', 'stocks', 'assets', 'bursa', 'trading212'] },
]

interface SearchItem {
  id: string
  label: string
  sublabel: string | null
  to: string
}

interface SearchGroup {
  group: string
  feature: string
  items: SearchItem[]
}

interface PaletteEntry {
  key: string
  group: string
  onSelect: () => void
  content: ReactNode
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K'

function paletteScore(value: string, search: string, keywords?: string[]): number {
  const needle = normalizeForSearch(search.trim())
  if (!needle) return 1
  const haystack = normalizeForSearch([value, ...(keywords ?? [])].join(' '))
  if (haystack.startsWith(needle)) return 1
  return haystack.includes(needle) ? 0.5 : 0
}

const ITEM_CLASS =
  'flex h-control-md cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 text-sm text-muted-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { can } = useMe()
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const term = search.trim()
  const debouncedTerm = useDebounced(term, 250)

  const canSearch = can('cautare.view')
  const results = useQuery({
    queryKey: ['search', debouncedTerm],
    queryFn: () => api.get<SearchGroup[]>(`/api/search?q=${encodeURIComponent(debouncedTerm)}`),
    enabled: open && canSearch && debouncedTerm.length >= 2,
    staleTime: 30_000,
  })

  const close = () => {
    onOpenChange(false)
    setSearch('')
    setActiveIndex(0)
  }

  const go = (to: string) => {
    close()
    navigate(to)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal()
        else dialog.setAttribute('open', '')
      }
      inputRef.current?.focus()
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  const pages = NAV_ITEMS.filter((item) => canOpenNavItem(item, can))
  const subPages = SUB_PAGES.filter((page) => can(page.feature))
  const actions = ACTIONS.filter((action) => can(action.feature))
  const pageActions = useRegisteredPageActions().filter((action) => can(action.feature))
  const groups = (results.data ?? []).filter((group) => can(group.feature))
  const searching = canSearch && term.length >= 2
  const waiting = searching && (results.isPending || debouncedTerm !== term)

  const entries = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = []

    const pushIfMatches = (label: string, keywords: string[] | undefined, entry: PaletteEntry) => {
      if (paletteScore(label, term, keywords) > 0) list.push(entry)
    }

    for (const action of pageActions) {
      pushIfMatches(action.label, undefined, {
        key: `pa:${action.id}`,
        group: t('common:palette.thisPage'),
        onSelect: () => {
          close()
          action.run()
        },
        content: (
          <>
            {action.icon ? <action.icon className="h-4 w-4" aria-hidden="true" /> : null}
            {action.label}
          </>
        ),
      })
    }

    if (!searching || waiting) {
      for (const action of actions) {
        pushIfMatches(action.label, action.keywords, {
          key: `act:${action.id}`,
          group: t('common:labels.actions'),
          onSelect: () => go(action.to),
          content: (
            <>
              <action.icon className="h-4 w-4" aria-hidden="true" />
              {action.label}
            </>
          ),
        })
      }

      for (const item of pages) {
        pushIfMatches(item.label, item.keywords, {
          key: `page:${item.to}`,
          group: t('common:palette.pages'),
          onSelect: () => go(item.to),
          content: (
            <>
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.label}
              <span className="ml-auto text-xs text-muted-foreground">{navGroupLabel(item.group)}</span>
            </>
          ),
        })
      }

      for (const page of subPages) {
        pushIfMatches(page.label, page.keywords, {
          key: `sub:${page.to}`,
          group: t('common:palette.pages'),
          onSelect: () => go(page.to),
          content: (
            <>
              <page.icon className="h-4 w-4" aria-hidden="true" />
              {page.label}
              <span className="ml-auto text-xs text-muted-foreground">{page.parent}</span>
            </>
          ),
        })
      }
    }

    if (searching && !waiting) {
      for (const group of groups) {
        for (const item of group.items) {
          list.push({
            key: `srv:${group.group}:${item.id}`,
            group: group.group,
            onSelect: () => go(item.to),
            content: (
              <>
                <span className="min-w-0 flex-1 truncate">
                  <Highlight text={item.label} query={term} />
                </span>
                {item.sublabel ? <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{item.sublabel}</span> : null}
              </>
            ),
          })
        }
      }
    }

    return list
  }, [pageActions, searching, waiting, actions, pages, subPages, groups, term])

  const clampedIndex = entries.length > 0 ? Math.min(activeIndex, entries.length - 1) : 0

  useEffect(() => {
    setActiveIndex(0)
  }, [term])

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    activeEl?.scrollIntoView?.({ block: 'nearest' })
  }, [clampedIndex, entries.length])

  const grouped = useMemo(() => {
    const map = new Map<string, Array<PaletteEntry & { index: number }>>()
    entries.forEach((entry, index) => {
      const arr = map.get(entry.group) ?? []
      arr.push({ ...entry, index })
      map.set(entry.group, arr)
    })
    return [...map.entries()]
  }, [entries])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (entries.length > 0) setActiveIndex((i) => (i + 1) % entries.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (entries.length > 0) setActiveIndex((i) => (i - 1 + entries.length) % entries.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      entries[clampedIndex]?.onSelect()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={t('common:palette.title')}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close()
      }}
      onKeyDown={handleKeyDown}
      className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top,0px))] z-50 m-0 w-[calc(100%-1rem)] max-w-none overflow-hidden rounded-lg border bg-surface-overlay p-0 text-popover-foreground backdrop:bg-black/50 md:left-1/2 md:right-auto md:top-[15vh] md:w-full md:max-w-lg md:-translate-x-1/2"
    >
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={entries[clampedIndex] ? `${listId}-opt-${clampedIndex}` : undefined}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common:palette.placeholder')}
          className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>
      <div ref={listRef} id={listId} role="listbox" className="max-h-[min(60dvh,24rem)] overflow-y-auto overscroll-contain p-1">
        {grouped.map(([groupName, groupItems]) => (
          <div key={groupName} role="group" aria-label={groupName}>
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{groupName}</div>
            {groupItems.map((item) => {
              const isSelected = item.index === clampedIndex
              return (
                <div
                  key={item.key}
                  id={`${listId}-opt-${item.index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(item.index)}
                  onClick={item.onSelect}
                  className={ITEM_CLASS}
                >
                  {item.content}
                </div>
              )
            })}
          </div>
        ))}

        {searching && !waiting && groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {results.isError ? t('common:palette.searchFailed') : t('common:palette.nothingFor', { term })}
          </p>
        ) : null}
      </div>
    </dialog>
  )
}
