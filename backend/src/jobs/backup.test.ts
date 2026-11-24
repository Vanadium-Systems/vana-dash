import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../shared/config.js'
import { archiveStorage, uploadOffsiteBackup } from './backup.js'

const uploads: { key: string; body: Buffer }[] = []

vi.mock('../shared/lib/r2.js', () => ({
  isBackupBucketConfigured: () => true,
  uploadToBackupBucket: async (key: string, body: Readable) => {
    const chunks: Buffer[] = []
    for await (const chunk of body) chunks.push(chunk as Buffer)
    uploads.push({ key, body: Buffer.concat(chunks) })
  },
}))

const dir = mkdtempSync(join(tmpdir(), 'backup-test-'))
const identityPath = join(dir, 'key.txt')
execFileSync('age-keygen', ['-o', identityPath], { stdio: 'ignore' })
const recipient = execFileSync('age-keygen', ['-y', identityPath]).toString().trim()

describe('uploadOffsiteBackup', () => {
  beforeEach(() => {
    uploads.length = 0
    config.backupOffsite.ageRecipient = recipient
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('uploads a copy only the private key can read, and leaves no encrypted file behind', async () => {
    const dumpPath = join(dir, 'backup-2026-01-02.sql.gz')
    const dump = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE invoices ();\n')
    writeFileSync(dumpPath, dump)

    const key = await uploadOffsiteBackup(dumpPath)

    expect(key).toMatch(/^backup-2026-01-02_\d{4}-\d{2}-\d{2}T[\d-]+Z\.sql\.gz\.age$/)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.body.includes(dump)).toBe(false)
    const decrypted = execFileSync('age', ['--decrypt', '--identity', identityPath], { input: uploads[0]!.body })
    expect(decrypted.equals(dump)).toBe(true)
    expect(existsSync(`${dumpPath}.age`)).toBe(false)
  })

  it('does nothing without a recipient', async () => {
    config.backupOffsite.ageRecipient = ''
    const dumpPath = join(dir, 'backup-2026-01-03.sql.gz')
    writeFileSync(dumpPath, 'x')

    expect(await uploadOffsiteBackup(dumpPath)).toBeNull()
    expect(uploads).toHaveLength(0)
  })
})

describe('archiveStorage', () => {
  const work = mkdtempSync(join(tmpdir(), 'storage-backup-test-'))
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  it('packs the storage folder, so the contract PDFs can be restored with the dump', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'storage-test-'))
    const previous = config.storageDir
    config.storageDir = storage
    try {
      const pdf = Buffer.from('%PDF-1.7 test contract')
      mkdirSync(join(storage, 'contracts', 'registry'), { recursive: true })
      writeFileSync(join(storage, 'contracts', 'registry', 'c.pdf'), pdf)
      const archive = join(work, 'storage-2026-01-02.tar.gz')

      await archiveStorage(archive)

      const restored = mkdtempSync(join(tmpdir(), 'restore-test-'))
      execFileSync('tar', ['-xzf', archive, '-C', restored])
      expect(readFileSync(join(restored, 'contracts', 'registry', 'c.pdf')).equals(pdf)).toBe(true)
      rmSync(restored, { recursive: true, force: true })
    } finally {
      config.storageDir = previous
      rmSync(storage, { recursive: true, force: true })
    }
  })

  it('names the encrypted storage copy after the archive', async () => {
    uploads.length = 0
    config.backupOffsite.ageRecipient = recipient
    const archive = join(work, 'storage-2026-01-04.tar.gz')
    writeFileSync(archive, 'x')
    expect(await uploadOffsiteBackup(archive)).toMatch(/^storage-2026-01-04_[\dTZ-]+\.tar\.gz\.age$/)
  })
})
