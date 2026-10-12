import cron from 'node-cron'
import * as reportsService from '../modules/reports/service.js'
import { config } from '../shared/config.js'
import { sendEmail } from '../shared/lib/email.js'

// Digest lunar automat — ziua 1 a lunii, ora 8, PDF-ul lunii ANTERIOARE (luna care tocmai
// s-a încheiat). Simetric cu alertele existente pe email (notificări reactive) — asta e un
// digest proactiv din aceeași infra (sendEmail cu atașament, deja folosit Sprint A).
const CRON_EXPR = '0 8 1 * *'

export function startMonthlyReportEmailJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runMonthlyReportEmailJob().catch((err) => console.error(`[monthly-report-email] ${String(err)}`))
  })
  console.log(`[monthly-report-email] Scheduled (${CRON_EXPR})`)
}

function previousMonth(): string {
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function runMonthlyReportEmailJob(): Promise<void> {
  const month = previousMonth()
  const pdf = await reportsService.generateMonthlySnapshotPdf({ month })
  if (!pdf) {
    console.warn(`[monthly-report-email] PDF indisponibil (Chromium neconfigurat) pt. ${month} — sar peste digest`)
    return
  }

  await sendEmail({
    to: config.alertEmailTo,
    subject: `[vana-dash] Raport lunar ${month}`,
    text: `Raportul lunar pentru ${month} e atașat (PDF).`,
    attachments: [{ filename: `raport-${month}.pdf`, content: pdf }],
  })
}
