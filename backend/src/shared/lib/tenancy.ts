import { currentActor, runWithFreshActor } from './request-context.js'

// Which company the current work belongs to. The request context carries it (set by
// `authenticate`); with none, it is the platform owner, so jobs and machine routes keep working
// as before tenancy. shared/db/client.ts sends it to Postgres when RLS_ENABLED, which is why
// this file must not import the database client.

/** Fixed id, inserted by migration 0069; every row that existed before tenancy belongs to it. */
export const OWNER_TENANT_ID = '00000000-0000-4000-8000-000000000001'

export function getOwnerTenantId(): string {
  return OWNER_TENANT_ID
}

export function currentTenantId(): string {
  return currentActor().tenantId ?? OWNER_TENANT_ID
}

export function isRlsBypassed(): boolean {
  return currentActor().bypassRls === true
}

/** Runs `fn` as the given company, keeping the rest of the current context (actor, locale). */
export async function runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  // Awaited inside the callback: a Drizzle builder only starts when awaited, and the store must
  // still be there when it does.
  return runWithFreshActor({ ...currentActor(), tenantId, bypassRls: false }, async () => await fn())
}

/** For the few lookups that must cross companies. Every caller says why in a comment. */
export async function withRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  return runWithFreshActor({ ...currentActor(), bypassRls: true }, async () => await fn())
}
