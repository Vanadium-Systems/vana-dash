import { asc, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { prospectStatuses } from '../../shared/db/schema/index.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { tr } from '../../shared/lib/i18n.js'
import type { SessionUser } from '../../shared/lib/session.js'
// The assistant is the only LLM provider in the app (key, model, monthly cap), so the phrase
// search reuses it instead of keeping a second provider config.
import { buildActiveProvider, resolveModel } from '../assistant/providers/index.js'
import { checkQuota, recordUsage } from '../assistant/quota.js'
import { FILTER_FIELDS, ProspectFilterSchema, type ProspectFilter } from './filters.js'

const MAX_FILTERS = 10

export class NlFiltersError extends Error {
  constructor(
    readonly code: 'ASSISTANT_FORBIDDEN' | 'ASSISTANT_NOT_CONFIGURED' | 'ASSISTANT_QUOTA',
    message: string,
  ) {
    super(message)
  }
}

export interface NlFiltersResult {
  filters: ProspectFilter[]
  understood: string
  dropped: number
}

/** The prompt carries the filter vocabulary, the company's statuses and today's date: never a prospect's data. */
export function buildSystemPrompt(statuses: Array<{ key: string; label: string }>, today: string): string {
  return `You turn a sales person's phrase into filters for a CRM prospect list. Answer with STRICT JSON only, no prose, no code fence:
{ "filters": [ ... ], "understood": "<one sentence, in the language of the phrase, saying what you understood>" }

Each filter is one of:
{ "field": F, "op": "in" | "not_in", "value": ["..."] }
{ "field": F, "op": "between", "value": [from, to] }   (either end may be null)
{ "field": F, "op": "is_empty" | "not_empty" }

F must be one of: ${FILTER_FIELDS.join(', ')}.
Values per field:
- status: a status key from the list below.
- owner: "me" (the person asking), "free" (no owner).
- priority: HOT, WARM, NURTURE, SKIP. score: number 0-100, use "between".
- nextTask: none, overdue, today, future.
- emailEvent: opened, clicked, bounced, replied, unsubscribed.
- isActive: "true" or "false".
- employees, revenue, value, foundingYear: numbers, use "between".
- expectedCloseAt, lastActivityAt, createdAt: dates as YYYY-MM-DD, use "between".
- caen: CAEN code or prefix. source: free text. people.role: free text.
- phone, email: only is_empty / not_empty. people.decisionMaker, people.doNotContact: only not_empty / is_empty.
Use only what the phrase says; at most ${MAX_FILTERS} filters. If the phrase has no usable filter, return "filters": [].

Company statuses (key: label):
${statuses.map((s) => `${s.key}: ${s.label}`).join('\n') || '(none)'}

Today is ${today}.`
}

/** First balanced `{...}` in the text, string-aware; null if there is none or it does not parse. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

const AnswerSchema = z.object({ filters: z.array(z.unknown()).default([]), understood: z.string().default('') })

export function parseAnswer(text: string): NlFiltersResult {
  const answer = AnswerSchema.safeParse(extractJsonObject(text))
  if (!answer.success) return { filters: [], understood: '', dropped: 0 }
  const filters: ProspectFilter[] = []
  let dropped = 0
  for (const raw of answer.data.filters) {
    const parsed = ProspectFilterSchema.safeParse(raw)
    if (parsed.success && filters.length < MAX_FILTERS) filters.push(parsed.data)
    else dropped++
  }
  return { filters, understood: answer.data.understood.slice(0, 300), dropped }
}

export async function interpretPhrase(me: SessionUser, text: string): Promise<NlFiltersResult> {
  if (!me.features.includes('asistent.view')) throw new NlFiltersError('ASSISTANT_FORBIDDEN', tr('errors.prospects.nlFiltersForbidden'))
  const quota = await checkQuota(me)
  if (!quota.ok) throw new NlFiltersError('ASSISTANT_QUOTA', quota.message)

  let active: Awaited<ReturnType<typeof buildActiveProvider>>
  let model: string
  try {
    active = await buildActiveProvider(null)
    model = await resolveModel(null, active.id)
  } catch {
    throw new NlFiltersError('ASSISTANT_NOT_CONFIGURED', tr('errors.prospects.nlFiltersNotConfigured'))
  }

  const statuses = await activeStatuses()
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: await getCompanyTimeZone() })
  let answer = ''
  let inputTokens = 0
  let outputTokens = 0
  try {
    for await (const event of active.provider.streamTurn({
      model,
      system: buildSystemPrompt(statuses, today),
      tools: [],
      messages: [{ role: 'user', content: text }],
      shouldStopAfterTurn: () => true,
    })) {
      if (event.type === 'text_delta') answer += event.text
      if (event.type === 'turn_end') {
        inputTokens += event.usage?.inputTokens ?? 0
        outputTokens += event.usage?.outputTokens ?? 0
      }
    }
  } catch (err) {
    // The phrase stays out of the log; the provider error code is enough to debug.
    console.error('[nl-filters] provider error', (err as { status?: number; code?: string }).status ?? (err as { code?: string }).code ?? 'unknown')
    throw new NlFiltersError('ASSISTANT_NOT_CONFIGURED', tr('errors.prospects.nlFiltersNotConfigured'))
  }
  await recordUsage(me, inputTokens, outputTokens)
  return parseAnswer(answer)
}

function activeStatuses() {
  return db
    .select({ key: prospectStatuses.key, label: prospectStatuses.label })
    .from(prospectStatuses)
    .where(isNull(prospectStatuses.deletedAt))
    .orderBy(asc(prospectStatuses.sortOrder))
}
