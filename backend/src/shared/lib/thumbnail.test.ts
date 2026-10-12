/**
 * shared/lib/thumbnail.ts — pdftoppm real (poppler-utils, instalat în imaginea Docker/dev
 * compose), nu mockuit. Fixture: PDF minimal, valid, construit manual (fără xref corect —
 * poppler îl recuperează, comportament real întâlnit des la PDF-uri malformate din practică).
 */
import { describe, expect, it } from 'vitest'
import { generatePdfThumbnail } from './thumbnail.js'

const MINIMAL_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    'trailer << /Size 4 /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'),
)

describe('generatePdfThumbnail', () => {
  it('randează prima pagină a unui PDF valid ca JPEG', async () => {
    const result = await generatePdfThumbnail(MINIMAL_PDF)
    expect(result).not.toBeNull()
    // magic bytes JPEG (0xFFD8) — nu verificăm conținutul vizual, doar că e o imagine reală.
    expect(result?.subarray(0, 2).toString('hex')).toBe('ffd8')
  })

  it('întoarce null pt. un buffer care nu e un PDF valid, fără să arunce', async () => {
    const result = await generatePdfThumbnail(Buffer.from('nu sunt un PDF'))
    expect(result).toBeNull()
  })
})
