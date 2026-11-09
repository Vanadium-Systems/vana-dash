import { describe, expect, it } from 'vitest'
import { BulkMoveSchema } from './schema.js'

describe('BulkMoveSchema', () => {
  it('refuză mai mult de 500 de elemente', () => {
    const items = Array.from({ length: 501 }, () => ({ type: 'file' as const, id: crypto.randomUUID() }))
    expect(BulkMoveSchema.safeParse({ items, targetFolderId: crypto.randomUUID() }).success).toBe(false)
  })
})
