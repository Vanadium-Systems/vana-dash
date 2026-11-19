import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSecret } from './config.js'

const NAME = 'TEST_CONFIG_SECRET'

afterEach(() => {
  delete process.env[NAME]
  delete process.env[`${NAME}_FILE`]
})

describe('readSecret', () => {
  it('reads the env var when no _FILE is set', () => {
    process.env[NAME] = 'from-env'
    expect(readSecret(NAME)).toBe('from-env')
  })

  it('prefers <NAME>_FILE and trims the trailing newline', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secret-')), 'value')
    fs.writeFileSync(file, 'from-file\n')
    process.env[NAME] = 'from-env'
    process.env[`${NAME}_FILE`] = file
    expect(readSecret(NAME)).toBe('from-file')
  })

  it('fails loudly when <NAME>_FILE points nowhere', () => {
    process.env[`${NAME}_FILE`] = '/nonexistent/secret'
    expect(() => readSecret(NAME)).toThrow(/ENOENT/)
  })

  it('returns an empty string when neither is set', () => {
    expect(readSecret(NAME)).toBe('')
  })
})
