import { z } from 'zod'

// A person's own email settings (/api/email/me). Keys of `signatures` are identity keys; an
// empty string clears the person's signature, so the mailbox's applies again.
export const MySettingsUpdateSchema = z.object({
  signatures: z.record(z.string().regex(/^[a-z0-9_-]+$/), z.string().max(2000)).optional(),
  outreachDailyCap: z.number().int().min(0).max(1000).nullable().optional(),
})
