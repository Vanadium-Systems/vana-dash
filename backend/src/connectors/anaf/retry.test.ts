import { afterEach, describe, expect, it, vi } from 'vitest'
import { anafConnector } from './index.js'
import type { AnafSession } from '../types.js'

// anafGet/listMessages nu sunt exportate — testăm retry-ul pe 429 prin API-ul
// public al connectorului (fetchSpvMessages), care cheamă listMessages → anafGet.

const session: AnafSession = { cif: '12345678', accessToken: 'fake-token' }

function emptyListResponse() {
  return new Response(JSON.stringify({ mesaje: [], numar_total_pagini: 1 }), { status: 200 })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('anafGet retry on 429', () => {
  it(
    'retries through 2x 429 and eventually succeeds on the 3rd attempt, with a delay between attempts',
    async () => {
      let calls = 0
      const callTimestamps: number[] = []
      const fetchSpy = vi.fn(async () => {
        callTimestamps.push(Date.now())
        calls++
        if (calls <= 2) return new Response('rate limited', { status: 429 })
        return emptyListResponse()
      })
      vi.stubGlobal('fetch', fetchSpy)

      const messages = await anafConnector.fetchSpvMessages(session, 1)
      expect(messages).toEqual([])
      expect(calls).toBe(3)
      // Există un delay real între încercări (backoff), nu retry instant.
      expect(callTimestamps[1]! - callTimestamps[0]!).toBeGreaterThanOrEqual(400)
      expect(callTimestamps[2]! - callTimestamps[1]!).toBeGreaterThanOrEqual(900)
    },
    10_000,
  )

  it(
    '429 more times than the retry budget eventually throws instead of looping forever',
    async () => {
      let calls = 0
      const fetchSpy = vi.fn(async () => {
        calls++
        return new Response('rate limited', { status: 429 })
      })
      vi.stubGlobal('fetch', fetchSpy)

      await expect(anafConnector.fetchSpvMessages(session, 1)).rejects.toThrow(/429/)
      // MAX_RETRIES_429 = 3 → attempts 0..3 inclusive = 4 fetch calls total, then throw.
      expect(calls).toBe(4)
    },
    15_000,
  )

  it('does not retry on non-429 errors (e.g. 500) — fails immediately', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls++
      return new Response('server error', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(anafConnector.fetchSpvMessages(session, 1)).rejects.toThrow(/500/)
    expect(calls).toBe(1)
  })

  it('respects a Retry-After header (seconds) instead of the fixed backoff when present', async () => {
    let calls = 0
    const callTimestamps: number[] = []
    const fetchSpy = vi.fn(async () => {
      callTimestamps.push(Date.now())
      calls++
      if (calls === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } })
      return emptyListResponse()
    })
    vi.stubGlobal('fetch', fetchSpy)

    await anafConnector.fetchSpvMessages(session, 1)
    expect(callTimestamps[1]! - callTimestamps[0]!).toBeGreaterThanOrEqual(950)
  }, 10_000)
})
