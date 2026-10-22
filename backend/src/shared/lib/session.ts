import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { roles, tenants, userMailboxes, users } from '../db/schema/index.js'
import { availableFeatures, PAGES } from './features.js'
import type { DisplayCurrency, Locale } from './locale.js'

// Cine e omul din sesiune, cu tot ce trebuie ca să autorizeze un request (PLAN.md C2).
// Un singur query pe request, indexat pe PK — de aceea rolul vine în același SELECT ca
// userul, nu într-al doilea.

export interface SessionRole {
  id: string
  name: string
  kind: 'admin' | 'manager' | 'custom'
}

export interface SessionTenant {
  id: string
  name: string
  isPlatformOwner: boolean
  status: 'active' | 'suspended'
  /** What the company may use; ignored for the platform owner, who has the whole catalog. */
  features: string[]
}

export interface SessionUser {
  id: string
  email: string
  displayName: string | null
  role: SessionRole | null
  isPlatformAdmin: boolean
  /** The person's company. Absent only on users built by hand in tests (= the platform owner). */
  tenant?: SessionTenant
  /** Funcționalitățile efective (rolul ∩ catalog, cu poarta paginii respectată). */
  features: string[]
  /** Cheile cutiilor de email; `null` = toate (adminul). */
  mailboxes: string[] | null
  status: 'invited' | 'active' | 'disabled'
  lastSeenAt: Date | null
  notificationPrefs: { chat: 'all' | 'dm' | 'none'; emailNew: boolean; alerts: boolean } | null
  navLayout: unknown
  updatesSeenAt: Date | null
  sessionVersion: number
  locale: Locale
  displayCurrency: DisplayCurrency
}

export const DEFAULT_NOTIFICATION_PREFS = { chat: 'all', emailNew: true, alerts: true } as const

/** Numele omului în texte (confirmări, prompt, emailuri): displayName, sau emailul dacă n-are. */
export function userName(user: Pick<SessionUser, 'displayName' | 'email'>): string {
  return user.displayName ?? user.email
}

/**
 * Funcționalitățile efective ale unui rol: lista lui, cu porțile paginilor respectate.
 *
 * Regula lui „.view oprit" (decizie Stefan, 2026-09-28): dacă poarta paginii lipsește, cheile
 * paginii rămân salvate în rol dar sunt inactive — nu se pot da efectiv. Deci un rol poate
 * avea `facturi.emitere` salvat cu `facturi.view` oprit, și atunci nu poate emite.
 */
export function effectiveFeatures(
  roleFeatures: string[] | null,
  roleKind: string | null,
  tenant?: Pick<SessionTenant, 'isPlatformOwner' | 'features'>,
): string[] {
  // Another company gets only what it was given, and never what is the platform's own.
  const available =
    tenant && !tenant.isPlatformOwner
      ? availableFeatures().filter((feature) => !feature.ownerOnly && tenant.features.includes(feature.key))
      : availableFeatures()
  if (roleKind === 'admin') return available.map((feature) => feature.key)
  if (!roleFeatures) return []
  const granted = new Set(roleFeatures)
  const out = new Set<string>()
  for (const page of PAGES) {
    if (page.viewFeature && !granted.has(page.viewFeature)) continue
    for (const feature of available) {
      if (feature.page !== page.key) continue
      if (page.viewFeature === feature.key || granted.has(feature.key)) out.add(feature.key)
    }
  }
  return [...out]
}

export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isPlatformAdmin: users.isPlatformAdmin,
      sessionVersion: users.sessionVersion,
      status: users.status,
      lastSeenAt: users.lastSeenAt,
      notificationPrefs: users.notificationPrefs,
      navLayout: users.navLayout,
      updatesSeenAt: users.updatesSeenAt,
      locale: users.locale,
      displayCurrency: users.displayCurrency,
      roleId: roles.id,
      roleName: roles.name,
      roleKind: roles.kind,
      roleFeatures: roles.features,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantIsPlatformOwner: tenants.isPlatformOwner,
      tenantStatus: tenants.status,
      tenantFeatures: tenants.features,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!row) return null

  // Cutii de email: adminul are toate implicit (fără rânduri în user_mailboxes), oricine alt
  // are lista cheilor. `email.cutii` lipsește de aici — cine nu o are nici nu atribuie cutii
  // (BE-4), dar rămâne cu ale lui.
  const mailboxes =
    row.roleKind === 'admin' ? null : (await listMailboxes(row.id)) ?? []

  const tenant: SessionTenant = {
    id: row.tenantId,
    name: row.tenantName,
    isPlatformOwner: row.tenantIsPlatformOwner,
    status: row.tenantStatus,
    features: row.tenantFeatures,
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.roleId
      ? { id: row.roleId, name: row.roleName as string, kind: row.roleKind as SessionRole['kind'] }
      : null,
    isPlatformAdmin: row.isPlatformAdmin,
    status: row.status,
    tenant,
    features: effectiveFeatures(row.roleFeatures, row.roleKind, tenant),
    mailboxes,
    lastSeenAt: row.lastSeenAt,
    notificationPrefs: row.notificationPrefs ?? null,
    navLayout: row.navLayout,
    updatesSeenAt: row.updatesSeenAt,
    sessionVersion: row.sessionVersion,
    locale: row.locale,
    displayCurrency: row.displayCurrency,
  }
}

export async function listMailboxes(userId: string): Promise<string[] | null> {
  const rows = await db
    .select({ key: userMailboxes.identityKey })
    .from(userMailboxes)
    .where(and(eq(userMailboxes.userId, userId), isNull(userMailboxes.deletedAt)))
  return rows.map((r) => r.key)
}
