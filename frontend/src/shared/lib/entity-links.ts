import type { RefType } from './types'

// The one place that knows where each shareable object opens. Ctrl K, the cards in Mesaje and a
// link pasted into the composer all go through it, so a page that moves changes only here.

export interface LinkExtra {
  /** Calendar: the event's day (YYYY-MM-DD). Archive: the file's folder. Invoice: `emise` / `primite`. */
  date?: string
  folderId?: string
  tab?: 'emise' | 'primite'
}

export function linkFor(type: RefType, id: string, extra: LinkExtra = {}): string {
  switch (type) {
    case 'prospect':
      return `/pricing?prospect=${id}`
    case 'invoice':
      return `/accounting?tab=${extra.tab ?? 'emise'}&record=${id}`
    case 'email_thread':
      return `/email?thread=${id}`
    case 'calendar_event':
      return `/calendar?${extra.date ? `date=${extra.date}&` : ''}event=${id}`
    case 'archive_file':
      return `/archive?${extra.folderId ? `folder=${extra.folderId}&` : ''}file=${id}`
    case 'note':
      return `/notes?note=${id}`
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PARAM_BY_PATH: Record<string, [RefType, string]> = {
  '/pricing': ['prospect', 'prospect'],
  '/accounting': ['invoice', 'record'],
  '/email': ['email_thread', 'thread'],
  '/calendar': ['calendar_event', 'event'],
  '/archive': ['archive_file', 'file'],
  '/notes': ['note', 'note'],
}

/** A link to this app (absolute on the same origin, or a path) back to the object it opens. */
export function parseDashLink(raw: string): { type: RefType; id: string } | null {
  let url: URL
  try {
    url = new URL(raw.trim(), window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const entry = PARAM_BY_PATH[url.pathname.replace(/\/+$/, '')]
  if (!entry) return null
  const id = url.searchParams.get(entry[1])
  return id && UUID.test(id) ? { type: entry[0], id } : null
}
