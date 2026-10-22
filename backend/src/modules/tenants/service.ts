import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { roles, tenants, users } from '../../shared/db/schema/index.js'
import { config } from '../../shared/config.js'
import { FEATURES } from '../../shared/lib/features.js'
import { runAsTenant, withRlsBypass } from '../../shared/lib/tenancy.js'

// The platform admin's list of companies. Every query here crosses companies on purpose, so it
// runs inside withRlsBypass; the guard in the routes keeps it platform-admin only.
export class TenantError extends Error {
  constructor(
    readonly code: 'not_found' | 'rls_required' | 'slug_taken' | 'owner_locked' | 'feature_owner_only' | 'unknown_feature',
    readonly status: number,
  ) {
    super(code)
  }
}

/** URL-safe identity of a company, from its display name. */
export function tenantSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export interface TenantRow {
  id: string
  name: string
  slug: string
  cif: string | null
  isPlatformOwner: boolean
  status: 'active' | 'suspended'
  features: string[]
  userCount: number
  createdAt: string
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

export async function listTenants(): Promise<TenantRow[]> {
  const rows = await withRlsBypass(() =>
    db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        cif: tenants.cif,
        isPlatformOwner: tenants.isPlatformOwner,
        status: tenants.status,
        features: tenants.features,
        userCount: count(users.id),
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .leftJoin(users, eq(users.tenantId, tenants.id))
      .where(isNull(tenants.deletedAt))
      .groupBy(tenants.id, tenants.name, tenants.slug, tenants.cif, tenants.isPlatformOwner, tenants.status, tenants.features, tenants.createdAt)
      .orderBy(asc(tenants.createdAt)),
  )
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

/** A company by id, soft-delete respected. Reads across companies, hence the bypass. */
async function getTenant(id: string): Promise<{ id: string; slug: string; isPlatformOwner: boolean; features: string[] } | null> {
  const [row] = await withRlsBypass(() =>
    db
      .select({ id: tenants.id, slug: tenants.slug, isPlatformOwner: tenants.isPlatformOwner, features: tenants.features })
      .from(tenants)
      .where(and(eq(tenants.id, id), isNull(tenants.deletedAt))),
  )
  return row ?? null
}

export async function createTenant(input: { name: string; cif?: string }): Promise<TenantRow> {
  if (!config.rlsEnabled) throw new TenantError('rls_required', 409)

  const id = randomUUID()
  try {
    await withRlsBypass(() =>
      db.insert(tenants).values({ id, name: input.name, slug: tenantSlug(input.name), cif: input.cif ?? null, features: [] }),
    )
  } catch (err) {
    if (isUniqueViolation(err)) throw new TenantError('slug_taken', 409)
    throw err
  }

  // A new company starts with its own Admin role; runAsTenant gives the column default the
  // right tenant.
  await runAsTenant(id, () => db.insert(roles).values({ name: 'Admin', kind: 'admin' }))

  return findTenantRow(id)
}

/** One row of the list, by id; 404 if it is gone (or was soft-deleted meanwhile). */
async function findTenantRow(id: string): Promise<TenantRow> {
  const row = (await listTenants()).find((r) => r.id === id)
  if (!row) throw new TenantError('not_found', 404)
  return row
}

export async function updateTenantStatus(id: string, status: 'active' | 'suspended'): Promise<TenantRow> {
  const tenant = await getTenant(id)
  if (!tenant) throw new TenantError('not_found', 404)
  if (tenant.isPlatformOwner) throw new TenantError('owner_locked', 409)

  await withRlsBypass(() => db.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, id)))
  return findTenantRow(id)
}

export async function setTenantFeature(id: string, key: string, enabled: boolean): Promise<string[]> {
  const tenant = await getTenant(id)
  if (!tenant) throw new TenantError('not_found', 404)
  if (tenant.isPlatformOwner) throw new TenantError('owner_locked', 409)

  const feature = FEATURES.find((f) => f.key === key)
  if (!feature) throw new TenantError('unknown_feature', 400)
  if (feature.ownerOnly) throw new TenantError('feature_owner_only', 400)

  const features = enabled ? [...new Set([...tenant.features, key])] : tenant.features.filter((f) => f !== key)
  await withRlsBypass(() => db.update(tenants).set({ features, updatedAt: new Date() }).where(eq(tenants.id, id)))
  return features
}
