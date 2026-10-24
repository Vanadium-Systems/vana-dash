/**
 * Integration test, real pg (test/setup.ts): the ANAF emails are sorted, a D301 receipt confirms
 * the month in Declarations, and an unknown document raises one alert, not one per run.
 */
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import { alerts, declarationFilings, emailMessages, emailThreads } from '../shared/db/schema/index.js'
import { generateD301Preview } from '../modules/accounting/d301.js'
import { processSpvNotifications } from './spv-notifications.js'

const messageIds: string[] = []
const threadIds: string[] = []

afterAll(async () => {
  if (messageIds.length) await db.delete(emailMessages).where(inArray(emailMessages.id, messageIds))
  if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  await db.delete(declarationFilings).where(eq(declarationFilings.period, '2027-05'))
  await db.delete(alerts).where(like(alerts.message, '%TEST-SPV-NOTICE%'))
})

async function anafEmail(subject: string, body: string, from = 'Portal.ANAF@anaf.ro') {
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject, participants: [from], lastMessageAt: new Date() })
    .returning({ id: emailThreads.id })
  threadIds.push(thread!.id)
  const [message] = await db
    .insert(emailMessages)
    .values({ threadId: thread!.id, direction: 'in', fromAddress: from, toAddress: 'office@example.com', subject, bodyText: body, receivedAt: new Date() })
    .returning({ id: emailMessages.id })
  messageIds.push(message!.id)
  return message!.id
}

async function messageRow(id: string) {
  const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, id))
  return row!
}

describe('processSpvNotifications', () => {
  it('archives routine emails, confirms a D301 receipt and alerts once on anything else', async () => {
    const routine = await anafEmail('Documente noi SPV', '- CIF 12345674: Document Fisa Rol pentru CIF=12345674 in format PDF')
    const receipt = await anafEmail(
      'Documente noi SPV',
      '- CIF 90000014: recipisa pentru CIF 90000014, tip D301, numar_inregistrare INTERNT-1000000099-2027/20-06-2027, perioada raportare 5.2027',
    )
    const notice = await anafEmail('Documente noi SPV', '- CIF 90000014: Decizie TEST-SPV-NOTICE privind obligatiile')

    await processSpvNotifications()

    expect(await messageRow(routine)).toMatchObject({ folder: 'archive', isRead: true })
    expect((await messageRow(receipt)).labelId).not.toBeNull()
    expect(await messageRow(notice)).toMatchObject({ folder: 'inbox', isRead: false })

    const filing = (await generateD301Preview('2027-05')).filing
    expect(filing?.anafIndex).toBe('1000000099')
    expect(filing?.confirmedAt).not.toBeNull()

    await processSpvNotifications()
    const raised = await db.select().from(alerts).where(and(like(alerts.message, '%TEST-SPV-NOTICE%')))
    expect(raised).toHaveLength(1)
  })
})
