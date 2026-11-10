import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailTemplates } from './email-templates.js'
import { prospects } from './prospects.js'
import { prospectTasks } from './prospect-crm.js'
import { tenantColumns } from './tenant-column.js'

// Sprint Secvențe outreach (2026-08-12) — drip automat peste bulkSend existent (vezi
// PLAN.md). O secvență = listă ordonată de pași (template + delay), pornită per destinatar
// printr-un enrollment.
export const emailSequences = pgTable('email_sequences', {
  ...tenantColumns,
  ...standardColumns,
  name: text('name').notNull(),
  // Din sprintul de-hardcodare (2026-08-25): orice cheie de identitate configurată din Setări
  // (nu doar cele 3 inițiale) — text simplu, validarea e la nivel de service contra listei.
  fromIdentity: text('from_identity').notNull(),
  active: boolean('active').notNull().default(true),
  stopOnMeeting: boolean('stop_on_meeting').notNull().default(true),
  stopOnWonLost: boolean('stop_on_won_lost').notNull().default(true),
  // Set by the bounce-rate guard (or by hand); the runner skips paused sequences.
  pausedReason: text('paused_reason'),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
})

export const SEQUENCE_STEP_KINDS = [
  'email',
  'call',
  'task',
  'linkedin_connect',
  'linkedin_message',
  'linkedin_view',
  'linkedin_engage',
] as const

export const emailSequenceSteps = pgTable(
  'email_sequence_steps',
  {
    ...tenantColumns,
    ...standardColumns,
    sequenceId: uuid('sequence_id')
      .notNull()
      .references(() => emailSequences.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    kind: text('kind', { enum: SEQUENCE_STEP_KINDS }).notNull().default('email'),
    // Only email steps have a template; call / task steps create a prospect task instead.
    templateId: uuid('template_id').references(() => emailTemplates.id),
    variantBTemplateId: uuid('variant_b_template_id').references(() => emailTemplates.id),
    taskTitle: text('task_title'),
    taskDescription: text('task_description'),
    // Zile de la enrollment (pasul 1) sau de la pasul anterior (restul) — vezi jobs/email-sequence-runner.ts.
    delayDays: integer('delay_days').notNull(),
  },
  (t) => [
    uniqueIndex('uq_email_sequence_steps_order').on(t.sequenceId, t.stepOrder),
    check(
      'ck_email_sequence_steps_kind',
      sql`${t.kind} IN ('email', 'call', 'task', 'linkedin_connect', 'linkedin_message', 'linkedin_view', 'linkedin_engage')`,
    ),
    check('ck_email_sequence_steps_template', sql`${t.kind} <> 'email' OR ${t.templateId} IS NOT NULL`),
  ],
)

export const emailSequenceEnrollments = pgTable(
  'email_sequence_enrollments',
  {
    ...tenantColumns,
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
    status: text('status', { enum: ['active', 'replied', 'unsubscribed', 'completed', 'failed', 'meeting', 'won_lost', 'bounced'] })
      .notNull()
      .default('active'),
    // 3 eșecuri consecutive → status='failed' (adresă moartă, nu mai reîncearcă la nesfârșit).
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    nextSendAt: timestamp('next_send_at', { withTimezone: true }).notNull().defaultNow(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    // A call / task step waits for its task to be done before the sequence moves on.
    waitingTaskId: uuid('waiting_task_id').references(() => prospectTasks.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Nu poți înrola de 2 ori același destinatar în aceeași secvență.
    uniqueIndex('uq_email_sequence_enrollments_recipient').on(t.sequenceId, t.recipientEmail),
    // Query-ul cron-ului "ce-i due azi".
    index('idx_email_sequence_enrollments_due').on(t.status, t.nextSendAt),
  ],
)
