import { z } from 'zod'

// Every tool is one existing route, called with the caller's own Bearer token (see routes.ts), so
// rights, history and rate limit are the route's. There is no access rule in this module.
//
// Input: `pathParams` fill the `:name` segments, the rest goes to the query string (GET) or the JSON
// body. Inputs stay loose on purpose: the route validates them and its 400 comes back as the tool
// error, and `api_routes` gives the exact schema when the model needs it.

export interface ToolDef {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PATCH'
  /** The route as registered, e.g. `/api/prospects/:id`; the guard map is keyed on it. */
  route: string
  pathParams?: string[]
  input: z.ZodObject
}

const id = (what: string) => z.string().uuid().describe(`${what} id`)
const freeQuery = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
const freeBody = z.record(z.string(), z.unknown())

export const TOOLS: ToolDef[] = [
  {
    name: 'search',
    description: 'Search everything the person can see (prospects, email threads, archive, calendar, notes, invoices).',
    method: 'GET',
    route: '/api/search',
    input: z.object({ q: z.string().min(2) }),
  },
  {
    name: 'list_prospects',
    description: 'List prospects. Optional query filters as accepted by GET /api/prospects (see api_routes).',
    method: 'GET',
    route: '/api/prospects',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'get_prospect',
    description: 'The full sheet of one prospect.',
    method: 'GET',
    route: '/api/prospects/:id',
    pathParams: ['id'],
    input: z.object({ id: id('Prospect') }),
  },
  {
    name: 'add_prospect',
    description: 'Create a prospect. Body as accepted by POST /api/prospects (see api_routes).',
    method: 'POST',
    route: '/api/prospects',
    input: z.object({ body: freeBody }),
  },
  {
    name: 'add_prospect_note',
    description: 'Add a note on a prospect.',
    method: 'POST',
    route: '/api/prospects/:id/notes',
    pathParams: ['id'],
    input: z.object({ id: id('Prospect'), body: freeBody }),
  },
  {
    name: 'list_tasks',
    description: 'The person’s prospect tasks.',
    method: 'GET',
    route: '/api/prospects/tasks',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'add_task',
    description: 'Add a task on a prospect.',
    method: 'POST',
    route: '/api/prospects/:id/tasks',
    pathParams: ['id'],
    input: z.object({ id: id('Prospect'), body: freeBody }),
  },
  {
    name: 'complete_task',
    description: 'Mark a prospect task as done.',
    method: 'POST',
    route: '/api/prospects/tasks/:taskId/done',
    pathParams: ['taskId'],
    input: z.object({ taskId: id('Task') }),
  },
  {
    name: 'list_notes',
    description: 'The person’s own notes.',
    method: 'GET',
    route: '/api/notes',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'add_note',
    description: 'Create a personal note.',
    method: 'POST',
    route: '/api/notes',
    input: z.object({ body: freeBody }),
  },
  {
    name: 'list_invoices',
    description: 'Issued invoices.',
    method: 'GET',
    route: '/api/invoicing/invoices',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'get_invoice',
    description: 'One invoice or received record, with lines and payments.',
    method: 'GET',
    route: '/api/accounting/records/:id/detail',
    pathParams: ['id'],
    input: z.object({ id: id('Record') }),
  },
  {
    name: 'financial_summary',
    description: 'Revenue and expense totals for a period.',
    method: 'GET',
    route: '/api/metrics/summary',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'calendar_events',
    description: 'Calendar events in a range (query `from`, `to`).',
    method: 'GET',
    route: '/api/calendar/events',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'add_calendar_event',
    description: 'Create a calendar event.',
    method: 'POST',
    route: '/api/calendar/events',
    input: z.object({ body: freeBody }),
  },
  {
    name: 'archive_search',
    description: 'Search files in the archive the person can open.',
    method: 'GET',
    route: '/api/archive/search',
    input: z.object({ query: freeQuery }),
  },
  {
    name: 'list_email_threads',
    description: 'Email threads from the person’s mailboxes.',
    method: 'GET',
    route: '/api/email/threads',
    input: z.object({ query: freeQuery.optional() }),
  },
  {
    name: 'get_email_thread',
    description: 'One email thread with its messages.',
    method: 'GET',
    route: '/api/email/threads/:id',
    pathParams: ['id'],
    input: z.object({ id: id('Thread') }),
  },
  {
    name: 'api_routes',
    description: 'The API routes this token can call, with their feature and JSON schemas. Optional text filter.',
    method: 'GET',
    route: '/api/meta/routes',
    input: z.object({ filter: z.string().optional() }),
  },
]
