// Catalogul de funcționalități (PLAN.md C2) — sursa unică pentru guard-ul de pe rute, `/me`,
// nav-ul din frontend și pagina Module.
//
// De ce există: cu roluri și mai mulți oameni, „ce poate face omul ăsta" trebuie răspuns într-un
// singur loc, verificat pe server. Fiecare rută autentificată se rezolvă la EXACT o
// funcționalitate (cel mai lung prefix care se potrivește, pe metodă) sau e declarată `self`
// (a omului, nu a rolului), `public` sau `machine`. O rută care nu se rezolvă oprește pornirea
// serverului — deci o rută nouă nu poate scăpa de verificare fără să apară într-un test.
//
// În Etapa 1 există o singură firmă: `ownerOnly` marchează ce nu poate fi dat unei firme-client
// din Etapa 3 (SICAP, platformele, serverul, boții de trading, prețurile VanaGreen).

import { config } from '../config.js'
import { tr, type TrKey } from './i18n.js'

export const PAGE_KEYS = [
  'facturi',
  'financiar',
  'reconciliere',
  'clienti',
  'email',
  'calendar',
  'apeluri',
  'arhiva',
  'notite',
  'asistent',
  'investitii',
  'alerte',
  'setari',
  'echipa',
  'mesaje',
  'cautare',
  'licitatii',
  'platforme',
  'server',
] as const
export type PageKey = (typeof PAGE_KEYS)[number]

export interface RouteRule {
  /** Prefixul rutei, pe segmente: `/api/email/threads` acoperă și `/api/email/threads/:id`. */
  prefix: string
  /** `write` = doar POST/PATCH/PUT/DELETE, `read` = doar GET/HEAD. Absent = orice metodă. */
  methods?: 'read' | 'write'
}

export interface FeatureDef {
  key: string
  page: PageKey
  routes: RouteRule[]
  /** Nu poate fi dată niciodată altei firme (Etapa 3). */
  ownerOnly?: true
  /**
   * For a feature that belongs to an optional integration: false while the integration is not
   * configured. The feature then exists for nobody, the admin included, and the Modules page
   * does not list it.
   */
  available?: () => boolean
}

const all = (prefix: string): RouteRule[] => [{ prefix }]
const read = (prefix: string): RouteRule[] => [{ prefix, methods: 'read' }]
const write = (prefix: string): RouteRule[] => [{ prefix, methods: 'write' }]
/** Pagină fără funcționalități de scriere separate: cititul și scrisul cad sub aceeași cheie. */
const whole = (...prefixes: string[]): RouteRule[] => prefixes.flatMap((p) => all(p))

export const FEATURES: FeatureDef[] = [
  // ── Facturi ───────────────────────────────────────────────────────────────
  {
    key: 'facturi.view',
    page: 'facturi',
    routes: [...read('/api/accounting/records'), ...read('/api/invoicing/invoices')],
  },
  {
    key: 'facturi.emitere',
    page: 'facturi',
    routes: [...write('/api/accounting/records'), ...write('/api/invoicing/invoices'), ...all('/api/invoicing/exchange-rate')],
  },
  {
    key: 'facturi.anaf',
    page: 'facturi',
    routes: [...all('/api/accounting/anaf'), ...write('/api/invoicing/invoices/:id/send-anaf')],
  },
  {
    key: 'facturi.declaratii',
    page: 'facturi',
    routes: whole('/api/accounting/d301', '/api/accounting/d390', '/api/accounting/quarterly-package'),
  },
  {
    key: 'facturi.contracte',
    page: 'facturi',
    routes: whole('/api/contracts'),
  },
  {
    key: 'facturi.clienti',
    page: 'facturi',
    routes: whole('/api/invoicing/clients', '/api/invoicing/anaf-lookup'),
  },
  {
    key: 'facturi.cheltuieli',
    page: 'facturi',
    routes: whole('/api/accounting/recurring-expenses'),
  },
  {
    key: 'facturi.setari',
    page: 'facturi',
    routes: whole('/api/invoicing/sequence', '/api/invoicing/platforms'),
  },

  // ── Financiar ─────────────────────────────────────────────────────────────
  {
    // KPI-urile de pe Azi sunt date financiare, deci fără ele nici pagina, nici configurarea
    // cardurilor ei nu au ce arăta. `overview-config` e aici, nu la setări: nu e o setare de firmă.
    key: 'financiar.view',
    page: 'financiar',
    routes: whole(
      '/api/financials',
      '/api/metrics',
    ),
  },
  {
    key: 'financiar.rapoarte',
    page: 'financiar',
    routes: whole('/api/reports'),
  },

  // ── Reconciliere ──────────────────────────────────────────────────────────
  {
    key: 'reconciliere.view',
    page: 'reconciliere',
    routes: [
      ...read('/api/reconciliation/transactions'),
      ...all('/api/reconciliation/open-invoices'),
      ...all('/api/reconciliation/vanagreen-extension-log'),
      ...all('/api/reconciliation/vanagreen-tenants'),
    ],
  },
  {
    key: 'reconciliere.potrivire',
    page: 'reconciliere',
    routes: whole(
      '/api/reconciliation/transactions/:id/match',
      '/api/reconciliation/invoices/:id/mark-paid',
    ),
  },
  {
    key: 'reconciliere.conturi',
    page: 'reconciliere',
    routes: whole(
      '/api/reconciliation/accounts',
      '/api/reconciliation/providers',
      '/api/reconciliation/vanagreen-settings',
    ),
  },

  // ── Clienți ───────────────────────────────────────────────────────────────
  {
    key: 'clienti.view',
    page: 'clienti',
    routes: read('/api/prospects').concat(
      // Configul de prețuri e citit de toată pagina (nu doar de editor), de aceea read = view.
      read('/api/pricing/config'),
      read('/api/pricing/price-sheet'),
    ),
  },
  {
    key: 'clienti.prospectare',
    page: 'clienti',
    routes: [...write('/api/prospects'), ...all('/api/prospects/scoring-config')],
  },
  {
    key: 'clienti.calculator',
    page: 'clienti',
    routes: all('/api/pricing/calculate'),
  },
  {
    key: 'clienti.config-pret',
    page: 'clienti',
    ownerOnly: true,
    routes: [...write('/api/pricing/config'), ...all('/api/pricing/self-serve-toggle')],
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  {
    key: 'email.view',
    page: 'email',
    routes: [
      ...read('/api/email/threads'),
      ...all('/api/email/unread-counts'),
      ...read('/api/email/attachments'),
      ...read('/api/email/labels'),
      // Marcat citit, arhivat, etichetat, starred — acțiuni de inbox, nu trimitere.
      ...write('/api/email/messages/:id'),
      ...all('/api/email/messages/bulk-update'),
    ],
  },
  {
    key: 'email.trimitere',
    page: 'email',
    routes: whole(
      '/api/email/send',
      '/api/email/threads/:id/reply',
      '/api/email/messages/:id/forward',
      '/api/email/drafts',
      '/api/email/recent-addresses',
      '/api/email/images',
    ),
  },
  {
    key: 'email.bulk',
    page: 'email',
    routes: whole(
      '/api/email/bulk-send',
      '/api/email/sequences',
      '/api/email/sends',
      '/api/email/send-quota',
      '/api/email/platform-clients',
    ),
  },
  {
    key: 'email.sabloane',
    page: 'email',
    routes: whole('/api/email/templates'),
  },
  {
    key: 'email.setari',
    page: 'email',
    routes: [
      ...all('/api/email/settings'),
      ...all('/api/email/rules'),
      ...all('/api/email/blocklist'),
      ...all('/api/email/suppressions'),
      ...all('/api/email/suppressions-overview'),
      ...write('/api/email/labels'),
    ],
  },
  {
    key: 'email.cutii',
    page: 'email',
    routes: all('/api/team/members/:id/mailboxes'),
  },

  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    key: 'calendar.view',
    page: 'calendar',
    routes: [
      ...read('/api/calendar/events'),
      // Layer-ele de calendar (al meu + cele partajate) și share-urile puse de mine.
      ...read('/api/calendar/calendars'),
    ],
  },
  {
    key: 'calendar.editare',
    page: 'calendar',
    routes: [...write('/api/calendar/events'), ...write('/api/calendar/shares')],
  },
  {
    // Evenimente comune (cu participanți, care apar în calendarul fiecăruia) — oprită implicit,
    // ca orice funcționalitate nouă. Nu are rute proprii: poarta e chiar `calendar.editare`,
    // iar regula „participanți doar cu asta" e verificată în service, lângă scriere.
    key: 'calendar.comune',
    page: 'calendar',
    routes: [],
  },
  {
    // Vede toate calendarele. Fără rute proprii: lista de evenimente e aceeași rută, iar
    // funcționalitatea lărgește doar filtrul din service (`visibleCondition`).
    key: 'calendar.administrare',
    page: 'calendar',
    routes: [],
  },
  {
    key: 'calendar.programari',
    page: 'calendar',
    ownerOnly: true,
    routes: all('/api/booking'),
  },

  // ── Apeluri ───────────────────────────────────────────────────────────────
  {
    key: 'apeluri.view',
    page: 'apeluri',
    available: () => config.daily.apiKey !== '',
    routes: read('/api/calls'),
  },
  {
    key: 'apeluri.manage',
    page: 'apeluri',
    available: () => config.daily.apiKey !== '',
    routes: write('/api/calls'),
  },

  // ── Arhivă ────────────────────────────────────────────────────────────────
  {
    key: 'arhiva.view',
    page: 'arhiva',
    routes: [
      ...read('/api/archive/files'),
      ...read('/api/archive/folders'),
      ...read('/api/archive/search'),
      ...read('/api/archive/storage'),
      ...read('/api/archive/spaces'),
    ],
  },
  {
    key: 'arhiva.editare',
    page: 'arhiva',
    routes: [...write('/api/archive/files'), ...write('/api/archive/folders')],
  },
  {
    // Vede conținutul tuturor spațiilor și poate atribui folderele (decizie Stefan 2026-09-30).
    // Citirea efectivă e filtrată pe owner/share în service (access.ts), deci funcționalitatea
    // nu deschide singură nicio cale de citire — ea e poarta pentru atribuire. Prefixele sunt
    // cele două rute concrete, nu `/api/archive`: ruterul de mai sus (cel mai lung prefix) ar
    // captura POST `/api/archive/folders/:id/assign` pe `arhiva.editare`.
    key: 'arhiva.administrare',
    page: 'arhiva',
    routes: [...write('/api/archive/folders/:id/assign'), ...write('/api/archive/spaces/:ownerUserId/assign')],
  },

  // ── Notițe (personale, filtrate pe owner) ─────────────────────────────────
  {
    key: 'notite.view',
    page: 'notite',
    routes: whole('/api/notes', '/api/plan', '/api/wishlist'),
  },

  // ── Asistent ──────────────────────────────────────────────────────────────
  {
    key: 'asistent.view',
    page: 'asistent',
    routes: [
      ...all('/api/assistant/conversations'),
      ...all('/api/assistant/actions'),
      ...all('/api/assistant/scheduled'),
      ...read('/api/assistant/models'),
    ],
  },

  // ── Investiții ────────────────────────────────────────────────────────────
  {
    key: 'investitii.view',
    page: 'investitii',
    routes: [
      ...all('/api/crypto/markets'),
      ...all('/api/crypto/coin'),
      ...all('/api/crypto/search'),
      ...all('/api/crypto/watchlist'),
      ...read('/api/crypto/portfolio'),
      ...read('/api/crypto/trades'),
      ...all('/api/assets/search'),
      ...all('/api/assets/metals'),
      ...all('/api/assets/index-list'),
      ...all('/api/assets/detail'),
      ...all('/api/assets/watchlist'),
      ...read('/api/assets/portfolio'),
    ],
  },
  {
    key: 'investitii.ordine',
    page: 'investitii',
    routes: whole('/api/crypto/orders', '/api/assets/orders'),
  },
  {
    key: 'investitii.setari',
    page: 'investitii',
    routes: whole(
      '/api/crypto/settings',
      '/api/crypto/exchanges',
      '/api/assets/settings',
      '/api/assets/price-providers',
      '/api/assets/brokers',
    ),
  },
  {
    key: 'investitii.bots',
    page: 'investitii',
    ownerOnly: true,
    available: () => config.jeffbotIngestToken !== '',
    // Doar aici, nu și la `investitii.view`: ruterile se rezolvă la cel mai lung prefix, deci
    // `/api/jeffbot/*` ar câștiga întotdeauna `view` și comutatorul ar rămâne mort.
    routes: whole('/api/jeffbot'),
  },

  // ── Alerte ────────────────────────────────────────────────────────────────
  {
    key: 'alerte.view',
    page: 'alerte',
    routes: all('/api/alerts'),
  },
  {
    key: 'alerte.reguli',
    page: 'alerte',
    routes: all('/api/alert-rules'),
  },

  // ── Setări ────────────────────────────────────────────────────────────────
  {
    // Poarta paginii: cine nu o are nu vede Setări în nav. Secțiunile ei sunt cele de mai jos.
    key: 'setari.view',
    page: 'setari',
    routes: [],
  },
  {
    key: 'setari.firma',
    page: 'setari',
    routes: all('/api/settings/company-profile'),
  },
  {
    key: 'setari.asistent',
    page: 'setari',
    routes: all('/api/assistant/providers'),
  },
  {
    key: 'setari.joburi',
    page: 'setari',
    ownerOnly: true,
    routes: all('/api/settings/ops-jobs'),
  },

  // ── Echipă ────────────────────────────────────────────────────────────────
  {
    key: 'echipa.administrare',
    page: 'echipa',
    routes: [
      ...all('/api/access'),
      ...write('/api/team/members'),
      ...all('/api/team/members/:id/reset-password'),
      ...all('/api/team/members/:id/resend-invite'),
    ],
  },
  {
    key: 'echipa.istoric',
    page: 'echipa',
    routes: all('/api/audit'),
  },

  // ── Mesaje (Etapa 1, push B) ──────────────────────────────────────────────
  // Rutele /api/chat* apar împreună cu modulul chat, în Wave 5. Până atunci prefixul
  // rămâne neacoperit de nicio rută — și e exact ce trebuie: când modulul apare, testul
  // vede prefixul acoperit, fără altă schimbare.
  {
    key: 'mesaje.view',
    page: 'mesaje',
    routes: all('/api/chat'),
  },

  // ── Căutare (Ctrl K) ─────────────────────────────────────────────────────
  // Singura rută care taie mai multe pagini, deci are nevoie de o funcționalitate proprie: nu
  // poate fi atașată unei pagini fără să sune ambiguu în guard. Ce căută efectiv rămâne
  // filtrat pe funcționalitățile omului (modules/search/service.ts) — grupa fără funcționalitate
  // nu e interogată. Nu are item în nav: se deschide din Ctrl K.
  {
    key: 'cautare.view',
    page: 'cautare',
    routes: all('/api/search'),
  },

  // ── Doar Vanadium ─────────────────────────────────────────────────────────
  {
    key: 'licitatii.view',
    page: 'licitatii',
    ownerOnly: true,
    // Doar Vanadium: SICAP e o sursă publică de stat cu plafon strict (CLAUDE.md) — per firmă
    // s-ar înmulți request-urile și s-ar ajunge la blocarea IP-ului.
    routes: all('/api/tenders'),
  },
  {
    key: 'platforme.view',
    page: 'platforme',
    ownerOnly: true,
    routes: read('/api/platforms'),
  },
  {
    key: 'platforme.editare',
    page: 'platforme',
    ownerOnly: true,
    // Sync-ul unei platforme e tot o scriere (pleacă un connector în exterior).
    routes: write('/api/platforms'),
  },
  {
    key: 'server.view',
    page: 'server',
    ownerOnly: true,
    routes: read('/api/monitoring/health-signals'),
  },
]

export const FEATURE_KEYS = FEATURES.map((f) => f.key)

/** The catalog without the features of integrations this installation has not configured. */
export function availableFeatures(): FeatureDef[] {
  return FEATURES.filter((feature) => feature.available?.() ?? true)
}

// Pagina = ce apare în nav. `viewFeature` e poarta: cine nu o are nu vede pagina în nav, iar
// restul paginii (tab-uri, butoane) mai are nevoie de cheile lui. `null` = pagina e deschisă
// oricărui user activ — cazul Echipă, unde orice coleg trebuie să poată vedea cine e în echipă
// ca să îi scrie cuiva (GET /api/team/members e `self`).
export interface PageDef {
  key: PageKey
  group: 'today' | 'money' | 'work' | 'system'
  viewFeature: string | null
}

// Names shown to people are in locales/{ro,en}/features.json: `items.<feature key>`,
// `pages.<page key>`, `groups.<group>`. The helpers below read them in the request's language.

export function featureLabel(key: string): string {
  return tr(`features.items.${key}` as TrKey)
}

export function pageLabel(key: PageKey): string {
  return tr(`features.pages.${key}`)
}

export function pageGroupLabel(group: PageDef['group']): string {
  return tr(`features.groups.${group}`)
}

export const PAGES: PageDef[] = [
  { key: 'facturi', group: 'money', viewFeature: 'facturi.view' },
  { key: 'financiar', group: 'money', viewFeature: 'financiar.view' },
  { key: 'reconciliere', group: 'money', viewFeature: 'reconciliere.view' },
  { key: 'clienti', group: 'money', viewFeature: 'clienti.view' },
  { key: 'licitatii', group: 'money', viewFeature: 'licitatii.view' },
  { key: 'investitii', group: 'money', viewFeature: 'investitii.view' },
  { key: 'email', group: 'work', viewFeature: 'email.view' },
  { key: 'calendar', group: 'work', viewFeature: 'calendar.view' },
  { key: 'apeluri', group: 'work', viewFeature: 'apeluri.view' },
  { key: 'arhiva', group: 'work', viewFeature: 'arhiva.view' },
  { key: 'notite', group: 'work', viewFeature: 'notite.view' },
  { key: 'mesaje', group: 'work', viewFeature: 'mesaje.view' },
  { key: 'cautare', group: 'system', viewFeature: 'cautare.view' },
  { key: 'asistent', group: 'today', viewFeature: 'asistent.view' },
  { key: 'alerte', group: 'system', viewFeature: 'alerte.view' },
  { key: 'platforme', group: 'system', viewFeature: 'platforme.view' },
  { key: 'server', group: 'system', viewFeature: 'server.view' },
  { key: 'setari', group: 'system', viewFeature: 'setari.view' },
  { key: 'echipa', group: 'system', viewFeature: null },
]

const isReadMethod = (method: string) => method === 'GET' || method === 'HEAD'

function matchesPrefix(url: string, prefix: string): boolean {
  return url === prefix || url.startsWith(`${prefix}/`)
}

/**
 * Funcționalitatea unei rute sau `null` dacă nu e acoperită de catalog.
 * Cel mai lung prefix câștigă; la egalitate de lungime, două funcționalități diferite se
 * raportează ca ambele (ambiguu → boot-ul se oprește, vezi `assertCatalogCoversRoutes`).
 */
export function resolveFeatureKeys(method: string, url: string): string[] {
  const readOnly = isReadMethod(method)
  const hits: Array<{ key: string; length: number }> = []
  for (const feature of FEATURES) {
    for (const rule of feature.routes) {
      if (!matchesPrefix(url, rule.prefix)) continue
      if (rule.methods === 'write' && readOnly) continue
      if (rule.methods === 'read' && !readOnly) continue
      hits.push({ key: feature.key, length: rule.prefix.length })
    }
  }
  if (hits.length === 0) return []
  const longest = Math.max(...hits.map((h) => h.length))
  return [...new Set(hits.filter((h) => h.length === longest).map((h) => h.key))]
}

export function resolveFeatureKey(method: string, url: string): string | null {
  const keys = resolveFeatureKeys(method, url)
  return keys.length === 1 ? (keys[0] as string) : null
}

export interface RouteDescriptor {
  method: string
  url: string
  /** `self` = al omului, nu al rolului; `public`/`machine` = fără sesiune. */
  kind?: 'self' | 'public' | 'machine'
}

// Rutele care nu cer funcționalitate: `self` (al omului, nu al rolului), `public` sau
// `machine`. `methods` e necesar acolo unde același prefix apare în ambele feluri —
// `GET /api/team/members` e self (orice coleg vede cine e în echipă, ca să îi scrie), dar
// `POST /api/team/members` cere `echipa.administrare`. Fără metodă, prefixul cel mai lung
// (self) ar măști regula de mai jos și POST-ul ar trece oricum.
const KNOWN_PREFIXES: Array<{
  prefix: string
  kind: 'self' | 'public' | 'machine'
  methods?: 'read' | 'write'
}> = [
  { prefix: '/health', kind: 'public' },
  { prefix: '/api/auth/login', kind: 'public' },
  { prefix: '/api/auth/locale', kind: 'public' },
  { prefix: '/api/auth/forgot-password', kind: 'public' },
  { prefix: '/api/auth/reset-password', kind: 'public' },
  { prefix: '/api/auth/accept-invite', kind: 'public' },
  { prefix: '/api/auth/logout', kind: 'self' },
  { prefix: '/api/auth/me', kind: 'self' },
  { prefix: '/api/push', kind: 'self' },
  { prefix: '/api/settings/nav-layout', kind: 'self' },
  { prefix: '/api/team/members', kind: 'self', methods: 'read' },
  // Suportul e al oricărui om activ. `/api/platform/*` cere contul de platformă în rută
  // (`platformOnly`), nu o funcționalitate de rol.
  { prefix: '/api/support', kind: 'self' },
  { prefix: '/api/platform/support', kind: 'self' },
  { prefix: '/api/email/unsubscribe', kind: 'public' },
  { prefix: '/api/email-images', kind: 'public' },
  // The page a call guest opens: no account, rate limited, answers only the time window.
  { prefix: '/api/public/calls', kind: 'public' },
  // The logo sits in an <img> of emails read by people with no session. Uploading it is not public.
  { prefix: '/api/email/settings/logo', kind: 'public', methods: 'read' },
  { prefix: '/api/webhooks', kind: 'machine' },
  { prefix: '/api/v1', kind: 'machine' },
  { prefix: '/api/monitoring/host-metrics', kind: 'machine' },
]

/** Felul unei rute, dacă e declarată explicit (self / public / machine). */
export function declaredRouteKind(method: string, url: string): 'self' | 'public' | 'machine' | null {
  const readOnly = isReadMethod(method)
  const matches = KNOWN_PREFIXES.filter((entry) => {
    if (!matchesPrefix(url, entry.prefix)) return false
    if (entry.methods === 'write' && readOnly) return false
    if (entry.methods === 'read' && !readOnly) return false
    return true
  }).sort((a, b) => b.prefix.length - a.prefix.length)
  return matches[0]?.kind ?? null
}

export interface CatalogProblem {
  method: string
  url: string
  /** `open` = registered without `authenticate` and not declared `public` / `machine`. */
  reason: 'unmapped' | 'ambiguous' | 'open'
  keys: string[]
}

/**
 * A route registered without `authenticate` answers anyone. It has to say so in
 * `KNOWN_PREFIXES`; otherwise a forgotten `preHandler` would publish a route silently, since
 * the catalog check above only ever sees the authenticated ones.
 */
export function assertOpenRoutesAreDeclared(routes: RouteDescriptor[]): CatalogProblem[] {
  return routes
    .filter((route) => {
      const kind = declaredRouteKind(route.method, route.url)
      return kind !== 'public' && kind !== 'machine'
    })
    .map((route) => ({ method: route.method, url: route.url, reason: 'open' as const, keys: [] }))
}

/**
 * Verifică acoperirea catalogului: fiecare rută autentificată trebuie să se rezolve la exact o
 * funcționalitate sau să fie declarată `self`. Rutele `public`/`machine` nu intră în guard.
 * Rulat la pornire (serverul nu pornește cu o listă nevidă) și în test, ca lista completă să
 * apară în diff la orice rută nouă.
 */
export function assertCatalogCoversRoutes(routes: RouteDescriptor[]): CatalogProblem[] {
  const problems: CatalogProblem[] = []
  for (const route of routes) {
    if (declaredRouteKind(route.method, route.url)) continue
    const keys = resolveFeatureKeys(route.method, route.url)
    if (keys.length === 0) problems.push({ method: route.method, url: route.url, reason: 'unmapped', keys: [] })
    else if (keys.length > 1)
      problems.push({ method: route.method, url: route.url, reason: 'ambiguous', keys: keys.sort() })
  }
  return problems
}
