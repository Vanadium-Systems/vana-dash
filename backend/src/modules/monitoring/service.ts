import { existsSync, readdirSync, statSync } from 'node:fs'
import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { syncLog, systemAlertState, systemMetricsSnapshots } from '../../shared/db/schema/index.js'
import { sendAlertEmail } from '../../shared/lib/email.js'

// Track A: monitorizare server vana-dash — ingest, calcul semnale, motor de alertare
// edge-triggered. Mirror după sistemul deja funcțional din recyclers_app
// (modules/admin/monitoring-service.ts) — vezi PLAN.md pt. adaptările specifice vana-dash
// (6 semnale nu 7, jobs_failed în loc de document_failures/pdf_queue).

export type SignalLevel = 'green' | 'yellow' | 'red'
export type SignalKey = 'cpu' | 'ram' | 'disk' | 'containers' | 'jobs_failed' | 'backup'

export const SIGNAL_KEYS: readonly SignalKey[] = ['cpu', 'ram', 'disk', 'containers', 'jobs_failed', 'backup']

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  cpu: 'CPU host',
  ram: 'RAM host',
  disk: 'Disk /',
  containers: 'Sănătate containere',
  jobs_failed: 'Job-uri eșuate',
  backup: 'Backup zilnic',
}

// Cooldown cât un semnal rămâne roșu — nu trimite email la fiecare ingest/poll.
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000

export const HISTORY_RETENTION_DAYS = 7
const HISTORY_BUCKET_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Latest raw snapshot — in-memory, la fel ca în recyclers_app. Pierdut la
// restart proces — semnalele cad pe "no data yet" (galben, nu verde fals)
// până la următorul ingest (~1 min).
// ---------------------------------------------------------------------------
interface LatestSnapshot {
  capturedAt: Date
  cpuPct: number
  ramPct: number
  diskPct: number
  containersHealthy: Record<string, string>
}

let latestSnapshot: LatestSnapshot | null = null

/** Doar pt. teste — nu e folosit de niciun cod de producție. */
export function __setLatestSnapshotForTest(snapshot: LatestSnapshot | null): void {
  latestSnapshot = snapshot
}

export type MonitoredHost = 'dash' | 'server-1'

export interface IngestHostMetricsInput {
  host?: MonitoredHost
  cpu_pct: number
  ram_pct: number
  disk_pct: number
  containers: Record<string, string>
}

/** Persistă un snapshot brut, actualizează tile-ul "acum" în memorie, rulează verificarea
 *  de alertare sincron împotriva semnalelor proaspăt calculate (nu amânat la următorul GET). */
export async function ingestHostMetrics(input: IngestHostMetricsInput): Promise<void> {
  const capturedAt = new Date()
  const host = input.host ?? 'dash'

  // server-1 e doar afișat — fără snapshot în memorie, fără motor de alertare (semnalele
  // și emailurile de mai jos descriu VPS-ul dash).
  if (host !== 'dash') {
    await db.insert(systemMetricsSnapshots).values({
      host,
      capturedAt,
      cpuPct: input.cpu_pct,
      ramPct: input.ram_pct,
      diskPct: input.disk_pct,
      containersHealthy: input.containers,
    })
    return
  }

  latestSnapshot = {
    capturedAt,
    cpuPct: input.cpu_pct,
    ramPct: input.ram_pct,
    diskPct: input.disk_pct,
    containersHealthy: input.containers,
  }

  await db.insert(systemMetricsSnapshots).values({
    capturedAt,
    cpuPct: input.cpu_pct,
    ramPct: input.ram_pct,
    diskPct: input.disk_pct,
    containersHealthy: input.containers,
  })

  const signals = await computeAllSignals()
  for (const signal of signals) {
    try {
      await transitionSignal(signal.key, signal.level, signal.detail)
    } catch (err) {
      // Bookkeeping-ul de alertare al unui semnal nu trebuie să blocheze restul semnalelor
      // și nici să pice ingest-ul (snapshot-ul de mai sus e deja salvat).
      console.error(`[monitoring] tranziție alertă eșuată pt. semnalul ${signal.key}:`, err)
    }
  }
}

// ---------------------------------------------------------------------------
// Calculul semnalelor.
// ---------------------------------------------------------------------------

export interface ComputedSignal {
  key: SignalKey
  level: SignalLevel
  value: number | null
  unit: 'pct' | 'count' | 'hours'
  detail: string
  meta?: Record<string, unknown>
}

async function computeCpuAvg5m(): Promise<number | null> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000)
  const rows = await db
    .select({ cpuPct: systemMetricsSnapshots.cpuPct })
    .from(systemMetricsSnapshots)
    .where(and(eq(systemMetricsSnapshots.host, 'dash'), gte(systemMetricsSnapshots.capturedAt, cutoff)))
  if (rows.length === 0) return null
  return rows.reduce((sum, r) => sum + r.cpuPct, 0) / rows.length
}

/** Roșu doar dacă și instant ȘI media pe 5 min depășesc pragul — un vârf momentan
 *  (un singur job greu) nu declanșează singur roșu/email, doar unul susținut. */
function computeCpuSignal(current: number, avg5m: number | null): ComputedSignal {
  const effectiveAvg = avg5m ?? current
  let level: SignalLevel
  if (current > 85 && effectiveAvg > 85) level = 'red'
  else if (current >= 60) level = 'yellow'
  else level = 'green'
  return {
    key: 'cpu',
    level,
    value: current,
    unit: 'pct',
    detail: `${current.toFixed(1)}% (medie 5 min: ${effectiveAvg.toFixed(1)}%)`,
  }
}

function computeRamSignal(current: number): ComputedSignal {
  const level: SignalLevel = current > 90 ? 'red' : current >= 70 ? 'yellow' : 'green'
  return { key: 'ram', level, value: current, unit: 'pct', detail: `${current.toFixed(1)}%` }
}

function computeDiskSignal(current: number): ComputedSignal {
  const level: SignalLevel = current > 85 ? 'red' : current >= 70 ? 'yellow' : 'green'
  return { key: 'disk', level, value: current, unit: 'pct', detail: `${current.toFixed(1)}%` }
}

function computeContainersSignal(containers: Record<string, string>): ComputedSignal {
  const statuses = Object.values(containers)
  const unhealthyCount = statuses.filter((s) => s !== 'healthy' && s !== 'starting').length
  const startingCount = statuses.filter((s) => s === 'starting').length
  let level: SignalLevel
  if (unhealthyCount > 0) level = 'red'
  else if (startingCount > 0) level = 'yellow'
  else level = 'green'
  return {
    key: 'containers',
    level,
    value: unhealthyCount,
    unit: 'count',
    detail: level === 'green' ? 'Toate containerele healthy' : `${unhealthyCount} unhealthy/oprite, ${startingCount} starting`,
    meta: { containers },
  }
}

/** Echivalentul funcțional al `document_failures` din recyclers_app — vana-dash n-are acel
 *  tabel, dar are deja `sync_log` (status FAILED per job: sync-anaf, sync-bank, email:*,
 *  vanagreen-billing). Count în ultima oră, praguri similare. */
async function computeJobsFailedSignal(): Promise<ComputedSignal> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000)
  const rows = await db
    .select({ id: syncLog.id })
    .from(syncLog)
    .where(and(eq(syncLog.status, 'FAILED'), gte(syncLog.startedAt, cutoff)))
  const count = rows.length
  const level: SignalLevel = count >= 3 ? 'red' : count >= 1 ? 'yellow' : 'green'
  return { key: 'jobs_failed', level, value: count, unit: 'count', detail: `${count} job(uri) eșuate în ultima oră` }
}

function computeBackupSignal(): ComputedSignal {
  let newestMtimeMs: number | null = null
  try {
    if (existsSync(config.backupDir)) {
      for (const file of readdirSync(config.backupDir)) {
        if (!file.startsWith('backup-') || !file.endsWith('.sql.gz')) continue
        const mtime = statSync(`${config.backupDir}/${file}`).mtimeMs
        if (newestMtimeMs === null || mtime > newestMtimeMs) newestMtimeMs = mtime
      }
    }
  } catch (err) {
    console.error(`[monitoring] citire BACKUP_DIR (${config.backupDir}) eșuată:`, err)
  }

  if (newestMtimeMs === null) {
    return { key: 'backup', level: 'red', value: null, unit: 'hours', detail: 'Niciun fișier de backup găsit' }
  }

  const hoursSince = (Date.now() - newestMtimeMs) / (60 * 60 * 1000)
  const level: SignalLevel = hoursSince > 48 ? 'red' : hoursSince >= 36 ? 'yellow' : 'green'
  return {
    key: 'backup',
    level,
    value: Number(hoursSince.toFixed(1)),
    unit: 'hours',
    detail: `Ultimul backup acum ${hoursSince.toFixed(1)}h`,
  }
}

/** cpu/ram/disk/containers depind de snapshot-ul "acum" din memorie — null până la primul
 *  ingest vreodată (ex. imediat după un deploy proaspăt). În acel gol raportează
 *  galben/null, nu verde fals, ca un feed de monitorizare cu adevărat lipsă să fie vizibil
 *  fără să spamăm cu alerte roșii. jobs_failed/backup se calculează mereu live. */
export async function computeAllSignals(): Promise<ComputedSignal[]> {
  const snapshot = latestSnapshot

  let cpuSignal: ComputedSignal
  let ramSignal: ComputedSignal
  let diskSignal: ComputedSignal
  let containersSignal: ComputedSignal

  if (!snapshot) {
    const noDataDetail = 'Fără date încă — niciun ingest primit'
    cpuSignal = { key: 'cpu', level: 'yellow', value: null, unit: 'pct', detail: noDataDetail }
    ramSignal = { key: 'ram', level: 'yellow', value: null, unit: 'pct', detail: noDataDetail }
    diskSignal = { key: 'disk', level: 'yellow', value: null, unit: 'pct', detail: noDataDetail }
    containersSignal = { key: 'containers', level: 'yellow', value: null, unit: 'count', detail: noDataDetail, meta: { containers: {} } }
  } else {
    const cpuAvg5m = await computeCpuAvg5m()
    cpuSignal = computeCpuSignal(snapshot.cpuPct, cpuAvg5m)
    ramSignal = computeRamSignal(snapshot.ramPct)
    diskSignal = computeDiskSignal(snapshot.diskPct)
    containersSignal = computeContainersSignal(snapshot.containersHealthy)
  }

  const jobsFailedSignal = await computeJobsFailedSignal()
  const backupSignal = computeBackupSignal()

  return [cpuSignal, ramSignal, diskSignal, containersSignal, jobsFailedSignal, backupSignal]
}

// ---------------------------------------------------------------------------
// Motor de alertare — tranziții edge-triggered + cooldown. Stare în
// `system_alert_state` (6 rânduri fixe, seedate lazy mai jos).
// ---------------------------------------------------------------------------

async function ensureAlertStateSeeded(): Promise<void> {
  await db
    .insert(systemAlertState)
    .values(SIGNAL_KEYS.map((key) => ({ signalKey: key })))
    .onConflictDoNothing({ target: systemAlertState.signalKey })
}

/**
 * Aplică nivelul nou calculat al unui semnal peste starea persistată, trimițând
 * alertă/recuperare la tranzițiile specificate.
 *
 * Concurență: fiecare mutație care decide dacă trimite email e un
 * `UPDATE ... WHERE signal_key = ? AND current_level = ?` atomic (sau, pt. cazul de
 * cooldown cât rămâne roșu, `WHERE ... AND current_level = 'red' AND last_email_sent_at < cutoff`),
 * gardat pe starea exactă observată de acest apel. Dacă un apelant concurent a schimbat deja
 * rândul, clauza de gardă nu se mai potrivește, `.returning()` vine gol, și acest apel sare
 * peste trimitere — doar apelantul care chiar a câștigat update-ul trimite email.
 */
export async function transitionSignal(key: SignalKey, newLevel: SignalLevel, detail: string): Promise<void> {
  await ensureAlertStateSeeded()

  const [current] = await db.select().from(systemAlertState).where(eq(systemAlertState.signalKey, key)).limit(1)
  if (!current) return

  const oldLevel = current.currentLevel as SignalLevel

  if (oldLevel === newLevel) {
    if (newLevel === 'red') {
      const cutoff = new Date(Date.now() - ALERT_COOLDOWN_MS)
      const rows = await db
        .update(systemAlertState)
        .set({ lastEmailSentAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(systemAlertState.signalKey, key),
            eq(systemAlertState.currentLevel, 'red'),
            or(isNull(systemAlertState.lastEmailSentAt), lt(systemAlertState.lastEmailSentAt, cutoff)),
          ),
        )
        .returning()
      if (rows.length > 0) {
        await sendAlertEmail(`Sănătate sistem — ${SIGNAL_LABELS[key]} tot roșu`, detail)
      }
    }
    return
  }

  const rows = await db
    .update(systemAlertState)
    .set({
      currentLevel: newLevel,
      lastTransitionAt: new Date(),
      lastEmailSentAt: newLevel === 'red' ? new Date() : current.lastEmailSentAt,
      updatedAt: new Date(),
    })
    .where(and(eq(systemAlertState.signalKey, key), eq(systemAlertState.currentLevel, oldLevel)))
    .returning()

  if (rows.length === 0) return // pierdut cursa — apelantul câștigător a trimis deja emailul

  if (newLevel === 'red') {
    await sendAlertEmail(`Sănătate sistem — ${SIGNAL_LABELS[key]} ROȘU`, detail)
  } else if (oldLevel === 'red' && newLevel === 'green') {
    await sendAlertEmail(`Sănătate sistem — ${SIGNAL_LABELS[key]} recuperat`, `${SIGNAL_LABELS[key]} a revenit la verde.`)
  }
  // Tranzițiile spre/prin galben (din orice parte) nu trimit niciodată email.
}

// ---------------------------------------------------------------------------
// GET /health-signals — semnale + istoric sparkline.
// ---------------------------------------------------------------------------

export interface HistoryPoint {
  capturedAt: Date
  cpuPct: number
  ramPct: number
  diskPct: number
}

export type HealthRange = '1h' | '1d' | '7d'

// Colectorul scrie o dată/minut (infra/host-metrics-collector.sh) — la '1h' bucketul e cât
// rezoluția brută (fără rollup, ~60 puncte), '1d'/'7d' rămân la 5 min ca să nu trimitem mii de
// puncte spre un SVG (cerință Stefan, 2026-08-27: selector de interval pe graficul de sănătate).
const RANGE_CONFIG: Record<HealthRange, { windowMs: number; bucketMs: number }> = {
  '1h': { windowMs: 60 * 60 * 1000, bucketMs: 60 * 1000 },
  '1d': { windowMs: 24 * 60 * 60 * 1000, bucketMs: HISTORY_BUCKET_MS },
  '7d': { windowMs: HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000, bucketMs: HISTORY_BUCKET_MS },
}

/** Bucketing la citire — fără scriere separată, "rollup" se calculează aici din rândurile
 *  brute care cad în fereastra cerută (max retenția de 7 zile). */
async function getHistoryBuckets(host: MonitoredHost, range: HealthRange): Promise<HistoryPoint[]> {
  const { windowMs, bucketMs } = RANGE_CONFIG[range]
  const cutoff = new Date(Date.now() - windowMs)
  const rows = await db
    .select({
      capturedAt: systemMetricsSnapshots.capturedAt,
      cpuPct: systemMetricsSnapshots.cpuPct,
      ramPct: systemMetricsSnapshots.ramPct,
      diskPct: systemMetricsSnapshots.diskPct,
    })
    .from(systemMetricsSnapshots)
    .where(and(eq(systemMetricsSnapshots.host, host), gte(systemMetricsSnapshots.capturedAt, cutoff)))
    .orderBy(systemMetricsSnapshots.capturedAt)

  if (rows.length === 0) return []

  const buckets = new Map<number, { cpu: number[]; ram: number[]; disk: number[]; capturedAt: Date }>()
  for (const row of rows) {
    const bucketKey = Math.floor(row.capturedAt.getTime() / bucketMs)
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      bucket = { cpu: [], ram: [], disk: [], capturedAt: new Date(bucketKey * bucketMs) }
      buckets.set(bucketKey, bucket)
    }
    bucket.cpu.push(row.cpuPct)
    bucket.ram.push(row.ramPct)
    bucket.disk.push(row.diskPct)
  }

  const avg = (arr: number[]): number => arr.reduce((sum, v) => sum + v, 0) / arr.length

  return [...buckets.values()]
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
    .map((bucket) => ({ capturedAt: bucket.capturedAt, cpuPct: avg(bucket.cpu), ramPct: avg(bucket.ram), diskPct: avg(bucket.disk) }))
}

// Colectorul trimite la fiecare minut; peste 5 min fără snapshot înseamnă că server-1 e
// oprit, fără rețea sau cron-ul lui s-a oprit.
const SECONDARY_HOST_STALE_MS = 5 * 60 * 1000

export interface SecondaryHostSummary {
  host: MonitoredHost
  lastCapturedAt: Date | null
  signals: ComputedSignal[]
  history: HistoryPoint[]
}

/** Aceleași praguri ca pt. dash, dar citite din ultimul rând din DB (nu există snapshot în
 *  memorie pt. server-1). Media CPU pe 5 min vine tot din DB. Alertele le ridică separat
 *  jobs/server1-alerts.ts, doar în-app + push. */
export async function getSecondaryHostSignals(host: MonitoredHost): Promise<Omit<SecondaryHostSummary, 'history'>> {
  const [latest] = await db
    .select({
      capturedAt: systemMetricsSnapshots.capturedAt,
      cpuPct: systemMetricsSnapshots.cpuPct,
      ramPct: systemMetricsSnapshots.ramPct,
      diskPct: systemMetricsSnapshots.diskPct,
    })
    .from(systemMetricsSnapshots)
    .where(eq(systemMetricsSnapshots.host, host))
    .orderBy(desc(systemMetricsSnapshots.capturedAt))
    .limit(1)

  if (!latest || Date.now() - latest.capturedAt.getTime() > SECONDARY_HOST_STALE_MS) {
    const detail = latest ? 'Fără snapshot de peste 5 min — server oprit sau colector căzut' : 'Fără date încă — niciun ingest primit'
    return {
      host,
      lastCapturedAt: latest?.capturedAt ?? null,
      signals: (['cpu', 'ram', 'disk'] as const).map((key) => ({ key, level: 'yellow', value: null, unit: 'pct', detail })),
    }
  }

  const cutoff = new Date(Date.now() - 5 * 60 * 1000)
  const [cpuAvg] = await db
    .select({ avg: sql<number | null>`AVG(${systemMetricsSnapshots.cpuPct})` })
    .from(systemMetricsSnapshots)
    .where(and(eq(systemMetricsSnapshots.host, host), gte(systemMetricsSnapshots.capturedAt, cutoff)))

  return {
    host,
    lastCapturedAt: latest.capturedAt,
    signals: [
      computeCpuSignal(latest.cpuPct, cpuAvg?.avg == null ? null : Number(cpuAvg.avg)),
      computeRamSignal(latest.ramPct),
      computeDiskSignal(latest.diskPct),
    ],
  }
}

async function getSecondaryHostSummary(host: MonitoredHost, range: HealthRange): Promise<SecondaryHostSummary> {
  const [latest, history] = await Promise.all([getSecondaryHostSignals(host), getHistoryBuckets(host, range)])
  return { ...latest, history }
}

export async function getHealthSignalsSummary(
  range: HealthRange = '7d',
): Promise<{ signals: ComputedSignal[]; history: HistoryPoint[]; hosts: SecondaryHostSummary[] }> {
  const [signals, history, server1] = await Promise.all([
    computeAllSignals(),
    getHistoryBuckets('dash', range),
    getSecondaryHostSummary('server-1', range),
  ])
  return { signals, history, hosts: [server1] }
}
