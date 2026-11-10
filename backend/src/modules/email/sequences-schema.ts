import { z } from 'zod'
import { SEQUENCE_STEP_KINDS } from '../../shared/db/schema/email-sequences.js'
import { EmailFromSchema } from './schema.js'

// ── Secvențe ─────────────────────────────────────────────────────────────────

// An email step needs a template; any other step becomes a prospect task and needs a title
// (it may use {{firma}} and {{nume}}). A missing kind means email.
export const SequenceStepInputSchema = z
  .object({
    kind: z.enum(SEQUENCE_STEP_KINDS).optional(),
    delayDays: z.number().int().min(0),
    templateId: z.string().uuid().optional(),
    variantBTemplateId: z.string().uuid().optional(),
    taskTitle: z.string().trim().min(1).optional(),
    taskDescription: z.string().trim().min(1).optional(),
  })
  .superRefine((step, ctx) => {
    if ((step.kind ?? 'email') === 'email') {
      if (!step.templateId) ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'templateId required on an email step' })
    } else if (!step.taskTitle) {
      ctx.addIssue({ code: 'custom', path: ['taskTitle'], message: 'taskTitle required on a non-email step' })
    }
  })

export const SequenceCreateSchema = z.object({
  name: z.string().trim().min(1),
  fromIdentity: EmailFromSchema,
  stopOnMeeting: z.boolean().optional(),
  stopOnWonLost: z.boolean().optional(),
  steps: z.array(SequenceStepInputSchema).min(1),
})

export const SequenceUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  fromIdentity: EmailFromSchema.optional(),
  active: z.boolean().optional(),
  stopOnMeeting: z.boolean().optional(),
  stopOnWonLost: z.boolean().optional(),
  // Only resuming is a person's call; pausing belongs to the bounce-rate guard.
  paused: z.literal(false).optional(),
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
export const EnrollSchema = z
  .object({
    recipients: z.array(EnrollRecipientSchema).min(1).max(2000).optional(),
    // The members of a list and/or prospects picked by id; both only count if the person enrolling can see them.
    listId: z.string().uuid().optional(),
    prospectIds: z.array(z.string().uuid()).min(1).max(2000).optional(),
  })
  .refine((body) => body.recipients || body.listId || body.prospectIds, { message: 'recipients, listId or prospectIds required' })

export const SequenceEnrollmentIdParamsSchema = z.object({ id: z.string().uuid(), enrollmentId: z.string().uuid() })

// The transitions a person may make from the UI; completed/failed belong to
// jobs/email-sequence-runner.ts. 'active' brings back an enrollment the reply heuristic stopped
// by mistake (one reply from a public webmail domain once stopped every recipient on that
// domain). 'replied' is the opposite: a real reply the automatic hook in inbound-service.ts
// did not catch.
export const EnrollmentUpdateSchema = z.object({
  status: z.union([z.literal('unsubscribed'), z.literal('active'), z.literal('replied')]),
})
