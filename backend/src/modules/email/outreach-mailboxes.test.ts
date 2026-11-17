import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import {
  emailSends,
  emailSuppressions,
  emailTemplates,
  outreachMailboxes,
  roles,
  users,
} from '../../shared/db/schema/index.js'
import { closeAllSmtpPools, isLocalSmtpHost, mapSmtpError } from '../../shared/lib/smtp.js'
import { parseDsnBounce } from './outreach-bounce-imap.js'
import {
  createOutreachMailbox,
  effectiveDailyCap,
  listOutreachMailboxes,
  pickNextOutreachMailbox,
  testOutreachMailbox,
} from './outreach-mailboxes-service.js'
import { OutreachCapError } from './send-guard.js'
import { sendCampaignEmail } from './service.js'
import { updateEmailSettings } from './settings-service.js'

interface MiniSmtpState {
  port: number
  rejectNextRcpt: boolean
  receivedMessages: Array<{ from: string; to: string; data: string }>
  close: () => Promise<void>
}

async function startMiniSmtpServer(): Promise<MiniSmtpState> {
  const receivedMessages: Array<{ from: string; to: string; data: string }> = []
  const state: MiniSmtpState = {
    port: 0,
    rejectNextRcpt: false,
    receivedMessages,
    close: async () => {},
  }

  const server: Server = createServer((socket: Socket) => {
    let from = ''
    let to = ''
    let inData = false
    let dataBuf = ''
    let lineBuf = ''

    socket.write('220 localhost ESMTP MiniSMTP\r\n')
    socket.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8')
      while (true) {
        if (inData) {
          const endIdx = lineBuf.indexOf('\r\n.\r\n')
          if (endIdx === -1) break
          dataBuf += lineBuf.slice(0, endIdx)
          lineBuf = lineBuf.slice(endIdx + 5)
          inData = false
          receivedMessages.push({ from, to, data: dataBuf })
          dataBuf = ''
          socket.write('250 2.0.0 Ok: queued\r\n')
          continue
        }

        const nlIdx = lineBuf.indexOf('\r\n')
        if (nlIdx === -1) break
        const line = lineBuf.slice(0, nlIdx)
        lineBuf = lineBuf.slice(nlIdx + 2)
        const upper = line.toUpperCase()

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 SIZE 10485760\r\n')
        } else if (upper.startsWith('MAIL FROM:')) {
          from = line.slice(10).trim()
          socket.write('250 2.1.0 Ok\r\n')
        } else if (upper.startsWith('RCPT TO:')) {
          if (state.rejectNextRcpt) {
            state.rejectNextRcpt = false
            socket.write('550 5.1.1 User unknown\r\n')
          } else {
            to = line.slice(8).trim()
            socket.write('250 2.1.5 Ok\r\n')
          }
        } else if (upper === 'DATA') {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n')
          socket.end()
        } else if (upper === 'RSET' || upper === 'NOOP') {
          socket.write('250 2.0.0 Ok\r\n')
        } else {
          socket.write('250 2.0.0 Ok\r\n')
        }
      }
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') state.port = addr.port
      resolve()
    })
  })

  state.close = () =>
    new Promise((resolve) => {
      server.close(() => resolve())
    })
  return state
}

describe('outreach mailboxes — unit', () => {
  it('computes linear warm-up ramp up to warmupUntil', () => {
    const start = new Date('2026-11-01T00:00:00Z')
    const end = new Date('2026-11-11T00:00:00Z')
    const mid = new Date('2026-11-06T00:00:00Z')
    const after = new Date('2026-11-12T00:00:00Z')

    const m = { dailyCap: 50, createdAt: start, warmupUntil: end }
    expect(effectiveDailyCap(m, start)).toBe(10)
    expect(effectiveDailyCap(m, mid)).toBe(30)
    expect(effectiveDailyCap(m, after)).toBe(50)
    expect(effectiveDailyCap({ dailyCap: 50, createdAt: start, warmupUntil: null }, start)).toBe(50)
  })

  it('maps SMTP errors to safe error codes', () => {
    expect(mapSmtpError({ code: 'EAUTH', responseCode: 535 })).toBe('SMTP_AUTH_FAILED')
    expect(mapSmtpError({ code: 'ECONNREFUSED' })).toBe('SMTP_UNREACHABLE')
    expect(mapSmtpError({ responseCode: 550 })).toBe('SMTP_REJECTED')
    expect(mapSmtpError(new Error('other'))).toBe('SMTP_FAILED')
  })

  it('recognizes local SMTP hosts', () => {
    expect(isLocalSmtpHost('localhost')).toBe(true)
    expect(isLocalSmtpHost('127.0.0.1')).toBe(true)
    expect(isLocalSmtpHost('mailpit')).toBe(true)
    expect(isLocalSmtpHost('smtp.zoho.eu')).toBe(false)
  })

  it('parses RFC 3464 DSN permanent bounces and ignores delays or regular mail', () => {
    const permanentDsn = [
      'From: MAILER-DAEMON@example.com',
      'Content-Type: multipart/report; report-type=delivery-status',
      '',
      'Action: failed',
      'Status: 5.1.1',
      'Final-Recipient: rfc822; Dead.User@Example.COM',
    ].join('\r\n')
    expect(parseDsnBounce(permanentDsn)).toEqual({
      bouncedAddress: 'dead.user@example.com',
      statusCode: '5.1.1',
    })

    const delayedDsn = [
      'From: MAILER-DAEMON@example.com',
      'Content-Type: message/delivery-status',
      '',
      'Action: delayed',
      'Status: 4.4.1',
      'Final-Recipient: rfc822; slow@example.com',
    ].join('\r\n')
    expect(parseDsnBounce(delayedDsn)).toBeNull()

    expect(parseDsnBounce('From: friend@example.com\r\nSubject: Hello\r\n\r\nHi!')).toBeNull()
  })
})

describe('outreach mailboxes — integration', () => {
  const RUN = randomUUID().slice(0, 8)
  let smtp: MiniSmtpState
  const createdMailboxIds: string[] = []
  const createdTemplateIds: string[] = []
  const createdSendIds: string[] = []
  const createdUserIds: string[] = []
  const createdRoleIds: string[] = []
  const suppressedEmails: string[] = []

  const appPromise = buildServer()

  beforeAll(async () => {
    smtp = await startMiniSmtpServer()
    const app = await appPromise
    await app.ready()
    await updateEmailSettings({ outreachRealSendingEnabled: false })
  })

  afterEach(async () => {
    closeAllSmtpPools()
    if (createdSendIds.length > 0) {
      await db.delete(emailSends).where(inArray(emailSends.id, createdSendIds.splice(0)))
    }
    if (createdMailboxIds.length > 0) {
      await db.delete(outreachMailboxes).where(inArray(outreachMailboxes.id, createdMailboxIds.splice(0)))
    }
    if (suppressedEmails.length > 0) {
      await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressedEmails.splice(0)))
    }
    smtp.receivedMessages.length = 0
    smtp.rejectNextRcpt = false
  })

  afterAll(async () => {
    await smtp.close()
    if (createdTemplateIds.length > 0) {
      await db.delete(emailTemplates).where(inArray(emailTemplates.id, createdTemplateIds))
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds))
    }
    if (createdRoleIds.length > 0) {
      await db.delete(roles).where(inArray(roles.id, createdRoleIds))
    }
    const app = await appPromise
    await app.close()
  })

  it('encrypts secrets with v1, never exposes secretEnc, and blocks external SMTP when legal switch is off', async () => {
    const ext = await createOutreachMailbox({
      address: `ext-${RUN}@example.com`,
      displayName: 'External',
      smtpHost: 'smtp.zoho.eu',
      smtpPort: 465,
      smtpSecure: true,
      imapSecure: true,
      authKind: 'password',
      secret: 'super-secret-pass',
      dailyCap: 20,
    })
    createdMailboxIds.push(ext.id)

    const [rawRow] = await db.select().from(outreachMailboxes).where(eq(outreachMailboxes.id, ext.id))
    expect(rawRow?.secretEnc.startsWith('v1:')).toBe(true)
    expect(rawRow?.secretEnc).not.toContain('super-secret-pass')

    const listed = await listOutreachMailboxes()
    const found = listed.find((m) => m.id === ext.id)
    expect(found).toBeDefined()
    expect((found as unknown as Record<string, unknown>)['secretEnc']).toBeUndefined()

    const testRes = await testOutreachMailbox(ext.id, `admin-${RUN}@example.com`)
    expect(testRes).toEqual({ ok: false, code: 'OUTREACH_REAL_SENDING_DISABLED' })
  })

  it('rotates round-robin across local SMTP mailboxes, enforces daily cap, and suppresses synchronous bounces', async () => {
    const m1 = await createOutreachMailbox({
      address: `box1-${RUN}@example.com`,
      displayName: 'Box 1',
      smtpHost: '127.0.0.1',
      smtpPort: smtp.port,
      smtpSecure: false,
      imapSecure: true,
      authKind: 'password',
      secret: '',
      dailyCap: 1,
    })
    const m2 = await createOutreachMailbox({
      address: `box2-${RUN}@example.com`,
      displayName: 'Box 2',
      smtpHost: '127.0.0.1',
      smtpPort: smtp.port,
      smtpSecure: false,
      imapSecure: true,
      authKind: 'password',
      secret: '',
      dailyCap: 1,
    })
    createdMailboxIds.push(m1.id, m2.id)

    const [tpl] = await db
      .insert(emailTemplates)
      .values({ name: `Tpl ${RUN}`, subject: 'Hello {{nume}}', body: '<p>Hi {{nume}}</p>' })
      .returning()
    createdTemplateIds.push(tpl!.id)

    const r1 = await sendCampaignEmail({ to: `a-${RUN}@example.com`, nume: 'Ana', templateId: tpl!.id, from: 'outreach' })
    createdSendIds.push(r1.row.id)
    expect(r1.result.ok).toBe(true)
    expect(r1.row.outreachMailboxId).toBe(m1.id)

    const r2 = await sendCampaignEmail({ to: `b-${RUN}@example.com`, nume: 'Bob', templateId: tpl!.id, from: 'outreach' })
    createdSendIds.push(r2.row.id)
    expect(r2.result.ok).toBe(true)
    expect(r2.row.outreachMailboxId).toBe(m2.id)
    expect(smtp.receivedMessages).toHaveLength(2)
    expect(smtp.receivedMessages[0]?.data).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click')

    expect(await pickNextOutreachMailbox()).toBeNull()
    await expect(
      sendCampaignEmail({ to: `c-${RUN}@example.com`, templateId: tpl!.id, from: 'outreach' }),
    ).rejects.toBeInstanceOf(OutreachCapError)

    // Test synchronous bounce suppression with a 3rd mailbox
    const m3 = await createOutreachMailbox({
      address: `box3-${RUN}@example.com`,
      displayName: 'Box 3',
      smtpHost: '127.0.0.1',
      smtpPort: smtp.port,
      smtpSecure: false,
      imapSecure: true,
      authKind: 'password',
      secret: '',
      dailyCap: 5,
    })
    createdMailboxIds.push(m3.id)

    smtp.rejectNextRcpt = true
    const bounceTarget = `bounce-${RUN}@example.com`
    suppressedEmails.push(bounceTarget)
    const rBounce = await sendCampaignEmail({ to: bounceTarget, templateId: tpl!.id, from: 'outreach' })
    createdSendIds.push(rBounce.row.id)
    expect(rBounce.result.ok).toBe(false)
    expect(rBounce.row.status).toBe('bounced')

    const [sup] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, bounceTarget))
    expect(sup?.source).toBe('bounce')
  })

  it('allows employee with email.bulk to read /api/email/outreach-summary and blocks /api/email/outreach-mailboxes (403)', async () => {
    const app = await appPromise
    const [role] = await db
      .insert(roles)
      .values({
        name: `Sales ${RUN}`,
        kind: 'custom',
        features: ['email.view', 'email.trimitere', 'email.bulk'],
      })
      .returning()
    createdRoleIds.push(role!.id)

    const [user] = await db
      .insert(users)
      .values({
        email: `emp-${RUN}@example.com`,
        displayName: `Emp ${RUN}`,
        passwordHash: await argon2.hash('TestPass123!'),
        roleId: role!.id,
        status: 'active',
      })
      .returning()
    createdUserIds.push(user!.id)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user!.email, password: 'TestPass123!' },
    })
    expect(loginRes.statusCode).toBe(200)
    const setCookie = loginRes.headers['set-cookie']
    const cookieHeader = Array.isArray(setCookie)
      ? setCookie.map((c) => c.split(';')[0]).join('; ')
      : String(setCookie).split(';')[0]

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/email/outreach-summary',
      headers: { cookie: cookieHeader },
    })
    expect(summaryRes.statusCode).toBe(200)

    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/email/outreach-mailboxes',
      headers: { cookie: cookieHeader },
    })
    expect(adminRes.statusCode).toBe(403)
  })
})
