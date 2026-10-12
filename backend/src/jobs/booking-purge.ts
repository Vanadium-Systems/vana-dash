import cron from 'node-cron'
import { purgeExpiredBookings } from '../modules/booking/service.js'

// Contract E (docs/BOOKING.md, Legal): datele vizitatorilor dispar la 90 de zile după apel.
const CRON_EXPR = '30 4 * * *'

export function startBookingPurgeJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runBookingPurge()
  })
  console.log(`[booking-purge] Scheduled (${CRON_EXPR})`)
}

export async function runBookingPurge(): Promise<void> {
  try {
    const purged = await purgeExpiredBookings()
    if (purged > 0) console.log(`[booking-purge] anonimizate ${purged} programări`)
  } catch (err) {
    console.error('[booking-purge] eșuat:', err)
  }
}
