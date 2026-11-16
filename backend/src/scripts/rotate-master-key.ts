import { sql } from '../shared/db/client.js'
import { rewrapTenantKeys } from '../shared/lib/crypto.js'
import { countLegacyValues } from '../shared/lib/encrypted-columns.js'

// Master key rotation, with MASTER_ENCRYPTION_KEY_NEXT set next to the current key:
//   1. node dist/scripts/rotate-master-key.js  → re-wraps every company's data key with NEXT
//   2. in .env: MASTER_ENCRYPTION_KEY=<NEXT>, remove NEXT, restart the backend
// The data is not touched. Refuses while pre-v1 values exist: those are encrypted with the
// master key itself and would be lost at step 2 (run scripts/encrypt-v1.ts first).

async function main() {
  const legacy = await countLegacyValues()
  if (Object.keys(legacy).length > 0) {
    throw new Error(`pre-v1 values left, run encrypt-v1 first: ${JSON.stringify(legacy)}`)
  }
  console.log(`[rotate-master-key] re-wrapped ${await rewrapTenantKeys()} data key(s)`)
}

main()
  .catch((err) => {
    console.error('[rotate-master-key] failed:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
