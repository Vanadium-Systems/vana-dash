import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailTemplates } from './email-templates.js'
import { prospects } from './prospects.js'

// Sprint Secvențe outreach (2026-08-12) — drip automat peste bulkSend existent (vezi
// PLAN.md). O secvență = listă ordonată de pași (template + delay), pornită per destinatar
// printr-un enrollment.
export const emailSequences = pgTable('email_sequences', {
  ...standardColumns,
  name: text('name').notNull(),
  // Din sprintul de-hardcodare (2026-08-25): orice cheie de identitate configurată din Setări
  // (nu doar cele 3 inițiale) — text simplu, validarea e la nivel de service contra listei.
  fromIdentity: text('from_identity').notNull(),
  active: boolean('active').notNull().default(true),
})

export const emailSequenceSteps = pgTable(
  'email_sequence_steps',
  {
    ...standardColumns,
    sequenceId: uuid('sequence_id')
      .notNull()
      .references(() => emailSequences.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => emailTemplates.id),
    // Zile de la enrollment (pasul 1) sau de la pasul anterior (restul) — vezi jobs/email-sequence-runner.ts.
    delayDays: integer('delay_days').notNull(),
  },
  (t) => [uniqueIndex('uq_email_sequence_steps_order').on(t.sequenceId, t.stepOrder)],
)

export const emailSequenceEnrollments = pgTable(
  'email_sequence_enrollments',
  {
    ...standardColumns,
    sequenceId: uuid('sequence_id')
      .notNull()
      .references(() => emailSequences.id, { onDelete: 'cascade' }),
    // nullable — un enrollment poate viza un destinatar fără rând în `prospects` (ex. adresă liberă).
    prospectId: uuid('prospect_id').references(() => prospects.id),
    recipientEmail: text('recipient_email').notNull(),
    // pt. placeholder {{nume}} — nu depinde de prospects.name (poate diferi la enroll).
    recipientName: text('recipient_name'),
    // 0 = neînceput; N = ultimul pas trimis cu succes.
    currentStep: integer('current_step').notNull().default(0),
    status: text('status', { enum: ['active', 'replied', 'unsubscribed', 'completed', 'failed'] })
      .notNull()
      .default('active'),
    // 3 eșecuri consecutive → status='failed' (adresă moartă, nu mai reîncearcă la nesfârșit).
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    nextSendAt: timestamp('next_send_at', { withTimezone: true }).notNull().defaultNow(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  },
  (t) => [
    // Nu poți înrola de 2 ori același destinatar în aceeași secvență.
    uniqueIndex('uq_email_sequence_enrollments_recipient').on(t.sequenceId, t.recipientEmail),
    // Query-ul cron-ului "ce-i due azi".
    index('idx_email_sequence_enrollments_due').on(t.status, t.nextSendAt),
  ],
)
