import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config.js'
import * as schema from './schema/index.js'

export const sql = postgres(config.databaseUrl)
export const db = drizzle(sql, { schema })
export type Db = typeof db
