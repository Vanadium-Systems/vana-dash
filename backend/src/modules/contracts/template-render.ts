import { markSignatureRoles } from '../../shared/lib/pdf-signature-fields.js'
import { currentLocale } from '../../shared/lib/request-context.js'
import type { SignerRole, TemplateField } from './registry-schema.js'

// Tokens every company template may use besides its own fields.
export const BUILTIN_TOKENS = ['contract.numar', 'contract.data', 'parte.nume'] as const

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g

export function templateTokens(bodyHtml: string): string[] {
  return [...new Set([...bodyHtml.matchAll(TOKEN)].map((m) => m[1]!))]
}

/** Tokens in the body that are neither a field nor a built-in: almost always a typo, refused on save. */
export function unknownTokens(bodyHtml: string, fields: TemplateField[]): string[] {
  const known = new Set<string>([...BUILTIN_TOKENS, ...fields.map((f) => f.key)])
  return templateTokens(bodyHtml).filter((t) => !known.has(t))
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

/** Required fields left empty, by label, for the 400 the form shows. */
export function missingFields(fields: TemplateField[], values: Record<string, unknown>): string[] {
  const locale = currentLocale()
  return fields
    .filter((f) => f.required && (values[f.key] === undefined || values[f.key] === null || String(values[f.key]).trim() === ''))
    .map((f) => f.label[locale] ?? f.label.ro)
}

export interface RenderInput {
  bodyHtml: string
  fields: TemplateField[]
  signerRoles: SignerRole[]
  values: Record<string, unknown>
  numberLabel: string
  date: string
  counterpartyName: string
}

/** Values are escaped; the template HTML itself is the company's and is printed with JavaScript and the network off. */
export function renderCustomTemplate(input: RenderInput): string {
  const byKey = new Map(input.fields.map((f) => [f.key, f]))
  const builtins: Record<string, string> = {
    'contract.numar': input.numberLabel,
    'contract.data': formatDate(input.date),
    'parte.nume': input.counterpartyName,
  }
  const html = input.bodyHtml.replace(TOKEN, (_m, key: string) => {
    if (key in builtins) return escapeHtml(builtins[key]!)
    const field = byKey.get(key)
    const raw = input.values[key] ?? field?.default ?? ''
    const text = field?.type === 'date' ? formatDate(String(raw)) : String(raw)
    return escapeHtml(text)
  })
  return markSignatureRoles(html, input.signerRoles.filter((r) => r.own).map((r) => r.role))
}
