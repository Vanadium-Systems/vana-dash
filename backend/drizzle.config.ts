import dotenv from 'dotenv'
import { defineConfig } from 'drizzle-kit'

dotenv.config({ path: '../.env' })
dotenv.config()

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/schema/index.ts',
  out: './src/shared/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://vanadash:vanadash@localhost:5433/vanadash',
  },
})
