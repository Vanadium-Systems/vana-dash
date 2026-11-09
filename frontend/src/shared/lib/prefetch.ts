import type { QueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { FeatureKey } from './types'

// Hovering or focusing a nav item loads that page's code and its first data, so the click finds
// both ready (MV2). Each data entry repeats the page's own `queryKey` + `queryFn`, and carries the
// feature its route needs: a colleague without it must not see a 403 for a page they don't have.

type PageQuery = { feature: FeatureKey; queryKey: readonly unknown[]; queryFn: () => Promise<unknown>; staleTime?: number }

const pageCode = new Map<string, () => Promise<unknown>>()

/** App.tsx registers each lazy page's loader under its path, so the nav does not import pages. */
export function registerPageCode(path: string, load: () => Promise<unknown>) {
  pageCode.set(path, load)
}

// One entry per page: the first query of its default view.
const PAGE_DATA: Record<string, PageQuery[]> = {
  '/settings': [
    { feature: 'setari.firma', queryKey: ['settings', 'company-profile'], queryFn: () => api.get('/api/settings/company-profile') },
  ],
  '/system-health': [
    { feature: 'server.view', queryKey: ['monitoring', 'health-signals', '7d'], queryFn: () => api.get('/api/monitoring/health-signals?range=7d') },
  ],
  '/platforms': [{ feature: 'platforme.view', queryKey: ['platforms'], queryFn: () => api.get('/api/platforms') }],
  '/alerts': [{ feature: 'alerte.view', queryKey: ['alerts', 'active'], queryFn: () => api.get('/api/alerts?status=active') }],
  '/modules': [{ feature: 'echipa.administrare', queryKey: ['access', 'matrix'], queryFn: () => api.get('/api/access/matrix') }],
  '/team/history': [
    {
      feature: 'echipa.istoric',
      queryKey: ['audit', { actorId: '', entityType: '', before: null }],
      queryFn: () => api.get('/api/audit?limit=50'),
    },
  ],
  '/notes': [{ feature: 'notite.view', queryKey: ['notes', 'list', 'active', '', '', ''], queryFn: () => api.get('/api/notes?view=active') }],
  '/archive': [
    { feature: 'arhiva.view', queryKey: ['archive', 'folders', null, 'recent'], queryFn: () => api.get('/api/archive/folders?sort=recent') },
  ],
  '/calls': [{ feature: 'apeluri.view', queryKey: ['calls', 'all'], queryFn: () => api.get('/api/calls?status=all') }],
  '/crypto': [
    {
      feature: 'investitii.view',
      queryKey: ['crypto', 'markets', 1, 'all', 25],
      queryFn: () => api.get('/api/crypto/markets?page=1&category=all&limit=25'),
      staleTime: 60_000,
    },
  ],
  '/tenders': [
    {
      feature: 'licitatii.view',
      queryKey: ['tenders', { sourceFilter: 'all', onlyPriority: false, search: '', showArchived: false }],
      queryFn: () => api.get('/api/tenders'),
    },
  ],
  '/pricing': [
    { feature: 'clienti.view', queryKey: ['prospects', { search: '', showArchived: false }], queryFn: () => api.get('/api/prospects?') },
  ],
  '/reconciliation': [
    { feature: 'reconciliere.conturi', queryKey: ['bank-accounts'], queryFn: () => api.get('/api/reconciliation/accounts') },
  ],
  '/financials': [
    { feature: 'financiar.view', queryKey: ['financials', 'pnl', '30d'], queryFn: () => api.getWithMoney('/api/financials/pnl?period=30d') },
  ],
  '/accounting': [
    { feature: 'facturi.view', queryKey: ['accounting', 'records', 'out'], queryFn: () => api.get('/api/accounting/records?direction=out') },
  ],
  '/assistant': [
    { feature: 'asistent.view', queryKey: ['assistant', 'conversations'], queryFn: () => api.get('/api/assistant/conversations') },
  ],
  '/': [{ feature: 'notite.view', queryKey: ['notes', 'pinned'], queryFn: () => api.get('/api/notes?pinned=true') }],
  '/email': [{ feature: 'email.view', queryKey: ['email', 'labels'], queryFn: () => api.get('/api/email/labels') }],
  '/calendar': [
    { feature: 'calendar.view', queryKey: ['calendar', 'calendars'], queryFn: () => api.get('/api/calendar/calendars'), staleTime: 60_000 },
  ],
}

const started = new Set<string>()

export function prefetchPage(path: string, queryClient: QueryClient, can: (feature: FeatureKey) => boolean) {
  if (!started.has(path)) {
    started.add(path)
    // A failed chunk load is retried by the real navigation, so here it only frees the path.
    pageCode.get(path)?.().catch(() => started.delete(path))
  }
  for (const query of PAGE_DATA[path] ?? []) {
    if (!can(query.feature)) continue
    void queryClient.prefetchQuery({ queryKey: query.queryKey, queryFn: query.queryFn, staleTime: query.staleTime ?? 30_000 })
  }
}
