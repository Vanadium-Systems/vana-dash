import { inet, integer, pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { contractDocuments } from './contract-documents.js'
import { contracts } from './contracts.js'
import { tenantColumns } from './tenant-column.js'

export const SIGN_REQUEST_STATUSES = ['sent', 'opened', 'signed', 'declined', 'revoked', 'expired', 'locked'] as const
export type SignRequestStatus = (typeof SIGN_REQUEST_STATUSES)[number]

// A link sent to one person to sign one revision of a contract. The token, the emailed code and the
// short session after the code are stored only as SHA-256 hashes.
export const contractSignRequests = pgTable(
  'contract_sign_requests',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    // The revision the person reads and signs; a newer revision of the contract revokes the request.
    documentId: uuid('document_id')
      .notNull()
      .references(() => contractDocuments.id),
    signerName: text('signer_name').notNull(),
    signerEmail: text('signer_email').notNull(),
    signerRole: text('signer_role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: SIGN_REQUEST_STATUSES }).notNull().default('sent'),
    otpHash: text('otp_hash'),
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    otpAttempts: integer('otp_attempts').notNull().default(0),
    sessionHash: text('session_hash'),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedDocumentId: uuid('signed_document_id').references(() => contractDocuments.id),
    certificateDocumentId: uuid('certificate_document_id').references(() => contractDocuments.id),
    downloadUntil: timestamp('download_until', { withTimezone: true }),
    declineReason: text('decline_reason'),
  },
  (t) => [uniqueIndex('uq_contract_sign_requests_token').on(t.tokenHash), index('idx_contract_sign_requests_contract').on(t.contractId)],
)

export const SIGN_EVENT_KINDS = ['sent', 'opened', 'otp_sent', 'otp_ok', 'otp_fail', 'signed', 'declined', 'revoked', 'downloaded', 'locked'] as const

// The evidence trail of a signature: rows are only ever added (the RLS policies give no UPDATE or DELETE).
export const contractSignEvents = pgTable(
  'contract_sign_events',
  {
    ...tenantColumns,
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => contractSignRequests.id),
    kind: text('kind', { enum: SIGN_EVENT_KINDS }).notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    documentSha256: text('document_sha256'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_contract_sign_events_request').on(t.requestId)],
)
