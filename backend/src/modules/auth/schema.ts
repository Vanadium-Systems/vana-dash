import { z } from 'zod'
import { DISPLAY_CURRENCIES, LOCALES } from '../../shared/lib/locale.js'

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const PatchMeSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  // Momentul până la care omul a văzut Noutățile; serverul nu-l lasă să fie în viitor.
  updatesSeenAt: z.string().datetime().optional(),
  notificationPrefs: z
    .object({
      chat: z.enum(['all', 'dm', 'none']),
      emailNew: z.boolean(),
      alerts: z.boolean(),
    })
    .optional(),
  locale: z.enum(LOCALES).optional(),
  displayCurrency: z.enum(DISPLAY_CURRENCIES).optional(),
})

export const ForgotPasswordSchema = z.object({ email: z.string().email() })

export const ResetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(1),
})

export const AcceptInviteSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(1),
})

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})
