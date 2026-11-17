import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

/**
 * Dedicated SMTP mailboxes for outreach (bulk + sequences), each with its own
 * encrypted credentials (v1 envelope), daily cap, optional warm-up ramp, and
 * optional IMAP settings for asynchronous DSN bounce detection.
 */
export const outreachMailboxes = pgTable(
  'outreach_mailboxes',
  {
    ...tenantColumns,
    ...standardColumns,
    address: text('address').notNull(),
    displayName: text('display_name').notNull().default(''),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull().default(465),
    smtpSecure: boolean('smtp_secure').notNull().default(true),
    imapHost: text('imap_host'),
    imapPort: integer('imap_port'),
    imapSecure: boolean('imap_secure').notNull().default(true),
    authKind: text('auth_kind', { enum: ['password', 'oauth2'] }).notNull().default('password'),
    secretEnc: text('secret_enc').notNull(),
    dailyCap: integer('daily_cap').notNull().default(30),
    warmupUntil: timestamp('warmup_until', { withTimezone: true }),
    status: text('status', { enum: ['active', 'paused', 'error'] }).notNull().default('active'),
    lastErrorCode: text('last_error_code'),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastImapCheckAt: timestamp('last_imap_check_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_outreach_mailboxes_tenant_address')
      .on(t.tenantId, sql`lower(${t.address})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check('ck_outreach_mailboxes_auth_kind', sql`${t.authKind} IN ('password', 'oauth2')`),
    check('ck_outreach_mailboxes_status', sql`${t.status} IN ('active', 'paused', 'error')`),
    check('ck_outreach_mailboxes_daily_cap', sql`${t.dailyCap} >= 1`),
  ],
)
