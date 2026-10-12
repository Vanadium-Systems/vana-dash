import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { dashboardConfig } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { ReservedNumbersSchema, type ReservedNumber } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

export const RESERVED_NUMBERS_CONFIG_KEY = 'contract.reservedNumbers'

// Valabil doar cât timp cheia lipsește din dashboard_config: după prima salvare (inclusiv o
// listă golită de om) contează rândul din DB, deci 003 șters nu reapare.
const seedReservedNumbers = (): ReservedNumber[] => [
  { number: '003', note: tr('errors.contracts.reservedSeedNote'), date: '2026-09-28' },
]

export class ReservedNumberDuplicateError extends Error {}

export async function listReservedNumbers(): Promise<ReservedNumber[]> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, RESERVED_NUMBERS_CONFIG_KEY))
  return row ? ReservedNumbersSchema.parse(row.value) : seedReservedNumbers()
}

export async function replaceReservedNumbers(next: ReservedNumber[]): Promise<ReservedNumber[]> {
  // Unicitatea se verifică aici, după normalizarea din schemă: „3" și „003" sunt același număr.
  if (new Set(next.map((r) => r.number)).size !== next.length) throw new ReservedNumberDuplicateError()

  const current = await listReservedNumbers()
  const sorted = [...next].sort((a, b) => a.number.localeCompare(b.number))
  await db
    .insert(dashboardConfig)
    .values({ key: RESERVED_NUMBERS_CONFIG_KEY, value: sorted })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
  await recordAudit({
    action: 'contract.numere-rezervate.modificate',
    entityType: 'contract_reserved_numbers',
    changes: { numere: [current.map((r) => r.number), sorted.map((r) => r.number)] },
  })
  return sorted
}
