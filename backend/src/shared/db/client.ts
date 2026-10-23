import { sql as sqlTag } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../config.js'
import { currentTenantId, isRlsBypassed } from '../lib/tenancy.js'
import * as schema from './schema/index.js'

// With RLS_ENABLED every top-level query runs in a short transaction that first sets
// app.tenant_id / app.bypass_rls, which the policies of migration 0073 read. The call sites stay
// as they are: `db` records the builder chain and replays it inside that transaction when awaited.
// Without RLS_ENABLED, `db` is the plain client.

if (config.rlsEnabled && !config.databaseUrlApp) {
  // As superuser or table owner the policies are not applied at all: refuse instead of
  // pretending to isolate.
  throw new Error('[db] RLS_ENABLED=true needs DATABASE_URL_APP (a role with NOSUPERUSER NOBYPASSRLS)')
}

/** Raw client: migrations, scripts and lifecycle only, never business queries. */
export const sql = postgres(config.rlsEnabled ? config.databaseUrlApp : config.databaseUrl)
const plainDb = drizzle(sql, { schema })
export type Db = typeof plainDb

/** For a subquery passed into another `db` query (`inArray(col, dbSubquery.select()...)`): the
 *  recording proxy would answer every duck-typing check and recurse. Never await it on its own. */
export const dbSubquery = plainDb

async function applyTenantContext(tx: Db): Promise<void> {
  await tx.execute(sqlTag`select set_config('app.tenant_id', ${currentTenantId()}, true)`)
  await tx.execute(sqlTag`select set_config('app.bypass_rls', ${isRlsBypassed() ? 'on' : 'off'}, true)`)
}

type ChainStep = { kind: 'get'; prop: PropertyKey } | { kind: 'apply'; args: unknown[] }

/* eslint-disable @typescript-eslint/no-explicit-any -- replays any Drizzle builder chain */
function replaySteps(root: unknown, steps: ChainStep[]): unknown {
  let current: any = root
  let thisArg: any
  for (const step of steps) {
    if (step.kind === 'get') {
      thisArg = current
      current = current[step.prop]
    } else {
      current = current.apply(thisArg, step.args)
      thisArg = undefined
    }
  }
  return current
}

function runRecordedChain(steps: ChainStep[]): Promise<unknown> {
  return plainDb.transaction(async (tx) => {
    await applyTenantContext(tx as unknown as Db)
    return replaySteps(tx, steps)
  })
}

// `callable` is decided per node: a Proxy's typeof follows its target, and test helpers call
// anything that looks like a function.
function buildRecorder(steps: ChainStep[], callable: boolean): any {
  let cached: Promise<unknown> | undefined
  const run = () => (cached ??= runRecordedChain(steps))
  const target = callable ? function tenantScopedQuery() {} : {}
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return (...args: unknown[]) => (run() as any).then(...args)
      if (prop === 'catch') return (...args: unknown[]) => (run() as any).catch(...args)
      if (prop === 'finally') return (...args: unknown[]) => (run() as any).finally(...args)
      return buildRecorder([...steps, { kind: 'get', prop }], true)
    },
    apply(_t, _this, args) {
      return buildRecorder([...steps, { kind: 'apply', args }], false)
    },
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// `execute` is left out: applyTenantContext uses it, and a raw statement scopes itself.
const SCOPED_ENTRY_POINTS = new Set<PropertyKey>(['select', 'selectDistinct', 'insert', 'update', 'delete', 'query'])

export const db: Db = config.rlsEnabled
  ? (new Proxy(plainDb, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return (cb: (tx: Db) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              await applyTenantContext(tx as unknown as Db)
              return cb(tx as unknown as Db)
            })
        }
        if (SCOPED_ENTRY_POINTS.has(prop)) return buildRecorder([{ kind: 'get', prop }], true)
        return Reflect.get(target, prop, receiver)
      },
    }) as Db)
  : plainDb

/** Refuses to start with RLS on while connected as a role that RLS does not apply to. */
export async function assertRlsRoleIsSafe(): Promise<void> {
  if (!config.rlsEnabled) return
  const [role] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolsuper, rolbypassrls from pg_roles where rolname = current_user`
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error('[db] RLS_ENABLED=true but the database role is superuser or BYPASSRLS: isolation would be off')
  }
}
