import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { pushSubscriptions } from '../../shared/db/schema/index.js'
import {
  deleteDeviceToken,
  getPushPreferences,
  registerDeviceToken,
  sendTestPush,
  setPushPreferences,
} from '../../shared/lib/push.js'
import type { SubscribeSchema, UpdatePreferencesSchema } from './schema.js'
import type { z } from 'zod'

type SubscribeInput = z.infer<typeof SubscribeSchema>
type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>

export async function subscribe(me: SessionUser, input: SubscribeInput) {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      // Push-ul ajunge pe device-urile omului, nu pe toate (C2) — de aceea abonarea ține
      // owner-ul, iar `notifyPush` filtrează pe el.
      ownerUserId: me.id,
      endpoint: input.endpoint,
      p256dhKey: input.keys.p256dh,
      authKey: input.keys.auth,
      deviceLabel: input.deviceLabel,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dhKey: sql`excluded.p256dh_key`,
        authKey: sql`excluded.auth_key`,
        deviceLabel: sql`excluded.device_label`,
        deletedAt: null, // re-subscribe după revocare/reinstall — reactivează rândul existent
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

export async function unsubscribe(me: SessionUser, endpoint: string) {
  const [row] = await db
    .update(pushSubscriptions)
    .set({ deletedAt: new Date() })
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.ownerUserId, me.id)))
    .returning()
  return row
}

export const getPreferences = getPushPreferences
export const updatePreferences = (patch: UpdatePreferencesInput) => setPushPreferences(patch)
export const sendTest = sendTestPush

// Canalul nativ APK (FCM) — Contract C. Upsert pe token: reinstalare/relogin re-activează
// rândul existent și reîmprospătează lastSeenAt.
export async function registerDevice(me: SessionUser, input: { token: string }) {
  await registerDeviceToken(input.token, me.id)
  return { registered: true }
}

export async function unregisterDevice(me: SessionUser, input: { token: string }) {
  await deleteDeviceToken(input.token, me.id)
  return { deleted: true }
}
