// Source of truth for the home widgets the backend accepts. The frontend registry lists the
// same ids, sizes and features; a test compares the two.

export const WIDGET_SIZES = ['s', 'w', 'l', 'band'] as const // s=1×1, w=2×1, l=2×2, band=4×1
export type WidgetSize = (typeof WIDGET_SIZES)[number]

export interface HomeLayoutItem {
  widget: string
  size: WidgetSize
  order: number
  options?: Record<string, unknown>
}

// Not yet: the bank balance (no source of balances in the database or the bank connector) and
// the daily brief (no endpoint). They join when their data does.
export const WIDGETS: Record<string, { feature: string | null; sizes: WidgetSize[] }> = {
  collected: { feature: 'financiar.view', sizes: ['w', 'l'] },
  revenue: { feature: 'financiar.view', sizes: ['w', 'l', 'band'] },
  receivable: { feature: 'facturi.view', sizes: ['s', 'w'] },
  expenses_by_category: { feature: 'financiar.view', sizes: ['w', 'l'] },
  plan_next: { feature: 'notite.view', sizes: ['s', 'w'] },
  today: { feature: 'calendar.view', sizes: ['w', 'l'] },
  my_tasks: { feature: 'clienti.view', sizes: ['s', 'w', 'l'] },
  to_resolve: { feature: 'alerte.view', sizes: ['w', 'l'] },
  deadlines: { feature: 'facturi.view', sizes: ['s', 'w'] },
  unread_messages: { feature: 'mesaje.view', sizes: ['s', 'w'] },
  email: { feature: 'email.view', sizes: ['w', 'l'] },
  pinned_note: { feature: 'notite.view', sizes: ['s', 'l'] },
  quick_note: { feature: 'notite.view', sizes: ['w'] },
  suggested_leads: { feature: 'clienti.view', sizes: ['w', 'l'] },
  funnel: { feature: 'clienti.view', sizes: ['w', 'l'] },
  platform_status: { feature: 'platforme.view', sizes: ['s', 'w'] },
  year_grid: { feature: 'financiar.view', sizes: ['band'] },
  new_tenders: { feature: 'licitatii.view', sizes: ['w'] },
}

// "Collected" is not here: the band of figures under the window already leads with it.
export const DEFAULT_COMPANY_LAYOUT: HomeLayoutItem[] = [
  { widget: 'today', size: 'w', order: 0 },
  { widget: 'to_resolve', size: 'w', order: 1 },
  { widget: 'my_tasks', size: 'w', order: 2 },
  { widget: 'unread_messages', size: 's', order: 3 },
  { widget: 'deadlines', size: 's', order: 4 },
  { widget: 'email', size: 'w', order: 5 },
  { widget: 'revenue', size: 'band', order: 6 },
]
