import cron from 'node-cron'
import * as archiveService from '../modules/archive/service.js'

// Pe 1 ale lunii: pt. fiecare folder din Arhivă cu autoMonthlySubfolders activ (setat din UI,
// per folder), creează subfolderul lunii curente cu numele "LL-AAAA" (ex: "07-2026"), dacă nu
// există deja. Idempotent — ensureFolder verifică existența înainte de creare, deci rulările
// repetate (restart server, retry) nu duplică folderul.
//
// '0 5 1 * *' — 05:00 UTC, între jobs/backup.ts (03:00) și jobs/bnr-daily-fetch.ts (06:00).
const CRON_EXPR = '0 5 1 * *'

export function startArchiveMonthlyFoldersJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runArchiveMonthlyFoldersJob()
  })
  console.log(`[archive-monthly-folders] Scheduled (${CRON_EXPR})`)
}

export async function runArchiveMonthlyFoldersJob(): Promise<void> {
  const folders = await archiveService.listAutoMonthlyFolders()
  if (folders.length === 0) return

  const name = archiveService.monthYearFolderName(new Date())
  for (const folder of folders) {
    try {
      await archiveService.ensureFolder(name, folder.id)
      console.log(`[archive-monthly-folders] "${name}" asigurat sub "${folder.name}" (${folder.id})`)
    } catch (err) {
      console.error(`[archive-monthly-folders] eroare la folderul ${folder.id}:`, err)
    }
  }
}
