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

// One entry per page; the rest come in the `ux-prefetch` lot.
const PAGE_DATA: Record<string, PageQuery[]> = {
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
