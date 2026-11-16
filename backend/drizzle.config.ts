import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// Same files as src/shared/load-env.ts; vars already set win.
for (const envPath of ['../.env', '.env']) if (existsSync(envPath)) process.loadEnvFile(envPath)

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/schema/index.ts',
  out: './src/shared/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://vanadash:vanadash@localhost:5433/vanadash',
  },
})
