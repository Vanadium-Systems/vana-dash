import { describe, expect, it } from 'vitest'
import type { SignerRole, TemplateField } from './registry-schema.js'
import { renderCustomTemplate, unknownTokens } from './template-render.js'

const field = (key: string, type: TemplateField['type'] = 'text'): TemplateField => ({ key, label: { ro: key, en: key }, type, required: false })

const render = (bodyHtml: string, values: Record<string, unknown>, signerRoles: SignerRole[] = []) =>
  renderCustomTemplate({
    bodyHtml,
    fields: [field('scope')],
    signerRoles,
    values,
    numberLabel: 'C-001',
    date: '2030-03-05',
    counterpartyName: 'Acme SRL',
    party: { cui: 'RO123', adresa: 'Str. Lungă 1' },
    company: { nume: 'Beta SRL', cui: 'RO999', nrRegCom: 'J00/1/2030', adresa: 'Oraș, Str. Scurtă 2', reprezentant: 'Ana', email: 'office@example.com', telefon: '0700' },
  })

describe('renderCustomTemplate', () => {
  it('escapes the values but not the template itself', () => {
    const html = render('<p>{{scope}} / {{parte.nume}}</p>', { scope: '<script>alert(1)</script>' })
    expect(html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt; / Acme SRL</p>')
    expect(html).not.toContain('<script>')
  })

  it('fills the built-in tokens', () => {
    expect(render('{{contract.numar}}', {})).toBe('C-001')
  })

  it('fills the party and company tokens, empty when the party detail is missing', () => {
    expect(render('{{parte.cui}}|{{parte.adresa}}|{{parte.functie}}|{{firma.nume}}|{{firma.cui}}', {})).toBe('RO123|Str. Lungă 1||Beta SRL|RO999')
  })

  it('links a signature field only for the roles that are not ours', () => {
    const body = '<div data-sign-role="Furnizor">a</div><div data-sign-role="Beneficiar">b</div>'
    const html = render(body, {}, [
      { role: 'Furnizor', own: true },
      { role: 'Beneficiar', own: false },
    ])
    expect(html.match(/<a href=/g)).toHaveLength(1)
    expect(html).toMatch(/<a href="[^"]*Beneficiar"/)
    expect(html).not.toMatch(/<a href="[^"]*Furnizor"/)
  })
})

describe('unknownTokens', () => {
  it('lists what is neither a field nor a built-in', () => {
    expect(unknownTokens('{{scope}} {{contract.numar}} {{parte.cui}} {{firma.adresa}} {{xyz}} {{ other.one }} {{xyz}}', [field('scope')])).toEqual(['xyz', 'other.one'])
  })
})
