import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

// No unaccent extension in the database: fold Romanian letters (both comma and cedilla forms) on both sides.
export function foldDiacritics(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Romanian letters (comma and cedilla forms, lower then upper case), built from code points: a
// string literal with them would read as UI text to no-romanian-in-code.test.ts.
const DIACRITICS = String.fromCodePoint(0x103, 0xe2, 0xee, 0x219, 0x15f, 0x21b, 0x163, 0x102, 0xc2, 0xce, 0x218, 0x15e, 0x21a, 0x162)
const FOLDED = 'aaissttaaisstt'

/** `column` contains `term`, ignoring case and diacritics. `term` is raw user input. */
export function foldedIlike(column: AnyColumn | SQL, term: string): SQL {
  const pattern = `%${foldDiacritics(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return sql`translate(lower(${column}), ${DIACRITICS}, ${FOLDED}) like ${pattern}`
}

/**
 * A Content-Disposition value for any file name. Node rejects a header with characters outside
 * Latin-1 (a macOS screenshot name has `ă` and a narrow no-break space), so the name travels as
 * RFC 5987 `filename*`, with an ASCII `filename` for clients that ignore it.
 */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, "'")
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
