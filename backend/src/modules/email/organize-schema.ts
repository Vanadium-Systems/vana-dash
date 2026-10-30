import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'
import { updateSchema } from '../../shared/lib/update-schema.js'

// ── Etichete/reguli/blocklist — organizare mailbox (PLAN.md, Email Gmail-parity) ─────────────
// Fișier propriu (nu routes.ts/schema.ts) — concern distinct de send/bulk/templates, la fel cum
// inbound-* e separat de restul modulului (evită suprapunere de diff-uri la merge).

export const IdParamsSchema = z.object({ id: z.string().uuid() })

// ── Labels ───────────────────────────────────────────────────────────────────

export const LabelCreateSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  // 2026-08-20 — implicit true (comportament nou = identic celui vechi, fără câmp). false =
  // mesajele primite cu acest label nu mai declanșează notifyPush('email', ...).
  notificationsEnabled: z.boolean().default(true),
})
export const LabelUpdateSchema = updateSchema(LabelCreateSchema)

// ── Rules ────────────────────────────────────────────────────────────────────

export const RuleMatchTypeSchema = z.enum(['from_address', 'from_domain', 'subject_contains'])
export const RuleActionSchema = z.enum(['label', 'archive', 'trash', 'spam'])

const ruleActionRequiresLabel = (v: { action: string; labelId?: string }) =>
  v.action !== 'label' || Boolean(v.labelId)

export const RuleCreateSchema = z
  .object({
    matchType: RuleMatchTypeSchema,
    matchValue: z.string().min(1),
    action: RuleActionSchema,
    labelId: z.string().uuid().optional(),
  })
  .refine(ruleActionRequiresLabel, { message: lazyTr('errors.email.labelIdRequired'), path: ['labelId'] })

export const RuleUpdateSchema = z.object({
  matchType: RuleMatchTypeSchema.optional(),
  matchValue: z.string().min(1).optional(),
  action: RuleActionSchema.optional(),
  labelId: z.string().uuid().optional(),
})

// ── Blocklist ────────────────────────────────────────────────────────────────

export const BlocklistCreateSchema = z.object({ address: z.string().email() })
