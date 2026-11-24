import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { createGzip } from 'node:zlib'
import { config } from '../shared/config.js'
import { sendAlertEmail } from '../shared/lib/email.js'
import { tr } from '../shared/lib/i18n.js'
import { isBackupBucketConfigured, uploadToBackupBucket } from '../shared/lib/r2.js'

const execFileAsync = promisify(execFile)

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

    // The files the database points to (contract PDFs, invoice XML, email attachments) live on disk,
    // not in the dump: without this archive a restore brings back rows whose documents are gone.
    const storagePath = `${config.backupDir}/storage-${dateStamp}.tar.gz`
    await archiveStorage(storagePath)
    console.log(`[backup] storage archived: ${storagePath}`) // slop-ok: the job logs to stdout like its other lines

    for (const localPath of [outPath, storagePath]) {
      try {
        const key = await uploadOffsiteBackup(localPath)
        if (key) console.log(`[backup] off-site copy uploaded: ${key}`) // slop-ok: the job logs to stdout like its other lines
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[backup] off-site upload failed:', err)
        await sendAlertEmail(tr('emails.backup.offsiteFailedSubject'), tr('emails.backup.offsiteFailedBody', { dateStamp, message }))
      }
    }

    const cutoff = Date.now() - config.backupRetentionDays * 24 * 60 * 60 * 1000
    for (const file of readdirSync(config.backupDir)) {
      const ours = (file.startsWith('backup-') && file.endsWith('.sql.gz')) || (file.startsWith('storage-') && file.endsWith('.tar.gz'))
      if (!ours) continue
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

/** The whole storage folder as one tar.gz; a missing folder (fresh install) gives an empty archive. */
export async function archiveStorage(outPath: string): Promise<void> {
  mkdirSync(config.storageDir, { recursive: true })
  await execFileAsync('tar', ['-czf', outPath, '-C', config.storageDir, '.'])
}

// Encrypted to a public key only, so whoever takes over this server cannot read the copies, and
// the bucket lock keeps them from being deleted. Returns the R2 key, or null when not configured.
export async function uploadOffsiteBackup(localPath: string): Promise<string | null> {
  const { ageRecipient } = config.backupOffsite
  if (!ageRecipient || !isBackupBucketConfigured()) return null

  const encryptedPath = `${localPath}.age`
  try {
    // Encrypt to a file first: piping age straight into the upload would store a truncated
    // object if age failed halfway, and the bucket lock would keep it there for weeks.
    await execFileAsync('age', ['--encrypt', '--recipient', ageRecipient, '--output', encryptedPath, localPath])
    // A timestamp, not just the date: the bucket lock refuses overwrites, so a second run on the
    // same day needs its own key.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const extension = localPath.endsWith('.tar.gz') ? '.tar.gz' : '.sql.gz'
    const key = `${basename(localPath, extension)}_${stamp}${extension}.age`
    await uploadToBackupBucket(key, createReadStream(encryptedPath))
    return key
  } finally {
    rmSync(encryptedPath, { force: true })
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
