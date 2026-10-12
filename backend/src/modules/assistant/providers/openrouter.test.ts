import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js'
import {
  anthropicToOpenAiMessages,
  createOpenRouterProvider,
  openAiAssistantToAnthropicBlocks,
} from './openrouter.js'
import type { NeutralAssistantTool } from './types.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anthropicToOpenAiMessages', () => {
  it('textul user/assistant trece direct', () => {
    const history: BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'Salut' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Bună!' }] },
    ]
    expect(anthropicToOpenAiMessages(history)).toEqual([
      { role: 'user', content: 'Salut' },
      { role: 'assistant', content: 'Bună!' },
    ])
  })

  it('tool_use devine tool_calls pe mesajul assistant, tool_result devine mesaje role:tool separate', () => {
    const history: BetaMessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'Fă backup' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Pregătesc acțiunea.' },
          { type: 'tool_use', id: 'tu_1', name: 'create_backup', input: { target: 'all' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'Acțiune înregistrată' },
          { type: 'text', text: 'Și apoi?' },
        ],
      },
    ]
    const converted = anthropicToOpenAiMessages(history)
    expect(converted[1]).toMatchObject({
      role: 'assistant',
      content: 'Pregătesc acțiunea.',
      tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'create_backup', arguments: '{"target":"all"}' } }],
    })
    // tool_result → mesaj tool cu tool_call_id, textul user de după rămâne mesaj user
    expect(converted[2]).toEqual({ role: 'tool', content: 'Acțiune înregistrată', tool_call_id: 'tu_1' })
    expect(converted[3]).toEqual({ role: 'user', content: 'Și apoi?' })
  })
})

describe('openAiAssistantToAnthropicBlocks (round-trip)', () => {
  it('text + tool_calls → blocks Anthropic persistabile, argumente parsate ca obiect', () => {
    const blocks = openAiAssistantToAnthropicBlocks('Gata.', [
      { id: 'call_1', type: 'function', function: { name: 'list_platforms', arguments: '{"limit":5}' } },
    ])
    expect(blocks).toEqual([
      { type: 'text', text: 'Gata.' },
      { type: 'tool_use', id: 'call_1', name: 'list_platforms', input: { limit: 5 } },
    ])
    // round-trip: blocks rezultate pot reintra în conversia spre OpenAI fără pierdere
    const back = anthropicToOpenAiMessages([{ role: 'assistant', content: blocks }])
    expect(back).toEqual([
      {
        role: 'assistant',
        content: 'Gata.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_platforms', arguments: '{"limit":5}' } }],
      },
    ])
  })

  it('argumente JSON invalide nu aruncă — cad pe {_raw}', () => {
    const blocks = openAiAssistantToAnthropicBlocks(null, [
      { id: 'x', type: 'function', function: { name: 't', arguments: '{broken' } },
    ])
    expect(blocks).toEqual([{ type: 'tool_use', id: 'x', name: 't', input: { _raw: '{broken' } }])
  })
})

function sseResponse(chunks: Array<Record<string, unknown>>): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const noopStop = () => false

describe('createOpenRouterProvider — bucla de tool-uri', () => {
  const tool: NeutralAssistantTool = {
    name: 'get_metrics_summary',
    description: 'Sumar metrici',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn(async () => JSON.stringify({ revenue: 100 })),
  }

  it('runda 1 cere tool-ul, runda 2 răspunde text; evenimente + conținut persistabil corecte', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        if (requests.length === 1) {
          return sseResponse([
            { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_metrics_summary', arguments: '{}' } }] } }] },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          ])
        }
        return sseResponse([
          { choices: [{ delta: { content: 'Venitul e ' } }] },
          { choices: [{ delta: { content: '100 RON.' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ])
      }),
    )

    const events: Array<Record<string, unknown>> = []
    for await (const event of createOpenRouterProvider({ apiKey: 'sk-test' }).streamTurn({
      model: 'test-model',
      system: 'SYS',
      tools: [tool],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Cât am făcut?' }] }],
      shouldStopAfterTurn: noopStop,
    })) {
      events.push(event as Record<string, unknown>)
    }

    expect(tool.execute).toHaveBeenCalledWith('c1', {})
    // rezultatul tool-ului iese spre persistare, între cele două runde
    expect(events.map((e) => e.type).filter((t) => t === 'turn_end' || t === 'tool_results')).toEqual(['turn_end', 'tool_results', 'turn_end'])
    expect(events.find((e) => e.type === 'tool_results')).toEqual({
      type: 'tool_results',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"revenue":100}' }],
    })
    // ambele runde ajung în turn_end (persistare identică cu Anthropic), textul curge ca delta
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(2)
    expect(events.filter((e) => e.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'Venitul e ' },
      { type: 'text_delta', text: '100 RON.' },
    ])
    // runda 2 trimite istoricul cu rezultatul tool-ului (mesaje assistant+tool în format OpenAI)
    const secondBody = requests[1] as { messages: Array<{ role: string }> }
    expect(secondBody.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    // cheia pleacă în header, nu în body
    expect((requests[0] as Record<string, unknown>).api_key).toBeUndefined()
  })

  it('shouldStopAfterTurn oprește bucla după o rundă cu tool-uri (pending confirm)', async () => {
    let stopped = false
    const fetchMock = vi.fn(async () =>
      sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'send_invoice', arguments: '{"id":1}' } }] } }, { finish_reason: 'tool_calls' }] }]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: Array<Record<string, unknown>> = []
    for await (const event of createOpenRouterProvider({ apiKey: 'sk-test' }).streamTurn({
      model: 'm',
      system: 'S',
      tools: [{ ...tool, name: 'send_invoice', execute: async () => 'înregistrat' }],
      messages: [],
      shouldStopAfterTurn: () => {
        stopped = true
        return true
      },
    })) {
      events.push(event as Record<string, unknown>)
    }
    expect(stopped).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
  })

  it('eroare HTTP produce throw cu status-ul (service-ul o transformă în event error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(async () => {
      const gen = createOpenRouterProvider({ apiKey: 'bad' }).streamTurn({
        model: 'm',
        system: '',
        tools: [],
        messages: [],
        shouldStopAfterTurn: noopStop,
      })
      for await (const event of gen) void event
    }).rejects.toThrow(/401/)
  })

  it('eroarea trimisă în stream (status 200) produce throw, nu o tură goală', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([{ error: { code: 400, message: 'tool_call_id fără răspuns' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] }]),
      ),
    )
    await expect(async () => {
      const gen = createOpenRouterProvider({ apiKey: 'k' }).streamTurn({
        model: 'm',
        system: '',
        tools: [],
        messages: [],
        shouldStopAfterTurn: noopStop,
      })
      for await (const event of gen) void event
    }).rejects.toThrow(/tool_call_id fără răspuns \(400\)/)
  })
})
