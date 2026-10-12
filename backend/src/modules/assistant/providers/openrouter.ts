import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js'
import type { AssistantProvider, ProviderTurnEvent, ProviderTurnParams } from './types.js'
import { tr } from '../../../shared/lib/i18n.js'

// OpenRouterProvider (sprint multi-provider 2026-08-25) — API OpenAI-compatible
// (POST /chat/completions, tools function-calling, stream SSE), cu buclă de tool-uri manuală.
// Semantica e identică cu AnthropicProvider: text + tool_call în stream, conținutul fiecărei
// runde merge în turn_end ÎN FORMAT ANTHROPIC (formatul canonic din DB), oprire la răspuns
// fără tool_calls sau când există acțiuni pending confirm.

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

// ── Conversie Anthropic blocks ↔ OpenAI messages ────────────────────────────────────────────

export interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

/** Istoricul Anthropic (formatul din DB) → lista de mesaje OpenAI. tool_result-urile din
 *  mesajele user devin mesaje 'tool' separate, în ordinea blocks-urilor. */
export function anthropicToOpenAiMessages(messages: BetaMessageParam[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  for (const message of messages) {
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text' as const, text: message.content }]
    const textParts: string[] = []
    const toolCalls: OpenAiToolCall[] = []
    const pendingResults: OpenAiMessage[] = []
    for (const block of blocks) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })
      } else if (block.type === 'tool_result') {
        const content =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? (block.content as Array<{ type: string; text?: string }>)
                  .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
                  .join('\n')
              : ''
        pendingResults.push({ role: 'tool', content, tool_call_id: block.tool_use_id })
      }
    }
    if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        // OpenAI cere content:null pe mesajele doar-cu-tool_calls
        content: textParts.join('\n') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else {
      // Rezultatele tool înaintea textului user — OpenAI cere mesajele 'tool' imediat după
      // assistant-ul cu tool_calls (iar în Anthropic oricum rezultatele deschid mesajul user).
      out.push(...pendingResults)
      if (textParts.length > 0) out.push({ role: 'user', content: textParts.join('\n') })
    }
  }
  return out
}

/** Răspunsul asistentului (text + tool_calls) → blocks Anthropic, exact shape-ul persistat. */
export function openAiAssistantToAnthropicBlocks(content: string | null, toolCalls: OpenAiToolCall[]): BetaContentBlockParam[] {
  const blocks: BetaContentBlockParam[] = []
  if (content) blocks.push({ type: 'text', text: content })
  for (const call of toolCalls) {
    let input: unknown = {}
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
    } catch {
      input = { _raw: call.function.arguments }
    }
    blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
  }
  return blocks
}

// ── Stream SSE ───────────────────────────────────────────────────────────────────────────────

interface SseChunk {
  choices: Array<{
    delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }
    finish_reason?: string | null
  }>
  // OpenRouter: `usage: {include: true}` → chunk final cu usage (choices gol)
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  // eroare apărută după ce stream-ul a pornit — vine cu status 200, în corpul unui chunk
  error?: { code?: number | string; message?: string }
}

async function* parseSse(response: Response): AsyncGenerator<SseChunk> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error(tr('errors.assistant.openRouterNoBody'))
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separatorIndex: number
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          yield JSON.parse(data) as SseChunk
        } catch {
          // fragment incomplet / keep-alive — ignorat, ca orice alt non-JSON
        }
      }
    }
  }
}

interface AccumulatedToolCall {
  id: string
  name: string
  arguments: string
}

export interface OpenRouterProviderOptions {
  apiKey: string
  baseUrl?: string | null
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): AssistantProvider {
  const baseUrl = options.baseUrl?.replace(/\/$/, '') || OPENROUTER_DEFAULT_BASE_URL

  return {
    id: 'openrouter',
    async *streamTurn(params: ProviderTurnParams): AsyncGenerator<ProviderTurnEvent> {
      const messages: OpenAiMessage[] = [{ role: 'system', content: params.system }, ...anthropicToOpenAiMessages(params.messages)]

      while (true) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: params.model,
            messages,
            stream: true,
            usage: { include: true },
            tools: params.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
          }),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`OpenRouter returned ${res.status}: ${detail.slice(0, 300)}`)
        }

        let text = ''
        let usage: { inputTokens: number; outputTokens: number } | undefined
        const toolAccumulators = new Map<number, AccumulatedToolCall>()
        for await (const chunk of parseSse(res)) {
          if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message ?? tr('errors.assistant.streamError')}${chunk.error.code != null ? ` (${chunk.error.code})` : ''}`)
          if (chunk.usage?.prompt_tokens != null) {
            usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens ?? 0 }
          }
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.delta?.content) {
            text += choice.delta.content
            yield { type: 'text_delta', text: choice.delta.content }
          }
          for (const call of choice.delta?.tool_calls ?? []) {
            const acc = toolAccumulators.get(call.index) ?? { id: '', name: '', arguments: '' }
            if (call.id) acc.id = call.id
            if (call.function?.name) acc.name += call.function.name
            if (call.function?.arguments) acc.arguments += call.function.arguments
            toolAccumulators.set(call.index, acc)
          }
        }

        const toolCalls = [...toolAccumulators.entries()].sort(([a], [b]) => a - b).map(([, v]) => v)
        const completeCalls: OpenAiToolCall[] = toolCalls.filter((c) => c.id && c.name).map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } }))
        yield { type: 'turn_end', content: openAiAssistantToAnthropicBlocks(text || null, completeCalls), usage }
        if (completeCalls.length > 0) {
          for (const call of completeCalls) yield { type: 'tool_call', toolName: call.function.name }
        }

        if (params.shouldStopAfterTurn() || completeCalls.length === 0) break

        messages.push({ role: 'assistant', content: text || null, tool_calls: completeCalls })
        const results: BetaContentBlockParam[] = []
        for (const call of completeCalls) {
          const tool = params.tools.find((t) => t.name === call.function.name)
          let resultText: string
          try {
            resultText = tool ? await tool.execute(call.id, JSON.parse(call.function.arguments || '{}')) : tr('errors.assistant.unknownTool', { name: call.function.name })
          } catch (err) {
            resultText = tr('errors.assistant.toolFailed', { message: err instanceof Error ? err.message : String(err) })
          }
          messages.push({ role: 'tool', content: resultText, tool_call_id: call.id })
          results.push({ type: 'tool_result', tool_use_id: call.id, content: resultText })
        }
        yield { type: 'tool_results', content: results }
      }
    },
  }
}
