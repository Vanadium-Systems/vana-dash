/**
 * The tenant of the current work lives in the same async store as the actor, so it has to
 * survive nesting (a job that loops over companies) and default to the platform owner when no
 * request opened the store. No database here: the column defaults and the RLS policies are
 * checked by the migration tests.
 */
import { describe, expect, it } from 'vitest'
import { currentActor, runWithFreshActor } from './request-context.js'
import { OWNER_TENANT_ID, currentTenantId, isRlsBypassed, runAsTenant, withRlsBypass } from './tenancy.js'

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

describe('tenant in the request context', () => {
  it('defaults to the platform owner outside any request', () => {
    expect(currentTenantId()).toBe(OWNER_TENANT_ID)
    expect(isRlsBypassed()).toBe(false)
  })

  it('runAsTenant sets the tenant and restores the owner after it returns', async () => {
    const inside = await runAsTenant(OTHER_TENANT, async () => currentTenantId())
    expect(inside).toBe(OTHER_TENANT)
    expect(currentTenantId()).toBe(OWNER_TENANT_ID)
  })

  it('runAsTenant keeps the actor it was nested in', async () => {
    await runWithFreshActor({ userId: 'u1', ip: null }, async () => {
      await runAsTenant(OTHER_TENANT, async () => {
        expect(currentActor().userId).toBe('u1')
        expect(currentTenantId()).toBe(OTHER_TENANT)
      })
      expect(currentActor().userId).toBe('u1')
    })
  })

  it('withRlsBypass is turned off again by a nested runAsTenant', async () => {
    await withRlsBypass(async () => {
      expect(isRlsBypassed()).toBe(true)
      await runAsTenant(OTHER_TENANT, async () => {
        expect(isRlsBypassed()).toBe(false)
        expect(currentTenantId()).toBe(OTHER_TENANT)
      })
      expect(isRlsBypassed()).toBe(true)
    })
    expect(isRlsBypassed()).toBe(false)
  })
})
