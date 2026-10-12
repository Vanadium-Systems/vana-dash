import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js'

// Istoricul din DB nu garantează forma cerută de API-uri (fiecare tool_use urmat imediat de
// tool_result-ul lui, roluri alternante): rundele fără conținut, rezultatele confirmărilor
// adăugate după textul modelului și conversațiile salvate înainte ca rezultatele tool-urilor
// să fie persistate. Reparăm la încărcare, DB-ul rămâne cum e.

const MISSING_RESULT = 'Rezultatul acestui apel nu a fost păstrat.'
// Rezultatele din turele anterioare (liste de emailuri, facturi) ajung ușor la zeci de mii de
// tokeni și s-ar retrimite la fiecare mesaj. În tura curentă modelul le vede întregi.
const OLD_RESULT_MAX_CHARS = 2000

function blocksOf(message: BetaMessageParam): BetaContentBlockParam[] {
  return typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [...message.content]
}

function toolUseIds(blocks: BetaContentBlockParam[]): string[] {
  return blocks.flatMap((b) => (b.type === 'tool_use' ? [b.id] : []))
}

function missingResults(ids: string[]): BetaMessageParam {
  return { role: 'user', content: ids.map((id) => ({ type: 'tool_result' as const, tool_use_id: id, content: MISSING_RESULT })) }
}

function toolResultText(block: Extract<BetaContentBlockParam, { type: 'tool_result' }>): string {
  if (typeof block.content === 'string') return block.content
  if (!Array.isArray(block.content)) return ''
  return block.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
}

export function repairHistory(messages: BetaMessageParam[]): BetaMessageParam[] {
  const merged: Array<{ role: BetaMessageParam['role']; content: BetaContentBlockParam[] }> = []
  for (const message of messages) {
    const blocks = blocksOf(message).filter((b) => b.type !== 'text' || b.text.trim().length > 0)
    if (blocks.length === 0) continue
    const previous = merged.at(-1)
    // două runde ale asistentului se lipesc doar dacă prima n-a cerut tool-uri — altfel textul
    // celei de-a doua ar ajunge înaintea rezultatelor
    if (previous?.role === message.role && (message.role === 'user' || toolUseIds(previous.content).length === 0)) previous.content.push(...blocks)
    else merged.push({ role: message.role, content: blocks })
  }

  const out: BetaMessageParam[] = []
  for (let i = 0; i < merged.length; i++) {
    const message = merged[i]!
    const previous = merged[i - 1]
    if (message.role === 'assistant') {
      if (previous?.role === 'assistant') out.push(missingResults(toolUseIds(previous.content)))
      out.push(message)
      continue
    }

    const expectedIds = previous?.role === 'assistant' ? toolUseIds(previous.content) : []
    const results = new Map<string, BetaContentBlockParam>()
    const rest: BetaContentBlockParam[] = []
    for (const block of message.content) {
      if (block.type !== 'tool_result') {
        rest.push(block)
      } else if (expectedIds.includes(block.tool_use_id) && !results.has(block.tool_use_id)) {
        const text = toolResultText(block)
        results.set(
          block.tool_use_id,
          text.length > OLD_RESULT_MAX_CHARS
            ? { type: 'tool_result', tool_use_id: block.tool_use_id, content: `${text.slice(0, OLD_RESULT_MAX_CHARS)}\n[…scurtat, rezultat dintr-o tură anterioară; cheamă din nou tool-ul dacă ai nevoie de tot]` }
            : block,
        )
      } else {
        // rezultat fără tool_use imediat înainte (ex. confirmarea unei acțiuni) — modelul îl
        // primește ca text, altfel API-ul respinge tot istoricul
        rest.push({ type: 'text', text: `[Rezultat acțiune ${block.tool_use_id}]: ${toolResultText(block)}` })
      }
    }
    const ordered = expectedIds.map(
      (id) => results.get(id) ?? { type: 'tool_result' as const, tool_use_id: id, content: MISSING_RESULT },
    )
    out.push({ role: 'user', content: [...ordered, ...rest] })
  }

  // tool_use fără niciun mesaj user după (tură întreruptă) — rezultat lipsă, ca să nu blocheze tura următoare
  const last = merged.at(-1)
  if (last?.role === 'assistant' && toolUseIds(last.content).length > 0) out.push(missingResults(toolUseIds(last.content)))
  return out
}
