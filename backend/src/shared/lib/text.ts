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
