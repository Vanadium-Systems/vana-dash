import { describe, expect, it } from 'vitest'
import { fileCategory, fileTypeLabel, splitExtension } from './file-type'

describe('fileCategory', () => {
  it('maps the same mime types as the backend type filter', () => {
    expect(fileCategory('application/pdf')).toBe('pdf')
    expect(fileCategory('image/heic')).toBe('image')
    expect(fileCategory('text/plain')).toBe('document')
    expect(fileCategory('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document')
    expect(fileCategory('text/csv')).toBe('spreadsheet')
    expect(fileCategory('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('spreadsheet')
    expect(fileCategory('application/x-zip-compressed')).toBe('archive')
  })

  it('knows video and audio, which the backend files under other', () => {
    expect(fileCategory('video/mp4')).toBe('video')
    expect(fileCategory('audio/mpeg')).toBe('audio')
  })

  it('falls back to other for the unknown and the empty', () => {
    expect(fileCategory('application/octet-stream')).toBe('other')
    expect(fileCategory('')).toBe('other')
  })
})

describe('fileTypeLabel', () => {
  it('says the type in words', () => {
    expect(fileTypeLabel('pdf')).toBe('PDF')
    expect(fileTypeLabel('image')).toBe('Imagine')
  })
})

describe('splitExtension', () => {
  it('keeps the extension apart so a long name is cut before it', () => {
    expect(splitExtension('Facturi 2025.pdf')).toEqual({ base: 'Facturi 2025', extension: '.pdf' })
  })

  it('leaves dotfiles and names without an extension whole', () => {
    expect(splitExtension('.env')).toEqual({ base: '.env', extension: '' })
    expect(splitExtension('Contract')).toEqual({ base: 'Contract', extension: '' })
  })

  it('does not take a sentence with a dot for an extension', () => {
    expect(splitExtension('Nota din 3. ianuarie anul acesta')).toEqual({ base: 'Nota din 3. ianuarie anul acesta', extension: '' })
  })
})
