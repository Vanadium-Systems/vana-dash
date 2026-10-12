/* eslint-disable @typescript-eslint/no-explicit-any -- BetaRunnableTool e generic peste Input; `any` e cerut de SDK (același pattern ca tools/index.ts) */
// Contractul provider-neutral al asistentului (Contract K, PLAN.md 2026-08-25). DB-ul rămâne
// în format Anthropic content blocks — doar stratul de transport convertește.

import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool'
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js'

/** Tool vazut de provideri — derivat din BetaRunnableTool (shared.ts), fără dependență de SDK
 *  în bucla OpenRouter. `beta` poartă originalul SDK pt. toolRunner-ul Anthropic (type-only). */
export interface NeutralAssistantTool {
  name: string
  description: string
  /** JSON Schema — identic semantic cu input_schema (Anthropic) și parameters (OpenAI). */
  parameters: Record<string, unknown>
  /** Execută tool-ul (auto sau înregistrare confirm) și întoarce textul tool_result-ului. */
  execute(toolCallId: string, input: unknown): Promise<string>
  beta?: BetaRunnableTool<any>
}

export interface ProviderTurnParams {
  model: string
  system: string
  tools: NeutralAssistantTool[]
  /** Istoric în format Anthropic (formatul canonic din DB). */
  messages: BetaMessageParam[]
  /** True după o rundă care a înregistrat acțiuni pending — oprește bucla de tool-uri. */
  shouldStopAfterTurn(): boolean
}

/** turn_end poartă conținutul rundei ÎN FORMAT ANTHROPIC — exact ce se persistă în DB.
 *  usage = tokenii raportați de provider pt. runda respectivă (meter-ul de context din UI).
 *  tool_results = blocurile tool_result trimise modelului după o rundă cu tool_use; se
 *  persistă ca mesaj user, altfel tura următoare pleacă cu tool_use fără rezultat. */
export type ProviderTurnEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string }
  | { type: 'turn_end'; content: BetaContentBlockParam[]; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'tool_results'; content: BetaContentBlockParam[] }

export interface AssistantProvider {
  readonly id: string
  streamTurn(params: ProviderTurnParams): AsyncGenerator<ProviderTurnEvent>
}

export const ASSISTANT_PROVIDER_IDS = ['anthropic', 'openrouter'] as const
export type AssistantProviderId = (typeof ASSISTANT_PROVIDER_IDS)[number]
