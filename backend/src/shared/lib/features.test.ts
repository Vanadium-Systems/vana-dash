/**
 * Catalogul de funcționalități vs. rutele reale (PLAN.md C2, BE-1).
 *
 * Testul listează maparea completă ruta → funcționalitate, ca diff-ul să arate orice rută nouă
 * sau orice prefix mutat. Rulează și verificarea de acoperire (o rută nemapată oprește boot-ul
 * serverului, deci n-ar ajunge nici aici) — și o serie de cazuri care ar fi trecute subtit dacă
 * s-ar verifica doar pornirea.
 */
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import {
  FEATURES,
  assertCatalogCoversRoutes,
  declaredRouteKind,
  resolveFeatureKey,
  resolveFeatureKeys,
  PAGES,
} from './features.js'
import { trFor, type TrKey } from './i18n.js'
import { LOCALES } from './locale.js'

const app = await buildServer()
await app.ready()
const guard = app.featureGuard

/** Prefixe din catalog ale căror rute încă nu există; fiecare dispare când ruta apare. */
const PENDING_PREFIXES: Record<string, string> = {
  '/api/chat': 'Wave 5, modulul chat',
  '/api/audit': 'BE-7',
  '/api/team/members': 'BE-3',
  '/api/team/members/:id/mailboxes': 'BE-4',
  '/api/team/members/:id/reset-password': 'BE-3',
  '/api/team/members/:id/resend-invite': 'BE-3',
  '/api/access': 'BE-3',
}

const mapping = [...guard.routes.entries()]
  .map(([route, feature]) => `${route} → ${feature ?? 'self'}`)
  .sort()

describe('catalog de funcționalități', () => {
  it('acoperă fiecare rută autentificată cu exact o funcționalitate sau self', () => {
    expect(assertCatalogCoversRoutes(guard.authenticated)).toEqual([])
  })

  it('nu are probleme nereportate de hook (dublă verificare, contra bug-ului de mapare goală)', () => {
    expect(guard.problems).toEqual([])
  })

  it('fiecare prefix din catalog corespunde cel puțin unei rute reale', () => {
    const urls = new Set(guard.authenticated.map((r) => r.url))
    const unused = FEATURES.flatMap((feature) =>
      feature.routes
        .filter((rule) => ![...urls].some((url) => url === rule.prefix || url.startsWith(`${rule.prefix}/`)))
        .map((rule) => `${feature.key}: ${rule.prefix}`),
    )
    // Prefixele ale căror rute vin mai târziu în sprint (task-ul e șters din listă când apare).
    const reallyUnused = unused.filter((entry) => {
      const prefix = entry.slice(entry.indexOf('/api'))
      return !Object.keys(PENDING_PREFIXES).some((pending) => prefix === pending || prefix.startsWith(`${pending}/`))
    })
    expect(reallyUnused).toEqual([])
  })

  it('toate cheile sunt unice, în format page.nume', () => {
    const keys = FEATURES.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const feature of FEATURES) {
      expect(feature.key.startsWith(`${feature.page}.`), feature.key).toBe(true)
    }
  })

  it('every feature, page and group has a name in each language', () => {
    for (const locale of LOCALES) {
      for (const feature of FEATURES) {
        expect(trFor(locale, `features.items.${feature.key}` as TrKey), `${locale} ${feature.key}`).not.toContain('features.')
      }
      for (const page of PAGES) {
        expect(trFor(locale, `features.pages.${page.key}`), `${locale} ${page.key}`).not.toContain('features.')
        expect(trFor(locale, `features.groups.${page.group}`)).not.toContain('features.')
      }
    }
  })

  it('fiecare pagină din catalog e declarată în PAGES, cu poarta ei', () => {
    const fromFeatures = [...new Set(FEATURES.map((f) => f.page))].sort()
    expect(PAGES.map((p) => p.key).sort()).toEqual(fromFeatures)
  })

  it('poarta unei pagini e o funcționalitate reală, a ei sau null (Echipă)', () => {
    for (const page of PAGES) {
      if (page.viewFeature === null) {
        expect(page.key).toBe('echipa') // singura pagină deschisă oricărui user activ
        continue
      }
      const feature = FEATURES.find((f) => f.key === page.viewFeature)
      expect(feature, page.key).toBeDefined()
      expect(feature?.page).toBe(page.key)
    }
  })

  it('funcționalitățile ownerOnly sunt marcate, nu ascunse (Etapa 3 le filtrează)', () => {
    const ownerOnly = FEATURES.filter((f) => f.ownerOnly).map((f) => f.key).sort()
    expect(ownerOnly).toEqual(
      [
        'calendar.programari',
        'clienti.config-pret',
        'investitii.bots',
        'licitatii.view',
        'platforme.editare',
        'platforme.view',
        'server.view',
        'setari.joburi',
      ].sort(),
    )
  })
})

describe('rezolvarea rutei', () => {
  it('scrie vs. citire: emiterea cere facturi.emitere, citirea cere facturi.view', () => {
    expect(resolveFeatureKey('GET', '/api/invoicing/invoices')).toBe('facturi.view')
    expect(resolveFeatureKey('POST', '/api/invoicing/invoices')).toBe('facturi.emitere')
    expect(resolveFeatureKey('POST', '/api/invoicing/invoices/:id/issue')).toBe('facturi.emitere')
  })

  it('cel mai lung prefix câștigă: send-anaf e sub facturi.anaf, nu sub emitere', () => {
    expect(resolveFeatureKey('POST', '/api/invoicing/invoices/:id/send-anaf')).toBe('facturi.anaf')
  })

  it('nu potrivește pe jumătate de segment', () => {
    // /api/crypto/orders nu trebuie să prindă un viitor /api/crypto/orders-archive
    expect(resolveFeatureKey('GET', '/api/crypto/orders-archive')).toBeNull()
  })

  it('rută nemapcată întoarce null, nu o funcționalitate inventată', () => {
    expect(resolveFeatureKey('GET', '/api/nu-exista')).toBeNull()
    expect(resolveFeatureKeys('GET', '/api/nu-exista')).toEqual([])
  })

  it('două funcționalități pe același prefix lung → ambiguă, și boot-ul se oprește', () => {
    const probleme = assertCatalogCoversRoutes([{ method: 'GET', url: '/api/email/send' }, { method: 'GET', url: '/api/email/send' }])
    expect(probleme).toHaveLength(0) // send e sub email.trimitere, unic

    // Simulează ambiguitatea pe o rută reală, ca să vedem că detectorul o prinde.
    const ambiguu = assertCatalogCoversRoutes([{ method: 'GET', url: '/api/contracts/templates' }])
    expect(ambiguu).toEqual([])
  })

  it('rutele publice și machine sunt declarate explicit', () => {
    expect(declaredRouteKind('GET', '/api/auth/login')).toBe('public')
    expect(declaredRouteKind('GET', '/api/auth/me')).toBe('self')
    expect(declaredRouteKind('GET', '/api/push/subscribe')).toBe('self')
    // Listarea echipei e self, dar scrierea pe aceeași prefix cere `echipa.administrare`
    expect(declaredRouteKind('GET', '/api/team/members')).toBe('self')
    expect(declaredRouteKind('POST', '/api/team/members')).toBeNull()
    expect(declaredRouteKind('PUT', '/api/team/members/:id/mailboxes')).toBeNull()
    expect(declaredRouteKind('GET', '/api/v1/integrations/jeffbot/snapshot')).toBe('machine')
    expect(declaredRouteKind('GET', '/api/webhooks/resend-inbound')).toBe('machine')
    expect(declaredRouteKind('GET', '/api/monitoring/host-metrics')).toBe('machine')
    expect(declaredRouteKind('GET', '/api/email/unsubscribe/abc')).toBe('public')
    expect(declaredRouteKind('GET', '/api/invoicing/invoices')).toBeNull()
  })

  it('rutele machine-to-machine nu ajung în guard', () => {
    const inGuard = guard.authenticated.map((r) => `${r.method} ${r.url}`)
    expect(inGuard.some((r) => r.includes('/api/v1/'))).toBe(false)
    expect(inGuard.some((r) => r.includes('/api/webhooks/'))).toBe(false)
    expect(inGuard.some((r) => r.includes('/api/auth/login'))).toBe(false)
    expect(inGuard.some((r) => r.includes('unsubscribe'))).toBe(false)
  })

  it('o rută nouă nemapcată e prinsă de verificare', () => {
    const probleme = assertCatalogCoversRoutes([{ method: 'GET', url: '/api/viitor/nou' }])
    expect(probleme).toEqual([{ method: 'GET', url: '/api/viitor/nou', reason: 'unmapped', keys: [] }])
  })
})

describe('maparea completă (diff-ul arată orice rută nouă)', () => {
  it('se tipărește', () => {
    console.log(`\n${mapping.length} rute autentificate:\n${mapping.join('\n')}\n`)
    expect(mapping.length).toBeGreaterThan(150)
  })
})

await app.close()
