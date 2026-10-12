/**
 * modules/archive/schema.ts — regresie pt. gotcha-ul cunoscut `z.coerce.boolean()`
 * (transformă orice string non-gol, INCLUSIV "false", în `true` — vezi nota identică din
 * reconciliation/schema.ts). Aici e periculos: ar declanșa ștergere PERMANENTĂ pt. cine
 * trimite explicit `?permanent=false` crezând că e varianta sigură.
 */
import { describe, expect, it } from 'vitest'
import { DeleteFileQuerySchema } from './schema.js'

describe('DeleteFileQuerySchema', () => {
  it('permanent=false (string, din query) se parsează la boolean false', () => {
    expect(DeleteFileQuerySchema.parse({ permanent: 'false' })).toEqual({ permanent: false })
  })

  it('permanent=true (string, din query) se parsează la boolean true', () => {
    expect(DeleteFileQuerySchema.parse({ permanent: 'true' })).toEqual({ permanent: true })
  })

  it('lipsa parametrului implică false (soft delete, niciodată permanent implicit)', () => {
    expect(DeleteFileQuerySchema.parse({})).toEqual({ permanent: false })
  })
})
