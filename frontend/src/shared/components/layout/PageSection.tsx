import type { ReactNode } from 'react'
import { NavLink, useLocation, useSearchParams, Navigate } from 'react-router-dom'
import { PageSectionContext } from '@/shared/components/PageHeader'
import { useMe } from '@/shared/hooks/use-me'
import type { FeatureKey } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'

// Gazdele paginilor contopite (DESIGN.md, Navigație). Modulele rămân separate: App.tsx le dă
// elementele de pagină, aici se alege doar ce se vede și cum arată comutatorul.

const TAB_CLASS = 'inline-flex h-control-md items-center border-b-2 px-3 text-sm'

interface SectionTab {
  key: string
  label: string
  element: ReactNode
  /** Funcționalitatea tabului: fără ea, tabul nu există pentru omul ăsta (PLAN.md C2). */
  feature?: FeatureKey
}

/** Tab-uri în URL (`?tab=`); primul e implicit și nu apare în URL. */
export function TabbedSection({ title, tabs }: { title: string; tabs: SectionTab[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { can } = useMe()
  const visible = tabs.filter((tab) => can(tab.feature))
  // Omul a venit pe un tab pe care nu-l are: îl trimitem pe primul pe care îl are, nu pe
  // un ecran gol cu un titlu fără conținut.
  const current = visible.find((t) => t.key === searchParams.get('tab')) ?? visible[0]
  if (!current) return null

  const nav =
    visible.length > 1 ? (
      <div role="tablist" aria-label={title} className="flex gap-1 border-b">
        {visible.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === current.key}
            className={cn(TAB_CLASS, tab.key === current.key ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            // Parametrii paginii vechi (scope, perioadă) nu au sens în tab-ul nou.
            onClick={() => setSearchParams(tab.key === visible[0]!.key ? {} : { tab: tab.key })}
          >
            {tab.label}
          </button>
        ))}
      </div>
    ) : null

  return <PageSectionContext.Provider value={{ title, nav }}>{current.element}</PageSectionContext.Provider>
}

/** Comutator între rute înrudite (Investiții: Crypto / Acțiuni), fiecare cu URL-ul și tab-urile ei. */
export function LinkedSection({ title, links, children }: { title: string; links: Array<{ to: string; label: string }>; children: ReactNode }) {
  const nav = (
    <nav aria-label={title} className="inline-flex rounded-md border p-0.5">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) =>
            cn('inline-flex h-control-sm items-center rounded-sm px-3 text-sm', isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground')
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
  return <PageSectionContext.Provider value={{ title, nav }}>{children}</PageSectionContext.Provider>
}

/** Rută veche → tab-ul ei nou, cu restul query-ului păstrat (link-uri din push, istoric, APK). */
export function RedirectToTab({ to, tab }: { to: string; tab: string }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  // Wishlist își ținea filtrul în `tab`; acum stă în `tip`.
  const oldTab = params.get('tab')
  if (oldTab) {
    params.delete('tab')
    if (tab === 'wishlist') params.set('tip', oldTab)
  }
  params.set('tab', tab)
  return <Navigate to={`${to}?${params.toString()}`} replace />
}
