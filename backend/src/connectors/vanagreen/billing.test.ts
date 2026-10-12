/**
 * connectors/vanagreen/billing.ts — apeluri de billing către recyclers_app
 * (Sprint C, Track B). Mock `fetch` global, niciun request real (pattern
 * identic connectors/revolut/oauth.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlatformConfig } from '../types.js'
import { confirmReferralDiscount, extendVanagreenSubscription, fetchReferralDiscountStatus, fetchVanagreenTenants } from './billing.js'

const config: PlatformConfig = {
  id: 'platform-1',
  name: 'VanaGreen',
  type: 'vanagreen',
  apiUrl: 'https://vanagreen.example.com',
  apiKey: 'super-secret-api-key',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchVanagreenTenants', () => {
  it('maps snake_case response fields to camelCase', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://vanagreen.example.com/api/v1/platform/tenants')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer super-secret-api-key')
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'tenant-1',
              name: 'Acme SRL',
              cif: 'RO123',
              billing_due_date: '2026-08-01',
              billing_cycle: 'monthly',
              billing_cycle_day: 1,
              billing_cycle_month: null,
            },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const tenants = await fetchVanagreenTenants(config)
    expect(tenants).toEqual([
      {
        id: 'tenant-1',
        name: 'Acme SRL',
        cif: 'RO123',
        billingDueDate: '2026-08-01',
        billingCycle: 'monthly',
        billingCycleDay: 1,
        billingCycleMonth: null,
      },
    ])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('maps an empty tenants list to an empty array (not a crash)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    expect(await fetchVanagreenTenants(config)).toEqual([])
  })

  it('throws on a 4xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(fetchVanagreenTenants(config)).rejects.toThrow(/401/)
  })

  it('throws on a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(fetchVanagreenTenants(config)).rejects.toThrow(/500/)
  })

  it('propagates a network error as a throw (no swallowing)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(fetchVanagreenTenants(config)).rejects.toThrow(/ECONNREFUSED/)
  })
})

describe('extendVanagreenSubscription', () => {
  it('returns ok:true on 200', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://vanagreen.example.com/api/v1/platform/tenants/tenant-1/extend-subscription')
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({ months: 3, idempotencyKey: 'match-123', newBillingDueDate: '2026-08-01' })
      return new Response(JSON.stringify({ ok: true, tenantId: 'tenant-1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await extendVanagreenSubscription(config, 'tenant-1', 3, 'match-123', '2026-08-01')
    expect(result).toEqual({ ok: true, status: 200, tenantId: 'tenant-1' })
  })

  it('does NOT throw on a 500 — returns ok:false with status + message instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('internal error', { status: 500 })))
    const result = await extendVanagreenSubscription(config, 'tenant-1', 3, 'match-123', '2026-08-01')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
    expect(result.message).toContain('internal error')
  })

  it('does NOT throw on a 404 (tenant not found)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('tenant not found', { status: 404 })))
    const result = await extendVanagreenSubscription(config, 'unknown-tenant', 3, 'match-123', '2026-08-01')
    expect(result).toEqual({ ok: false, status: 404, tenantId: 'unknown-tenant', message: 'tenant not found' })
  })

  it('does NOT throw on a network error/timeout — returns ok:false, status:0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout')
      }),
    )
    const result = await extendVanagreenSubscription(config, 'tenant-1', 3, 'match-123', '2026-08-01')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.message).toContain('timeout')
  })

  it('never leaks the API key in the error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized: bad key', { status: 401 })))
    const result = await extendVanagreenSubscription(config, 'tenant-1', 3, 'match-123', '2026-08-01')
    expect(result.message).not.toContain(config.apiKey)
  })

  it('truncates an unexpectedly huge error body to 500 chars', async () => {
    const hugeBody = 'x'.repeat(10_000)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(hugeBody, { status: 500 })))
    const result = await extendVanagreenSubscription(config, 'tenant-1', 3, 'match-123', '2026-08-01')
    expect(result.message?.length).toBe(500)
  })
})

describe('fetchReferralDiscountStatus', () => {
  it('maps an eligible response to camelCase', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://vanagreen.example.com/api/v1/platform/tenants/tenant-1/referral-discount-status')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer super-secret-api-key')
      return new Response(
        JSON.stringify({ data: { eligible: true, referral_id: 'ref-1', referrer_tenant_id: 'tenant-referrer' } }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchReferralDiscountStatus(config, 'tenant-1')
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { eligible: true, referralId: 'ref-1', referrerTenantId: 'tenant-referrer' },
    })
  })

  it('maps a non-eligible response with null referral fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { eligible: false, referral_id: null, referrer_tenant_id: null } }), { status: 200 })),
    )
    const result = await fetchReferralDiscountStatus(config, 'tenant-1')
    expect(result.data).toEqual({ eligible: false, referralId: null, referrerTenantId: null })
  })

  it('does NOT throw on a non-2xx response — returns ok:false with status + message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('tenant not found', { status: 404 })))
    const result = await fetchReferralDiscountStatus(config, 'unknown-tenant')
    expect(result).toEqual({ ok: false, status: 404, message: 'tenant not found' })
  })

  it('does NOT throw on a network error — returns ok:false, status:0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    const result = await fetchReferralDiscountStatus(config, 'tenant-1')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.message).toContain('ECONNREFUSED')
  })
})

describe('confirmReferralDiscount', () => {
  it('sends referral_id in the body and maps a fresh confirm', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://vanagreen.example.com/api/v1/platform/tenants/tenant-1/referral-discount-status/confirm')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ referral_id: 'ref-1' })
      return new Response(JSON.stringify({ data: { ok: true, already_applied: false } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await confirmReferralDiscount(config, 'tenant-1', 'ref-1')
    expect(result).toEqual({ ok: true, status: 200, alreadyApplied: false })
  })

  it('maps an already-applied confirm (idempotent retry)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { ok: true, already_applied: true } }), { status: 200 })))
    const result = await confirmReferralDiscount(config, 'tenant-1', 'ref-1')
    expect(result).toEqual({ ok: true, status: 200, alreadyApplied: true })
  })

  it('does NOT throw on a non-2xx response — returns ok:false with status + message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('internal error', { status: 500 })))
    const result = await confirmReferralDiscount(config, 'tenant-1', 'ref-1')
    expect(result).toEqual({ ok: false, status: 500, message: 'internal error' })
  })

  it('does NOT throw on a network error — returns ok:false, status:0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout')
      }),
    )
    const result = await confirmReferralDiscount(config, 'tenant-1', 'ref-1')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(0)
    expect(result.message).toContain('timeout')
  })

  it('never leaks the API key in the error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized: bad key', { status: 401 })))
    const result = await confirmReferralDiscount(config, 'tenant-1', 'ref-1')
    expect(result.message).not.toContain(config.apiKey)
  })
})
