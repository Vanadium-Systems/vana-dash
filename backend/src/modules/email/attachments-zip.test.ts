import { describe, expect, it } from 'vitest'
import { dedupeFileNames, zipFileName } from './attachments-zip.js'

describe('dedupeFileNames', () => {
  it('adds a counter before the extension', () => {
    expect(dedupeFileNames(['a.pdf', 'a.pdf', 'a.pdf', 'b.txt'])).toEqual(['a.pdf', 'a (2).pdf', 'a (3).pdf', 'b.txt'])
  })

  it('handles names without extension and dotfiles', () => {
    expect(dedupeFileNames(['README', 'README', '.env', '.env'])).toEqual(['README', 'README (2)', '.env', '.env (2)'])
  })

  it('strips path separators', () => {
    expect(dedupeFileNames(['../etc/passwd', 'a\\b.txt'])).toEqual(['.._etc_passwd', 'a_b.txt'])
  })
})

describe('zipFileName', () => {
  it('replaces invalid characters and trims to 60 chars', () => {
    expect(zipFileName('Re: a/b?')).toBe('Re_ a_b_.zip')
    expect(zipFileName('x'.repeat(100))).toBe(`${'x'.repeat(60)}.zip`)
  })

  it('falls back when the subject is empty', () => {
    expect(zipFileName('  ')).toBe('attachments.zip')
  })
})
