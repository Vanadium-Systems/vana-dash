/**
 * Asistentul vorbește cu omul, și nu e o ocolire a guard-ului (PLAN.md C2, QA-7 + SEC).
 *
 * Providerul e înlocuit cu unul care doar reține ce i-a fost trimis — de aceea putem verifica
 * două lucruri care altfel ar cere un apel real la API: ce tool-uri vede modelul și cum se
 * numește omul în prompt. Rularea programată (job, fără request) e cazul cel mai greu: autorul
 * trebuie să vină din conversație, nu din contextul requestului, iar drepturile lui recalculate
 * acum — de aceea rulăm exact pe această cale.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

const tururi: Array<{ system: string; tools: string[]; messages: unknown }> = []

vi.mock('./providers/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./providers/index.js')>()),
  buildActiveProvider: async () => ({
    id: 'anthropic',
    provider: {
      id: 'anthropic',
      async *streamTurn(params: { system: string; tools: Array<{ name: string }>; messages: unknown }) {
        tururi.push({ system: params.system, tools: params.tools.map((t) => t.name), messages: params.messages })
        yield { type: 'text_delta' as const, text: 'Răspuns de test' }
        yield { type: 'turn_end' as const, content: [{ type: 'text', text: 'Răspuns de test' }], usage: { inputTokens: 10, outputTokens: 5 } }
      },
    },
  }),
}))

import { db } from '../../shared/db/client.js'
import { assistantConversations, assistantUsage, roles, users } from '../../shared/db/schema/index.js'
import { effectiveFeatures } from '../../shared/lib/session.js'
import { executeReport } from '../../jobs/scheduled-tick.js'
import { runConversationTurn } from './service.js'

const SALES = ['clienti.view', 'clienti.prospectare', 'calendar.view', 'calendar.editare', 'email.view', 'email.trimitere']

const [role] = await db
  .insert(roles)
  .values({ name: `QA asistent: ${Date.now()}`, kind: 'custom', features: SALES })
  .returning()
const [ana] = await db
  .insert(users)
  .values({ email: `qa-asistent-${Date.now()}@test.local`, passwordHash: 'x', displayName: 'Ana Popescu', roleId: role!.id })
  .returning()

const conversationIds: string[] = []
async function conversationOf(ownerUserId: string | null) {
  const [row] = await db.insert(assistantConversations).values({ ownerUserId }).returning()
  conversationIds.push(row!.id)
  return row!
}

afterAll(async () => {
  // Rândurile de consum ale testului, ca plafonul lunar să nu rămână umplut pentru Ana.
  await db.delete(assistantUsage).where(eq(assistantUsage.userId, ana!.id))
  if (conversationIds.length) await db.delete(assistantConversations).where(inArray(assistantConversations.id, conversationIds))
  await db.delete(users).where(eq(users.id, ana!.id))
  await db.delete(roles).where(eq(roles.id, role!.id))
})

const rulează = async (generator: AsyncGenerator<{ type: string; text?: string }>) => {
  for await (const event of generator) void event
}

describe('promptul vorbește cu omul, nu cu „Stefan"', () => {
  it('numele din displayName ajunge în prompt, iar „Stefan" nu apare', async () => {
    const conv = await conversationOf(ana!.id)
    tururi.length = 0
    await rulează(runConversationTurn(conv.id, 'Bună'))

    const [tur] = tururi
    expect(tur!.system).toContain('Ana Popescu')
    expect(tur!.system).not.toContain('Stefan')
  })

  it('fără displayName se folosește emailul, tot nu „Stefan"', async () => {
    const [faraNume] = await db
      .insert(users)
      .values({ email: `qa-fara-nume-${Date.now()}@test.local`, passwordHash: 'x', displayName: null, roleId: role!.id })
      .returning()
    try {
      const conv = await conversationOf(faraNume!.id)
      tururi.length = 0
      await rulează(runConversationTurn(conv.id, 'Bună'))
      expect(tururi[0]!.system).toContain(faraNume!.email)
      expect(tururi[0]!.system).not.toContain('Stefan')
    } finally {
      await db.delete(assistantConversations).where(inArray(assistantConversations.id, conversationIds))
      await db.delete(users).where(eq(users.id, faraNume!.id))
    }
  })
})

describe('tool-urile sunt cele ale omului, recalculate la fiecare tur', () => {
  it('un coleg nu primește tool-uri pe care nu le are', async () => {
    const conv = await conversationOf(ana!.id)
    tururi.length = 0
    await rulează(runConversationTurn(conv.id, 'Ce facturi avem?'))

    const nume = tururi[0]!.tools
    expect(nume.length).toBeGreaterThan(0)
    // `facturi.*` și `investitii.bots` sunt ale altora — nu au ce căuta în lista lui Ana.
    expect(nume.some((t) => t.includes('invoice'))).toBe(false)
    expect(nume).not.toContain('jeffbot_overview')
    // Ce are, are: clienții și calendarul.
    expect(nume).toContain('list_prospects')
    expect(nume).toContain('list_calendar_events')
    // Fără cutie de email atribuită, tool-urile de trimitere lipsesc oricum (gating.test.ts).
    expect(nume).not.toContain('send_email')
  })

  it('dacă între timp i-a fost oprită o funcționalitate, tool-ul dispare la turul următor', async () => {
    const conv = await conversationOf(ana!.id)
    tururi.length = 0
    await rulează(runConversationTurn(conv.id, 'Prima întrebare'))
    expect(tururi[0]!.tools).toContain('create_prospect')

    const [rol] = await db.select().from(roles).where(eq(roles.id, role!.id))
    await db.update(roles).set({ features: ['clienti.view'] }).where(eq(roles.id, role!.id))
    try {
      await rulează(runConversationTurn(conv.id, 'A doua întrebare'))
      // Cititul rămâne (`clienti.view` e porntă), scrierea dispare cu `clienti.prospectare`.
      const tooluri = tururi[tururi.length - 1]!.tools
      expect(tooluri).toContain('list_prospects')
      expect(tooluri).not.toContain('create_prospect')
    } finally {
      await db.update(roles).set({ features: rol!.features }).where(eq(roles.id, role!.id))
    }
  })
})

describe('rultura programată rulează cu drepturile autorului', () => {
  it('conversația raportului e a autorului, iar promptul îi poartă numele', async () => {
    tururi.length = 0
    const preview = await executeReport({
      id: '00000000-0000-4000-8000-0000000000ff',
      ownerUserId: ana!.id,
      kind: 'report',
      runAt: new Date(),
      text: null,
      prompt: 'Rezumatul săptămânii',
      linkTo: null,
      recurrence: 'once',
      weekday: null,
      conversationId: null,
    })
    expect(preview).toBe('Răspuns de test')

    const [conv] = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.title, 'Rezumatul săptămânii'))
    expect(conv!.ownerUserId).toBe(ana!.id)
    // Fără request (job), deci autorul vine din conversație — și tool-urile sunt ale lui.
    expect(tururi[0]!.system).toContain('Ana Popescu')
    expect(tururi[0]!.system).not.toContain('Stefan')
    expect(tururi[0]!.tools).toContain('list_prospects')
    expect(tururi[0]!.tools.some((t) => t === 'issue_invoice')).toBe(false)
  })

  it('funcționalitățile effective ale rolului sunt cele salvate, cu poarta paginii', () => {
    expect(effectiveFeatures(['email.trimitere'], 'custom')).toEqual([])
    expect(effectiveFeatures(['email.view', 'email.trimitere'], 'custom')).toEqual(['email.view', 'email.trimitere'])
  })
})
