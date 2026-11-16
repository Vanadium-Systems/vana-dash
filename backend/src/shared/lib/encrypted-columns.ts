import { and, eq, isNotNull, notLike, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '../db/client.js'
import {
  anafCredentials,
  assetBrokers,
  assetPriceProviders,
  assistantProviders,
  bankAccounts,
  bankTransactions,
  billingClients,
  cryptoExchanges,
  platforms,
} from '../db/schema/index.js'
import { decryptField, encryptField } from './crypto.js'
import { protectIban } from './iban.js'
import { withRlsBypass } from './tenancy.js'

// Every column that holds an encrypted secret, and the conversion of what is left from before v1:
// pre-v1 ciphertexts become v1, plaintext IBANs move to *_enc + *_hmac. Used by
// scripts/encrypt-v1.ts and, as a guard, by scripts/rotate-master-key.ts.

interface SecretTable {
  name: string
  table: PgTable
  id: PgColumn
  tenantId: PgColumn
  columns: Record<string, PgColumn>
}

export const SECRET_TABLES: SecretTable[] = [
  { name: 'platforms', table: platforms, id: platforms.id, tenantId: platforms.tenantId, columns: { apiKeyEnc: platforms.apiKeyEnc } },
  {
    name: 'bank_accounts',
    table: bankAccounts,
    id: bankAccounts.id,
    tenantId: bankAccounts.tenantId,
    columns: {
      apiKeyEnc: bankAccounts.apiKeyEnc,
      privateKeyEnc: bankAccounts.privateKeyEnc,
      accessTokenEnc: bankAccounts.accessTokenEnc,
      refreshTokenEnc: bankAccounts.refreshTokenEnc,
    },
  },
  {
    name: 'anaf_credentials',
    table: anafCredentials,
    id: anafCredentials.id,
    tenantId: anafCredentials.tenantId,
    columns: { accessTokenEnc: anafCredentials.accessTokenEnc, refreshTokenEnc: anafCredentials.refreshTokenEnc },
  },
  {
    name: 'assistant_providers',
    table: assistantProviders,
    id: assistantProviders.id,
    tenantId: assistantProviders.tenantId,
    columns: { apiKeyEnc: assistantProviders.apiKeyEnc },
  },
  {
    name: 'asset_price_providers',
    table: assetPriceProviders,
    id: assetPriceProviders.id,
    tenantId: assetPriceProviders.tenantId,
    columns: { apiKeyEnc: assetPriceProviders.apiKeyEnc },
  },
  { name: 'asset_brokers', table: assetBrokers, id: assetBrokers.id, tenantId: assetBrokers.tenantId, columns: { apiKeyEnc: assetBrokers.apiKeyEnc } },
  {
    name: 'crypto_exchanges',
    table: cryptoExchanges,
    id: cryptoExchanges.id,
    tenantId: cryptoExchanges.tenantId,
    columns: { apiKeyEnc: cryptoExchanges.apiKeyEnc, apiSecretEnc: cryptoExchanges.apiSecretEnc },
  },
  {
    name: 'billing_clients',
    table: billingClients,
    id: billingClients.id,
    tenantId: billingClients.tenantId,
    columns: { ibanEnc: billingClients.ibanEnc },
  },
  {
    name: 'bank_transactions',
    table: bankTransactions,
    id: bankTransactions.id,
    tenantId: bankTransactions.tenantId,
    columns: { counterpartyIbanEnc: bankTransactions.counterpartyIbanEnc },
  },
]

// The IBANs still in clear: [plaintext column, encrypted, hmac].
const PLAIN_IBANS = [
  { name: 'billing_clients.iban', table: billingClients, id: billingClients.id, tenantId: billingClients.tenantId, plain: billingClients.iban, keys: ['iban', 'ibanEnc', 'ibanHmac'] },
  {
    name: 'bank_transactions.counterparty_iban',
    table: bankTransactions,
    id: bankTransactions.id,
    tenantId: bankTransactions.tenantId,
    plain: bankTransactions.counterpartyIban,
    keys: ['counterpartyIban', 'counterpartyIbanEnc', 'counterpartyIbanHmac'],
  },
] as const

// '' is the placeholder some services write when a secret is not set yet; it is not a ciphertext.
const isLegacy = (column: PgColumn) => and(isNotNull(column), sql`${column} <> ''`, notLike(column, 'v1:%'))

/** Values still in a pre-v1 format or in clear, across every company. */
export function countLegacyValues(): Promise<Record<string, number>> {
  // A platform-wide count, run from the scripts, never from a request.
  return withRlsBypass(countLegacyValuesInScope)
}

async function countLegacyValuesInScope(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const t of SECRET_TABLES) {
    for (const [key, column] of Object.entries(t.columns)) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(t.table).where(isLegacy(column))
      if (row!.n > 0) counts[`${t.name}.${key}`] = row!.n
    }
  }
  for (const p of PLAIN_IBANS) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(p.table).where(and(isNotNull(p.plain), sql`${p.plain} <> ''`))
    if (row!.n > 0) counts[p.name] = row!.n
  }
  return counts
}

export interface ConvertOptions {
  dryRun: boolean
  batchSize: number
  pauseMs: number
}

/** Converts one company's rows, in batches. Runs inside runAsTenant(tenantId). The explicit
 *  tenant filter matters with RLS off: each row must be encrypted with its own company's key. */
export async function convertTenant(tenantId: string, opts: ConvertOptions): Promise<Record<string, number>> {
  const done: Record<string, number> = {}
  const pause = () => new Promise((resolve) => setTimeout(resolve, opts.pauseMs))
  /* eslint-disable @typescript-eslint/no-explicit-any -- the column key comes from the table list above */
  for (const t of SECRET_TABLES) {
    for (const [key, column] of Object.entries(t.columns)) {
      const label = `${t.name}.${key}`
      for (;;) {
        const rows = await db
          .select({ id: t.id, value: column })
          .from(t.table)
          .where(and(eq(t.tenantId, tenantId), isLegacy(column)))
          .limit(opts.batchSize)
        if (opts.dryRun) {
          if (rows.length) done[label] = rows.length
          break
        }
        if (!rows.length) break
        for (const row of rows) {
          const v1 = await encryptField(await decryptField(row.value as string))
          await db.update(t.table).set({ [key]: v1 } as any).where(eq(t.id, row.id))
        }
        done[label] = (done[label] ?? 0) + rows.length
        await pause()
      }
    }
  }
  for (const p of PLAIN_IBANS) {
    const [plainKey, encKey, hmacKey] = p.keys
    for (;;) {
      const rows = await db
        .select({ id: p.id, iban: p.plain })
        .from(p.table)
        .where(and(eq(p.tenantId, tenantId), isNotNull(p.plain), sql`${p.plain} <> ''`))
        .limit(opts.batchSize)
      if (opts.dryRun) {
        if (rows.length) done[p.name] = rows.length
        break
      }
      if (!rows.length) break
      for (const row of rows) {
        const { enc, hmac } = await protectIban(row.iban as string)
        await db.update(p.table).set({ [plainKey]: null, [encKey]: enc, [hmacKey]: hmac } as any).where(eq(p.id, row.id))
      }
      done[p.name] = (done[p.name] ?? 0) + rows.length
      await pause()
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return done
}
