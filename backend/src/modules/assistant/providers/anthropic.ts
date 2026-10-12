/* eslint-disable @typescript-eslint/no-explicit-any -- BetaRunnableTool e generic peste Input; `any` e cerut de SDK (același pattern ca tools/index.ts) */
import Anthropic from '@anthropic-ai/sdk'
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool'
import type { AssistantProvider, NeutralAssistantTool, ProviderTurnEvent, ProviderTurnParams } from './types.js'

/** Adaptor BetaRunnableTool → NeutralAssistantTool — singurul loc care atinge API-ul SDK-ului
 *  pt. tool-uri. Structura minimă de mai jos e comună tuturor tool-urilor produse de
 *  betaZodTool (variantele memory ale uniunii SDK n-au description/input_schema pe tip, dar
 *  tool-urile noastre da). `parse` validează inputul modelului înainte de run. */
export function toNeutralTools(betaTools: BetaRunnableTool<any>[]): NeutralAssistantTool[] {
  return betaTools.map((raw) => {
    const tool = raw as unknown as {
      name: string
      description?: string
      input_schema: Record<string, unknown>
      run: (args: any, context?: unknown) => Promise<string>
      parse: (content: unknown) => any
    }
    return {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema,
      async execute(toolCallId: string, input: unknown) {
        const parsed = typeof tool.parse === 'function' ? tool.parse(input) : input
        const context = { toolUse: { type: 'tool_use', id: toolCallId, name: tool.name, input: parsed } }
        return String(await tool.run(parsed, context))
      },
      beta: raw,
    }
  })
}

// AnthropicProvider — refactor 1:1 al buclei din service.ts driveRunner (2026-07-24),
// sub interfața comună. Comportament identic: stream per rundă, conținutul fiecărei runde
// ajunge în turn_end (persistarea rămâne la service), oprire la stop_reason !== 'tool_use'
// sau când există acțiuni pending confirm.
export function createAnthropicProvider(apiKey: string): AssistantProvider {
  const client = new Anthropic({ apiKey })
  return {
    id: 'anthropic',
    async *streamTurn(params: ProviderTurnParams): AsyncGenerator<ProviderTurnEvent> {
      const betaTools = params.tools.map((t) => t.beta).filter((t): t is BetaRunnableTool<any> => Boolean(t))
      if (betaTools.length !== params.tools.length) throw new Error('AnthropicProvider cere tool-uri BetaRunnableTool')

      const runner = client.beta.messages.toolRunner({
        model: params.model,
        max_tokens: 8000,
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        tools: betaTools,
        messages: params.messages,
        stream: true,
      })

      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text }
          }
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            yield { type: 'tool_call', toolName: event.content_block.name }
          }
        }
        const finalMessage = await messageStream.finalMessage()
        yield {
          type: 'turn_end',
          content: finalMessage.content,
          usage: { inputTokens: finalMessage.usage.input_tokens, outputTokens: finalMessage.usage.output_tokens },
        }
        if (params.shouldStopAfterTurn()) break
        if (finalMessage.stop_reason !== 'tool_use') break
        // runner-ul ține răspunsul în cache — următoarea iterație nu mai execută tool-urile a doua oară
        const toolResponse = await runner.generateToolResponse()
        if (toolResponse && Array.isArray(toolResponse.content)) yield { type: 'tool_results', content: toolResponse.content }
      }
    },
  }
}
