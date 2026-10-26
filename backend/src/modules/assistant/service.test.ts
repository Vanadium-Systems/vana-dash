/**
 * modules/assistant/service.ts — persistare + gating pe assistant_pending_actions.
 * Integration test, pg real (test/setup.ts). Nu testăm runConversationTurn/continueAfterAction
 * (necesită ANTHROPIC_API_KEY + apel real la API) — vezi verificarea live din raportul de sprint.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { assistantConversations, assistantMessages, assistantPendingActions, roles, users } from '../../shared/db/schema/index.js'

import { effectiveFeatures } from '../../shared/lib/session.js'
import type { SessionUser } from '../../shared/lib/session.js'

import {
  confirmPendingAction,
  createConversation,
  expirePendingActions,
  listConversationMessages,
  listConversations,
  rejectPendingAction,
  updateConversationModel,
} from './service.js'

const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stefan@vanadium.systems',
  displayName: 'Stefan',
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' as const },
  isPlatformAdmin: true,
  features: effectiveFeatures([], 'admin'),
  mailboxes: null,
  status: 'active' as const,
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  locale: 'ro',
  displayCurrency: 'RON',
  sessionVersion: 1,
} satisfies SessionUser
const [adminRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUserRow] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.roleId, adminRoleRow!.id)).limit(1)
admin.id = adminUserRow!.id
const [managerRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Manager'))
// Un om real cu rolul Manager (funcționalități vide) — seed-ul nu are încă un astfel de user.
const [managerUser] = await db
  .insert(users)
  .values({ email: 'assistant-test-manager@vanadium.systems', passwordHash: 'x', displayName: 'Ana Popescu', roleId: managerRoleRow!.id })
  .returning()
const managerUserId = managerUser!.id

const conversationIds: string[] = []

async function makeConversation() {
  const [row] = await db.insert(assistantConversations).values({ ownerUserId: admin.id }).returning()
  conversationIds.push(row!.id)
  return row!
}

afterAll(async () => {
  if (conversationIds.length) await db.delete(assistantConversations).where(inArray(assistantConversations.id, conversationIds))
  await db.delete(users).where(eq(users.id, managerUserId))
})

describe('listConversationMessages', () => {
  it('round-trips rich content blocks (text + tool_use + tool_result) through jsonb', async () => {
    const conv = await makeConversation()
    const content = [
      { type: 'text', text: 'Salut' },
      { type: 'tool_use', id: 'toolu_123', name: 'list_platforms', input: {} },
      { type: 'tool_result', tool_use_id: 'toolu_123', content: '[]' },
    ]
    await db.insert(assistantMessages).values({ conversationId: conv.id, role: 'assistant', content })

    const rows = await listConversationMessages(conv.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.content).toEqual(content)
  })

  it('orders messages by createdAt ascending', async () => {
    const conv = await makeConversation()
    await db.insert(assistantMessages).values({ conversationId: conv.id, role: 'user', content: [{ type: 'text', text: 'primul' }] })
    await db.insert(assistantMessages).values({ conversationId: conv.id, role: 'assistant', content: [{ type: 'text', text: 'al doilea' }] })

    const rows = await listConversationMessages(conv.id)
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant'])
  })
})

describe('createConversation / listConversations / updateConversationModel', () => {
  it('createConversation fără model persistă model=null (folosește config.anthropic.model implicit)', async () => {
    const row = await createConversation(admin)
    conversationIds.push(row.id)
    expect(row.model).toBeNull()
  })

  it('createConversation cu model persistă modelul ales explicit', async () => {
    const row = await createConversation(admin, 'claude-haiku-4-5-20251001')
    conversationIds.push(row.id)
    expect(row.model).toBe('claude-haiku-4-5-20251001')
  })

  it('listConversations ordonează după lastMessageAt descrescător', async () => {
    const older = await makeConversation()
    await db.update(assistantConversations).set({ lastMessageAt: new Date(Date.now() - 60_000) }).where(eq(assistantConversations.id, older.id))
    const newer = await makeConversation()
    await db.update(assistantConversations).set({ lastMessageAt: new Date() }).where(eq(assistantConversations.id, newer.id))

    const rows = await listConversations(admin)
    const olderIdx = rows.findIndex((r) => r.id === older.id)
    const newerIdx = rows.findIndex((r) => r.id === newer.id)
    expect(newerIdx).toBeLessThan(olderIdx)
  })

  it('updateConversationModel schimbă modelul unei conversații existente', async () => {
    const conv = await makeConversation()
    const updated = await updateConversationModel(admin, conv.id, 'claude-sonnet-5')
    expect(updated?.model).toBe('claude-sonnet-5')
  })

  it('updateConversationModel pe un id inexistent nu crapă, returnează undefined', async () => {
    const updated = await updateConversationModel(admin, '00000000-0000-0000-0000-000000000000', 'claude-sonnet-5')
    expect(updated).toBeUndefined()
  })
})

describe('confirmPendingAction / rejectPendingAction', () => {
  it('confirmPendingAction fails cleanly for a nonexistent action id', async () => {
    const result = await confirmPendingAction(admin, '00000000-0000-0000-0000-000000000000')
    expect(result.ok).toBe(false)
  })

  it('confirmPendingAction fails and marks expired for a past-due pending action', async () => {
    const conv = await makeConversation()
    const [action] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: { id: '00000000-0000-0000-0000-000000000000' },
        toolUseId: 'toolu_expired',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning()

    const result = await confirmPendingAction(admin, action!.id)
    expect(result.ok).toBe(false)

    const [reloaded] = await db.select().from(assistantPendingActions).where(eq(assistantPendingActions.id, action!.id))
    expect(reloaded!.status).toBe('expired')
  })

  it('confirmPendingAction with an unknown tool name fails without crashing', async () => {
    const conv = await makeConversation()
    const [action] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'not_a_real_tool',
        toolInput: {},
        toolUseId: 'toolu_unknown',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()

    const result = await confirmPendingAction(admin, action!.id)
    expect(result.ok).toBe(false)
  })

  it('rejectPendingAction marks the action rejected and persists a tool_result message, never executing anything', async () => {
    const conv = await makeConversation()
    const [action] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: { id: '00000000-0000-0000-0000-000000000000' },
        toolUseId: 'toolu_reject',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()

    const result = await rejectPendingAction(admin, action!.id)
    expect(result.ok).toBe(true)

    const [reloaded] = await db.select().from(assistantPendingActions).where(eq(assistantPendingActions.id, action!.id))
    expect(reloaded!.status).toBe('rejected')

    const messages = await listConversationMessages(conv.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_reject',
        content: `${adminUserRow!.displayName} a respins această acțiune. Nu o executa și nu o repeta fără să întrebe din nou.`,
      },
    ])
  })

  it('confirm/reject on an already-resolved action fails (no double-processing)', async () => {
    const conv = await makeConversation()
    const [action] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: { id: '00000000-0000-0000-0000-000000000000' },
        toolUseId: 'toolu_double',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()

    const first = await rejectPendingAction(admin, action!.id)
    expect(first.ok).toBe(true)
    const second = await rejectPendingAction(admin, action!.id)
    expect(second.ok).toBe(false)
  })

  it('acțiunea înregistrată cu 15 minute în urmă nu se mai execută dacă funcționalitatea i-a fost oprită', async () => {
    // Conversația unui om fără `facturi.emitere` (rolul Manager pornește gol), cu o acțiune de
    // emitere înregistrată — exact scena din C2: asistentul nu e o ocolire a guard-ului nici pe
    // calea confirmării.
    const [row] = await db
      .insert(assistantConversations)
      .values({ ownerUserId: managerUserId })
      .returning()
    conversationIds.push(row!.id)
    const [action] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: row!.id,
        toolName: 'issue_invoice',
        toolInput: { id: '00000000-0000-0000-0000-000000000000' },
        toolUseId: 'toolu_no_feature',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()

    const result = await confirmPendingAction(admin, action!.id)
    expect(result.ok).toBe(false)

    const [reloaded] = await db.select().from(assistantPendingActions).where(eq(assistantPendingActions.id, action!.id))
    expect(reloaded!.status).toBe('expired')
    // Nimic nu s-a scris în conversație: tool-ul n-a fost apelat.
    expect(await listConversationMessages(row!.id)).toHaveLength(0)
  })
})

describe('expirePendingActions', () => {
  it('expires only past-due pending actions, leaves others untouched', async () => {
    const conv = await makeConversation()
    const [expired] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: {},
        toolUseId: 'toolu_a',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning()
    const [notYetExpired] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: {},
        toolUseId: 'toolu_b',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    const [alreadyConfirmed] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId: conv.id,
        toolName: 'issue_invoice',
        toolInput: {},
        toolUseId: 'toolu_c',
        status: 'confirmed',
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning()

    await expirePendingActions()

    const rows = await db
      .select()
      .from(assistantPendingActions)
      .where(inArray(assistantPendingActions.id, [expired!.id, notYetExpired!.id, alreadyConfirmed!.id]))
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]))
    expect(byId[expired!.id]).toBe('expired')
    expect(byId[notYetExpired!.id]).toBe('pending')
    expect(byId[alreadyConfirmed!.id]).toBe('confirmed')
  })
})
