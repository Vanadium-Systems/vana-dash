// The API without the cron jobs (src/index.ts starts ~40 of them). In CI a job would call BNR, ANAF or
// SICAP from the runner; the employee test only needs the routes.
import { buildServer } from '../backend/src/app.js'
import { config } from '../backend/src/shared/config.js'
import { assertRlsRoleIsSafe } from '../backend/src/shared/db/client.js'

await assertRlsRoleIsSafe()
const app = await buildServer()
await app.listen({ port: config.port, host: '127.0.0.1' })
