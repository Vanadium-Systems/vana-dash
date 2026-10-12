import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarOff, CalendarPlus, FilePlus2, Gift, LineChart, Mail, Rocket, Search, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { NAV_ITEMS, navGroupLabel } from '@/shared/lib/nav-items'
import type { FeatureKey } from '@/shared/lib/types'
import { normalizeForSearch } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

// Ctrl K (DESIGN.md): fără animație la deschidere, pentru că pornește din tastatură de zeci de
// ori pe zi. Paginile vin din NAV_ITEMS, mai însă filtrate pe funcționalități — un item
// ascuns aici s-ar deschide într-un 403. Căutarea în date merge pe server (`/api/search`,
// BE-9): acolo e filtrul pe funcționalități și pe cutiile de email ale omului, deci niciun
// rezultat nu poate veni pe o rută necubată.

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

// Pagini care nu mai au item propriu în meniu (tab-uri sau comutator în pagina gazdă).
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

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const PALETTE_SHORTCUT = isMac ? '⌘K' : 'Ctrl K'

function paletteFilter(value: string, search: string, keywords?: string[]) {
  const needle = normalizeForSearch(search.trim())
  if (!needle) return 1
  const haystack = normalizeForSearch([value, ...(keywords ?? [])].join(' '))
  if (haystack.startsWith(needle)) return 1
  return haystack.includes(needle) ? 0.5 : 0
}

const GROUP_CLASS = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground'

const ITEM_CLASS =
  'flex h-control-md cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 text-sm text-muted-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { can } = useMe()
  const [search, setSearch] = useState('')
  const term = search.trim()
  const debouncedTerm = useDebounced(term, 250)

  // Sub 2 caractere serverul nu caută nimic (`/api/search` cere minimum 2), deci nici
  // interogăm — cu un prefix scurt ar întreba trei tabele pentru orice.
  const results = useQuery({
    queryKey: ['search', debouncedTerm],
    queryFn: () => api.get<SearchGroup[]>(`/api/search?q=${encodeURIComponent(debouncedTerm)}`),
    enabled: open && debouncedTerm.length >= 2,
    staleTime: 30_000,
  })

  const go = (to: string) => {
    onOpenChange(false)
    setSearch('')
    navigate(to)
  }

  const pages = NAV_ITEMS.filter((item) => can(item.feature))
  const subPages = SUB_PAGES.filter((page) => can(page.feature))
  const actions = ACTIONS.filter((action) => can(action.feature))
  const groups = (results.data ?? []).filter((group) => can(group.feature))
  const searching = term.length >= 2
  // Cât timp răspunde serverul, arătăm doar starea de căutare, nu paginile: o listă care
  // se schimbă sub cursorul omului e mai derutantă decât o așteptare scurtă.
  const waiting = searching && (results.isPending || debouncedTerm !== term)

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setSearch('')
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top,0px))] z-50 overflow-hidden rounded-lg border bg-surface-overlay text-popover-foreground md:left-1/2 md:right-auto md:top-[15vh] md:w-full md:max-w-lg md:-translate-x-1/2"
        >
          <DialogPrimitive.Title className="sr-only">{t('common:palette.title')}</DialogPrimitive.Title>
          <Command filter={paletteFilter} loop>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={t('common:palette.placeholder')}
                className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
              />
            </div>
            <Command.List className="max-h-[min(60dvh,24rem)] overflow-y-auto overscroll-contain p-1">
              {!searching || waiting ? (
                <>
                  {actions.length > 0 ? (
                    <Command.Group heading={t('common:labels.actions')} className={GROUP_CLASS}>
                      {actions.map((action) => (
                        <Command.Item key={action.id} value={action.label} keywords={action.keywords} onSelect={() => go(action.to)} className={ITEM_CLASS}>
                          <action.icon className="h-4 w-4" aria-hidden="true" />
                          {action.label}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}

                  <Command.Group heading={t('common:palette.pages')} className={GROUP_CLASS}>
                    {pages.map((item) => (
                      <Command.Item key={item.to} value={item.label} keywords={item.keywords} onSelect={() => go(item.to)} className={ITEM_CLASS}>
                        <item.icon className="h-4 w-4" aria-hidden="true" />
                        {item.label}
                        <span className="ml-auto text-xs text-muted-foreground">{navGroupLabel(item.group)}</span>
                      </Command.Item>
                    ))}
                    {subPages.map((page) => (
                      <Command.Item key={page.to} value={page.label} keywords={page.keywords} onSelect={() => go(page.to)} className={ITEM_CLASS}>
                        <page.icon className="h-4 w-4" aria-hidden="true" />
                        {page.label}
                        <span className="ml-auto text-xs text-muted-foreground">{page.parent}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              ) : null}

              {searching && !waiting ? (
                groups.length > 0 ? (
                  groups.map((group) => (
                    <Command.Group key={group.group} heading={group.group} className={GROUP_CLASS}>
                      {group.items.map((item) => (
                        <Command.Item key={item.id} value={`${group.group} ${item.label} ${item.sublabel ?? ''}`} onSelect={() => go(item.to)} className={ITEM_CLASS}>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.sublabel ? <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{item.sublabel}</span> : null}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {results.isError
                      ? t('common:palette.searchFailed')
                      : t('common:palette.nothingFor', { term })}
                  </p>
                )
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
