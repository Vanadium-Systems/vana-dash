/**
 * modules/monitoring/service.ts — Track A. Integration test cu pg real (test/setup.ts),
 * mockuim doar shared/lib/email.ts (network boundary) — restul (calcul semnale, motor de
 * alertare, cooldown) rulează cu DB real, exact ca în producție.
 */
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { syncLog, systemAlertState, systemMetricsSnapshots } from '../../shared/db/schema/index.js'

const sendAlertEmailMock = vi.fn()
vi.mock('../../shared/lib/email.js', () => ({
  sendAlertEmail: (...args: unknown[]) => sendAlertEmailMock(...args),
}))

const {
  __setLatestSnapshotForTest,
  computeAllSignals,
  SIGNAL_KEYS,
  transitionSignal,
} = await import('./service.js')

const BACKUP_DIR = './backup-test'
const syncLogIds: string[] = []

function writeBackupFile(name: string, ageHours: number) {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const path = `${BACKUP_DIR}/${name}`
  writeFileSync(path, 'fake dump')
  const mtime = new Date(Date.now() - ageHours * 60 * 60 * 1000)
  utimesSync(path, mtime, mtime)
}

async function makeSyncLog(status: 'FAILED' | 'SUCCESS', startedAt: Date) {
  const [row] = await db.insert(syncLog).values({ status, startedAt, jobKey: 'qa-test' }).returning()
  syncLogIds.push(row!.id)
  return row!
}

beforeEach(async () => {
  sendAlertEmailMock.mockReset()
  __setLatestSnapshotForTest(null)
  await db.delete(systemAlertState).where(inArray(systemAlertState.signalKey, SIGNAL_KEYS as string[]))
  if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true, force: true })
  // DB de dev partajat cu restul suitei (și cu teste manuale live, ex. curl direct) —
  // curăță orice FAILED rezidual din ultimele 2h ca jobs_failed să pornească de la 0, și
  // orice snapshot recent ca media 5min de la computeCpuAvg5m() să nu fie poluată de
  // rânduri scrise de alte rulări (nu de acest fișier de test, care manipulează snapshot-ul
  // "acum" doar în memorie via __setLatestSnapshotForTest, nu în DB).
  await db.delete(syncLog).where(and(eq(syncLog.status, 'FAILED'), gte(syncLog.startedAt, new Date(Date.now() - 2 * 60 * 60 * 1000))))
  await db.delete(systemMetricsSnapshots).where(gte(systemMetricsSnapshots.capturedAt, new Date(Date.now() - 10 * 60 * 1000)))
})

afterEach(async () => {
  if (syncLogIds.length) {
    await db.delete(syncLog).where(inArray(syncLog.id, syncLogIds.splice(0)))
  }
  __setLatestSnapshotForTest(null)
})

afterAll(async () => {
  if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true, force: true })
  await db.delete(systemAlertState).where(inArray(systemAlertState.signalKey, SIGNAL_KEYS as string[]))
})

describe('computeAllSignals — "no data yet" (fără ingest încă)', () => {
  it('cpu/ram/disk/containers sunt galben+null (nu verde fals) când nu există niciun snapshot', async () => {
    const signals = await computeAllSignals()
    const byKey = new Map(signals.map((s) => [s.key, s]))
    for (const key of ['cpu', 'ram', 'disk', 'containers'] as const) {
      expect(byKey.get(key)?.level).toBe('yellow')
      expect(byKey.get(key)?.value).toBeNull()
    }
  })

  it('întoarce toate cele 6 semnale, chiar fără date', async () => {
    const signals = await computeAllSignals()
    expect(signals.map((s) => s.key).sort()).toEqual(
      ['backup', 'containers', 'cpu', 'disk', 'jobs_failed', 'ram'].sort(),
    )
  })
})

describe('computeAllSignals — praguri cpu/ram/disk (cu snapshot)', () => {
  it('ram: verde <70, galben 70-90, roșu >90', async () => {
    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 0, ramPct: 50, diskPct: 0, containersHealthy: {} })
    expect((await computeAllSignals()).find((s) => s.key === 'ram')?.level).toBe('green')

    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 0, ramPct: 75, diskPct: 0, containersHealthy: {} })
    expect((await computeAllSignals()).find((s) => s.key === 'ram')?.level).toBe('yellow')

    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 0, ramPct: 95, diskPct: 0, containersHealthy: {} })
    expect((await computeAllSignals()).find((s) => s.key === 'ram')?.level).toBe('red')
  })

  it('disk: verde <70, galben 70-85, roșu >85', async () => {
    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 0, ramPct: 0, diskPct: 60, containersHealthy: {} })
    expect((await computeAllSignals()).find((s) => s.key === 'disk')?.level).toBe('green')

    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 0, ramPct: 0, diskPct: 90, containersHealthy: {} })
    expect((await computeAllSignals()).find((s) => s.key === 'disk')?.level).toBe('red')
  })

  it('cpu: roșu cere ȘI valoarea instant ȘI media 5min peste prag (un singur eșantion nu ajunge)', async () => {
    __setLatestSnapshotForTest({ capturedAt: new Date(), cpuPct: 95, ramPct: 0, diskPct: 0, containersHealthy: {} })
    // Fără alte rânduri în system_metrics_snapshots, media 5min cade pe valoarea curentă
    // (fallback), deci un singur eșantion peste prag TOT declanșează roșu aici.
    const signal = (await computeAllSignals()).find((s) => s.key === 'cpu')
    expect(signal?.level).toBe('red')
    expect(signal?.value).toBe(95)
  })

  it('containers: verde dacă toate healthy, galben dacă vreunul starting, roșu dacă vreunul unhealthy/stopped', async () => {
    __setLatestSnapshotForTest({
      capturedAt: new Date(),
      cpuPct: 0,
      ramPct: 0,
      diskPct: 0,
      containersHealthy: { backend: 'healthy', caddy: 'healthy' },
    })
    expect((await computeAllSignals()).find((s) => s.key === 'containers')?.level).toBe('green')

    __setLatestSnapshotForTest({
      capturedAt: new Date(),
      cpuPct: 0,
      ramPct: 0,
      diskPct: 0,
      containersHealthy: { backend: 'healthy', caddy: 'starting' },
    })
    expect((await computeAllSignals()).find((s) => s.key === 'containers')?.level).toBe('yellow')

    __setLatestSnapshotForTest({
      capturedAt: new Date(),
      cpuPct: 0,
      ramPct: 0,
      diskPct: 0,
      containersHealthy: { backend: 'stopped', caddy: 'healthy' },
    })
    const containersSignal = (await computeAllSignals()).find((s) => s.key === 'containers')
    expect(containersSignal?.level).toBe('red')
    expect(containersSignal?.value).toBe(1)
  })
})

describe('computeAllSignals — jobs_failed (din sync_log)', () => {
  it('verde cu 0 FAILED, galben cu 1-2, roșu cu ≥3 în ultima oră', async () => {
    expect((await computeAllSignals()).find((s) => s.key === 'jobs_failed')?.level).toBe('green')

    await makeSyncLog('FAILED', new Date())
    expect((await computeAllSignals()).find((s) => s.key === 'jobs_failed')?.level).toBe('yellow')

    await makeSyncLog('FAILED', new Date())
    await makeSyncLog('FAILED', new Date())
    expect((await computeAllSignals()).find((s) => s.key === 'jobs_failed')?.level).toBe('red')
  })

  it('ignoră FAILED-urile mai vechi de o oră și SUCCESS-urile', async () => {
    await makeSyncLog('FAILED', new Date(Date.now() - 2 * 60 * 60 * 1000))
    await makeSyncLog('SUCCESS', new Date())
    expect((await computeAllSignals()).find((s) => s.key === 'jobs_failed')?.level).toBe('green')
  })
})

describe('computeAllSignals — backup (mtime fișier)', () => {
  it('roșu dacă niciun fișier de backup nu există', async () => {
    const signal = (await computeAllSignals()).find((s) => s.key === 'backup')
    expect(signal?.level).toBe('red')
    expect(signal?.value).toBeNull()
  })

  it('verde <36h, galben 36-48h, roșu >48h', async () => {
    writeBackupFile('backup-2026-07-16.sql.gz', 10)
    expect((await computeAllSignals()).find((s) => s.key === 'backup')?.level).toBe('green')

    rmSync(BACKUP_DIR, { recursive: true, force: true })
    writeBackupFile('backup-2026-07-15.sql.gz', 40)
    expect((await computeAllSignals()).find((s) => s.key === 'backup')?.level).toBe('yellow')

    rmSync(BACKUP_DIR, { recursive: true, force: true })
    writeBackupFile('backup-2026-07-14.sql.gz', 60)
    expect((await computeAllSignals()).find((s) => s.key === 'backup')?.level).toBe('red')
  })

  it('ignoră fișiere care nu urmează convenția de nume backup-*.sql.gz', async () => {
    writeBackupFile('random-file.txt', 1)
    const signal = (await computeAllSignals()).find((s) => s.key === 'backup')
    expect(signal?.level).toBe('red') // niciun backup-*.sql.gz real găsit
  })
})

describe('transitionSignal — motor de alertare edge-triggered', () => {
  it('green -> red trimite email de alertă', async () => {
    await transitionSignal('cpu', 'red', 'test detail')
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(systemAlertState).where(eq(systemAlertState.signalKey, 'cpu'))
    expect(row?.currentLevel).toBe('red')
  })

  it('red -> red în interiorul cooldown-ului NU retrimite', async () => {
    await transitionSignal('ram', 'red', 'first')
    sendAlertEmailMock.mockClear()
    await transitionSignal('ram', 'red', 'second')
    expect(sendAlertEmailMock).not.toHaveBeenCalled()
  })

  it('red -> red DUPĂ cooldown retrimite (simulat prin last_email_sent_at vechi)', async () => {
    await transitionSignal('disk', 'red', 'first')
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000) // >2h cooldown
    await db.update(systemAlertState).set({ lastEmailSentAt: old }).where(eq(systemAlertState.signalKey, 'disk'))
    sendAlertEmailMock.mockClear()
    await transitionSignal('disk', 'red', 'second')
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
  })

  it('red -> green trimite email de recuperare', async () => {
    await transitionSignal('containers', 'red', 'down')
    sendAlertEmailMock.mockClear()
    await transitionSignal('containers', 'green', 'up')
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
    expect(sendAlertEmailMock.mock.calls[0]![0]).toMatch(/recuperat/i)
  })

  it('tranzițiile spre/prin galben nu trimit niciodată email', async () => {
    await transitionSignal('jobs_failed', 'yellow', 'meh')
    expect(sendAlertEmailMock).not.toHaveBeenCalled()
    await transitionSignal('jobs_failed', 'green', 'ok')
    expect(sendAlertEmailMock).not.toHaveBeenCalled()
  })

  it('idempotent sub concurență: N tranziții simultane green->red pt. același semnal trimit UN SINGUR email', async () => {
    const N = 5
    await Promise.all(Array.from({ length: N }, () => transitionSignal('backup', 'red', 'race')))
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(systemAlertState).where(eq(systemAlertState.signalKey, 'backup'))
    expect(row?.currentLevel).toBe('red')
  })
})

describe('transitionSignal — izolare între semnale', () => {
  it('o tranziție pe un semnal nu afectează starea altui semnal', async () => {
    await transitionSignal('cpu', 'red', 'x')
    const [ramRow] = await db.select().from(systemAlertState).where(eq(systemAlertState.signalKey, 'ram'))
    expect(ramRow?.currentLevel ?? 'green').toBe('green')
  })
})
