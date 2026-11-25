import type { CompanyProfile } from '../../shared/lib/company.js'
import { markSignatureRoles } from '../../shared/lib/pdf-signature-fields.js'
import { currentLocale } from '../../shared/lib/request-context.js'
import type { SignerRole, TemplateField } from './registry-schema.js'

// The other side's details: read from the client or prospect picked, and editable on the form,
// because a prospect has no address and a name typed by hand has nothing at all.
export const PARTY_DETAIL_KEYS = ['cui', 'nrRegCom', 'adresa', 'reprezentant', 'functie', 'email'] as const
export type PartyDetailKey = (typeof PARTY_DETAIL_KEYS)[number]
export type PartyDetails = Partial<Record<PartyDetailKey, string>>

const COMPANY_KEYS = ['nume', 'cui', 'nrRegCom', 'adresa', 'reprezentant', 'email', 'telefon'] as const
type CompanyKey = (typeof COMPANY_KEYS)[number]

// Tokens every company template may use besides its own fields.
export const BUILTIN_TOKENS = [
  'contract.numar',
  'contract.data',
  'parte.nume',
  ...PARTY_DETAIL_KEYS.map((key) => `parte.${key}` as const),
  ...COMPANY_KEYS.map((key) => `firma.${key}` as const),
] as const

/** Our company, from the company sheet. The contract writes the office on one line, city first. */
export function companyDetails(profile: CompanyProfile): Record<CompanyKey, string> {
  const office = profile.registeredOffice
  return {
    nume: profile.name,
    cui: profile.cui,
    nrRegCom: profile.regCom,
    adresa: [office.city, office.street, office.number, office.details].map((part) => part.trim()).filter(Boolean).join(', '),
    reprezentant: profile.representative,
    email: profile.email,
    telefon: profile.phone,
  }
}

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
  party: PartyDetails
  company: Record<CompanyKey, string>
}

/** Values are escaped; the template HTML itself is the company's and is printed with JavaScript and the network off. */
export function renderCustomTemplate(input: RenderInput): string {
  const byKey = new Map(input.fields.map((f) => [f.key, f]))
  const builtins: Record<string, string> = {
    'contract.numar': input.numberLabel,
    'contract.data': formatDate(input.date),
    'parte.nume': input.counterpartyName,
    ...Object.fromEntries(PARTY_DETAIL_KEYS.map((key) => [`parte.${key}`, input.party[key] ?? ''])),
    ...Object.fromEntries(COMPANY_KEYS.map((key) => [`firma.${key}`, input.company[key]])),
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
