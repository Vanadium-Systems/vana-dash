import { eq, like, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { dashboardConfig } from '../../shared/db/schema/index.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import type { EmailSettingsUpdateSchema, LogoUploadSchema } from './settings-schema.js'
import { tr } from '../../shared/lib/i18n.js'

// Setări editabile din UI (Setări Email), stocate în dashboard_config (jsonb key/value, tabelă
// existentă, nefolosită până la acest sprint) — .env rămâne doar fallback pt. instalări proaspete.

const KEYS = {
  // Semnătură per identitate de trimitere (2026-09-30): `email.signature.<identityKey>`. Cele
  // două chei de azi sunt tot `stefan` și `contact`, deci valorile salvate rămân pe identitățile
  // lor, fără migrare. O identitate nouă, fără rând, primește semnătura de firmă.
  signaturePrefix: 'email.signature.',
  logo: 'email.logo', // { path: string, contentType: string }
  autoSpamEnabled: 'email.auto_spam_enabled',
  spamThreshold: 'email.spam_threshold',
  spamKeywords: 'email.spam_keywords',
  outreachDailyCap: 'email.outreach_daily_cap',
  outreachSendHour: 'email.outreach_send_hour',
  outreachSendWeekdaysOnly: 'email.outreach_send_weekdays_only',
  identities: 'email.identities',
  autoLoadImages: 'email.auto_load_images',
} as const

// Plafon manual (nu mai există rampă automată — Stefan a cerut control direct din UI, 2026-08-17,
// după ce rampa bazată pe OUTREACH_DOMAIN_LAUNCH_DATE ar fi sărit direct la 150/zi). Pornește
// conservator, Stefan îl urcă singur pe măsură ce vede cum merge livrarea.
export const DEFAULT_OUTREACH_DAILY_CAP = 50

// Fereastra de trimitere (2026-08-17, cerere Stefan) — oră Europe/Bucharest + doar zile
// lucrătoare, verificate de jobs/email-sequence-runner.ts (server-ul rulează în UTC).
export const DEFAULT_OUTREACH_SEND_HOUR = 10
export const DEFAULT_OUTREACH_SEND_WEEKDAYS_ONLY = true

export const DEFAULT_SPAM_KEYWORDS = [
  'click here',
  'you have won',
  'urgent wire transfer',
  'act now',
  'free money',
  'congratulations you',
  'crypto investment',
  'nigerian prince',
  'verify your account',
  'suspended account',
  'lottery winner',
]

interface LogoValue {
  path: string
  contentType: string
}

// Identități de trimitere (sprint de-hardcodare 2026-08-25) — editabile din Setări Email.
// Seed-ul e implicit (env-urile curente), nu un rând scris în DB: prima salvare din UI
// persistă lista, până atunci `fromAddress`-urile vin din config. `key` rămâne cheia stabilă
// referențiată de Compose/bulk/secvențe ('stefan'/'contact'/'outreach' azi).
export interface EmailIdentity {
  key: string
  label: string
  fromAddress: string
}

export function defaultIdentities(): EmailIdentity[] {
  return [
    { key: 'stefan', label: 'Stefan', fromAddress: config.emailFromStefan },
    { key: 'contact', label: 'Contact', fromAddress: config.emailFromContact },
    { key: 'noreply', label: 'No-reply', fromAddress: config.emailFromNoreply },
    // outreach poate fi neconfigurat din env (gol) — rândul rămâne vizibil în UI ca să poată
    // fi completat de acolo, fără redeploy (fail-soft la trimitere cade pe contact).
    { key: 'outreach', label: 'Outreach', fromAddress: config.emailFromOutreach },
  ]
}

async function getValue<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, key))
  return row ? (row.value as T) : null
}

/** Rândurile `email.signature.*` → `{ <identityKey>: html }`. Un rând cu șir gol e tot rând. */
async function getSignatureValues(): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: dashboardConfig.key, value: dashboardConfig.value })
    .from(dashboardConfig)
    .where(like(dashboardConfig.key, `${KEYS.signaturePrefix}%`))
  return Object.fromEntries(rows.map((row) => [row.key.slice(KEYS.signaturePrefix.length), row.value as string]))
}

async function setValue(key: string, value: unknown): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

export interface EmailSettings {
  /** Semnătură per identitate de trimitere, `<identityKey>` → HTML. Șirul gol = fără semnătură. */
  signatures: Record<string, string>
  logoUrl: string | null
  autoSpamEnabled: boolean
  spamThreshold: number
  spamKeywords: string[]
  outreachDailyCap: number
  outreachSendHour: number
  outreachSendWeekdaysOnly: boolean
  identities: EmailIdentity[]
  autoLoadImages: boolean
}

export async function getIdentities(): Promise<EmailIdentity[]> {
  const stored = await getValue<EmailIdentity[]>(KEYS.identities)
  return stored ?? defaultIdentities()
}

/**
 * Semnătura fiecărei identități, cu fallback pentru cele fără rând: `stefan` ia semnătura
 * personală, orice altă cutie semnătura de firmă — cea a identității `contact` dacă e salvată,
 * altfel cea din `.env`. Rândul există dar e gol înseamnă „fără semnătură" (o alegere), de
 * aceea `in stored`, nu `stored[key]`.
 */
function resolveSignatures(stored: Record<string, string>, identities: EmailIdentity[]): Record<string, string> {
  const companySignature = 'contact' in stored ? (stored['contact'] as string) : config.emailSignatureContactText
  return Object.fromEntries(
    identities.map((identity) => [
      identity.key,
      identity.key in stored
        ? (stored[identity.key] as string)
        : identity.key === 'stefan'
          ? config.emailSignatureStefanText
          : companySignature,
    ]),
  )
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const [storedSignatures, logo, autoSpamEnabled, spamThreshold, spamKeywords, outreachDailyCap, outreachSendHour, outreachSendWeekdaysOnly, identities, autoLoadImages] =
    await Promise.all([
      getSignatureValues(),
      getValue<LogoValue>(KEYS.logo),
      getValue<boolean>(KEYS.autoSpamEnabled),
      getValue<number>(KEYS.spamThreshold),
      getValue<string[]>(KEYS.spamKeywords),
      getValue<number>(KEYS.outreachDailyCap),
      getValue<number>(KEYS.outreachSendHour),
      getValue<boolean>(KEYS.outreachSendWeekdaysOnly),
      getIdentities(),
      getValue<boolean>(KEYS.autoLoadImages),
    ])

  // Absolut, nu relativ — semnătura ajunge într-un email citit de destinatari din afară, nu
  // există "origine curentă" ca într-un browser. Backend + frontend sunt pe același domeniu
  // (Caddy le proxy-ează pe amândouă), deci frontendOrigin e corect și aici.
  const logoUrl = logo ? `${config.frontendOrigin}/api/email/settings/logo` : config.emailLogoUrl || null

  return {
    signatures: resolveSignatures(storedSignatures, identities),
    logoUrl,
    autoSpamEnabled: autoSpamEnabled ?? true,
    spamThreshold: spamThreshold ?? 4,
    spamKeywords: spamKeywords ?? DEFAULT_SPAM_KEYWORDS,
    outreachDailyCap: outreachDailyCap ?? DEFAULT_OUTREACH_DAILY_CAP,
    outreachSendHour: outreachSendHour ?? DEFAULT_OUTREACH_SEND_HOUR,
    outreachSendWeekdaysOnly: outreachSendWeekdaysOnly ?? DEFAULT_OUTREACH_SEND_WEEKDAYS_ONLY,
    identities,
    autoLoadImages: autoLoadImages ?? false,
  }
}

export async function updateEmailSettings(input: z.infer<typeof EmailSettingsUpdateSchema>): Promise<EmailSettings> {
  const writes: Array<Promise<void>> = []
  for (const [identityKey, html] of Object.entries(input.signatures ?? {})) {
    writes.push(setValue(`${KEYS.signaturePrefix}${identityKey}`, html))
  }
  if (input.autoSpamEnabled !== undefined) writes.push(setValue(KEYS.autoSpamEnabled, input.autoSpamEnabled))
  if (input.spamThreshold !== undefined) writes.push(setValue(KEYS.spamThreshold, input.spamThreshold))
  if (input.spamKeywords !== undefined) writes.push(setValue(KEYS.spamKeywords, input.spamKeywords))
  if (input.outreachDailyCap !== undefined) writes.push(setValue(KEYS.outreachDailyCap, input.outreachDailyCap))
  if (input.outreachSendHour !== undefined) writes.push(setValue(KEYS.outreachSendHour, input.outreachSendHour))
  if (input.outreachSendWeekdaysOnly !== undefined) writes.push(setValue(KEYS.outreachSendWeekdaysOnly, input.outreachSendWeekdaysOnly))
  if (input.identities !== undefined) writes.push(setValue(KEYS.identities, input.identities))
  if (input.autoLoadImages !== undefined) writes.push(setValue(KEYS.autoLoadImages, input.autoLoadImages))
  await Promise.all(writes)
  return getEmailSettings()
}

const LOGO_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export class LogoTypeError extends Error {}

export async function uploadLogo(input: z.infer<typeof LogoUploadSchema>): Promise<void> {
  const buffer = Buffer.from(input.content, 'base64')
  // The extension ends up in the storage path, so it comes from a fixed list, not from the name.
  const ext = input.filename.split('.').pop()?.toLowerCase() ?? ''
  const contentType = LOGO_CONTENT_TYPES[ext]
  if (!contentType) throw new LogoTypeError(tr('errors.email.logoType'))
  const path = await saveDocument(`email/logo.${ext}`, buffer)
  await setValue(KEYS.logo, { path, contentType } satisfies LogoValue)
}

export async function getLogoFile(): Promise<{ buffer: Buffer; contentType: string } | null> {
  const logo = await getValue<LogoValue>(KEYS.logo)
  if (!logo) return null
  const buffer = await readDocument(logo.path)
  return { buffer, contentType: logo.contentType }
}
