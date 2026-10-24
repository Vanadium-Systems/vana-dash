import cron from 'node-cron'
import { and, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm'
import { parseForm150Email, parseSpvDocumentsEmail, type SpvNotificationItem } from '../connectors/anaf/spv-notifications.js'
import { confirmFilingFromReceipt } from '../modules/accounting/d301.js'
import { db } from '../shared/db/client.js'
import { emailLabels, emailMessages, spvEmailNotices } from '../shared/db/schema/index.js'
import { tl } from '../shared/lib/i18n.js'
import { raiseAccountingAlert } from './accounting-alerts.js'

// Reads the emails ANAF sends about the SPV (see connectors/anaf/spv-notifications.ts):
// routine ones are archived, receipts get the "ANAF" label (a D301/D390 one also marks the month
// as registered in Declarations), and anything else gets the label, stays unread and alerts.
// A row in spv_email_notices marks an email as handled.

const CRON_EXPR = '*/10 * * * *'
const LOOKBACK_DAYS = 90
// Older emails found on the first run are sorted and labelled, but only recent ones alert.
const ALERT_WINDOW_DAYS = 3
const IMPORTANT_LABEL = 'ANAF'
const DECLARATIONS_WITH_FILINGS = new Set(['D301', 'D390'])

export function startSpvNotificationsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void processSpvNotifications().catch((err) => console.error(`[spv-notifications] ${String(err)}`))
  })
  console.log(`[spv-notifications] Scheduled (${CRON_EXPR})`)
}

async function importantLabelId(): Promise<string> {
  const [existing] = await db
    .select({ id: emailLabels.id })
    .from(emailLabels)
    .where(and(eq(emailLabels.name, IMPORTANT_LABEL), isNull(emailLabels.deletedAt)))
  if (existing) return existing.id
  const [created] = await db.insert(emailLabels).values({ name: IMPORTANT_LABEL, notificationsEnabled: true }).returning({ id: emailLabels.id })
  return created!.id
}

export async function processSpvNotifications(now = new Date()): Promise<{ handled: number; important: number }> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const pending = await db
    .select({
      id: emailMessages.id,
      fromAddress: emailMessages.fromAddress,
      subject: emailMessages.subject,
      bodyText: emailMessages.bodyText,
      receivedAt: sql<Date>`COALESCE(${emailMessages.receivedAt}, ${emailMessages.createdAt})`,
    })
    .from(emailMessages)
    .leftJoin(spvEmailNotices, eq(spvEmailNotices.emailMessageId, emailMessages.id))
    .where(
      and(
        isNull(spvEmailNotices.id),
        eq(emailMessages.direction, 'in'),
        isNull(emailMessages.deletedAt),
        gte(emailMessages.createdAt, since),
        or(ilike(emailMessages.fromAddress, '%portal.anaf@anaf.ro%'), ilike(emailMessages.fromAddress, '%admin.portal@mfinante.ro%')),
      ),
    )
    .limit(200)

  let important = 0
  for (const message of pending) {
    const receivedAt = new Date(message.receivedAt)
    const recent = now.getTime() - receivedAt.getTime() < ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const body = message.bodyText ?? ''
    let items: SpvNotificationItem[] = []
    let needsAttention = false

    if (/documente noi spv/i.test(message.subject)) {
      items = parseSpvDocumentsEmail(body)
      for (const item of items) {
        if (item.kind === 'receipt' && DECLARATIONS_WITH_FILINGS.has(item.declarationCode!)) {
          await confirmFilingFromReceipt(item.declarationCode as 'D301' | 'D390', item.period!, item.anafIndex!, receivedAt)
        }
        if (item.kind === 'important') {
          needsAttention = true
          if (recent) await raiseAccountingAlert('accounting.spv_notice', tl('alerts.accounting.spvNotice', { cif: item.cif, text: item.text }))
        }
      }
      if (items.length > 0 && items.every((i) => i.kind === 'routine')) {
        await db.update(emailMessages).set({ folder: 'archive', isRead: true }).where(eq(emailMessages.id, message.id))
      }
    } else {
      const form150 = parseForm150Email(message.subject, body)
      if (form150) {
        needsAttention = true
        if (recent) {
          const key = form150.rejected ? 'alerts.accounting.form150Rejected' : 'alerts.accounting.form150Answered'
          await raiseAccountingAlert('accounting.spv_notice', tl(key, { number: form150.formNumber, text: form150.text }))
        }
      }
      // Other ANAF emails (validation and security codes) are left alone.
    }

    if (needsAttention) {
      important++
      await db
        .update(emailMessages)
        .set({ labelId: await importantLabelId(), folder: 'inbox', isRead: false })
        .where(eq(emailMessages.id, message.id))
    } else if (items.some((i) => i.kind === 'receipt')) {
      // Receipts are worth finding later, not worth a notification.
      await db.update(emailMessages).set({ labelId: await importantLabelId() }).where(eq(emailMessages.id, message.id))
    }
    await db.insert(spvEmailNotices).values({ emailMessageId: message.id, items, important: needsAttention }).onConflictDoNothing()
  }
  return { handled: pending.length, important }
}
