import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createGzip } from 'node:zlib'
import { config } from '../shared/config.js'
import { sendAlertEmail } from '../shared/lib/email.js'
import { tr } from '../shared/lib/i18n.js'

// Track A: pg_dump zilnic, gzip, retenție + alertă pe eșec — a doua plasă de siguranță,
// independentă de snapshot-ul automat Hetzner (decizie Stefan, 2026-07-16: cron local,
// nu doar Hetzner). Fișierele ajung în config.backupDir, citite și de
// modules/monitoring/service.ts (semnalul „backup", pe mtime).
const RUN_HOUR_UTC = 3

function msUntilNextRun(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC, 0, 0, 0))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

export async function runBackup(): Promise<void> {
  const dateStamp = new Date().toISOString().slice(0, 10)
  const outPath = `${config.backupDir}/backup-${dateStamp}.sql.gz`

  try {
    mkdirSync(config.backupDir, { recursive: true })

    // Conexiunea trece direct la pg_dump (nu re-parsată manual) — parsarea cu new URL()
    // encodează procentual caractere rezervate (ex. padding-ul base64 „=" dintr-o parolă)
    // fără să le decodeze înapoi, trimițând tacit credențiale greșite.
    const dumpProc = execFile('pg_dump', [`--dbname=${config.databaseUrl}`, '-Fp', '--no-password'], {
      maxBuffer: 512 * 1024 * 1024,
    })

    await new Promise<void>((resolve, reject) => {
      const gz = createGzip()
      const out = createWriteStream(outPath)
      dumpProc.stdout?.pipe(gz).pipe(out)
      dumpProc.stderr?.on('data', (d: Buffer) => console.warn('[backup] pg_dump stderr:', d.toString()))
      out.on('finish', resolve)
      out.on('error', reject)
      dumpProc.on('error', reject)
      dumpProc.on('close', (code) => {
        if (code !== 0) reject(new Error(tr('errors.backup.pgDumpExit', { code })))
      })
    })

    console.log(`[backup] backup scris: ${outPath}`)

    const cutoff = Date.now() - config.backupRetentionDays * 24 * 60 * 60 * 1000
    for (const file of readdirSync(config.backupDir)) {
      if (!file.startsWith('backup-') || !file.endsWith('.sql.gz')) continue
      const fp = `${config.backupDir}/${file}`
      if (statSync(fp).mtimeMs < cutoff) {
        rmSync(fp)
        console.log(`[backup] backup vechi șters: ${file}`)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[backup] backup eșuat:', err)
    await sendAlertEmail(tr('emails.backup.failedSubject'), tr('emails.backup.failedBody', { dateStamp, message }))
  }
}

export function startBackupJob(): void {
  const schedule = (): void => {
    const timer = setTimeout(() => {
      void runBackup().finally(schedule)
    }, msUntilNextRun())
    timer.unref()
  }
  schedule()
  console.log(`[backup] Scheduled (zilnic ${RUN_HOUR_UTC}:00 UTC)`)
}
