import { z } from 'zod'
import { WIDGETS } from './widgets.js'

const HomeLayoutItemSchema = z
  .object({
    widget: z.string().refine((id) => id in WIDGETS, 'unknown widget'),
    size: z.enum(['s', 'w', 'l', 'band']),
    order: z.number().int().min(0),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((item, ctx) => {
    if (!WIDGETS[item.widget]?.sizes.includes(item.size)) {
      ctx.addIssue({ code: 'custom', path: ['size'], message: 'size not allowed for this widget' })
    }
  })

export const HomeLayoutBodySchema = z.object({
  layout: z
    .array(HomeLayoutItemSchema)
    .max(24)
    .refine((items) => new Set(items.map((item) => item.widget)).size === items.length, 'duplicate widget'),
})
