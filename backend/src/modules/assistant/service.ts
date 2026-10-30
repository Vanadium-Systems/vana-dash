import { and, asc, desc, eq, lt } from 'drizzle-orm'
import type Anthropic from '@anthropic-ai/sdk'
import { db } from '../../shared/db/client.js'
import { assistantConversations, assistantMessages, assistantPendingActions } from '../../shared/db/schema/index.js'
import { loadSessionUser, userName, type SessionUser } from '../../shared/lib/session.js'
import { buildAssistantTools, confirmExecutors, toolFeature, type PendingConfirmation } from './tools/index.js'
import { checkQuota, recordUsage } from './quota.js'
import type { AssistantModelId } from './models.js'
import { localSystemPrompt, systemPrompt } from './system-prompt.js'
import { repairHistory } from './history.js'
import { toNeutralTools, buildActiveProvider, resolveModel, type AssistantProviderId } from './providers/index.js'
import { getCompany } from '../../shared/lib/company.js'
import { tr } from '../../shared/lib/i18n.js'

export type { AssistantModelId } from './models.js'

const PENDING_ACTION_TTL_MS = 15 * 60 * 1000
const TITLE_MAX_LEN = 60

export async function createConversation(me: SessionUser, model?: AssistantModelId, provider?: AssistantProviderId) {
  const [row] = await db.insert(assistantConversations).values({ ownerUserId: me.id, model, provider }).returning()
  return row!
}

export async function listConversations(me: SessionUser) {
  return db
    .select()
    .from(assistantConversations)
    .where(eq(assistantConversations.ownerUserId, me.id))
    .orderBy(desc(assistantConversations.lastMessageAt))
}

// Ștergerea e fizică, nu soft — conversațiile sunt chat, nu documente; mesajele și acțiunile
// pending pleacă prin cascade (FK onDelete cascade pe ambele tabele).
export async function deleteConversation(me: SessionUser, id: string) {
  const [row] = await db
    .delete(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.ownerUserId, me.id)))
    .returning({ id: assistantConversations.id })
  return row ?? null
}

export async function updateConversationModel(me: SessionUser, id: string, model: AssistantModelId, provider?: AssistantProviderId) {
  const [row] = await db
    .update(assistantConversations)
    .set(provider ? { model, provider, updatedAt: new Date() } : { model, updatedAt: new Date() })
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.ownerUserId, me.id)))
    .returning()
  return row
}

export async function listConversationMessages(conversationId: string) {
  return db
    .select()
    .from(assistantMessages)
    .where(eq(assistantMessages.conversationId, conversationId))
    .orderBy(asc(assistantMessages.createdAt))
}

export type AssistantSseEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string }
  | { type: 'confirm_required'; actionId: string; toolName: string; toolInput: unknown; summary: string }
  | { type: 'entity_refs'; refs: EntityRef[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Referință la o entitate citată de asistent (Contract A) — chip clickabil în UI.
export interface EntityRef {
  ref: string
  label: string
}

const ENTITY_REF_PATTERN = /\[\[([a-z_-]+:[^\]|]+)\|([^\]]+)\]\]/g

/** Extrage referințele `[[type:id|etichetă]]` dintr-un text — folosit pt. evenimentul SSE
 *  `entity_refs` (mesajul live) și de FE pt. mesajele din istoric (parsare pe client). */
export function extractEntityRefs(text: string): EntityRef[] {
  const refs = new Map<string, EntityRef>()
  for (const match of text.matchAll(ENTITY_REF_PATTERN)) {
    const ref = match[1]!
    if (!refs.has(ref)) refs.set(ref, { ref, label: match[2]! })
  }
  return [...refs.values()]
}

async function persistPendingActions(conversationId: string, pending: PendingConfirmation[]) {
  const events: AssistantSseEvent[] = []
  for (const p of pending) {
    const [row] = await db
      .insert(assistantPendingActions)
      .values({
        conversationId,
        toolName: p.toolName,
        toolInput: p.toolInput,
        toolUseId: p.toolUseId,
        expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS),
      })
      .returning()
    events.push({ type: 'confirm_required', actionId: row!.id, toolName: p.toolName, toolInput: p.toolInput, summary: p.summary })
  }
  return events
}

// Rulează un tur de conversație: persistă mesajul lui Stefan, orchestrează Tool Runner-ul
// (tool-urile "auto" se execută automat, cele "confirm" doar se înregistrează), persistă
// răspunsul + mesajele intermediare, și produce evenimentele de forward-uit ca SSE.
export async function* runConversationTurn(conversationId: string, userText: string): AsyncGenerator<AssistantSseEvent> {
  await db.insert(assistantMessages).values({ conversationId, role: 'user', content: [{ type: 'text', text: userText }] })

  // Titlu automat din primul mesaj — doar dacă nu are deja unul (nu suprascriem un titlu
  // setat anterior). Fără asta, lista de conversații ar arăta doar UUID-uri needescifrabile.
  const [conversation] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversationId))
  const title = conversation?.title ?? userText.slice(0, TITLE_MAX_LEN)
  await db
    .update(assistantConversations)
    .set({ lastMessageAt: new Date(), title })
    .where(eq(assistantConversations.id, conversationId))

  yield* driveTurn(conversationId, conversation?.model as AssistantModelId | null, conversation?.provider, await loadHistoryForApi(conversationId))
}

// Continuă conversația după ce Stefan a confirmat/respins o acțiune — injectează rezultatul
// ca mesaj de sistem (tool_result-ul deja persistat de handleConfirm/handleReject) și lasă
// modelul să reia natural.
export async function continueAfterAction(conversationId: string): Promise<AsyncGenerator<AssistantSseEvent>> {
  const [conversation] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversationId))
  return driveTurn(conversationId, conversation?.model as AssistantModelId | null, conversation?.provider, await loadHistoryForApi(conversationId))
}

/** Someone else's action answers like a missing one, so the id does not leak that it exists. */
export async function ownsConversation(me: SessionUser, conversationId: string) {
  const [row] = await db
    .select({ id: assistantConversations.id })
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, conversationId), eq(assistantConversations.ownerUserId, me.id)))
  return Boolean(row)
}

/** Autorul conversației, cu funcționalitățile lui recalculate acum (nule dacă n-are user). */
async function conversationOwner(conversationId: string) {
  const [conversation] = await db
    .select({ ownerUserId: assistantConversations.ownerUserId })
    .from(assistantConversations)
    .where(eq(assistantConversations.id, conversationId))
  if (!conversation?.ownerUserId) throw new Error(tr('errors.assistant.conversationNoAuthor'))
  const user = await loadSessionUser(conversation.ownerUserId)
  if (!user) throw new Error(tr('errors.assistant.authorGone'))
  return user
}

async function loadHistoryForApi(conversationId: string) {
  const rows = await listConversationMessages(conversationId)
  return repairHistory(rows.map((r) => ({ role: r.role, content: r.content }) as Anthropic.Beta.Messages.BetaMessageParam))
}

async function* driveTurn(
  conversationId: string,
  model: AssistantModelId | null | undefined,
  providerOverride: string | null | undefined,
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
): AsyncGenerator<AssistantSseEvent> {
  const pending: PendingConfirmation[] = []
  // Drepturile se recalculează la fiecare tur (C2): dacă între timp i s-a oprit o
  // funcționalitate, tool-ul dispare din lista trimisă modelului.
  const user = await conversationOwner(conversationId)
  const quota = await checkQuota(user)
  if (!quota.ok) {
    yield { type: 'error', message: quota.message }
    return
  }
  const { provider, id: providerId } = await buildActiveProvider(providerOverride)
  const effectiveModel = await resolveModel(model ?? null, providerId)
  // Local models only see what the person types: no tools, so no company data leaves for them.
  const isLocal = providerId === 'local'
  const companyName = (await getCompany()).profile.name
  const tools = isLocal
    ? []
    : toNeutralTools(await buildAssistantTools({ onConfirmRequired: (p) => pending.push(p), conversationId, user }))

  let fullText = ''
  let producedContent = false
  let spentInputTokens = 0
  let spentOutputTokens = 0
  try {
    for await (const event of provider.streamTurn({
      model: effectiveModel,
      system: isLocal ? localSystemPrompt(user, companyName) : systemPrompt(user, companyName),
      tools,
      messages,
      shouldStopAfterTurn: () => pending.length > 0,
    })) {
      if (event.type === 'text_delta') {
        fullText += event.text
        yield { type: 'text_delta', text: event.text }
      }
      if (event.type === 'tool_call') yield { type: 'tool_call', toolName: event.toolName }
      if (event.type === 'turn_end' && event.content.length > 0) {
        await db.insert(assistantMessages).values({
          conversationId,
          role: 'assistant',
          content: event.content,
          inputTokens: event.usage?.inputTokens ?? null,
          outputTokens: event.usage?.outputTokens ?? null,
        })
        spentInputTokens += event.usage?.inputTokens ?? 0
        spentOutputTokens += event.usage?.outputTokens ?? 0
        producedContent = true
      }
      if (event.type === 'tool_results' && event.content.length > 0) {
        await db.insert(assistantMessages).values({ conversationId, role: 'user', content: event.content })
      }
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    return
  }
  // Consumul se numără după ce modelul a răspuns (usage vine per tur), ca un tur eșuat să nu
  // consume din plafon. Ridică și alerta de 80% la Stefan, dacă e cazul.
  await recordUsage(user, spentInputTokens, spentOutputTokens)
  if (!producedContent) {
    yield { type: 'error', message: tr('errors.assistant.noAnswer') }
    return
  }

  for (const event of await persistPendingActions(conversationId, pending)) {
    yield event
  }
  // Referințele entităților citate — după `done`, înainte de închiderea stream-ului (Contract A),
  // ca FE să poată pune chips dedesubtul mesajului live fără să reparseze textul.
  const refs = extractEntityRefs(fullText)
  if (refs.length > 0) yield { type: 'entity_refs', refs }
  yield { type: 'done' }
}

export async function confirmPendingAction(
  me: SessionUser,
  actionId: string,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const [action] = await db
    .select()
    .from(assistantPendingActions)
    .where(and(eq(assistantPendingActions.id, actionId), eq(assistantPendingActions.status, 'pending')))
  if (!action || !(await ownsConversation(me, action.conversationId))) {
    return { ok: false, error: tr('errors.assistant.actionGone') }
  }
  if (action.expiresAt < new Date()) {
    await db.update(assistantPendingActions).set({ status: 'expired', updatedAt: new Date() }).where(eq(assistantPendingActions.id, action.id))
    return { ok: false, error: tr('errors.assistant.actionExpired') }
  }

  const executor = confirmExecutors[action.toolName]
  if (!executor) return { ok: false, error: tr('errors.assistant.unknownTool', { name: action.toolName }) }

  const user = await conversationOwner(action.conversationId)
  // Drepturile se verifică din nou aici, nu doar la înregistrare: acțiunea poate avea 15 minute,
  // timp în care funcționalitatea de care depinde i-a fost oprită (C2 — asistentul nu e o
  // ocolire a guard-ului nici pe calea confirmării).
  const feature = toolFeature(action.toolName)
  if (feature && !user.features.includes(feature)) {
    await db
      .update(assistantPendingActions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(assistantPendingActions.id, action.id))
    return { ok: false, error: tr('errors.assistant.actionNoLongerAllowed', { feature }) }
  }

  let resultText: string
  try {
    // Al doilea argument = contextul acțiunii persistate — tool-urile care se ancorează în
    // conversația curentă (schedule_report) îl folosesc, restul îl ignoră.
    const result = await executor(action.toolInput as never, {
      conversationId: action.conversationId,
      user,
    })
    resultText = tr('errors.assistant.actionDone', { result: JSON.stringify(result) })
  } catch (err) {
    resultText = tr('errors.assistant.actionFailed', { message: err instanceof Error ? err.message : String(err) })
  }

  await db
    .update(assistantPendingActions)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(eq(assistantPendingActions.id, action.id))

  await db.insert(assistantMessages).values({
    conversationId: action.conversationId,
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: action.toolUseId,
        content: resultText,
      },
    ],
  })

  return { ok: true, conversationId: action.conversationId }
}

export async function rejectPendingAction(
  me: SessionUser,
  actionId: string,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const [action] = await db
    .select()
    .from(assistantPendingActions)
    .where(and(eq(assistantPendingActions.id, actionId), eq(assistantPendingActions.status, 'pending')))
  if (!action || !(await ownsConversation(me, action.conversationId))) {
    return { ok: false, error: tr('errors.assistant.actionGone') }
  }

  const author = await conversationOwner(action.conversationId)

  await db
    .update(assistantPendingActions)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(assistantPendingActions.id, action.id))

  await db.insert(assistantMessages).values({
    conversationId: action.conversationId,
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: action.toolUseId,
        content: tr('errors.assistant.actionRejected', { author: userName(author) }),
      },
    ],
  })

  return { ok: true, conversationId: action.conversationId }
}

// Cron — vezi jobs/assistant-cleanup.ts.
export async function expirePendingActions() {
  const result = await db
    .update(assistantPendingActions)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(assistantPendingActions.status, 'pending'), lt(assistantPendingActions.expiresAt, new Date())))
    .returning({ id: assistantPendingActions.id })
  return result.length
}
