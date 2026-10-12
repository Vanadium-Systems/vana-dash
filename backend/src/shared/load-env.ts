import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// .env trăiește la root-ul monorepo-ului (../../../ față de backend/src/shared).
// dotenv nu suprascrie variabilele deja setate, deci env-ul real are prioritate.
const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env') })
dotenv.config()
