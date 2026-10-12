import '../load-env.js'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Missing DATABASE_URL')

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

const client = postgres(databaseUrl, { max: 1 })
await migrate(drizzle(client), { migrationsFolder })
await client.end()
console.log('Migrations applied.')
