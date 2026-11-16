import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenantColumns } from './tenant-column.js'

// One data key per company, wrapped with MASTER_ENCRYPTION_KEY (AES-256-GCM). Secrets are
// encrypted with the data key, so rotating the master key re-wraps these few rows and leaves the
// data alone. The wrapped key is useless without the master key, which never reaches the DB.
export const tenantKeys = pgTable(
  'tenant_keys',
  {
    ...tenantColumns,
    // Short random id written into every ciphertext: v1:<keyId>:<payload>.
    keyId: text('key_id').primaryKey(),
    wrappedKey: text('wrapped_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // A retired key still decrypts; new values use the company's active key.
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  // Two first encryptions racing for the same company must end with one active key.
  (t) => [uniqueIndex('uq_tenant_keys_active').on(t.tenantId).where(sql`${t.retiredAt} is null`)],
)
