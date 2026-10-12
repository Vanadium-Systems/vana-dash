import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { contractTemplates, dashboardConfig } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import {
  CONTRACT_TEMPLATE_BODIES,
  CONTRACT_TEMPLATE_KEYS,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  DEFAULT_CONTRACT_FRAGMENTS,
  DEFAULT_CONTRACT_TERMS,
  renderContractHtml,
  renderAnexaHtml,
  renderActAditionalHtml,
  type ContractFragments,
  type ContractTemplateKey,
  type ContractTerms,
} from '../../shared/lib/contract-templates.js'
import type { ContractRenderData } from '../../shared/lib/contract-templates.js'
import type { ContractAddendum } from '../../shared/db/schema/contract-addenda.js'
import { ContractTermsUpdateSchema } from './templates-schema.js'

// Șabloanele de contract + termenii comerciali, editabile din UI (sprint de-hardcodare
// 2026-08-25). Seed-ul e lazy și idempotent (prima citire inserează corpurile canonice din
// shared/lib/contract-template-bodies.ts) — conținut identic cu randarea directă, garantat de
// testul care rulează ambele căi pe aceleași date.
//
// Un rând needitat (updated_at = created_at) urmează canonicalul din cod: altfel, după o
// schimbare de tokeni în cod (ex. scoaterea Perioadei Pilot, 2026-09), rândul seed-uit înainte
// rămânea cu tokeni pe care randarea nu-i mai știe și orice generare de contract crăpa.

export const TERMS_CONFIG_KEY = 'contract.terms'

type TemplateRow = typeof contractTemplates.$inferSelect

async function ensureSeeded(): Promise<void> {
  await db
    .insert(contractTemplates)
    .values(
      CONTRACT_TEMPLATE_KEYS.map((key) => ({
        key,
        name: TEMPLATE_NAMES[key],
        bodyHtml: CONTRACT_TEMPLATE_BODIES[key],
        placeholders: CONTRACT_TEMPLATE_PLACEHOLDERS[key],
      })),
    )
    .onConflictDoUpdate({
      target: contractTemplates.key,
      set: { bodyHtml: sql`excluded.body_html`, placeholders: sql`excluded.placeholders` },
      setWhere: sql`${contractTemplates.updatedAt} = ${contractTemplates.createdAt}`,
    })
}

const TEMPLATE_NAMES: Record<ContractTemplateKey, string> = {
  'contract-saas': 'Contract de servicii SaaS (+ DPA)',
  'anexa-preturi': 'Anexa de prețuri',
  'act-aditional': 'Act adițional',
}

export async function listTemplates(): Promise<TemplateRow[]> {
  await ensureSeeded()
  return db.select().from(contractTemplates).orderBy(contractTemplates.key)
}

/** Corpul curent al șablonului — rândul din DB sau corpul canonical dacă nu există/editat. */
export async function getTemplateBody(key: ContractTemplateKey): Promise<string> {
  await ensureSeeded()
  const [row] = await db.select({ bodyHtml: contractTemplates.bodyHtml }).from(contractTemplates).where(eq(contractTemplates.key, key))
  return row?.bodyHtml ?? CONTRACT_TEMPLATE_BODIES[key]
}

function validateTokens(key: ContractTemplateKey, bodyHtml: string): void {
  // Necunoscut = aproape sigur o greșeală de editare (token șters greșit din lista de inserare)
  // — respins la salvare, nu la prima generare de PDF.
  const known = new Set([...CONTRACT_TEMPLATE_PLACEHOLDERS[key].map((p) => p.token)])
  const used = [...bodyHtml.matchAll(/\{\{([a-zA-Z0-9._]+)\}\}/g)].map((m) => m[1]!)
  const unknown = [...new Set(used.filter((t) => !known.has(t)))]
  if (unknown.length > 0) throw new Error(`Tokeni necunoscuți: ${unknown.join(', ')}`)
}

export async function updateTemplate(key: ContractTemplateKey, bodyHtml: string): Promise<TemplateRow> {
  if (!CONTRACT_TEMPLATE_BODIES[key]) throw new Error('Șablon inexistent')
  validateTokens(key, bodyHtml)
  await ensureSeeded()
  const [row] = await db
    .update(contractTemplates)
    .set({ bodyHtml, updatedAt: new Date() })
    .where(eq(contractTemplates.key, key))
    .returning()
  return row!
}

/** Restaurare la original = rescriere cu corpul canonical (nu ștergere — cheia rămâne rezervată).
 *  updated_at revine la created_at ca rândul să urmeze iar canonicalul la schimbări viitoare. */
export async function restoreTemplate(key: ContractTemplateKey): Promise<TemplateRow> {
  await ensureSeeded()
  const [row] = await db
    .update(contractTemplates)
    .set({ bodyHtml: CONTRACT_TEMPLATE_BODIES[key], placeholders: CONTRACT_TEMPLATE_PLACEHOLDERS[key], updatedAt: sql`${contractTemplates.createdAt}` })
    .where(eq(contractTemplates.key, key))
    .returning()
  return row!
}

// ── Termeni comerciali (dashboard_config['contract.terms']) ──────────────────────────────────

export async function getContractTerms(): Promise<ContractTerms> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, TERMS_CONFIG_KEY))
  return { ...DEFAULT_CONTRACT_TERMS, ...(row ? (row.value as Partial<ContractTerms>) : {}) }
}

export async function updateContractTerms(patch: z.infer<typeof ContractTermsUpdateSchema>): Promise<ContractTerms> {
  const current = await getContractTerms()
  const next = { ...current, ...patch }
  await db
    .insert(dashboardConfig)
    .values({ key: TERMS_CONFIG_KEY, value: next })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
  // Termenii intră în toate contractele generate de acum încolo, deci schimbarea lor e de
  // greutate contabilă și merge în istoric (C2), cu valorile vechi pe câmpurile atinse.
  await recordAudit({
    action: 'contract.termeni.modificati',
    entityType: 'contract_terms',
    changes: Object.fromEntries(Object.keys(patch).map((field) => [field, [current[field as keyof ContractTerms], next[field as keyof ContractTerms]]])),
  })
  return next
}

// ── Conditional fragments (dashboard_config['contract.fragments']) ────────────────────────
//
// Like the bodies: what is saved in the database wins over the code, key by key. There is no
// editing screen for them; they are changed directly in the row.

export const FRAGMENTS_CONFIG_KEY = 'contract.fragments'

export async function getContractFragments(): Promise<ContractFragments> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, FRAGMENTS_CONFIG_KEY))
  const saved = (row?.value ?? {}) as Partial<ContractFragments>
  return {
    ...DEFAULT_CONTRACT_FRAGMENTS,
    ...saved,
    cuLunaGratuita: { ...DEFAULT_CONTRACT_FRAGMENTS.cuLunaGratuita, ...saved.cuLunaGratuita },
    faraLunaGratuita: { ...DEFAULT_CONTRACT_FRAGMENTS.faraLunaGratuita, ...saved.faraLunaGratuita },
  }
}

// ── Randarea documentelor prin corpul din DB ─────────────────────────────────────────────────

export async function renderDocument(docType: 'contract' | 'anexa', data: ContractRenderData): Promise<string> {
  const [bodyHtml, terms, fragments] = await Promise.all([getTemplateBody(docType === 'contract' ? 'contract-saas' : 'anexa-preturi'), getContractTerms(), getContractFragments()])
  return docType === 'contract' ? renderContractHtml(data, terms, bodyHtml, fragments) : renderAnexaHtml(data, terms, bodyHtml, fragments)
}

export async function renderAddendum(addendum: ContractAddendum, client: Parameters<typeof renderActAditionalHtml>[1], contractInfo: { nrContract: string; dataContract: string }): Promise<string> {
  const [bodyHtml, terms, fragments] = await Promise.all([getTemplateBody('act-aditional'), getContractTerms(), getContractFragments()])
  return renderActAditionalHtml(addendum, client, contractInfo, terms, bodyHtml, fragments)
}
