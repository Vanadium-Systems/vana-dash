import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { prospects } from './prospects.js'
import { tenantColumns } from './tenant-column.js'

// A saved prospect search: search text, filters, columns, sort, column calculations, layout.
export const prospectViews = pgTable(
  'prospect_views',
  {
    ...tenantColumns,
    ...standardColumns,
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['companies', 'people'] }).notNull().default('companies'),
    q: text('q').notNull().default(''),
    filters: jsonb('filters').notNull().default([]),
    columns: jsonb('columns').notNull().default([]),
    sort: jsonb('sort'),
    calcs: jsonb('calcs').notNull().default({}),
    layout: text('layout', { enum: ['list', 'board', 'forecast'] }).notNull().default('list'),
    shared: boolean('shared').notNull().default(false),
    notifyNew: boolean('notify_new').notNull().default(false),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_prospect_views_owner').on(t.tenantId, t.ownerUserId),
    check('ck_prospect_views_kind', sql`${t.kind} IN ('companies', 'people')`),
    check('ck_prospect_views_layout', sql`${t.layout} IN ('list', 'board', 'forecast')`),
  ],
)

export const prospectViewStars = pgTable(
  'prospect_view_stars',
  {
    ...tenantColumns,
    ...standardColumns,
    viewId: uuid('view_id')
      .notNull()
      .references(() => prospectViews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('uq_prospect_view_stars').on(t.tenantId, t.viewId, t.userId)],
)

export const prospectListFolders = pgTable('prospect_list_folders', {
  ...tenantColumns,
  ...standardColumns,
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  shared: boolean('shared').notNull().default(true),
})

// Static lists: membership is explicit, unlike a view which recomputes its filters.
export const prospectLists = pgTable('prospect_lists', {
  ...tenantColumns,
  ...standardColumns,
  folderId: uuid('folder_id').references(() => prospectListFolders.id, { onDelete: 'set null' }),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  shared: boolean('shared').notNull().default(true),
})

export const prospectListMembers = pgTable(
  'prospect_list_members',
  {
    ...tenantColumns,
    ...standardColumns,
    listId: uuid('list_id')
      .notNull()
      .references(() => prospectLists.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    addedByUserId: uuid('added_by_user_id').references(() => users.id),
  },
  (t) => [
    uniqueIndex('uq_prospect_list_members').on(t.tenantId, t.listId, t.prospectId),
    index('idx_prospect_list_members_prospect').on(t.prospectId),
  ],
)

// Stage history in its own table: the funnel and "days in stage" cannot be computed reliably from
// the audit log's JSON.
export const prospectStageEvents = pgTable(
  'prospect_stage_events',
  {
    ...tenantColumns,
    ...standardColumns,
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('idx_stage_events').on(t.tenantId, t.changedAt, t.toStatus),
    index('idx_stage_events_prospect').on(t.prospectId, t.changedAt),
  ],
)

export const textSnippets = pgTable('text_snippets', {
  ...tenantColumns,
  ...standardColumns,
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  body: text('body').notNull(),
  shared: boolean('shared').notNull().default(false),
})
