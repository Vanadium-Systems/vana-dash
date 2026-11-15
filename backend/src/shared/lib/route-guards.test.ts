import { describe, expect, it } from 'vitest'
import { declaredRouteKind, resolveFeatureKeys } from './features.js'

/**
 * What the colleague pages load on open, and the gate under which they load it.
 * A colleague (non-admin) holds only the page's view feature, so every load-time GET must be
 * declared `self` or resolve to exactly the gate. A failing row means a colleague would get 403.
 *
 * When a colleague page gets a new load-time query, add its row here.
 *
 * Row: [page, frontend file where the call is, METHOD, route as the frontend calls it (ids as :id), gate].
 * gate = the feature that makes the call happen: the page view gate, or the `enabled: can(...)` /
 * tab gate around it. `self` as gate = the call has no gate and must be declared `self`.
 */
type Row = [page: string, source: string, method: string, route: string, gate: string]

const ROWS: Row[] = [
  // Shell hooks, run on every page
  ['Shell', 'shared/hooks/use-me.ts:33', 'GET', '/api/auth/me', 'self'],
  ['Shell', 'shared/hooks/use-notifications.ts:27', 'GET', '/api/notifications', 'self'],
  ['Shell', 'shared/hooks/use-nav-layout.ts:21', 'GET', '/api/settings/nav-layout', 'self'],
  ['Shell', 'shared/hooks/use-analytics.ts:17', 'GET', '/api/analytics/client-config', 'self'],
  ['Shell', 'shared/hooks/use-active-alerts-count.ts:13', 'GET', '/api/alerts/active-count', 'alerte.view'],
  ['Shell', 'shared/hooks/use-email-unread-counts.ts:23', 'GET', '/api/email/unread-counts', 'email.view'],
  ['Shell', 'shared/hooks/use-task-badge.ts:10', 'GET', '/api/prospects/tasks/counts', 'clienti.view'],
  ['Shell', 'shared/hooks/use-chat.ts:22', 'GET', '/api/chat/conversations', 'mesaje.view'],
  ['Shell', 'shared/hooks/use-team.ts:30', 'GET', '/api/team/members', 'self'],

  // Profilul meu
  ['Profile', 'modules/auth/ProfilePage.tsx:50', 'GET', '/api/email/sender-options', 'email.view'],
  // Token section (under can('echipa.tokenuri')): own routes, never the Modules catalog.
  ['Profile', 'modules/auth/api-tokens.ts:30', 'GET', '/api/me/api-tokens', 'self'],
  ['Profile', 'modules/auth/ApiTokensCard.tsx:34', 'GET', '/api/me/api-tokens/features', 'self'],

  // Echipa (non-admin view)
  ['Team', 'shared/hooks/use-team.ts:30', 'GET', '/api/team/members', 'self'],
  ['Team', 'modules/team/TeamPage.tsx:144', 'GET', '/api/access/matrix', 'echipa.administrare'],

  // Mesaje
  ['Messages', 'shared/hooks/use-chat.ts:22', 'GET', '/api/chat/conversations', 'mesaje.view'],
  ['Messages', 'modules/messages/useThreadMessages.ts:81', 'GET', '/api/chat/conversations/:id/messages', 'mesaje.view'],

  // Notite / Plan / Wishlist
  ['Notes', 'modules/notes/notes-api.ts:32', 'GET', '/api/notes', 'notite.view'],
  ['Notes', 'modules/notes/NotesPage.tsx:81', 'GET', '/api/notes/labels', 'notite.view'],
  ['Plan', 'modules/plan/PlanPage.tsx:94', 'GET', '/api/plan', 'notite.view'],
  ['Wishlist', 'modules/wishlist/WishlistPage.tsx:111', 'GET', '/api/wishlist', 'notite.view'],

  // Calendar
  ['Calendar', 'modules/calendar/CalendarPage.tsx:158', 'GET', '/api/calendar/calendars', 'calendar.view'],
  ['Calendar', 'modules/calendar/CalendarPage.tsx:202', 'GET', '/api/calendar/events', 'calendar.view'],
  ['Calendar', 'modules/calendar/BookingPanel.tsx:47', 'GET', '/api/booking/blocks', 'calendar.programari'],
  ['Calendar', 'modules/calendar/BookingPanel.tsx:52', 'GET', '/api/booking/settings', 'calendar.programari'],
  ['Calendar', 'modules/calendar/BookingPanel.tsx:59', 'GET', '/api/booking/bookings', 'calendar.programari'],
  ['Calendar', 'modules/calendar/BookingPanel.tsx:90', 'GET', '/api/booking/preview', 'calendar.programari'],

  // Email inbox
  ['Email', 'modules/email/MailboxView.tsx:180', 'GET', '/api/email/threads', 'email.view'],
  ['Email', 'modules/email/MailboxView.tsx:135', 'GET', '/api/email/sender-options', 'email.view'],
  ['Email', 'modules/email/EmailSidebar.tsx:133', 'GET', '/api/email/labels', 'email.view'],
  ['Email', 'shared/hooks/use-email-unread-counts.ts:23', 'GET', '/api/email/unread-counts', 'email.view'],
  ['Email', 'modules/email/EmailSidebar.tsx:43', 'GET', '/api/email/send-quota', 'email.bulk'],

  // Clienti, Prospectare tab
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:16', 'GET', '/api/prospects/statuses', 'clienti.view'],
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:20', 'GET', '/api/prospects/assignees', 'clienti.view'],
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:24', 'GET', '/api/prospects/views', 'clienti.view'],
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:28', 'GET', '/api/prospects/lists', 'clienti.view'],
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:50', 'GET', '/api/prospects', 'clienti.view'],
  ['Prospects', 'modules/clients/prospects/use-prospect-data.ts:59', 'GET', '/api/prospects/count', 'clienti.view'],
  ['Prospects', 'modules/clients/lists/use-lists-data.ts:8', 'GET', '/api/prospects/list-folders', 'clienti.view'],

  // Fisa prospectului, always-on queries
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:20', 'GET', '/api/prospects/:id', 'clienti.view'],
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:30', 'GET', '/api/prospects/:id/neighbors', 'clienti.view'],
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:39', 'GET', '/api/prospects/:id/timeline', 'clienti.view'],
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:46', 'GET', '/api/prospects/:id/notes', 'clienti.view'],
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:50', 'GET', '/api/prospects/:id/tasks', 'clienti.view'],
  ['ProspectSheet', 'modules/clients/sheet/use-sheet.ts:62', 'GET', '/api/prospects/release-settings', 'clienti.view'],

  // Arhiva
  ['Archive', 'modules/archive/ArchivePage.tsx:167', 'GET', '/api/archive/spaces', 'arhiva.view'],
  ['Archive', 'modules/archive/ArchivePage.tsx:187', 'GET', '/api/archive/stars', 'arhiva.view'],
  ['Archive', 'modules/archive/ArchivePage.tsx:198', 'GET', '/api/archive/folders', 'arhiva.view'],
  ['Archive', 'modules/archive/ArchivePage.tsx:211', 'GET', '/api/archive/files', 'arhiva.view'],
  ['Archive', 'modules/archive/ArchiveHeader.tsx:29', 'GET', '/api/archive/storage', 'arhiva.view'],

  // Apeluri
  ['Calls', 'modules/calls/calls-api.ts:15', 'GET', '/api/calls', 'apeluri.view'],
]

// Real mismatches found in the frontend, not fixed here: each is reported and tracked separately.
const KNOWN_MISMATCHES: Row[] = []

describe('colleague pages: load-time queries pass the feature guard', () => {
  it.each(ROWS)('%s (%s): %s %s needs only %s', (_page, _source, method, route, gate) => {
    const kind = declaredRouteKind(method, route)
    if (kind === 'self') return
    expect(resolveFeatureKeys(method, route)).toEqual([gate])
  })

  it.each(KNOWN_MISMATCHES)('known mismatch %s (%s): %s %s', (_page, _source, method, route, gate) => {
    const kind = declaredRouteKind(method, route)
    if (kind === 'self') return
    expect(resolveFeatureKeys(method, route)).not.toEqual([gate])
  })

  it('profile does not load company email settings', () => {
    const profileRoutes = ROWS.filter(([page]) => page === 'Profile').map(([, , , route]) => route)
    expect(profileRoutes.length).toBeGreaterThan(0)
    expect(profileRoutes.some((route) => route.startsWith('/api/email/settings'))).toBe(false)
  })
})
