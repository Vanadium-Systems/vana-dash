import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { billingClients, calls, prospects } from '../../shared/db/schema/index.js'
import { callPublicUrl, closeCallRoom, openCallRoom, type CallRecord } from '../../shared/lib/call-rooms.js'
import { createOwnerToken, DailyError, isDailyConfigured } from '../../shared/lib/daily.js'
import { getCompany } from '../../shared/lib/company.js'
import { userName, type SessionUser } from '../../shared/lib/session.js'
import type { z } from 'zod'
import { CreateCallSchema, UpdateCallSchema } from './schema.js'

type CreateInput = z.infer<typeof CreateCallSchema>
type UpdateInput = z.infer<typeof UpdateCallSchema>

export class CallError extends Error {
  constructor(
    readonly code: 'not_found' | 'closed' | 'provider' | 'not_configured',
    readonly status: number,
  ) {
    super(code)
  }
}

export interface CallRow {
  id: string
  title: string
  publicUrl: string
  scheduledAt: string | null
  expiresAt: string
  status: 'open' | 'ended' | 'cancelled'
  durationSeconds: number | null
  participantCount: number | null
  bookingId: string | null
  prospect: { id: string; name: string } | null
  billingClient: { id: string; name: string } | null
  createdAt: string
}

// The row people see: our own link, never the Daily room name or a token.
function toCallRow(call: CallRecord, prospectName: string | null, clientName: string | null): CallRow {
  return {
    id: call.id,
    title: call.title,
    publicUrl: callPublicUrl(call.publicId),
    scheduledAt: call.scheduledAt?.toISOString() ?? null,
    expiresAt: call.expiresAt.toISOString(),
    status: call.status,
    durationSeconds: call.durationSeconds ?? null,
    participantCount: call.participantCount ?? null,
    bookingId: call.bookingId ?? null,
    prospect: call.prospectId && prospectName ? { id: call.prospectId, name: prospectName } : null,
    billingClient: call.billingClientId && clientName ? { id: call.billingClientId, name: clientName } : null,
    createdAt: call.createdAt.toISOString(),
  }
}

async function selectRows(where: ReturnType<typeof and> | undefined, limit: number): Promise<CallRow[]> {
  const rows = await db
    .select({ call: calls, prospectName: prospects.name, clientName: billingClients.name })
    .from(calls)
    .leftJoin(prospects, eq(prospects.id, calls.prospectId))
    .leftJoin(billingClients, eq(billingClients.id, calls.billingClientId))
    .where(and(isNull(calls.deletedAt), where))
    .orderBy(desc(calls.createdAt))
    .limit(limit)
  return rows.map((row) => toCallRow(row.call, row.prospectName, row.clientName))
}

export async function listCalls(query: { status: 'open' | 'ended' | 'all'; limit: number }): Promise<CallRow[]> {
  const where =
    query.status === 'open' ? eq(calls.status, 'open') : query.status === 'ended' ? inArray(calls.status, ['ended', 'cancelled']) : undefined
  return selectRows(where, query.limit)
}

export async function getCall(id: string): Promise<CallRow | null> {
  const [row] = await selectRows(eq(calls.id, id), 1)
  return row ?? null
}

// A row that still has a room to open: soft-deleted calls are gone for good.
async function loadOpenable(id: string): Promise<CallRecord> {
  const [row] = await db.select().from(calls).where(and(eq(calls.id, id), isNull(calls.deletedAt)))
  if (!row) throw new CallError('not_found', 404)
  return row
}

export async function createCall(input: CreateInput): Promise<CallRow> {
  if (!isDailyConfigured()) throw new CallError('not_configured', 503)

  const exp = new Date(Date.now() + input.expiresInHours * 3_600_000)
  let row: CallRecord
  try {
    row = await openCallRoom({
      title: input.title,
      exp,
      prospectId: input.prospectId,
      billingClientId: input.billingClientId,
    })
  } catch (err) {
    if (err instanceof DailyError) throw new CallError('provider', 502)
    throw err
  }

  return (await getCall(row.id))!
}

export async function updateCall(id: string, input: UpdateInput): Promise<CallRow> {
  const call = await loadOpenable(id)

  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (input.title !== undefined) set.title = input.title
  if (input.prospectId !== undefined) set.prospectId = input.prospectId
  if (input.billingClientId !== undefined) set.billingClientId = input.billingClientId

  await db.update(calls).set(set).where(eq(calls.id, call.id))
  return (await getCall(id))!
}

export async function joinCall(id: string, me: SessionUser): Promise<{ roomUrl: string; token: string }> {
  const call = await loadOpenable(id)
  if (call.status !== 'open' || call.expiresAt.getTime() <= Date.now()) throw new CallError('closed', 410)

  let token: string
  try {
    // The owner token lets the dashboard user remove people and end the call for everyone.
    token = await createOwnerToken(call.roomName, call.expiresAt, `${userName(me)} \u00b7 ${(await getCompany()).profile.name}`)
  } catch (err) {
    if (err instanceof DailyError) throw new CallError('provider', 502)
    throw err
  }

  return { roomUrl: call.roomUrl, token }
}

export async function endCall(id: string): Promise<CallRow> {
  const call = await loadOpenable(id)
  try {
    await closeCallRoom(call, 'ended')
  } catch (err) {
    if (err instanceof DailyError) throw new CallError('provider', 502)
    throw err
  }
  return (await getCall(id))!
}

// What the anonymous join page may know: nothing about who the call is for.
export async function getPublicCall(
  publicId: string,
): Promise<{ status: 'open' | 'ended'; opensAt: string | null; closesAt: string; roomUrl: string | null } | null> {
  const [call] = await db.select().from(calls).where(and(eq(calls.publicId, publicId), isNull(calls.deletedAt)))
  if (!call) return null

  const isOpen = call.status === 'open' && call.expiresAt.getTime() > Date.now()
  return {
    status: isOpen ? 'open' : 'ended',
    opensAt: call.scheduledAt ? new Date(call.scheduledAt.getTime() - 15 * 60_000).toISOString() : null,
    closesAt: call.expiresAt.toISOString(),
    roomUrl: isOpen ? call.roomUrl : null,
  }
}
