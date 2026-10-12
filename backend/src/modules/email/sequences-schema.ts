import { z } from 'zod'
import { EmailFromSchema } from './schema.js'

// ── Secvențe ─────────────────────────────────────────────────────────────────

export const SequenceStepInputSchema = z.object({
  templateId: z.string().uuid(),
  delayDays: z.number().int().min(0),
})

export const SequenceCreateSchema = z.object({
  name: z.string().trim().min(1),
  fromIdentity: EmailFromSchema,
  steps: z.array(SequenceStepInputSchema).min(1),
})

export const SequenceUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  fromIdentity: EmailFromSchema.optional(),
  active: z.boolean().optional(),
  // Înlocuire completă a pașilor, dacă e trimis — nu un merge parțial.
  steps: z.array(SequenceStepInputSchema).min(1).optional(),
})

export const SequenceIdParamsSchema = z.object({ id: z.string().uuid() })

// ── Enrollments ──────────────────────────────────────────────────────────────

export const EnrollRecipientSchema = z.object({
  email: z.string().email(),
  nume: z.string().optional(),
  prospectId: z.string().uuid().optional(),
})

// Enrolling only writes rows (nothing is sent in the request, unlike bulkSend, which sends one
// by one with a delay), so the bulkSend limit of 50 has no reason to apply here: selecting a
// whole CSV import in Prospects goes past it at once.
export const EnrollSchema = z.object({
  recipients: z.array(EnrollRecipientSchema).min(1).max(2000),
})

export const SequenceEnrollmentIdParamsSchema = z.object({ id: z.string().uuid(), enrollmentId: z.string().uuid() })

// The transitions a person may make from the UI; completed/failed belong to
// jobs/email-sequence-runner.ts. 'active' brings back an enrollment the reply heuristic stopped
// by mistake (one reply from a public webmail domain once stopped every recipient on that
// domain). 'replied' is the opposite: a real reply the automatic hook in inbound-service.ts
// did not catch.
export const EnrollmentUpdateSchema = z.object({
  status: z.union([z.literal('unsubscribed'), z.literal('active'), z.literal('replied')]),
})
