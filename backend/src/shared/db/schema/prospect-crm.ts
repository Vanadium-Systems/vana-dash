import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { prospects } from './prospects.js'
import { calendarEvents } from './calendar-events.js'
import { tenantColumns } from './tenant-column.js'

// The people at a prospect's company. "Do not contact" is the GDPR art. 21 objection: calls,
// email and sequences all respect it.
export const prospectPeople = pgTable(
  'prospect_people',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    isDecisionMaker: boolean('is_decision_maker').notNull().default(false),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    doNotContactReason: text('do_not_contact_reason'),
    position: smallint('position').notNull().default(0),
  },
  (t) => [index('idx_prospect_people_prospect').on(t.prospectId)],
)

export const CONTACT_POINT_KINDS = ['phone', 'email'] as const
export const CONTACT_POINT_STATUSES = ['ok', 'bounced', 'unsubscribed', 'invalid'] as const

// A phone or email of the company (personId null) or of one of its people. `valueNormalized`
// (E.164 / lowercase) is what duplicates, bounces and email activity match on.
export const prospectContactPoints = pgTable(
  'prospect_contact_points',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => prospectPeople.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: CONTACT_POINT_KINDS }).notNull(),
    value: text('value').notNull(),
    valueNormalized: text('value_normalized').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status', { enum: CONTACT_POINT_STATUSES }).notNull().default('ok'),
  },
  (t) => [
    index('idx_contact_points_lookup').on(t.tenantId, t.kind, t.valueNormalized),
    index('idx_contact_points_prospect').on(t.prospectId),
    check('ck_contact_points_kind', sql`${t.kind} IN ('phone', 'email')`),
    check('ck_contact_points_status', sql`${t.status} IN ('ok', 'bounced', 'unsubscribed', 'invalid')`),
  ],
)

export const prospectNotes = pgTable(
  'prospect_notes',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    // null = imported (the old free-text notes column, or a spreadsheet).
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    pinned: boolean('pinned').notNull().default(false),
  },
  (t) => [index('idx_prospect_notes_prospect').on(t.prospectId, t.createdAt)],
)

export const PROSPECT_TASK_KINDS = [
  'call',
  'email',
  'meeting',
  'task',
  'linkedin_connect',
  'linkedin_message',
  'linkedin_view',
  'linkedin_engage',
] as const
export const PROSPECT_TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export const CALL_OUTCOMES = ['answered', 'no_answer', 'voicemail', 'wrong_number', 'callback'] as const

export const prospectTasks = pgTable(
  'prospect_tasks',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => prospectPeople.id, { onDelete: 'set null' }),
    // Required: a task nobody owns is a task nobody sees.
    assigneeUserId: uuid('assignee_user_id')
      .notNull()
      .references(() => users.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: PROSPECT_TASK_KINDS }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    priority: text('priority', { enum: PROSPECT_TASK_PRIORITIES }).notNull().default('medium'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    // Set when a sequence skipped the task after it sat undone for too long.
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvents.id, { onDelete: 'set null' }),
    outcome: text('outcome', { enum: CALL_OUTCOMES }),
    outcomeNote: text('outcome_note'),
  },
  (t) => [
    index('idx_prospect_tasks_open').on(t.prospectId, t.dueAt).where(sql`${t.doneAt} IS NULL AND ${t.deletedAt} IS NULL`),
    index('idx_prospect_tasks_assignee').on(t.assigneeUserId, t.dueAt).where(sql`${t.doneAt} IS NULL AND ${t.deletedAt} IS NULL`),
    check(
      'ck_prospect_tasks_kind',
      sql`${t.kind} IN ('call', 'email', 'meeting', 'task', 'linkedin_connect', 'linkedin_message', 'linkedin_view', 'linkedin_engage')`,
    ),
    check('ck_prospect_tasks_priority', sql`${t.priority} IN ('low', 'medium', 'high')`),
    check(
      'ck_prospect_tasks_outcome',
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('answered', 'no_answer', 'voicemail', 'wrong_number', 'callback')`,
    ),
  ],
)

export const prospectCollaborators = pgTable(
  'prospect_collaborators',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ['view', 'edit'] }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_prospect_collaborators').on(t.tenantId, t.prospectId, t.userId),
    index('idx_prospect_collaborators_user').on(t.userId),
    check('ck_prospect_collaborators_level', sql`${t.level} IN ('view', 'edit')`),
  ],
)

// 'transfer' asks for the prospect itself; 'access' asks to be added as a collaborator (the
// "Request access" button on a prospect card in Messages).
export const prospectTransferRequests = pgTable(
  'prospect_transfer_requests',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['transfer', 'access'] }).notNull().default('transfer'),
    fromUserId: uuid('from_user_id').references(() => users.id),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['pending', 'accepted', 'refused', 'cancelled'] }).notNull().default('pending'),
    note: text('note'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_transfer_pending').on(t.tenantId, t.prospectId, t.toUserId, t.kind).where(sql`${t.status} = 'pending'`),
    check('ck_transfer_requests_kind', sql`${t.kind} IN ('transfer', 'access')`),
    check('ck_transfer_requests_status', sql`${t.status} IN ('pending', 'accepted', 'refused', 'cancelled')`),
  ],
)
