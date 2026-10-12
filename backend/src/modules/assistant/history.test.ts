import { describe, expect, it } from 'vitest'
import { repairHistory } from './history.js'

describe('repairHistory', () => {
  it('conversația salvată fără rezultatele tool-urilor și cu ture goale devine validă', () => {
    const repaired = repairHistory([
      { role: 'user', content: [{ type: 'text', text: 'scoate firmele' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Caut.' }, { type: 'tool_use', id: 't1', name: 'list_emails', input: {} }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Gata.' }] },
      { role: 'user', content: [{ type: 'text', text: 'SC ACME SRL' }] },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'text', text: 'sef?' }] },
    ])
    expect(repaired).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'scoate firmele' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Caut.' }, { type: 'tool_use', id: 't1', name: 'list_emails', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Rezultatul acestui apel nu a fost păstrat.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Gata.' }] },
      { role: 'user', content: [{ type: 'text', text: 'SC ACME SRL' }, { type: 'text', text: 'sef?' }] },
    ])
  })

  it('rezultatul salvat rămâne pe loc; confirmarea venită după textul modelului devine text', () => {
    const repaired = repairHistory([
      { role: 'user', content: [{ type: 'text', text: 'trimite factura' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'send_invoice', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Acțiune înregistrată' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Aștept confirmarea.' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Acțiune executată cu succes' }] },
    ])
    expect(repaired.slice(2)).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Acțiune înregistrată' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Aștept confirmarea.' }] },
      { role: 'user', content: [{ type: 'text', text: '[Rezultat acțiune c1]: Acțiune executată cu succes' }] },
    ])
  })

  it('rezultatele lungi din turele anterioare se scurtează', () => {
    const [, , results] = repairHistory([
      { role: 'user', content: [{ type: 'text', text: 'emailuri' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'list_emails', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'x'.repeat(50_000) }] },
    ])
    const block = (results!.content as Array<{ type: string; content: string }>)[0]!
    expect(block.type).toBe('tool_result')
    expect(block.content.length).toBeLessThan(2200)
    expect(block.content).toContain('scurtat')
  })
})
