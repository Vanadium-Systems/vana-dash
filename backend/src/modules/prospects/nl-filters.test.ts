/**
 * Phrase → filters (BE12). The provider is mocked; users, statuses and prospects are real rows.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { assistantUsage, prospects } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { ProviderTurnParams } from '../assistant/providers/types.js'

const calls: ProviderTurnParams[] = []
let reply = ''
let usage = { inputTokens: 120, outputTokens: 30 }

vi.mock('../assistant/providers/index.js', () => ({
  buildActiveProvider: async () => ({
    id: 'anthropic',
    provider: {
      id: 'fake',
      async *streamTurn(params: ProviderTurnParams) {
        calls.push(params)
        yield { type: 'text_delta' as const, text: reply }
        yield { type: 'turn_end' as const, content: [], usage }
      },
    },
  }),
  resolveModel: async () => 'fake-model',
}))

const quota = vi.hoisted(() => ({ ok: true as boolean }))
vi.mock('../assistant/quota.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assistant/quota.js')>()),
  checkQuota: async () => (quota.ok ? { ok: true } : { ok: false, code: 'ASSISTANT_QUOTA', message: 'cap reached' }),
}))

const { interpretPhrase, NlFiltersError } = await import('./nl-filters-service.js')

const userIds: string[] = []
const prospectIds: string[] = []
const withAssistant = await createTestUser('nl-ok', userIds, { features: ['clienti.view', 'asistent.view'] })
const withoutAssistant = await createTestUser('nl-no', userIds, { features: ['clienti.view'] })

beforeEach(() => {
  calls.length = 0
  quota.ok = true
  usage = { inputTokens: 120, outputTokens: 30 }
})

afterAll(async () => {
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('interpretPhrase', () => {
  it('keeps valid filters and drops an invented field', async () => {
    reply = 'Sure: ```json\n' + JSON.stringify({
      filters: [
        { field: 'priority', op: 'in', value: ['HOT'] },
        { field: 'favoriteColor', op: 'in', value: ['red'] },
      ],
      understood: 'Prospecți fierbinți',
    }) + '\n```'
    const result = await interpretPhrase(withAssistant, 'prospecți fierbinți')
    expect(result.filters).toEqual([{ field: 'priority', op: 'in', value: ['HOT'] }])
    expect(result.dropped).toBe(1)
    expect(result.understood).toBe('Prospecți fierbinți')
  })

  it('text that is not JSON gives no filters', async () => {
    reply = 'I cannot help with that'
    expect(await interpretPhrase(withAssistant, 'ceva')).toEqual({ filters: [], understood: '', dropped: 0 })
  })

  it('without asistent.view it is forbidden and the provider is not called', async () => {
    await expect(interpretPhrase(withoutAssistant, 'x')).rejects.toMatchObject({ code: 'ASSISTANT_FORBIDDEN' })
    expect(calls).toHaveLength(0)
  })

  it('records the tokens from turn_end', async () => {
    reply = '{"filters":[],"understood":""}'
    usage = { inputTokens: 77, outputTokens: 11 }
    await db.delete(assistantUsage).where(eq(assistantUsage.userId, withAssistant.id))
    await interpretPhrase(withAssistant, 'ceva')
    const [row] = await db.select().from(assistantUsage).where(eq(assistantUsage.userId, withAssistant.id))
    expect(row!.inputTokens).toBe(77)
    expect(row!.outputTokens).toBe(11)
  })

  it('refuses when the monthly cap is reached', async () => {
    quota.ok = false
    const err = await interpretPhrase(withAssistant, 'ceva').catch((e) => e)
    expect(err).toBeInstanceOf(NlFiltersError)
    expect(err.code).toBe('ASSISTANT_QUOTA')
    expect(calls).toHaveLength(0)
  })

  it('the prompt carries no prospect data', async () => {
    const name = `Zeta-Unique-${crypto.randomUUID()} SRL`
    const [row] = await db.insert(prospects).values({ name }).returning()
    prospectIds.push(row!.id)
    reply = '{"filters":[],"understood":""}'
    await interpretPhrase(withAssistant, 'ceva')
    expect(calls[0]!.system).not.toContain(name)
    expect(calls[0]!.system).toContain('priority')
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'ceva' }])
  })
})
