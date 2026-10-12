import { z } from 'zod'

export const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  deviceLabel: z.string().trim().max(100).optional(),
})

export const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

export const UpdatePreferencesSchema = z.object({
  alerts: z.boolean().optional(),
  email: z.boolean().optional(),
  invoiceStatus: z.boolean().optional(),
  calendarReminder: z.boolean().optional(),
  paymentMatch: z.boolean().optional(),
})

// Token FCM al APK-ului (Contract C) — lungime generoasă, Firebase token-urile au ~150-160 chars.
export const DeviceTokenSchema = z.object({
  token: z.string().min(32).max(512),
})
