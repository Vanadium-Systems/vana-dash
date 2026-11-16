import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnvIfExists } from './load-env.js'

describe('loadEnvIfExists', () => {
  const keysToClean: string[] = []

  afterEach(() => {
    for (const k of keysToClean) {
      delete process.env[k]
    }
    keysToClean.length = 0
  })

  it('ignores missing .env files without throwing', () => {
    expect(() => loadEnvIfExists(path.join(os.tmpdir(), 'does-not-exist-vana-dash.env'))).not.toThrow()
  })

  it('loads variables from an existing .env file without overwriting set env vars', () => {
    const tmpFile = path.join(os.tmpdir(), `vana-dash-env-test-${Date.now()}.env`)
    fs.writeFileSync(tmpFile, 'VANA_TEST_A=from_file\nVANA_TEST_B=from_file_b\n', 'utf8')
    try {
      process.env.VANA_TEST_A = 'already_set'
      keysToClean.push('VANA_TEST_A', 'VANA_TEST_B')
      loadEnvIfExists(tmpFile)
      expect(process.env.VANA_TEST_A).toBe('already_set')
      expect(process.env.VANA_TEST_B).toBe('from_file_b')
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})
