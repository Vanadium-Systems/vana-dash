import { z } from 'zod'

export const OutreachMailboxIdParamsSchema = z.object({
  id: z.string().uuid(),
})

export const OutreachMailboxCreateSchema = z.object({
  address: z.string().trim().email().max(254),
  displayName: z.string().trim().max(120).default(''),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  imapHost: z.string().trim().max(255).nullable().optional(),
  imapPort: z.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: z.boolean().default(true),
  authKind: z.enum(['password', 'oauth2']).default('password'),
  secret: z.string().max(2000).default(''),
  dailyCap: z.number().int().min(1).max(2000).default(30),
  warmupUntil: z.string().datetime().nullable().optional(),
})

export const OutreachMailboxUpdateSchema = z.object({
  address: z.string().trim().email().max(254).optional(),
  displayName: z.string().trim().max(120).optional(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapHost: z.string().trim().max(255).nullable().optional(),
  imapPort: z.number().int().min(1).max(65535).nullable().optional(),
  imapSecure: z.boolean().optional(),
  secret: z.string().max(2000).optional(),
  dailyCap: z.number().int().min(1).max(2000).optional(),
  warmupUntil: z.string().datetime().nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
})
