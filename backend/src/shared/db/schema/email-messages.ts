import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailThreads } from './email-threads.js'
import { emailLabels } from './email-labels.js'
import { users } from './users.js'

// Mesaje individuale — inbound din webhook Resend + outbound reply-uri legate de thread.
export const emailMessages = pgTable(
  'email_messages',
  {
    ...standardColumns,
    threadId: uuid('thread_id')
      .notNull()
      .references(() => emailThreads.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    // id-ul Resend — unic pt. upsert idempotent pe re-livrare webhook. Nullable: doar
    // mesajele 'in' din webhook îl au garantat; 'out' poate popula opțional id-ul trimiterii reale.
    resendEmailId: text('resend_email_id'),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    // Header Reply-To, dacă expeditorul l-a setat explicit (diferit de From — comun la
    // trimițători bulk/transacționali). NULL dacă lipsește — reply-ul cade pe fromAddress.
    // Bug găsit de Stefan (2026-07-24): worker-ul Cloudflare punea `message.from` (envelope
    // SMTP, gen bounces+xxx@outbound.intercom.mail...) pe fromAddress în loc de header-ul
    // From: real, deci reply-urile plecau spre o adresă de bounce moartă.
    replyToAddress: text('reply_to_address'),
    subject: text('subject').notNull(),
    bodyText: text('body_text'),
    // Sprint 3 (2026-07-24) — HTML brut, NESANITIZAT (sanitizarea e strict client-side la
    // randare, DOMPurify — vezi modules/email/HtmlMessageBody.tsx FE). Nullable: mesajele vechi
    // (înainte de editorul rich-text, 2026-08-11) rămân doar text — 'out' îl populează acum
    // (mirrorOutboundMessage/replyToThread/forwardMessage, modules/email/inbound-service.ts).
    bodyHtml: text('body_html'),
    // null pentru mesaje 'out'
    receivedAt: timestamp('received_at', { withTimezone: true }),
    // Stare mailbox (PLAN.md — paritate Gmail). `folder` e relevant DOAR pt. direction='in';
    // rândurile 'out' rămân pe implicitul 'inbox', inofensiv (view-urile de Inbox filtrează
    // explicit direction='in').
    isRead: boolean('is_read').notNull().default(false),
    isStarred: boolean('is_starred').notNull().default(false),
    folder: text('folder', { enum: ['inbox', 'archive', 'trash', 'spam'] }).notNull().default('inbox'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    labelId: uuid('label_id').references(() => emailLabels.id, { onDelete: 'set null' }),
    // self-referință — callback cu tip explicit, pattern Drizzle pt. FK către propriul tabel.
    forwardOfMessageId: uuid('forward_of_message_id').references((): AnyPgColumn => emailMessages.id, {
      onDelete: 'set null',
    }),
    // Sprint D, Track 5 — cale de ingestie nouă (Cloudflare Email Routing, nu doar Resend).
    // Message-ID (header RFC) — disponibil direct din payload-ul Worker-ului, spre deosebire
    // de Resend (unde threading-ul se baza pe resendEmailId). Folosit pt. dedup + threading
    // DOAR pe calea 'cloudflare' (Resend continuă să folosească resendEmailId, neatins).
    sourceMessageId: text('source_message_id'),
    // 'gmail-import' — backfill one-off din arhiva Gmail (script import-gmail-mbox-archive.ts,
    // pre-cutover E3), NU o cale de ingest live. Coloană TEXT simplă (enum-ul e doar la nivel
    // TS, fără CHECK constraint în DB), deci adăugarea valorii nu cere migrare.
    inboundSource: text('inbound_source', { enum: ['resend', 'cloudflare', 'gmail-import'] }).notNull().default('resend'),
    // Cine a trimis, pe orice cale (compose, reply, forward, bulk, secvență, asistent) —
    // aceeași cutie poate fi la doi oameni, deci adresa nu mai spune cine (PLAN.md C2).
    // null = trimis înainte de Etapa 1 (backfill = Stefan) sau de un job fără actor.
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // idempotent pe webhook retry — mai multe NULL-uri permise în Postgres
    uniqueIndex('uq_email_messages_resend_id').on(t.resendEmailId),
    index('idx_email_messages_folder').on(t.folder),
    index('idx_email_messages_label').on(t.labelId),
    index('idx_email_messages_sent_by').on(t.sentByUserId),
    // Dedup pe calea Cloudflare — parțial, ca rândurile 'resend' (sourceMessageId mereu
    // null acolo) să nu intre în conflict între ele.
    uniqueIndex('uq_email_messages_source_message_id')
      .on(t.sourceMessageId)
      .where(sql`${t.inboundSource} = 'cloudflare'`),
  ],
)
