import { jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Șabloanele documentelor contractuale (sprint de-hardcodare 2026-08-25) — HTML cu tokeni
// {{placeholder}}, editabile din UI (Setări → Șabloane). Sursa originală rămâne în
// shared/lib/contract-templates.ts: seed-ul DB e transcrierea lui, iar "restaurare la
// original" revine la ea. `placeholders` documentează token-ii disponibili per șablon:
// [{ token, descriere, exemplu }] — FE îi afișează ca inserare rapidă în editor.
export const contractTemplates = pgTable('contract_templates', {
  ...standardColumns,
  // 'contract-saas' | 'anexa-preturi' | 'act-aditional'
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  bodyHtml: text('body_html').notNull(),
  placeholders: jsonb('placeholders').notNull().default([]),
})
