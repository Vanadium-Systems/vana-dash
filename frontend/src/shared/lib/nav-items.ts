import { Activity, Archive, Bell, CalendarDays, Gavel, History, Landmark, LayoutDashboard, LineChart, Mail, MessageSquare, Receipt, Server, SlidersHorizontal, Sparkles, StickyNote, Users, Wallet, Grid3x3 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FeatureKey } from './types'

// Definiția canonică a navigației (Contractul F, sprint UI remake 2026-08-25) — o singură
// sursă citită de sidebar, de bottom nav-ul de mobil și de editorul din Setări. Ordinea +
// vizibilitatea curentă vin din dashboard_config['nav.layout'] ({to, visible}[]); fără
// config → ordinea de aici (comportamentul implicit).
//
// `feature` e poarta paginii (PLAN.md C2): fără ea, itemul dispare din nav, din Ctrl K și din
// bottom nav (§5.17 — ascunzi ce nu poate face niciodată omul în rolul lui). Lipsește doar pe
// paginile fără funcționalitate proprie (Azi și Echipă — vezi `features.ts`). Setările
// personale ale omului stau la `/me`, care nu are poartă: e contul lui, nu al firmei.

export const NAV_GROUP_ORDER = ['Azi', 'Bani', 'Lucru', 'Sistem'] as const
export type NavGroup = (typeof NAV_GROUP_ORDER)[number]

export interface NavItemDef {
  to: string
  label: string
  icon: LucideIcon
  group: NavGroup
  /** Funcționalitatea care deschide pagina; absent = pagină fără poartă. */
  feature?: FeatureKey
  /** Cuvinte în plus pentru Ctrl K (numele vechi ale paginii, sinonime). */
  keywords?: string[]
  /** Alte rute pe care itemul apare activ (Investiții = /crypto + /assets). */
  activeOn?: string[]
  /** Nu intră în bottom nav-ul de mobil, oricâte shortcut-uri ar avea. */
  noMobileShortcut?: boolean
}

// Sprint Remake v2 (DESIGN.md, Navigație): 16 destinații pe 4 grupuri, etichete în română.
// Rutele nu se schimbă (push-uri, APK, nav.layout salvat); Rapoarte, Plan, Wishlist și Acțiuni
// au ieșit din listă pentru că trăiesc acum ca tab-uri sau comutator în pagina gazdă.
export const NAV_ITEMS: NavItemDef[] = [
  { to: '/', label: 'Azi', icon: LayoutDashboard, group: 'Azi', keywords: ['overview', 'acasa'] },
  { to: '/assistant', label: 'Asistent', icon: Sparkles, group: 'Azi', feature: 'asistent.view', keywords: ['chat', 'ai'] },

  { to: '/accounting', label: 'Facturi', icon: Receipt, group: 'Bani', feature: 'facturi.view', keywords: ['accounting', 'contabilitate', 'efactura', 'anaf'] },
  { to: '/financials', label: 'Financiar', icon: Wallet, group: 'Bani', feature: 'financiar.view', keywords: ['financials', 'rapoarte', 'reports', 'profit'] },
  { to: '/reconciliation', label: 'Reconciliere', icon: Landmark, group: 'Bani', feature: 'reconciliere.view', keywords: ['banca', 'revolut', 'tranzactii'] },
  { to: '/pricing', label: 'Clienți', icon: Users, group: 'Bani', feature: 'clienti.view', keywords: ['pricing', 'prospectare', 'preturi'] },
  { to: '/tenders', label: 'Licitații', icon: Gavel, group: 'Bani', feature: 'licitatii.view', keywords: ['sicap', 'tenders'] },
  { to: '/crypto', label: 'Investiții', icon: LineChart, group: 'Bani', feature: 'investitii.view', keywords: ['crypto', 'actiuni', 'assets', 'bursa', 'bot'], activeOn: ['/crypto', '/assets'] },

  { to: '/email', label: 'Email', icon: Mail, group: 'Lucru', feature: 'email.view', keywords: ['mail', 'inbox'] },
  { to: '/messages', label: 'Mesaje', icon: MessageSquare, group: 'Lucru', feature: 'mesaje.view', keywords: ['chat', 'scrie', 'grup', 'direct'] },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, group: 'Lucru', feature: 'calendar.view', keywords: ['programari', 'evenimente'] },
  { to: '/archive', label: 'Arhivă', icon: Archive, group: 'Lucru', feature: 'arhiva.view', keywords: ['fisiere', 'documente'] },
  { to: '/notes', label: 'Notițe', icon: StickyNote, group: 'Lucru', feature: 'notite.view', keywords: ['plan', 'wishlist', 'obiective'] },

  { to: '/team', label: 'Echipă', icon: Users, group: 'Sistem', keywords: ['colegi', 'angajati', 'roluri'] },
  { to: '/modules', label: 'Module', icon: Grid3x3, group: 'Sistem', feature: 'echipa.administrare', keywords: ['acces', 'functionalitati', 'roluri'] },
  { to: '/team/history', label: 'Istoric', icon: History, group: 'Sistem', feature: 'echipa.istoric', keywords: ['audit', 'cine a facut ce'], noMobileShortcut: true },
  { to: '/alerts', label: 'Alerte', icon: Bell, group: 'Sistem', feature: 'alerte.view', keywords: ['alerts'] },
  { to: '/platforms', label: 'Platforme', icon: Server, group: 'Sistem', feature: 'platforme.view', keywords: ['platforms', 'vanagreen'] },
  { to: '/system-health', label: 'Server', icon: Activity, group: 'Sistem', feature: 'server.view', keywords: ['sanatate sistem', 'system health', 'cpu', 'disk'] },
  { to: '/settings', label: 'Setări', icon: SlidersHorizontal, group: 'Sistem', feature: 'setari.view', keywords: ['settings'] },
]

/** Shortcut-urile fixe din bottom nav-ul de mobil (Contractul H). De la 2026-10-01 Mesaje ia
 *  locul Arhivei (decizie Stefan) — `arhiva.view` e oprită pentru colegi până la push C, deci
 *  ar fi fost un shortcut care dă într-un ecran refuzat. */
export const MOBILE_BOTTOM_TOS = ['/', '/email', '/calendar', '/messages'] as const

export function findNavItem(to: string): NavItemDef | undefined {
  return NAV_ITEMS.find((item) => item.to === to)
}

/**
 * Îmbină definiția canonică cu config-ul salvat (`{to, visible}[]`):
 * - itemele prezente în config apar în ORDINEA lui, cu vizibilitatea lui;
 * - item nou în cod, fără intrare în config → append la final, vizibil;
 * - item necunoscut în config → ignorat;
 * - config null/absent → default canonic complet vizibil.
 */
export function resolveNavLayout(config: Array<{ to: string; visible: boolean }> | null | undefined): NavItemDef[] {
  if (!config || !Array.isArray(config)) return NAV_ITEMS
  const byTo = new Map(NAV_ITEMS.map((item) => [item.to, item]))
  const resolved: NavItemDef[] = []
  for (const entry of config) {
    const item = byTo.get(entry.to)
    if (!item) continue
    resolved.push(item)
    byTo.delete(item.to)
  }
  for (const item of NAV_ITEMS) {
    if (!resolved.includes(item)) resolved.push(item)
  }
  // Vizibilitatea se aplică la final — ordinea rămâne stabilă și pt. itemele ascunse
  // (editorul din Setări le arată pe toate, cu toggle).
  const visibility = new Map(config.map((entry) => [entry.to, entry.visible]))
  return resolved.filter((item) => visibility.get(item.to) ?? true)
}
