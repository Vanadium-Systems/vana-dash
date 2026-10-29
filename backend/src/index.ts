import { buildServer } from './app.js'
import { startAccountingAlertsJob } from './jobs/accounting-alerts.js'
import { startArchiveMonthlyFoldersJob } from './jobs/archive-monthly-folders.js'
import { startAssistantCleanupJob } from './jobs/assistant-cleanup.js'
import { startBackupJob } from './jobs/backup.js'
import { startBillingCycleRolloverJob } from './jobs/billing-cycle-rollover.js'
import { startBnrDailyFetchJob } from './jobs/bnr-daily-fetch.js'
import { startBookingPurgeJob } from './jobs/booking-purge.js'
import { startCallsCloseJob } from './jobs/calls-close.js'
import { startCalendarRemindersJob } from './jobs/calendar-reminders.js'
import { startChatCleanupJob } from './jobs/chat-cleanup.js'
import { startCryptoPriceSyncJob } from './jobs/crypto-price-sync.js'
import { startAssetsPriceSyncJob } from './jobs/assets-price-sync.js'
import { startEmailReconcileJob } from './jobs/email-reconcile.js'
import { startEmailSequenceRunnerJob } from './jobs/email-sequence-runner.js'
import { startJeffbotAlertsJob } from './jobs/jeffbot-alerts.js'
import { startMetricAlertsJob } from './jobs/metric-alerts.js'
import { startMonthlyReportEmailJob } from './jobs/monthly-report-email.js'
import { startPlatformOpsAlertsJob } from './jobs/platform-ops-alerts.js'
import { startAnafUploadPollJob } from './jobs/poll-anaf-upload-status.js'
import { startAnafTokenRefreshJob } from './jobs/refresh-anaf-token.js'
import { startRecurringExpensesJob } from './jobs/recurring-expenses.js'
import { startRevolutTokenRefreshJob } from './jobs/refresh-revolut-token.js'
import { startScheduledTickJob } from './jobs/scheduled-tick.js'
import { startAnafSyncJob } from './jobs/sync-anaf.js'
import { startBankSyncJob } from './jobs/sync-bank.js'
import { startSyncRunner } from './jobs/sync-runner.js'
import { startSystemMetricsPurgeJob } from './jobs/system-metrics-purge.js'
import { startServer1AlertsJob } from './jobs/server1-alerts.js'
import { startSpvNotificationsJob } from './jobs/spv-notifications.js'
import { startTenderWatchSyncJob } from './jobs/tender-watch-sync.js'
import { startUptimeMonitorJob } from './jobs/uptime-monitor.js'
import { startVanagreenBillingJob } from './jobs/vanagreen-billing.js'
import { startVanagreenTenantSyncJob } from './jobs/vanagreen-tenant-sync.js'
import { config } from './shared/config.js'
import { assertRlsRoleIsSafe } from './shared/db/client.js'
import { importCompanyProfileFromEnv } from './shared/lib/company-env-import.js'
import { closeBrowser } from './shared/lib/pdf.js'

// Most cron jobs start with `void runXJob()`. A rejection there used to stop the whole process
// (Node's default), so one bad job run took the API down with it. Log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

await assertRlsRoleIsSafe()
await importCompanyProfileFromEnv()

const app = await buildServer()
await startSyncRunner()
startAnafSyncJob()
startAnafTokenRefreshJob()
startAnafUploadPollJob()
startBankSyncJob()
startRevolutTokenRefreshJob()
startAccountingAlertsJob()
startSpvNotificationsJob()
startMetricAlertsJob()
startPlatformOpsAlertsJob()
startUptimeMonitorJob()
startMonthlyReportEmailJob()
startEmailReconcileJob()
startEmailSequenceRunnerJob()
startVanagreenBillingJob()
startVanagreenTenantSyncJob()
startBillingCycleRolloverJob()
startRecurringExpensesJob()
startBnrDailyFetchJob()
startSystemMetricsPurgeJob()
startBookingPurgeJob()
startCallsCloseJob()
startServer1AlertsJob()
startBackupJob()
startArchiveMonthlyFoldersJob()
startCalendarRemindersJob()
startAssistantCleanupJob()
startChatCleanupJob()
startScheduledTickJob()
startCryptoPriceSyncJob()
startAssetsPriceSyncJob()
startTenderWatchSyncJob()
if (config.jeffbotIngestToken) startJeffbotAlertsJob()

if (!config.vapid.publicKey || !config.vapid.privateKey) {
  console.warn(
    '[startup] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY neconfigurate — notificările push sunt dezactivate. ' +
      'Generează cu `npx web-push generate-vapid-keys` și setează-le în .env.',
  )
}

app.addHook('onClose', async () => {
  await closeBrowser()
})

// Reminder la fiecare pornire, nu doar reactiv la trimiterea unei alerte —
// Stefan trebuie să verifice domeniul (SPF/DKIM) în dashboard-ul Resend
// înainte ca emailul să fie funcțional în producție (nu se poate automatiza).
if (!config.resendApiKey) {
  console.warn(
    '[startup] RESEND_API_KEY neconfigurat — alertele email sunt dezactivate. ' +
      'Verifică domeniul (SPF/DKIM) în dashboard-ul Resend, apoi setează RESEND_API_KEY în .env.',
  )
}

if (!config.firebase.serviceAccountJson) {
  console.warn(
    '[startup] FIREBASE_SERVICE_ACCOUNT_JSON neconfigurat — notificările FCM pe APK sunt dezactivate. ' +
      'Service account JSON-ul se generează din Consolă Firebase (Conturi de serviciu).',
  )
}

await app.listen({ port: config.port, host: config.host })
