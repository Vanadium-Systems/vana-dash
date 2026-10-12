# Adding a connector

Everything specific to an external system lives in `backend/src/connectors/<name>/`. The rest of
the app sees only an interface, so it cannot tell one platform, tax authority or bank from
another.

There are three kinds of connector, each with its own registry in `connectors/index.ts`:

| Kind | Interface | Registry | Today |
|---|---|---|---|
| Platform (numeric KPIs) | `PlatformConnector` | `connectors` | `vanagreen`, `generic` |
| Accounting (documents) | `AccountingConnector` | `accountingConnectors` | `anaf` |
| Bank (transactions) | `BankConnector` | `bankConnectors` | `revolut` |

## A platform connector

### 1. Create the folder

```
backend/src/connectors/<platform>/
├── index.ts      # implements PlatformConnector
├── transform.ts  # API response → PlatformMetric[]
└── types.ts      # types of the platform's API response
```

### 2. Implement the interface

```typescript
// backend/src/connectors/<platform>/index.ts
import type { PlatformConnector } from '../types.js'

export const myPlatformConnector: PlatformConnector = {
  type: 'my-platform',          // registry key and platforms.type
  displayName: 'My Platform',

  async fetchMetrics(config, from, to) {
    const res = await fetch(`${config.apiUrl}/api/metrics`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),   // required on every fetch
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return transformMetrics(await res.json())
  },

  async checkHealth(config) { /* GET /health with a timeout */ },
}
```

Rules:

- Every fetch has a timeout (`AbortSignal.timeout`). A connector that hangs blocks the sync
  runner.
- Throw freely. `runConnectorSync` catches the error, writes it to `sync_log` and isolates the
  failure, so one broken platform does not stop the others. No internal retry or catch.
- Never log `config.apiKey`.

### 2b. `fetchOpsSignals` (optional)

Platforms that already expose operational health (CPU, memory, disk, errors, backups) can
implement this optional method. It is fetched live each time the health panel is opened
(`GET /api/platforms/:id/ops-signals`), with no storage and no cron. Platforms without it show
"no operational metrics yet". The reference implementation is `connectors/vanagreen/index.ts`.

```typescript
async fetchOpsSignals(config: PlatformConfig): Promise<PlatformOpsSignals> {
  const res = await fetch(`${config.apiUrl}/api/v1/platform/health-signals`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return transformOpsSignals(await res.json())
}
```

### 3. Map onto the standard metric keys

In `transform.ts`, map onto the keys in [METRIC_KEYS.md](METRIC_KEYS.md) (`revenue`, `mrr`,
`active_clients`, ...). Platform-specific values take a prefix: `<platform>.<metric>`.

If the platform answers with a current snapshot, truncate `recordedAt` to the start of the day,
so repeated syncs on the same day upsert the same point.

### 4. Register it

```typescript
// backend/src/connectors/index.ts
export const connectors: Record<string, PlatformConnector> = {
  vanagreen: vanagreenConnector,
  'my-platform': myPlatformConnector,
}
```

The frontend picks up the new type from `GET /api/platforms/types`. No UI change is needed.

### 5. Test it

Add a `transform.test.ts` modelled on `connectors/vanagreen/transform.test.ts`: key mapping and
the truncation of `recordedAt`.

### What not to do

- `if (platform.type === '...')` outside the connector's folder.
- A plain `INSERT` into `platform_metrics`. Use `upsertMetrics` from `shared/lib/sync.ts`.
- Endpoints on the platform side that return personal data. Numeric aggregates only.

---

## Accounting connectors

An accounting connector moves documents between the app and a tax authority. The only one today
is `connectors/anaf`, for Romania's e-Factura and SPV. **This is the interface to implement for
another country.**

```
connectors/anaf/
├── index.ts       # fetchIncomingInvoices, fetchSpvMessages, uploadInvoice, checkUploadStatus, checkHealth
├── oauth.ts       # OAuth2 against logincert.anaf.ro (authorize URL, code exchange, refresh)
├── transform.ts   # downloaded UBL XML → IncomingInvoice; upload and status responses
├── xml-builder.ts # issued invoices → UBL 2.1 CIUS-RO XML (buildInvoiceXml, computeTotals)
├── declarations/  # D301 and D390 VAT declaration builders
└── types.ts
```

- The session (`AnafSession`: tax id and decrypted access token) comes from `shared/lib/anaf.ts`
  (`getAnafSession()`), which refreshes the token an hour before it expires.
- The first consent cannot be automated: the account owner goes through the browser flow with a
  qualified digital certificate. An expired or revoked refresh token sets
  `anaf_credentials.status = 'needs_reauth'` and sends an email.
- `ANAF_ENV=sandbox` targets `api.anaf.ro/test/...`. Validate your XML there before production.

For another country, `xml-builder.ts` is the part most likely to be reusable: UBL 2.1 is the
basis of the European EN 16931 standard, and CIUS-RO is Romania's profile of it.

## Bank connectors

The interface is small: `fetchTransactions(account, from, to)` and `checkHealth(account)`.
Replacing Revolut with another provider (GoCardless Bank Account Data, Salt Edge, a bank's own
API) means a new folder and an entry in `bankConnectors`. Nothing else changes.

- Transactions are upserted on `UNIQUE(bank_account_id, external_id)`, so a sync is idempotent.
- After each sync, `autoMatchTransactions()` (`shared/lib/bank-sync.ts`) links a transaction to
  an invoice when the amount is exact and either the IBAN matches or the reference contains the
  invoice number (threshold 0.8). Matches are visible and reversible in the UI. The scoring
  itself is a pure function in `shared/lib/matching.ts`.

### Revolut Business: OAuth2 with a JWT client assertion

Unlike ANAF, which has one global configuration, **each row in `bank_accounts` has its own
`client_id` and certificate**. There is no global `REVOLUT_CLIENT_ID`, because a business can
have several Revolut integrations.

```
connectors/revolut/
├── certificate.ts # generateSelfSignedCertificate(): RSA 2048, valid 10 years
├── jwt.ts         # signClientAssertion(): RS256 JWT with node:crypto, no extra dependency
├── oauth.ts       # buildAuthorizeUrl, exchangeCode, refreshTokens
├── index.ts       # BankConnector: fetchTransactions, checkHealth, prepareSession
└── types.ts
```

The flow (the account owner does steps 1 to 3 in the UI; the rest is automatic):

1. **Generate a certificate.** `POST /api/reconciliation/accounts/:id/generate-certificate`
   creates a self-signed RSA pair. The private key is stored encrypted (AES-256-GCM) and never
   leaves the server. The public certificate is stored in clear and can be downloaded.
2. **Upload it by hand.** Download the certificate from Reconciliation → Settings and upload it
   in Revolut Business → Settings → API. Revolut checks JWT signatures against it, so this step
   cannot be automated. Enter the `client_id` Revolut assigns back into the account.
3. **Consent.** `GET /api/reconciliation/accounts/:id/authorize-url` returns the consent URL.
   Open it, approve in the Revolut Business app, and you are redirected with a `code` that is
   valid for about two minutes.
4. **Exchange the code.** `POST /api/reconciliation/accounts/:id/exchange-code` with `{ code }`
   signs a fresh client assertion and sends it to `POST {REVOLUT_API_URL}/auth/token` as
   `client_assertion` (RFC 7523). Revolut issues no client secret; the signature takes its place.
   In the JWT, `iss` is **only the hostname** of `REVOLUT_REDIRECT_URI`, without the scheme
   (Revolut rejects `https://` there with 401, code 9001), `sub` is the `client_id`, `aud` is
   `https://revolut.com`, and it expires in an hour.
5. **Refresh.** `jobs/refresh-revolut-token.ts` runs every 25 minutes and renews any active
   account whose token expires in under 15 minutes, signing a new assertion each time. A failure
   on one account does not stop the others.

| Token | Lifetime | When it expires |
|---|---|---|
| Access token | 40 minutes | Refreshed automatically |
| Refresh token | 90 days | `auth_status = 'needs_reauth'` and an email; consent is given again by hand |

An alert (`accounting.revolut_refresh_token_expiring` in `jobs/accounting-alerts.ts`) fires
seven days before the refresh token is due to expire, estimated from `last_refreshed_at`.

The whole flow was verified end to end against `sandbox-business.revolut.com`. Production use
additionally requires an IP allow-list on the Revolut side.
