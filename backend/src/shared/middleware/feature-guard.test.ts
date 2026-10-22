/**
 * Guard-ul de funcționalități, verificat pe fiecare rută a lui (PLAN.md C2, QA-1).
 *
 * `features.test.ts` dovedește că fiecare rută e *mapată*; testul de aici dovedește că mapa
 * e *corectă*: pentru fiecare funcționalitate din catalog, o rută a ei răspunde 403 cu
 * `FEATURE_FORBIDDEN` când omul nu o are, și trece de guard când o are. O funcționalitate
 * uitată în catalog sau o rută mapată la cheia greșită se vede aici, nu într-un test de
 * regresie pe o pagină.
 *
 * Cele două laturi nu se pot verifica identic: pe o rută de citire trimitem cererea reală
 * (parametrii de cale sunt id-uri aleatorii, deci 404, și corpul lipsește, deci validarea
 * răspunde 400 înainte de handler). Pe o rută de scriere trimitem tot corpul gol, cu
 * `authenticate` în `preValidation` — deci răspunsul e 400 de la validare, fără să scriem
 * nimic, și tot așa dovedește că omul a trecut de guard (401/403 ar însemna refuz).
 *
 * Ce nu tragem aici: `mesaje.view` (modulul chat vine în Wave 5) și `setari.view` (e poarta
 * paginii Setări, fără rute proprii). `investitii.bots` are rute de acum — testul o ar fi
 * trecut oricum abia după repararea umbririi din features.ts, deci e tot în lista de mai jos.
 */
import argon2 from 'argon2'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import Fastify from 'fastify'
import fp from 'fastify-plugin'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { archiveFolders, roles, users } from '../../shared/db/schema/index.js'
import { FEATURES, FEATURE_KEYS, PAGES, resolveFeatureKeys } from '../lib/features.js'
import { featureGuardPlugin } from './feature-guard.js'

const app = await buildServer()
await app.ready()
const guard = app.featureGuard

/** Fără rute proprii, pentru că nu pot fi verificate pe HTTP (doar porți de pagină). */
// `calendar.comune` și `calendar.administrare` lărgesc ce face service-ul pe rutele lui
// `calendar.view` / `calendar.editare` (participanți, toate calendarele), fără rute proprii.
const WITHOUT_ROUTES = new Set(['setari.view', 'calendar.comune', 'calendar.administrare'])

/**
 * Rute care ar ieși în exterior cu parametrii plini, deci niciun request la ele în test.
 * `investitii.view` ar lua primul GET din hartă (`/api/crypto/markets` → CoinGecko) — îi
 * alegem unul care citește doar din DB.
 */
const PREFERRED: Record<string, string> = {
  'investitii.view': 'GET /api/crypto/portfolio',
  // `GET /api/chat/stream` e prima rută a funcționalității, dar ține răspunsul deschis cât
  // timp socketul e viu — prin `inject` ar bloca testul. Lista se închide și e suficientă.
  'mesaje.view': 'GET /api/chat/conversations',
}

/** Rutele fiecărei funcționalități, din harta guard-ului, în ordinea în care se înregistrează. */
function routesOf(key: string): string[] {
  return [...guard.routes.entries()].filter(([, feature]) => feature === key).map(([route]) => route)
}

/** `'/api/x/:id'` → `'/api/x/00000000-0000-00…'`, ca un request să nu atingă rânduri reale. */
const withFakeIds = (url: string) => url.replace(/:[A-Za-z]+\b/g, '00000000-0000-4000-8000-000000000000')

const sent = (token: string, method: string, url: string) =>
  app.inject({ method: method as 'GET', url, cookies: { vana_session: token } })

const passwordHash = await argon2.hash('parola-de-test-123')
const createdUsers: string[] = []
const createdRoles: string[] = []

/** Un om cu exact funcționalitățile cerute (poarta paginii inclusă), ca să nu moară pe altă poartă. */
async function userWith(features: string[]) {
  const roleName = `QA guard: ${features.join('+') || 'gol'}`
  let roleId = (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName)))[0]?.id
  if (!roleId) {
    const [role] = await db
      .insert(roles)
      .values({ name: roleName, kind: 'custom', features: [...features].sort() })
      .returning()
    roleId = role!.id
    createdRoles.push(roleId)
  }
  const [row] = await db
    .insert(users)
    .values({ email: `qa-guard-${features.join('-') || 'gol'}-${createdUsers.length}@test.local`, passwordHash, displayName: 'QA guard' })
    .returning()
  await db.update(users).set({ roleId }).where(eq(users.id, row!.id))
  createdUsers.push(row!.id)
  return await app.jwt.sign({ sub: row!.id, sv: 1 })
}

/** 400 de la validare e tot „a trecut de guard"; 500 ar însemna ceva rupt în handler. */
const passedGuard = (statusCode: number) => statusCode !== 401 && statusCode !== 403 && statusCode < 500

const featuresWithRoutes = FEATURE_KEYS.filter((key) => routesOf(key).length > 0)

/** Oamenii se creează în testele lor (un `describe` nu poate `await`), dar nu de două ori. */
const tokens = new Map<string, string>()
const tokenFor = async (features: string[]) => {
  const id = [...features].sort().join('+') || 'gol'
  const existing = tokens.get(id)
  if (existing) return existing
  const token = await userWith(features)
  tokens.set(id, token)
  return token
}

beforeAll(() => {
  // Fiecare funcționalitate trebuie să aibă măcar o rută reală, exceptând cele declarate
  // mai sus — altfel ar rămâne un switch mort în pagina Module, nemai prins de niciun test.
  for (const key of FEATURE_KEYS) {
    if (routesOf(key).length === 0) {
      expect(WITHOUT_ROUTES.has(key), `${key} nu are rută și nici e în WITHOUT_ROUTES`).toBe(true)
    } else {
      expect(WITHOUT_ROUTES.has(key), `${key} are rute, dar e în WITHOUT_ROUTES`).toBe(false)
    }
  }
})

afterAll(async () => {
  // GET /api/archive/spaces creează rădăcina spațiului omului, iar FK-ul ei e `restrict`.
  if (createdUsers.length) await db.delete(archiveFolders).where(inArray(archiveFolders.ownerUserId, createdUsers))
  for (const id of createdUsers) await db.delete(users).where(eq(users.id, id))
  if (createdRoles.length) await db.delete(roles).where(and(inArray(roles.id, createdRoles), isNull(roles.deletedAt)))
  await app.close()
})

describe('acoperirea catalogului prin rute reale', () => {
  it('fiecare funcționalitate cu rute e atinsă de test, și fiecare rută e la o singură cheie', () => {
    // Fiecare rută mapată aparține unei funcționalități din catalog și e acoperită de o
    // intrare a testului — o funcționalitate nouă adăugată în catalog nu poate scăpa.
    for (const key of FEATURE_KEYS) {
      if (routesOf(key).length > 0) expect(featuresWithRoutes).toContain(key)
    }
    const mapped = [...guard.routes.values()].filter((f): f is string => f !== null)
    expect([...new Set(mapped)].sort()).toEqual([...featuresWithRoutes].sort())
  })

  it('singura funcționalitate fără rute este poarta unei pagini', () => {
    const faraRute = FEATURE_KEYS.filter((key) => routesOf(key).length === 0).sort()
    expect(faraRute).toEqual([...WITHOUT_ROUTES].sort())
    // `setari.view` e poarta paginii, nu o cheie fără efect: o pagină fără `.view` nu
    // deschide nicio cheie a ei (session.effectiveFeatures).
    expect(PAGES.find((p) => p.key === 'setari')?.viewFeature).toBe('setari.view')
  })

  it('niciun prefix al unei funcționalități nu e umbrit de alt funcționalitate', () => {
    // Investițiile au `investitii.view` (toate piețele) și `investitii.bots` (doar jeffbot).
    // Dacă rutele botului ar rămâne sub `view`, comutatorul „Boți de trading" ar fi mort: cine
    // îl pornește tot nu primește nimic, pentru că prefixul mai lung al celeilalte câștigă.
    // Verificăm per prefix, nu per funcționalitate — ca un prefix uitat în urmă să se vadă.
    for (const feature of FEATURES) {
      if (WITHOUT_ROUTES.has(feature.key)) continue
      for (const rule of feature.routes) {
        const covered = guard.authenticated.filter(({ method, url }) => {
          if (url !== rule.prefix && !url.startsWith(`${rule.prefix}/`)) return false
          const readOnly = method === 'GET' || method === 'HEAD'
          if (rule.methods === 'write' && readOnly) return false
          if (rule.methods === 'read' && !readOnly) return false
          return true
        })
        const winner = covered.find(({ method, url }) => resolveFeatureKeys(method, url).includes(feature.key))
        expect(winner, `${feature.key}: nicio rută nu se rezolvă la ea sub ${rule.prefix}`).toBeTruthy()
      }
    }
  })
})

describe('funcționalitate cu funcționalitate: 403 fără ea, trece cu ea', () => {
  for (const key of featuresWithRoutes) {
    const feature = FEATURES.find((f) => f.key === key)!
    const page = PAGES.find((p) => p.key === feature.page)!

    it(`${key} — fără ea 403 FEATURE_FORBIDDEN, cu ea trece de guard`, async () => {
      // Omul „cu" poarta paginii + funcționalitatea. Pe o `.view` poarta e chiar funcționalitatea
      // testată, deci omul „fără ea" rămâne fără nicio cheie.
      const gate = page.viewFeature
      const cuFuncționalitatea = await tokenFor([...new Set([...(gate ? [gate] : []), key])])
      const faraEa = await tokenFor(gate && gate !== key ? [gate] : [])

      const candidates = routesOf(key)
      const preferred = PREFERRED[key]
      const representative = (preferred && candidates.includes(preferred) ? preferred : null) ?? candidates[0]!
      const [method, url] = representative.split(' ') as [string, string]
      const target = withFakeIds(url)

      const refuzat = await sent(faraEa, method, target)
      expect(refuzat.statusCode, `${key} — ${method} ${target}`).toBe(403)
      expect(refuzat.json().error).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature: key })

      const permis = await sent(cuFuncționalitatea, method, target)
      expect(passedGuard(permis.statusCode), `${key} — ${method} ${target} → ${permis.statusCode}`).toBe(true)
    })
  }
})

describe('omul fără nicio funcționalitate', () => {
  it('toate rutele din catalog îi sunt refuzate, cu cheia corectă', async () => {
    const noRole = await tokenFor([])
    for (const [route, feature] of guard.routes) {
      if (feature === null) continue // `self`: al omului, nu al rolului
      const [method, url] = route.split(' ') as [string, string]
      const res = await sent(noRole, method, withFakeIds(url))
      expect(res.statusCode, `${route} → ${res.statusCode}`).toBe(403)
      expect(res.json().error).toMatchObject({ code: 'FEATURE_FORBIDDEN', feature })
    }
  })
})

describe('bootul cu o rută nerezolvată', () => {
  it('serverul nu pornește, și mesajul spune ce nu e acoperit', async () => {
    // Server gol, doar cele două hook-uri: o rută nouă sub un prefix necunoscut trebuie să
    // oprească pornirea, nu să treacă sub tăcere (regula „rută nouă = intrare în catalog").
    const boot = Fastify()
    const authenticate = async () => {}
    boot.decorate('authenticate', authenticate)
    await boot.register(fp(async (instance) => void instance.register(featureGuardPlugin)))
    boot.post('/api/viitor/ nou', { preHandler: [authenticate] }, async () => ({ ok: true }))
    await expect(boot.ready()).rejects.toThrow(/does not cover every route[\s\S]*no feature: POST \/api\/viitor/)
    await boot.close()
  })

  it('a route without authenticate stops the boot unless it is declared public or machine', async () => {
    const boot = Fastify()
    boot.decorate('authenticate', async () => {})
    await boot.register(fp(async (instance) => void instance.register(featureGuardPlugin)))
    boot.get('/health', async () => ({ ok: true }))
    boot.get('/api/invoicing/invoices/export', async () => ({ ok: true }))
    await expect(boot.ready()).rejects.toThrow(/\(1\)[\s\S]*not declared public\/machine: GET \/api\/invoicing\/invoices\/export/)
    await boot.close()
  })

  it('every route the real server answers without a session is on the declared list', () => {
    expect(guard.open.map((route) => `${route.method} ${route.url}`).sort()).toMatchInlineSnapshot(`
      [
        "GET /api/auth/locale",
        "GET /api/email-images/:filename",
        "GET /api/email/settings/logo",
        "GET /api/email/unsubscribe/:token",
        "GET /api/public/calls/:publicId",
        "GET /api/v1/integrations/vanagreen/pricing/bundles",
        "GET /api/v1/public/booking/slots",
        "GET /health",
        "POST /api/auth/accept-invite",
        "POST /api/auth/forgot-password",
        "POST /api/auth/login",
        "POST /api/auth/reset-password",
        "POST /api/email/unsubscribe/:token",
        "POST /api/monitoring/host-metrics",
        "POST /api/v1/integrations/jeffbot/snapshot",
        "POST /api/v1/integrations/vanagreen/billing-clients",
        "POST /api/v1/integrations/vanagreen/pricing/calculate",
        "POST /api/v1/public/booking",
        "POST /api/v1/public/booking/cancel",
        "POST /api/webhooks/cloudflare-inbound",
        "POST /api/webhooks/resend-inbound",
        "POST /api/webhooks/sentry",
        "POST /api/webhooks/vanagreen-alert",
      ]
    `)
  })
})
