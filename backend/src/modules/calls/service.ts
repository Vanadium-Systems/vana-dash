import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { runAsTenant, withRlsBypass } from '../../shared/lib/tenancy.js'
import { billingClients, calls, conversationMembers, prospects } from '../../shared/db/schema/index.js'
import { callPublicUrl, closeCallRoom, isCallsConfigured, openCallRoom, type CallRecord } from '../../shared/lib/call-rooms.js'
import { decryptField } from '../../shared/lib/crypto.js'
import { createLiveKitToken, LiveKitError } from '../../shared/lib/livekit.js'
import { getCompany } from '../../shared/lib/company.js'
import { visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import { userName, type SessionUser } from '../../shared/lib/session.js'
import type { z } from 'zod'
import { CreateCallSchema, UpdateCallSchema } from './schema.js'

type CreateInput = z.input<typeof CreateCallSchema>
type UpdateInput = z.infer<typeof UpdateCallSchema>

export class CallError extends Error {
  constructor(
    readonly code: 'not_found' | 'closed' | 'provider' | 'not_configured' | 'forbidden',
    readonly status: number,
    readonly feature?: string,
  ) {
    super(code)
  }
}

export interface CallRow {
  id: string
  title: string
  publicUrl: string
  kind: 'audio' | 'video'
  provider: 'daily' | 'livekit'
  conversationId: string | null
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

export type CallTokenResponse = {
  provider: 'livekit'
  livekitUrl: string
  token: string
  roomName: string
  kind: 'audio' | 'video'
  conversationId: string | null
  guestKey: string | null
}

// The row people see: our own link, never the SFU room name or a token.
function toCallRow(call: CallRecord, prospectName: string | null, clientName: string | null): CallRow {
  return {
    id: call.id,
    title: call.title,
    publicUrl: callPublicUrl(call.publicId),
    kind: call.kind,
    provider: call.provider,
    conversationId: call.conversationId ?? null,
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

async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.deletedAt),
      ),
    )
  return Boolean(row)
}

// Non-conversation calls are company-wide (with prospect name filtered by visibleProspectsWhere);
// conversation calls are visible ONLY to active members of that conversation.
async function selectRows(me: SessionUser, where: ReturnType<typeof and> | undefined, limit: number): Promise<CallRow[]> {
  const rows = await db
    .select({ call: calls, prospectName: prospects.name, clientName: billingClients.name })
    .from(calls)
    .leftJoin(prospects, and(eq(prospects.id, calls.prospectId), visibleProspectsWhere(me)))
    .leftJoin(billingClients, eq(billingClients.id, calls.billingClientId))
    .where(
      and(
        isNull(calls.deletedAt),
        sql`(${calls.conversationId} IS NULL OR EXISTS (
          SELECT 1 FROM ${conversationMembers} cm
          WHERE cm."conversation_id" = ${calls.conversationId}
            AND cm."user_id" = ${me.id}
            AND cm."deleted_at" IS NULL
        ))`,
        where,
      ),
    )
    .orderBy(desc(calls.createdAt))
    .limit(limit)
  return rows.map((row) => toCallRow(row.call, row.prospectName, row.clientName))
}

export async function listCalls(me: SessionUser, query: { status: 'open' | 'ended' | 'all'; limit: number }): Promise<CallRow[]> {
  const where =
    query.status === 'open' ? eq(calls.status, 'open') : query.status === 'ended' ? inArray(calls.status, ['ended', 'cancelled']) : undefined
  return selectRows(me, where, query.limit)
}

export async function getCall(me: SessionUser, id: string): Promise<CallRow | null> {
  const [row] = await selectRows(me, eq(calls.id, id), 1)
  return row ?? null
}

export async function getCallsStatus(): Promise<{ configured: boolean }> {
  return { configured: await isCallsConfigured() }
}

// A row that still has a room to open: soft-deleted calls are gone for good.
async function loadOpenable(id: string): Promise<CallRecord> {
  const [row] = await db.select().from(calls).where(and(eq(calls.id, id), isNull(calls.deletedAt)))
  if (!row) throw new CallError('not_found', 404)
  return row
}

export async function createCall(me: SessionUser, input: CreateInput): Promise<CallRow> {
  if (!(await isCallsConfigured())) throw new CallError('not_configured', 503)

  if (input.conversationId) {
    const member = await isConversationMember(input.conversationId, me.id)
    if (!member) throw new CallError('not_found', 404)
  }

  const baseMs = input.scheduledAt ? new Date(input.scheduledAt).getTime() : Date.now()
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined
  const exp = new Date(baseMs + (input.expiresInHours ?? 4) * 3_600_000)

  let row: CallRecord
  try {
    row = await openCallRoom({
      title: input.title,
      exp,
      scheduledAt,
      kind: input.kind ?? 'video',
      conversationId: input.conversationId ?? null,
      createdByUserId: me.id,
      prospectId: input.prospectId,
      billingClientId: input.billingClientId,
    })
  } catch (err) {
    if (err instanceof LiveKitError) throw new CallError('provider', 502)
    throw err
  }

  return (await getCall(me, row.id))!
}

export async function updateCall(me: SessionUser, id: string, input: UpdateInput): Promise<CallRow> {
  const call = await loadOpenable(id)
  if (call.conversationId && !(await isConversationMember(call.conversationId, me.id))) {
    throw new CallError('not_found', 404)
  }

  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (input.title !== undefined) set.title = input.title
  if (input.prospectId !== undefined) set.prospectId = input.prospectId
  if (input.billingClientId !== undefined) set.billingClientId = input.billingClientId

  await db.update(calls).set(set).where(eq(calls.id, call.id))
  return (await getCall(me, id))!
}

async function assertCanAccessCall(call: CallRecord, me: SessionUser): Promise<void> {
  if (call.conversationId) {
    if (!me.features.includes('mesaje.view')) throw new CallError('forbidden', 403, 'mesaje.view')
    if (!(await isConversationMember(call.conversationId, me.id))) throw new CallError('not_found', 404)
    return
  }
  if (!me.features.includes('apeluri.manage')) throw new CallError('forbidden', 403, 'apeluri.manage')
}

export async function issueCallToken(id: string, me: SessionUser): Promise<CallTokenResponse> {
  const call = await loadOpenable(id)
  await assertCanAccessCall(call, me)
  if (call.status !== 'open' || call.expiresAt.getTime() <= Date.now()) throw new CallError('closed', 410)

  // Old rows from the removed Daily provider have no room anywhere.
  if (call.provider !== 'livekit') throw new CallError('closed', 410)

  const displayName = call.conversationId ? userName(me) : `${userName(me)} · ${(await getCompany()).profile.name}`

  try {
    const ttlSeconds = Math.max(300, Math.floor((call.expiresAt.getTime() - Date.now()) / 1000))
    const { token, livekitUrl } = await createLiveKitToken({
      roomName: call.roomName,
      identity: me.id,
      name: displayName,
      isHost: true,
      ttlSeconds,
    })
    const guestKey = call.bookingId && call.guestKeyEnc ? await decryptField(call.guestKeyEnc) : null
    return {
      provider: 'livekit',
      livekitUrl,
      token,
      roomName: call.roomName,
      kind: call.kind,
      conversationId: call.conversationId ?? null,
      guestKey,
    }
  } catch (err) {
    if (err instanceof LiveKitError) throw new CallError('provider', 502)
    throw err
  }
}

/** Backwards-compatible alias for `issueCallToken` on legacy `/join`. */
export async function joinCall(id: string, me: SessionUser): Promise<CallTokenResponse> {
  return issueCallToken(id, me)
}

export async function endCall(me: SessionUser, id: string): Promise<CallRow> {
  const call = await loadOpenable(id)
  await assertCanAccessCall(call, me)
  try {
    await closeCallRoom(call, 'ended')
  } catch (err) {
    if (err instanceof LiveKitError) throw new CallError('provider', 502)
    throw err
  }
  return (await getCall(me, id))!
}

// What the anonymous join page may know: nothing about who the call is for or the E2EE key.
export async function getPublicCall(
  publicId: string,
): Promise<{
  status: 'open' | 'ended'
  kind: 'audio' | 'video'
  provider: 'daily' | 'livekit'
  opensAt: string | null
  closesAt: string
} | null> {
  // The guest has no account, so no company: the link itself is the key (unique, random), and
  // only the time window and provider kind leave this function.
  const [call] = await withRlsBypass(() =>
    db
      .select({
        status: calls.status,
        kind: calls.kind,
        provider: calls.provider,
        scheduledAt: calls.scheduledAt,
        expiresAt: calls.expiresAt,
      })
      .from(calls)
      .where(and(eq(calls.publicId, publicId), isNull(calls.deletedAt))),
  )
  if (!call) return null

  // A Daily row has no room any more, so it reads as ended whatever its status says.
  const isOpen = call.provider === 'livekit' && call.status === 'open' && call.expiresAt.getTime() > Date.now()
  return {
    status: isOpen ? 'open' : 'ended',
    kind: call.kind,
    provider: call.provider,
    opensAt: call.scheduledAt ? new Date(call.scheduledAt.getTime() - 15 * 60_000).toISOString() : null,
    closesAt: call.expiresAt.toISOString(),
  }
}

export async function issuePublicCallToken(
  publicId: string,
  guestName: string,
): Promise<{ provider: 'livekit'; livekitUrl: string; token: string; roomName: string; kind: 'audio' | 'video' }> {
  // Guest has no session: read the call record across tenants to resolve its company & window.
  const [call] = await withRlsBypass(() =>
    db
      .select({
        tenantId: calls.tenantId,
        status: calls.status,
        kind: calls.kind,
        provider: calls.provider,
        roomName: calls.roomName,
        scheduledAt: calls.scheduledAt,
        expiresAt: calls.expiresAt,
      })
      .from(calls)
      .where(and(eq(calls.publicId, publicId), isNull(calls.deletedAt))),
  )
  if (!call) throw new CallError('not_found', 404)

  const now = Date.now()
  const opensAt = call.scheduledAt ? call.scheduledAt.getTime() - 15 * 60_000 : null
  if (call.provider !== 'livekit' || call.status !== 'open' || call.expiresAt.getTime() <= now || (opensAt !== null && now < opensAt)) {
    throw new CallError('closed', 410)
  }

  return runAsTenant(call.tenantId, async () => {
    try {
      const ttlSeconds = Math.max(300, Math.floor((call.expiresAt.getTime() - Date.now()) / 1000))
      const { token, livekitUrl } = await createLiveKitToken({
        roomName: call.roomName,
        identity: `guest:${randomBytes(6).toString('hex')}`,
        name: guestName,
        isHost: false,
        ttlSeconds,
      })
      return { provider: 'livekit', livekitUrl, token, roomName: call.roomName, kind: call.kind }
    } catch (err) {
      if (err instanceof LiveKitError) throw new CallError('provider', 502)
      throw err
    }
  })
}
