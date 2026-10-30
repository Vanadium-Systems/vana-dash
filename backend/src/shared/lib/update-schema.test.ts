import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DraftUpdateSchema } from '../../modules/email/drafts-schema.js'
import { updateSchema } from './update-schema.js'

describe('updateSchema', () => {
  const Create = z.object({ name: z.string().min(1), currency: z.string().default('EUR'), active: z.boolean().default(true) }).strict()

  it('leaves out what the request left out, instead of filling in the defaults', () => {
    expect(updateSchema(Create).parse({ name: 'Acme' })).toEqual({ name: 'Acme' })
    expect(updateSchema(Create).parse({})).toEqual({})
  })

  it('still validates the fields that are sent and keeps the object strict', () => {
    expect(updateSchema(Create).safeParse({ name: '' }).success).toBe(false)
    expect(updateSchema(Create).safeParse({ other: 1 }).success).toBe(false)
  })

  it('a draft edited only in its recipient keeps its subject and body', () => {
    expect(DraftUpdateSchema.parse({ to: 'someone@example.com' })).toEqual({ to: 'someone@example.com' })
  })
})
