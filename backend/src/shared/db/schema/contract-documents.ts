import { boolean, index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { billingClients } from './billing-clients.js'
import { contractAddenda } from './contract-addenda.js'
import { tenantColumns } from './tenant-column.js'

// Ledger-ul PDF-urilor contractuale generate — servește și ca bază pt. wave-ul CertSign
// ulterior (status semnat/nesemnat per DOCUMENT, nu per client ca-n sistemul YAML vechi).
// Fără protecție "nu regenera peste semnat": fiecare generare creează un rând nou (istoric
// complet, niciun fișier suprascris pe disc) — FE avertizează, nu blochează.
export const contractDocuments = pgTable(
  'contract_documents',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    billingClientId: uuid('billing_client_id')
      .notNull()
      .references(() => billingClients.id),
    docType: text('doc_type', { enum: ['contract', 'anexa', 'act_aditional'] }).notNull(),
    // Doar pt. doc_type='act_aditional' — leagă documentul de actul adițional care l-a generat.
    addendumId: uuid('addendum_id').references(() => contractAddenda.id),
    pdfStoragePath: text('pdf_storage_path').notNull(),
    isSigned: boolean('is_signed').notNull().default(false),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    // 2026-09-03 — sprint semnătură digitală (tab „Semnează"). Dreptunghiul ales de Stefan pt.
    // poziția semnăturii, coordonate normalizate 0..1 față de pagină (independent de zoom-ul
    // din UI la desenare). Null = nesetat încă.
    signatureRect: jsonb('signature_rect').$type<{ page: number; x: number; y: number; width: number; height: number }>(),
    // Un document semnat e un RÂND NOU care referă originalul nesemnat (nu overwrite — același
    // pattern ca „regenerarea creează un document nou", vezi ContractsTab.tsx).
    sourceDocumentId: uuid('source_document_id').references((): AnyPgColumn => contractDocuments.id, { onDelete: 'set null' }),
  },
  (t) => [index('idx_contract_documents_client_type').on(t.billingClientId, t.docType, t.addendumId)],
)
