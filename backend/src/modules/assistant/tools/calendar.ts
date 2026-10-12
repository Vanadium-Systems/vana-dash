import { z } from 'zod/v4'
import * as calendarService from '../../calendar/service.js'
import type { SessionUser } from '../../../shared/lib/session.js'
import { autoTool } from './shared.js'

const eventFields = {
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean().optional(),
  recurrenceRule: z.string().optional(),
  reminderMinutesBefore: z.number().int().positive().max(1440).nullable().optional(),
}

// Calendar per om (PLAN.md C2): tool-urile primesc omul din `ctx.user`, deci listează doar
// ce vede el și creează în calendarul lui. Un eveniment cerut direct prin id dintr-un calendar
// care nu e al lui și nu e partajat lui iese 404 — la fel ca în UI.
export function buildCalendarTools(ctx: { user: SessionUser }) {
  return [
    autoTool({
      name: 'list_calendar_events',
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      description: 'Listă evenimente din calendar între două date (expandate din recurență).',
      run: (a) => calendarService.listOccurrences(ctx.user, new Date(a.from), new Date(a.to)),
    }),
    autoTool({
      name: 'create_calendar_event',
      inputSchema: z.object(eventFields),
      description: 'Creează un eveniment în calendarul tău. Reversibil — editabil/ștergibil imediat din UI.',
      run: (a) => calendarService.createEvent(ctx.user, { ...a, startAt: new Date(a.startAt), endAt: new Date(a.endAt) } as never),
    }),
    autoTool({
      name: 'update_calendar_event',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        allDay: z.boolean().optional(),
      }),
      description: 'Editează un eveniment de calendar existent.',
      run: ({ id, startAt, endAt, ...rest }) =>
        calendarService.updateEvent(ctx.user, id, {
          ...rest,
          startAt: startAt ? new Date(startAt) : undefined,
          endAt: endAt ? new Date(endAt) : undefined,
        } as never),
    }),
    autoTool({
      name: 'delete_calendar_event',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge un eveniment de calendar.',
      run: (a) => calendarService.deleteEvent(ctx.user, a.id),
    }),
  ]
}