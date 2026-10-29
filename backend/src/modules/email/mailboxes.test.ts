/**
 * Izolarea pe cutii de email (PLAN.md C2, BE-4) — cel mai probabil loc în care un coleg ar
 * putea vedea emailurile altuia, deci verificat pe TOATE căile: listă, căutare, fir deschis
 * prin id direct, atașament cerut direct, și trimitere de pe o cutie care nu e a lui.
 */
import argon2 from 'argon2'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailAttachments, emailDrafts, emailMessages, emailThreads, emailTemplates, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import { emailSequences, emailSequenceSteps } from '../../shared/db/schema/index.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import { saveDocument } from '../../shared/lib/storage.js'

// Fără mock, reply-ul ar lovi Resend-ul real. Restul modulului rămâne cel adevărat.
// `id` unic la fiecare trimitere: `email_messages.resend_email_id` are index unic, iar un
// id constant ar lovi a doua trimitere din fișier. The run prefix keeps it unique across runs
// on the same database too.
const RUN = Date.now()
let sendCount = 0
vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return {
    ...actual,
    sendEmailWithResult: vi.fn(async () => ({ ok: true, id: `qa-mailbox-${RUN}-${(sendCount += 1)}` })),
    fetchReceivedEmail: async () => null,
  }
})

const app = await buildServer()
await app.ready()

const PASSWORD = 'parola-de-test-123'
const threadIds: string[] = []
const userIds: string[] = []
const roleIds: string[] = []
const draftIds: string[] = []
const sequenceIds: string[] = []
const templateIds: string[] = []

interface TestSession {
  me: SessionUser
  token: string
}

async function userWithMailboxes(email: string, identityKeys: string[]): Promise<TestSession> {
  const [role] = await db
    .insert(roles)
    .values({ name: `Test: cutii ${email}`, kind: 'custom', features: ['email.view', 'email.trimitere', 'email.bulk'] })
    .returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash(PASSWORD), displayName: email.split('@')[0], roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  if (identityKeys.length) {
    await db.insert(userMailboxes).values(identityKeys.map((key) => ({ userId: row!.id, identityKey: key })))
  }
  const token = await app.jwt.sign({ sub: row!.id, sv: 1 })
  const me: SessionUser = {
    id: row!.id,
    email,
    displayName: email.split('@')[0] ?? null,
    role: { id: role!.id, name: role!.name, kind: 'custom' as const },
    isPlatformAdmin: false,
    features: effectiveFeatures(['email.view', 'email.trimitere', 'email.bulk'], 'custom'),
    mailboxes: identityKeys,
    status: 'active' as const,
    lastSeenAt: null,
    notificationPrefs: null,
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    displayCurrency: 'RON',
    sessionVersion: 1,
  }
  return { me, token }
}

// Cutiile se cheamă după identitățile din Setări Email (cheia, nu adresa). `contact` și
// `stefan` există implicit; `sales` se adaugă din Setări, de aceea testul nu depinde de ea.
const salesUser = await userWithMailboxes('qa-contact-cutii@test.local', ['contact'])
const stefanUser = await userWithMailboxes('qa-stefan-cutii@test.local', ['stefan'])

async function makeThread(subject: string, toAddress: string) {
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject, participants: [toAddress, 'client@extern.ro'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(thread!.id)
  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: 'client@extern.ro',
      toAddress,
      subject,
      bodyText: 'Corp de test',
      receivedAt: new Date(),
    })
    .returning()
  return { thread: thread!, message: message! }
}

const salesThread = await makeThread('QA fir contact', 'contact@vanadium.systems')
const stefanThread = await makeThread('QA fir stefan', 'stefan@vanadium.systems')

const tokenOf = (u: TestSession) => u.token
const asSales = (u: TestSession) => app.inject({ method: 'GET', url: '/api/email/threads', cookies: { vana_session: tokenOf(u) } })
const threadById = (id: string, u: TestSession) =>
  app.inject({ method: 'GET', url: `/api/email/threads/${id}`, cookies: { vana_session: tokenOf(u) } })
const unreadOf = async (u: TestSession) => {
  const res = await app.inject({ method: 'GET', url: '/api/email/unread-counts', cookies: { vana_session: tokenOf(u) } })
  return res.json().data as { inbox: number; spam: number; total: number }
}

afterAll(async () => {
  if (draftIds.length) await db.delete(emailDrafts).where(inArray(emailDrafts.id, draftIds))
  if (sequenceIds.length) {
    await db.delete(emailSequenceSteps).where(inArray(emailSequenceSteps.sequenceId, sequenceIds))
    await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds))
  }
  if (templateIds.length) await db.delete(emailTemplates).where(inArray(emailTemplates.id, templateIds))
  if (threadIds.length) await db.delete(emailMessages).where(inArray(emailMessages.threadId, threadIds))
  if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  for (const id of userIds) {
    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  if (roleIds.length) await db.delete(roles).where(and(inArray(roles.id, roleIds), isNull(roles.deletedAt)))
  await app.close()
})

describe('vederea inboxului', () => {
  it('listă doar firele de pe cutiile omului', async () => {
    const res = await asSales(salesUser)
    expect(res.statusCode).toBe(200)
    const ids = res.json().data.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(salesThread.thread.id)
    expect(ids).not.toContain(stefanThread.thread.id)
  })

  it('căutarea nu întoarce firul pe care omul nu îl vede', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/email/threads?q=stefan',
      cookies: { vana_session: tokenOf(salesUser) },
    })
    const ids = list.json().data.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(stefanThread.thread.id)
  })

  it('firul străin deschis prin id direct → 404, nu 403', async () => {
    expect((await threadById(stefanThread.thread.id, salesUser)).statusCode).toBe(404)
    expect((await threadById(salesThread.thread.id, salesUser)).statusCode).toBe(200)
  })

  it('necititele sunt per om: cine își deschide firul îl scade doar la el', async () => {
    // Fir nou, ca testul să nu depindă de ce a deschis testele de dinainte.
    const fresh = await makeThread('QA fir necitit', 'contact@vanadium.systems')
    const before = await unreadOf(salesUser)
    const otherBefore = await unreadOf(stefanUser)
    expect(before.total).toBe(1)
    expect(otherBefore.total).toBe(1)

    await threadById(fresh.thread.id, salesUser)

    expect((await unreadOf(salesUser)).total).toBe(0)
    // Celălalt om nu e atins, chiar dacă firul stă în aceeași tabelă.
    expect((await unreadOf(stefanUser)).total).toBe(1)
  })
})

describe('trimiterea', () => {
  it('nu poate trimite de pe o cutie care nu e a lui (403 MAILBOX_FORBIDDEN)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { to: 'client@extern.ro', subject: 'QA', body: 'QA', from: 'stefan' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('MAILBOX_FORBIDDEN')
  })

  it('poate răspunde într-un fir de pe cutia lui', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${salesThread.thread.id}/reply`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { body: '<p>Răspuns de test</p>' },
    })
    // Răspunsul pleacă de pe adresa firului (contact@), care e și cutia omului ăsta.
    expect(res.statusCode).toBe(201)
  })

  it('răspunsul pe un fir străin e refuzat, chiar cu id corect', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${stefanThread.thread.id}/reply`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { body: '<p>nu ar trebui să ajungă</p>' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('răspunsul pe o cutie care nu e a omului e 403 MAILBOX_FORBIDDEN, nu 400', async () => {
    // Fir mixt: primit pe stefan@, dar cu un mesaj trimis de pe contact@ — deci omul cu
    // doar contact@ îl vede (listă, căutare, id), însă răspunsul ar pleca de pe stefan@.
    const fir = await makeThread('QA fir mixt', 'stefan@vanadium.systems')
    await db.insert(emailMessages).values({
      threadId: fir.thread.id,
      direction: 'out',
      fromAddress: 'contact@vanadium.systems',
      toAddress: 'client@extern.ro',
      subject: fir.thread.subject,
      bodyText: 'Alt mesaj, de pe cutia lui',
      sentByUserId: salesUser.me.id,
    })
    const list = await asSales(salesUser)
    expect(list.json().data.items.map((t: { id: string }) => t.id)).toContain(fir.thread.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${fir.thread.id}/reply`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { body: '<p>pe firul lui, nu pe cutia mea</p>' },
    })
    expect(res.statusCode, res.body).toBe(403)
    expect(res.json().error.code).toBe('MAILBOX_FORBIDDEN')
  })

  it('colegul răspunde pe cutia lui, nu pe una fixată în cod', async () => {
    // Omul cu doar stefan@ răspunde într-un fir primit pe stefan@ — nu pe `contact`, cum era
    // verificat înainte; un coleg de vânzări cu sales@ ar fi fost refuzat pe propria cutie.
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${stefanThread.thread.id}/reply`,
      cookies: { vana_session: tokenOf(stefanUser) },
      payload: { body: '<p>Răspuns de pe stefan@</p>' },
    })
    expect(res.statusCode, res.body).toBe(201)
    expect(res.json().data.fromAddress).toBe('stefan@vanadium.systems')
  })

  it('forward pe un mesaj din altă cutie: mesaj inexistent, ca orice id străin', async () => {
    const fir = await makeThread('QA fir forward', 'stefan@vanadium.systems')
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/messages/${fir.message.id}/forward`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { to: 'altcineva@extern.ro' },
    })
    expect(res.statusCode, res.body).toBe(400)
    expect(res.body).toContain('Mesaj inexistent')
  })

  it('forward pe un mesaj trimis de el e refuzat: ar pleca de pe adresa destinatarului', async () => {
    // Mesajul e al lui (l-a trimis de pe contact@), deci e vizibil — dar adresa de pe care ar
    // pleca forward-ul e cea a destinatarului, care nu e cutia lui.
    const fir = await makeThread('QA fir forward trimis', 'contact@vanadium.systems')
    const [trimis] = await db
      .insert(emailMessages)
      .values({
        threadId: fir.thread.id,
        direction: 'out',
        fromAddress: 'contact@vanadium.systems',
        toAddress: 'client@extern.ro',
        subject: fir.thread.subject,
        bodyText: 'Trimis de el însuși',
        sentByUserId: salesUser.me.id,
      })
      .returning()
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/messages/${trimis!.id}/forward`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { to: 'altcineva@extern.ro' },
    })
    expect(res.statusCode, res.body).toBe(403)
    expect(res.json().error.code).toBe('MAILBOX_FORBIDDEN')
  })

  it('forward pe cutia lui merge, iar mesajul poartă autorul', async () => {
    const fir = await makeThread('QA fir forward propriu', 'contact@vanadium.systems')
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/messages/${fir.message.id}/forward`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { to: 'altcineva@extern.ro' },
    })
    expect(res.statusCode, res.body).toBe(201)
    const [trimis] = await db
      .select({ sentByUserId: emailMessages.sentByUserId, fromAddress: emailMessages.fromAddress, threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(and(eq(emailMessages.forwardOfMessageId, fir.message.id), isNull(emailMessages.deletedAt)))
    // The forward opens a thread of its own; afterAll removes it with the others.
    if (trimis && !threadIds.includes(trimis.threadId)) threadIds.push(trimis.threadId)
    expect(trimis!.sentByUserId).toBe(salesUser.me.id)
    expect(trimis!.fromAddress).toBe('contact@vanadium.systems')
  })

  it('secvențele nu pot pleca de pe o cutie care nu e a omului', async () => {
    const [tpl] = await db.insert(emailTemplates).values({ name: 'QA cutii secvență', subject: 'S', body: 'B' }).returning()
    templateIds.push(tpl!.id)
    const refuzat = await app.inject({
      method: 'POST',
      url: '/api/email/sequences',
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { name: 'QA cutii', fromIdentity: 'outreach', steps: [{ templateId: tpl!.id, delayDays: 0 }] },
    })
    expect(refuzat.statusCode).toBe(403)
    expect(refuzat.json().error.code).toBe('MAILBOX_FORBIDDEN')

    const seq = await app.inject({
      method: 'POST',
      url: '/api/email/sequences',
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { name: 'QA cutii', fromIdentity: 'contact', steps: [{ templateId: tpl!.id, delayDays: 0 }] },
    })
    expect(seq.statusCode).toBe(201)
    sequenceIds.push(seq.json().data.id)

    // Nici schimbarea identității unei secvențe existente nu trece pe o cutie străină.
    const schimbata = await app.inject({
      method: 'PATCH',
      url: `/api/email/sequences/${seq.json().data.id}`,
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { fromIdentity: 'stefan' },
    })
    expect(schimbata.statusCode).toBe(403)
  })

  it('ciorna e a autorului: nu apare la colegul cu aceeași cutie și nu se deschide prin id', async () => {
    const ciorna = await app.inject({
      method: 'POST',
      url: '/api/email/drafts',
      cookies: { vana_session: tokenOf(salesUser) },
      payload: { fromKey: 'contact', to: 'client@extern.ro', subject: 'QA ciornă', body: '<p>neterminat</p>' },
    })
    expect(ciorna.statusCode).toBe(201)
    const id = ciorna.json().data.id
    draftIds.push(id)

    const lista = await app.inject({ method: 'GET', url: '/api/email/drafts', cookies: { vana_session: tokenOf(salesUser) } })
    expect(lista.json().data.map((d: { id: string }) => d.id)).toContain(id)

    // `colea` are tot contact@, deci nu-ai lui: ciorna rămâne a lui.
    const coleg = await userWithMailboxes('qa-colega-cutii@test.local', ['contact'])
    const listaColegului = await app.inject({ method: 'GET', url: '/api/email/drafts', cookies: { vana_session: tokenOf(coleg) } })
    expect(listaColegului.json().data.map((d: { id: string }) => d.id)).not.toContain(id)
    const deschidere = await app.inject({
      method: 'GET',
      url: `/api/email/drafts/${id}`,
      cookies: { vana_session: tokenOf(coleg) },
    })
    expect(deschidere.statusCode).toBe(404)
  })
})

describe('aceeași cutie la doi oameni', () => {
  it('cititul rămâne per om, iar răspunsul e păstrat cu autorul', async () => {
    const primul = await userWithMailboxes('qa-primul-cutii@test.local', ['contact'])
    const alDoilea = await userWithMailboxes('qa-al-doilea-cutii@test.local', ['contact'])
    const inainte = { primul: (await unreadOf(primul)).total, alDoilea: (await unreadOf(alDoilea)).total }
    const fir = await makeThread('QA fir comun', 'contact@vanadium.systems')
    expect((await unreadOf(primul)).total).toBe(inainte.primul + 1)
    expect((await unreadOf(alDoilea)).total).toBe(inainte.alDoilea + 1)

    // Primul citește și răspunde; al doilea nu e atins.
    await threadById(fir.thread.id, primul)
    const raspuns = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${fir.thread.id}/reply`,
      cookies: { vana_session: tokenOf(primul) },
      payload: { body: '<p>Primul a răspuns</p>' },
    })
    expect(raspuns.statusCode).toBe(201)
    expect((await unreadOf(primul)).total).toBe(inainte.primul)
    expect((await unreadOf(alDoilea)).total).toBe(inainte.alDoilea + 1)

    const [mesaj] = await db
      .select({ sentByUserId: emailMessages.sentByUserId })
      .from(emailMessages)
      .where(and(eq(emailMessages.threadId, fir.thread.id), eq(emailMessages.direction, 'out')))
      .orderBy(desc(emailMessages.createdAt))
    expect(mesaj!.sentByUserId).toBe(primul.me.id)
  })

  it('al doilea răspuns pe același fir primește 409 cu cine a răspuns', async () => {
    const primul = await userWithMailboxes('qa-409-primul@test.local', ['contact'])
    const alDoilea = await userWithMailboxes('qa-409-al-doilea@test.local', ['contact'])
    const fir = await makeThread('QA fir 409', 'contact@vanadium.systems')
    const [primit] = await db
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(eq(emailMessages.threadId, fir.thread.id), eq(emailMessages.direction, 'in')))

    await app.inject({
      method: 'POST',
      url: `/api/email/threads/${fir.thread.id}/reply`,
      cookies: { vana_session: tokenOf(primul) },
      payload: { body: '<p>Primul a răspuns</p>', lastSeenMessageId: primit!.id },
    })
    // „Trimite oricum" rămâne posibil: al doilea are voie să trimită peste răspunsul primului.
    const res = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${fir.thread.id}/reply`,
      cookies: { vana_session: tokenOf(alDoilea) },
      payload: { body: '<p>Și al doilea</p>', lastSeenMessageId: primit!.id },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'THREAD_REPLIED_MEANWHILE', by: primul.me.displayName })

    const forzat = await app.inject({
      method: 'POST',
      url: `/api/email/threads/${fir.thread.id}/reply`,
      cookies: { vana_session: tokenOf(alDoilea) },
      payload: { body: '<p>Fortez, am citit răspunsul</p>' },
    })
    expect(forzat.statusCode).toBe(201)
  })
})

describe('atașamentele', () => {
  it('un atașament dintr-un fir străin e 404, chiar cerut direct prin id', async () => {
    const [atașament] = await db
      .insert(emailAttachments)
      .values({
        messageId: stefanThread.message.id,
        filename: 'qa-secret.txt',
        storagePath: 'email-qa/nu-se-citeste.txt',
        contentType: 'text/plain',
      })
      .returning()
    const res = await app.inject({
      method: 'GET',
      url: `/api/email/attachments/${atașament!.id}/download`,
      cookies: { vana_session: tokenOf(salesUser) },
    })
    expect(res.statusCode).toBe(404)
    await db.delete(emailAttachments).where(eq(emailAttachments.id, atașament!.id))
  })

  it('an HTML attachment is downloaded, never rendered on the app origin; an image opens inline', async () => {
    const htmlPath = await saveDocument('email-qa/sender-page.html', '<script>alert(1)</script>')
    const pngPath = await saveDocument('email-qa/photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const [html, png] = await db
      .insert(emailAttachments)
      .values([
        { messageId: stefanThread.message.id, filename: 'factură "nouă".html', storagePath: htmlPath, contentType: 'text/html' },
        { messageId: stefanThread.message.id, filename: 'photo.png', storagePath: pngPath, contentType: 'image/png' },
      ])
      .returning()
    const get = (id: string) =>
      app.inject({ method: 'GET', url: `/api/email/attachments/${id}/download`, cookies: { vana_session: tokenOf(stefanUser) } })

    const page = await get(html!.id)
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toBe('application/octet-stream')
    expect(page.headers['content-disposition']).toBe("attachment; filename*=UTF-8''factur%C4%83%20_nou%C4%83_.html")

    const photo = await get(png!.id)
    expect(photo.headers['content-type']).toBe('image/png')
    expect(photo.headers['content-disposition']).toMatch(/^inline;/)

    await db.delete(emailAttachments).where(inArray(emailAttachments.id, [html!.id, png!.id]))
  })
})
