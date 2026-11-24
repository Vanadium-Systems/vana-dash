import { sql } from 'drizzle-orm'
import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Șabloanele documentelor contractuale (sprint de-hardcodare 2026-08-25) — HTML cu tokeni
// {{placeholder}}, editabile din UI (Setări → Șabloane). Sursa originală rămâne în
// shared/lib/contract-templates.ts: seed-ul DB e transcrierea lui, iar "restaurare la
// original" revine la ea. `placeholders` documentează token-ii disponibili per șablon:
// [{ token, descriere, exemplu }] — FE îi afișează ca inserare rapidă în editor.
export const contractTemplates = pgTable('contract_templates', {
  ...tenantColumns,
  ...standardColumns,
  // 'contract-saas' | 'anexa-preturi' | 'act-aditional'
  // Set only on the three SaaS templates; the company's own templates have none.
  key: text('key'),
  name: text('name').notNull(),
  bodyHtml: text('body_html').notNull(),
  placeholders: jsonb('placeholders').notNull().default([]),
  category: text('category'),
  fields: jsonb('fields').notNull().default([]),
  seriesId: uuid('series_id'),
  signerRoles: jsonb('signer_roles').notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
}, (t) => [uniqueIndex('uq_contract_templates_tenant_key').on(t.tenantId, t.key).where(sql`${t.key} IS NOT NULL`)])
