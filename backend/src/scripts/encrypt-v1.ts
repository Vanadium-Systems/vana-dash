import { sql } from '../shared/db/client.js'
import { convertTenant, countLegacyValues } from '../shared/lib/encrypted-columns.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'

// Converts what is left from before v1, company by company: pre-v1 ciphertexts to v1, plaintext
// IBANs to *_enc + *_hmac. Idempotent; small batches with a pause, for the 1 vCPU box.
//   node dist/scripts/encrypt-v1.js --dry-run     (counts only)
//   node dist/scripts/encrypt-v1.js [--batch 100] [--pause-ms 250]

function numberArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

async function main() {
  const opts = {
    dryRun: process.argv.includes('--dry-run'),
    batchSize: numberArg('--batch', 100),
    pauseMs: numberArg('--pause-ms', 250),
  }
  console.log(`[encrypt-v1] before: ${JSON.stringify(await countLegacyValues())}${opts.dryRun ? ' (dry run)' : ''}`)
  await forEachTenant(async (tenantId) => {
    const done = await convertTenant(tenantId, opts)
    console.log(`[encrypt-v1] ${tenantId}: ${JSON.stringify(done)}`)
  })
  if (!opts.dryRun) console.log(`[encrypt-v1] left: ${JSON.stringify(await countLegacyValues())}`)
}

main()
  .catch((err) => {
    console.error('[encrypt-v1] failed:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
