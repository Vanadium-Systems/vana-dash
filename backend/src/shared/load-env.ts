import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// .env lives at the monorepo root (../../../ from backend/src/shared).
// process.loadEnvFile does not overwrite already-set env vars.
const here = path.dirname(fileURLToPath(import.meta.url))

export function loadEnvIfExists(envPath: string): void {
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

loadEnvIfExists(path.resolve(here, '../../../.env'))
loadEnvIfExists(path.resolve(process.cwd(), '.env'))
