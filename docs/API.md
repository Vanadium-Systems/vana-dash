# vana-dash API

Every route needs a valid JWT in the HttpOnly cookie `vana_session`, except the ones listed
under [Routes without a session](#routes-without-a-session). Answers have the form
`{ "success": true, "data": … }` or `{ "success": false, "error": "…" }`. Access errors carry a
stable code:
`{ "success": false, "error": { "code": "FEATURE_FORBIDDEN", "feature": "facturi.emitere" } }`.

Feature keys, some status values and the labels the UI shows are in Romanian; they are quoted
here as they are in the code.

**Users and features.** The app has several people, each with a role (`admin`, `manager` or
`custom`). What a person can do is the feature list of their role (`roles.features`); the admin
has the whole catalog. The catalog is `backend/src/shared/lib/features.ts`: each feature
declares the route prefixes it covers, and the guard in `shared/middleware/feature-guard.ts`
resolves every authenticated route to exactly one feature. A route that resolves to nothing and
is not declared `self`, `public` or `machine` stops the server from starting. So does a route
registered without authentication that is not declared `public` or `machine`. Without the
feature the answer is `403 FEATURE_FORBIDDEN`. A page's `.view` feature is the gate of the
others on that page: while it is off, the rest are ignored.

Besides the guard, some modules filter per person in the service: email by the mailboxes
assigned (`MAILBOX_FORBIDDEN`), notes, plan, wishlist and assistant by owner, the Archive by
spaces and shares, the Calendar by owner, share and attendees. An object from someone else's
space asked for by id answers `404`, not `403`, so it does not reveal that it exists.

The JWT is `{ sub, sv }`. `session_version` goes up when a person is deactivated or resets
their password, so old sessions get `401`. The role and the features are read on every request,
so a change in Modules takes effect without logging out.

## Language and display currency

Every text the server sends (errors, validation messages, feature labels, search groups) is in
the language of the request: the person's `locale` once signed in, otherwise the `X-Locale`
header sent by the pages before login, otherwise `DEFAULT_LOCALE`. The shape of an error does
not change, only its language. System emails and push notifications use the recipient's
language, not the sender's.

Responses with totals (Financials, Reports, Metrics, Wishlist) carry a `money` object next to
`data`:

```json
{ "success": true, "data": {}, "money": { "currency": "EUR", "converted": true, "rateSource": "BNR" } }
```

The figures are in `money.currency`, the person's display currency. Each row is converted in
SQL at the BNR rate of its own day. If no rate exists for that currency, the figures stay in
RON and `money` says `"converted": false, "fallback": "no_rate"`. The amount of a single
document, reconciliation, the D301/D390 declarations and the quarterly package are never
converted. `recurring-revenue` and `recurring-expenses` add `mrrDisplay` and `monthlyDisplay`,
converted at the latest rate.

## Routes without a session

These are all of them; a test snapshot (`feature-guard.test.ts`) keeps the list honest.

| Route | Protected by |
|---|---|
| `GET /health` | nothing, returns `{ status: 'ok' }` |
| `POST /api/auth/login` | rate limit, 5 per 15 minutes per IP |
| `GET /api/auth/locale` | nothing; returns only `{ defaultLocale, enabledLocales }` |
| `POST /api/auth/forgot-password`, `/reset-password`, `/accept-invite` | rate limit, 5 per minute per IP; one-time tokens |
| `GET`/`POST /api/email/unsubscribe/:token` | HMAC token |
| `GET /api/email-images/:filename` | unguessable generated name |
| `GET /api/email/settings/logo` | serves only the current logo |
| `GET /api/public/calls/:publicId` | rate limit, 30 per minute per IP; an unguessable id; answers only the time window and, while open, the room |
| `POST /api/webhooks/resend-inbound` | Svix signature |
| `POST /api/webhooks/sentry` | HMAC signature |
| `POST /api/webhooks/cloudflare-inbound`, `/api/webhooks/vanagreen-alert`, `/api/monitoring/host-metrics`, `/api/v1/integrations/…`, `/api/v1/public/booking…` | a secret in a header, one per caller |

The header secrets are checked before the body is read. With a secret missing from env, its
route refuses every request.

## Auth

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → sets the cookie. A deactivated or still-invited person gets 401, like a wrong password |
| POST | `/api/auth/logout` | Clears the cookie |
| GET | `/api/auth/me` | `{ user: { id, email, displayName, role, status }, features, isPlatformAdmin, mailboxes, notificationPrefs, navLayout, updatesSeenAt, locale, enabledLocales, displayCurrency, displayCurrencies }`. `mailboxes: null` means all (admin) |
| GET | `/api/auth/locale` | `{ defaultLocale, enabledLocales }`, for the pages before login |
| PATCH | `/api/auth/me` | `{ displayName?, notificationPrefs?: { chat: 'all'\|'dm'\|'none', emailNew, alerts }, updatesSeenAt?, locale?: 'ro'\|'en', displayCurrency?: 'RON'\|'EUR'\|'USD' }`. `400` for a language or currency outside the lists. `updatesSeenAt` (ISO) is how far the person has read What's new; the server caps it at now |
| POST | `/api/auth/me/password` | `{ currentPassword, newPassword }` (12 characters minimum). Logs out the other sessions |
| POST | `/api/auth/forgot-password` | `{ email }` → always `204`, whether the address has an account or not |
| POST | `/api/auth/reset-password` | `{ token, password }`. Single-use token, 1h. `RESET_TOKEN_EXPIRED` |
| POST | `/api/auth/accept-invite` | `{ token, password }`. Token valid 72h. `INVITE_EXPIRED` (expired or invalid), `INVITE_USED` (already accepted) |

## Access (Modules)

The Modules page. Every route except the catalog needs `echipa.administrare`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/access/catalog` | The pages with their features (`key`, `label`, `ownerOnly`) |
| GET | `/api/access/matrix` | `{ roles: [{ id, name, kind, features, memberCount, editable, lockedFeatures }] }`. For a manager, `lockedFeatures` is what they do not have themselves |
| PUT | `/api/access/roles/:id/features/:key` | `{ enabled }`. `FEATURE_REQUIRES_VIEW`, `PERMISSION_ESCALATION` (a manager gives only what they have), `ROLE_LOCKED` (Admin) |
| PUT | `/api/access/roles/:id/pages/:page` | `{ enabled }`, the whole page at once |
| POST | `/api/access/roles` | `{ name, copyFromRoleId? }` |
| PATCH | `/api/access/roles/:id` | `{ name }` |
| DELETE | `/api/access/roles/:id` | `409 ROLE_IN_USE { memberCount }` if people have it |

## Team

| Method | Route | Description |
|---|---|---|
| GET | `/api/team/members` | Any active person (the list behind "Scrie" and the share dialogs) → `[{ id, displayName, email, role, status, lastSeenAt }]` |
| POST | `/api/team/members` | `{ email, displayName?, roleId }` → `201 { id, status: 'invited' }` and an email with a link. `EMAIL_TAKEN`. Needs `echipa.administrare` |
| PATCH | `/api/team/members/:id` | `{ displayName?, roleId?, status?: 'active'\|'disabled' }`. `409 LAST_ADMIN` |
| POST | `/api/team/members/:id/resend-invite` | A new invitation link |
| POST | `/api/team/members/:id/reset-password` | Email with a reset link; logs the person out |
| GET/PUT | `/api/team/members/:id/mailboxes` | `{ identityKeys: [...] }`, the person's mailboxes. PUT also needs `email.cutii`; a manager gives only mailboxes they have |

## History

| Method | Route | Description |
|---|---|---|
| GET | `/api/audit` | Query: `entityType?`, `entityId?`, `actorId?`, `action?`, `before?` (ISO, for paging), `limit?` (1-200, default 50) → `[{ id, actor: { id, displayName } \| null, action, entityType, entityId, changes, createdAt }]`. Needs `echipa.istoric`. `actor: null` is a system job. The table is append-only |

## Search (Ctrl K)

| Method | Route | Description |
|---|---|---|
| GET | `/api/search` | Query: `q` (2-120 characters), `limit?` (1-10, default 5) → `[{ group, feature, items: [{ id, label, sublabel, to }] }]`. Groups: invoices, clients, email, archive, calendar. A group is queried only if the person has its feature, and email, archive and calendar go through their module's per-person filter |

## Messages

Chat between people, in real time. Every route needs `mesaje.view`; a conversation you are not
part of answers `404`. Real time is SSE over an in-memory bus (one backend container); sending
goes through POST. The admin has no way to read other people's direct messages.

| Method | Route | Description |
|---|---|---|
| GET | `/api/chat/stream` | SSE: `message.created`, `message.updated`, `conversation.updated`, `read`, `delivered` (`{ conversationId, userId, at }`), `presence`. Heartbeat every 25s |
| POST | `/api/chat/heartbeat` | A sign of life sent while the page is visible (every 45s). A sleeping device can keep the SSE socket "open", so presence relies on the heartbeat, not on the connection |
| GET | `/api/chat/conversations` | `[{ id, kind, name, members: [{ id, displayName, presence, lastSeenAt }], lastMessage, unreadCount }]` |
| POST | `/api/chat/conversations` | `{ kind: 'dm', userId }` (returns the existing one) or `{ kind: 'group', name, memberIds }` |
| PATCH | `/api/chat/conversations/:id` | `{ name?, addMemberIds?, removeMemberIds? }`. The group's owner or `echipa.administrare` |
| GET | `/api/chat/conversations/:id/messages` | Query: `before?` (message id), `limit?` (default 50) → `{ messages, hasMore, receipts }`; `receipts` is `[{ userId, deliveredUpTo, readUpTo }]` for the other members. Loading the thread, like loading the conversation list, marks its messages delivered to the reader |
| POST | `/api/chat/conversations/:id/messages` | `{ body, clientId, attachmentIds? }`. `clientId` deduplicates a resend; `body` may be empty when there are attachments |
| POST | `/api/chat/conversations/:id/read` | `{ messageId }` |
| PATCH | `/api/chat/messages/:id` | `{ body }`. The author only; marked as edited |
| DELETE | `/api/chat/messages/:id` | The author only; soft delete, shown as "Mesaj șters" |
| POST | `/api/chat/attachments` | Multipart, 50 MB per file at most, 10 per message. Uploads not sent within 24h are removed by a job |
| GET | `/api/chat/attachments/:id` | Members of the conversation only. Only plain images open inline; everything else (SVG and HTML included) is a download, with `nosniff`. `?size=thumb` on a JPEG, PNG or WebP returns a 640px JPEG made once and kept in R2. Cached as `immutable` |

## Platforms

| Method | Route | Description |
|---|---|---|
| GET | `/api/platforms` | The connected platforms. API keys are never returned |
| GET | `/api/platforms/types` | The types available in the connector registry |
| GET | `/api/platforms/:id` | One platform |
| POST | `/api/platforms` | `{ name, type, apiUrl, apiKey, syncCron }`. `apiKey` is write-only, encrypted with AES-256-GCM. `apiUrl` cannot point at a private or internal address |
| PATCH | `/api/platforms/:id` | Partial update; send `apiKey` only to change it |
| DELETE | `/api/platforms/:id` | Soft delete, and stops its cron |
| POST | `/api/platforms/:id/sync` | Manual sync (synchronous); the result goes to the sync log |
| GET | `/api/platforms/:id/sync-log` | The last 20 runs |
| GET | `/api/platforms/:id/ops-signals` | Operational health (CPU, RAM, disk, errors, backup), fetched live from the connector. 404 for an unknown platform; `{ supported: false, signals: [], history: [] }` if the connector does not implement `fetchOpsSignals`; 502 on a network or parsing error. See `docs/CONNECTOR_GUIDE.md` |

## Metrics

Common query params: `period` = `7d` | `30d` | `90d` | `mtd` | `ytd` (default `30d`), or `from`
+ `to` (ISO datetime); optionally `platformId`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/metrics/summary` | Per metric key: `{ metricKey, unit, total, latest, latestAt }`. Gauges (mrr, active_clients) use `latest`; flows use `total` |
| GET | `/api/metrics/series` | `?metricKey=revenue` → a daily series `{ date, value }` (SUM per day, in SQL) |
| GET | `/api/metrics/overview-config` | `{ visibleKpis: string[] }`, the optional cards shown on the overview. `mrr` is built in (it does not come from `platform_metrics`) |
| PUT | `/api/metrics/overview-config` | `{ visibleKpis: string[] }`. An empty array hides all the optional cards; the revenue card always stays |

## Financials

Query params: `period` or `from` + `to`, as above. The source is **`financial_records` only**,
not `platform_metrics`, so revenue is never counted twice.

| Method | Route | Description |
|---|---|---|
| GET | `/api/financials/pnl` | `{ byMonth: [{ month, direction, total }], byCategory: [{ category, direction, total }] }`. `month` is ISO 8601, `direction` is `in`/`out`, `category` falls back to `'necategorizat'` |
| GET | `/api/financials/cashflow` | `[{ direction, paymentStatus, total, count }]`, grouped by direction and payment status (paid/unpaid/partial) |

## Accounting

| Method | Route | Description |
|---|---|---|
| GET | `/api/accounting/records` | Filters: `direction` (in/out), `type`, `paymentStatus`, `anafStatus`, `from`, `to`, `limit` |
| POST | `/api/accounting/records` | A manual record (expense, invoice, payment) |
| GET | `/api/accounting/records/:id` | Detail and invoice lines |
| PATCH | `/api/accounting/records/:id/payment` | `{ paymentStatus, paidAt? }` |
| GET | `/api/accounting/records/:id/xml` | The UBL XML as a download (issued and received) |
| GET | `/api/accounting/records/:id/pdf` | The PDF, if one was generated |
| GET | `/api/accounting/anaf/status` | The state of the ANAF connection. Tokens are never returned |
| GET | `/api/accounting/anaf/authorize-url` | The OAuth consent URL (browser + digital certificate) |
| POST | `/api/accounting/anaf/refresh` | Renews the ANAF tokens now → the status. 400 if not connected, 502 if ANAF refuses; a failure does not mark the credentials as needing re-authorization |
| POST | `/api/accounting/anaf/exchange-code` | `{ code, cif }` → tokens, encrypted in the database |
| POST | `/api/accounting/anaf/sync` | Manual e-Factura sync (received invoices, last 30 days) |
| GET | `/api/accounting/d301?month=YYYY-MM` | Preview of declaration D301 (reverse charge, every line): `{ lines, totals, warnings }` |
| GET | `/api/accounting/d390?month=YYYY-MM` | Preview of D390 (VIES recapitulative), `eu_services` lines only |
| GET | `/api/accounting/d301/export?month=&format=xml\|csv` | XML ready to be signed, or a quick CSV |
| GET | `/api/accounting/d390/export?month=&format=xml\|csv` | Same, for D390 |
| GET | `/api/accounting/quarterly-package?quarter=YYYY-Qn` | Preview (summary; the zip is not rebuilt) |
| POST | `/api/accounting/quarterly-package/generate?quarter=YYYY-Qn` | Builds the zip (archive + summary CSV) and returns a presigned R2 link, valid 15 minutes |

## Invoicing

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/invoicing/clients` | Billing clients (PATCH/DELETE on `/:id`). The contract fields used by the Contracts module live here too: `contactName`, `contactTitle`, `phone`, `contractPlan`, `contractDetails` (free jsonb). Leaves out `isDemo: true` |
| GET | `/api/invoicing/clients/demo` | Demo tenants synced from VanaGreen, shown apart in the UI. Same shape |
| GET/POST | `/api/invoicing/invoices` | Issued invoices; POST creates a draft `{ billingClientId, currency, dueAt?, note?, lines[] }` |
| PATCH/DELETE | `/api/invoicing/invoices/:id` | Only while it is a draft (no number allocated) |
| POST | `/api/invoicing/invoices/:id/issue` | Allocates the number (atomically, on the sequence) and generates XML, HTML and PDF |
| POST | `/api/invoicing/invoices/:id/send-anaf` | Uploads to e-Factura → `anaf_status='pending'`; the poll job updates the state |
| GET/PATCH | `/api/invoicing/sequence` | Numbering settings (prefix, padding, yearly reset) |

## Contracts

Isolated from `accounting` and `invoicing`: it reads `billing_clients` straight from the schema
and imports no service of another module. The contract fields are written only through
`PATCH /api/invoicing/clients/:id`; this module reads them and validates the jsonb shape
(`ContractDetailsSchema`). Feature: `facturi.contracte`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/contracts/clients/:clientId/info` | The client and the parsed, validated `contractDetails` |
| GET | `/api/contracts/clients/:clientId/documents` | The documents generated for the client (contract, annex, addendum) |
| POST | `/api/contracts/clients/:clientId/documents` | `{ docType: 'contract' \| 'anexa' }`. Generates the PDF (HTML → PDF). 400 with the exact list of missing fields if the client's data is incomplete |
| PATCH | `/api/contracts/documents/:id` | `{ isSigned: boolean }`, set by hand |
| GET | `/api/contracts/documents/:id/pdf` | Downloads the document |
| GET | `/api/contracts/clients/:clientId/addenda` | The client's addenda |
| POST | `/api/contracts/clients/:clientId/addenda` | Creates an addendum; numbered per client (`MAX(number)+1` in a transaction) |
| POST | `/api/contracts/addenda/:id/document` | Generates the addendum's PDF |

**Editable templates.** The document bodies live in `contract_templates`, seeded on first read
with the sample texts from the code. PDF rendering reads the database and falls back to the
sample text if the row is missing.

| Method | Route | Description |
|---|---|---|
| GET | `/api/contracts/templates` | The three templates (`contract-saas`, `anexa-preturi`, `act-aditional`) and the documented list of placeholders |
| PUT | `/api/contracts/templates/:key` | `{ bodyHtml }`. Trusted source HTML; the per-client values injected at generation are escaped anyway |
| POST | `/api/contracts/templates/:key/restore` | Replaces the body with the sample text from the code. The edited text cannot be recovered |
| GET | `/api/contracts/templates/:key/blank` | The document as a PDF with the client's fields as dotted lines, from the current body and terms. Nothing is stored |
| GET | `/api/contracts/terms` | The commercial terms from `dashboard_config['contract.terms']` |
| PUT | `/api/contracts/terms` | Partial update on the known keys |
| GET | `/api/contracts/reserved-numbers` | Contract numbers taken outside the app, `[{ number, note, date }]` from `dashboard_config['contract.reservedNumbers']` |
| PUT | `/api/contracts/reserved-numbers` | Replaces the whole list. `number` is 1-4 digits, normalized to 3 (`3` → `003`); `note` 1-120 characters; `date` `YYYY-MM-DD`. The same number twice → `400 RESERVED_NUMBER_DUPLICATE` |

Each `POST .../documents` creates a new row in `contract_documents`: the full history is kept
and no file on disk is overwritten. The UI warns when the latest document of that type is
already signed, but does not block generating a new one.

## Reconciliation

| Method | Route | Description |
|---|---|---|
| GET | `/api/reconciliation/providers` | Bank providers in the registry |
| GET/POST | `/api/reconciliation/accounts` | Bank accounts (`apiKey` is write-only, encrypted); PATCH/DELETE on `/:id` |
| POST | `/api/reconciliation/accounts/:id/sync` | Manual transaction sync and auto-match |
| POST | `/api/reconciliation/accounts/:id/generate-certificate` | Generates a self-signed certificate (RSA 2048) for the account → `{ certificatePem }`. The private key is encrypted in the database and never returned |
| GET | `/api/reconciliation/accounts/:id/authorize-url` | The Revolut OAuth consent URL → `{ url }`. 400 if `client_id` or the certificate is missing |
| POST | `/api/reconciliation/accounts/:id/exchange-code` | `{ code }` → exchanges the consent code for tokens (JWT client assertion, encrypted in the database). 502 if Revolut refuses |
| GET | `/api/reconciliation/transactions` | Filters: `accountId`, `unmatchedOnly`, `direction`, `limit` |
| GET | `/api/reconciliation/open-invoices` | Unpaid invoices, for the manual match dropdown |
| POST | `/api/reconciliation/transactions/:id/match` | `{ financialRecordId }`. Manual match; marks the payment |
| DELETE | `/api/reconciliation/transactions/:id/match` | Unmatch; the invoice goes back to unpaid |

The account object also has `authStatus` (`unconfigured`/`active`/`needs_reauth`),
`tokenExpiresAt`, `lastRefreshedAt`, `clientId` and `certificatePem` (the public key, safe to
show). The secrets (`privateKeyEnc`, `accessTokenEnc`, `refreshTokenEnc`, `apiKeyEnc`) never
appear in an answer.

## Email

Source of truth: `backend/src/modules/email/routes.ts` (templates, send, bulk send, sends) and
`inbound-routes.ts` (webhooks and threads).

**Mailboxes per person.** A person sees only the threads with a message received on one of
their mailboxes or sent from it (`user_mailboxes`; the admin has all of them). A thread from
another mailbox asked for by id → `404`. Sending (compose, reply, forward, bulk, sequences,
drafts, assistant) accepts only the person's identities, otherwise `403 MAILBOX_FORBIDDEN`.
Read/unread is per person (`email_thread_reads`), drafts belong to their author, and on outgoing
messages `sentByUserId` says who sent from a shared mailbox. A reply sends `lastSeenMessageId`;
if someone else replied in the meantime → `409 THREAD_REPLIED_MEANWHILE { by, at }`. The
signature is per identity (`email.signature.<identityKey>`), falling back to the company one.

| Method | Route | Description |
|---|---|---|
| GET | `/api/email/templates` | The templates |
| POST | `/api/email/templates` | `{ name, subject, body }`. `body` is HTML and may use the placeholder `{{nume}}`, replaced when sending |
| PATCH | `/api/email/templates/:id` | Partial update |
| DELETE | `/api/email/templates/:id` | Soft delete |
| POST | `/api/email/send` | `{ to, subject, body, templateId? }`, one message. `body` is HTML; the plain text is derived from it. 400 if `templateId` does not exist |
| POST | `/api/email/bulk-send` | `{ templateId, recipients: [{ email, nume? }] }` (50 at most) → `{ sent, skipped, suppressed, failed, results }`. `skipped` is the automatic dedup on `(recipient, templateId)`. `suppressed` are addresses in `email_suppressions` (unsubscribed), skipped without sending. An unsubscribe link is appended; messages go out one by one with a delay |
| GET | `/api/email/sends` | Send history. Query: `templateId?`, `recipient?`, `batchId?`, `limit` (default 200, max 500) |
| GET | `/api/email/send-quota` | Usage against the daily and monthly limits of the Resend plan |
| GET/POST | `/api/email/unsubscribe/:token` | **No session.** The link in the footer of a bulk send, and the one-click POST of RFC 8058. A stateless token (HMAC-SHA256 over the address, `EMAIL_UNSUBSCRIBE_SECRET`). 400 if the secret is not configured or the signature fails. On success: an idempotent upsert into `email_suppressions`, and the matching prospect, if any, gets `status: 'dezabonat'` |
| POST | `/api/email/images` | Uploads a picture for the rich-text editor: multipart, 5 MB at most, PNG/JPEG/GIF/WEBP only → `{ url: '/api/email-images/<uuid>.<ext>' }`. The URL is for previews; when the message is really sent, `<img src>` is rewritten to `cid:` with a MIME attachment, because mail clients hide images loaded from an external URL |
| GET | `/api/email-images/:filename` | **No session.** Serves the picture above for previews. `filename` is validated strictly (a UUID and an extension from a fixed list). Cached for a year: the generated name is never reused |
| GET | `/api/email/recent-addresses` | Autocomplete for "Către" in compose: distinct addresses from `email_messages`, most recently used first |
| GET | `/api/email/threads` | The inbox threads, by `lastMessageAt` descending |
| GET | `/api/email/threads/:id` | `{ thread, messages }`. `bodyHtml` is raw, unsanitized HTML; it is sanitized in the browser (DOMPurify) when rendered, never on the server |
| POST | `/api/email/threads/:id/reply` | `{ body, lastSeenMessageId? }` → a reply in the thread, through Resend, with `In-Reply-To`/`References` set from the message replied to |
| POST | `/api/email/messages/:id/forward` | `{ to, extraBody?, includeOriginalAttachments, attachments? }`. `extraBody` is HTML; the quote of the original is built separately |
| GET | `/api/email/attachments/:id/download` | An attachment of a message the person can see. Images, PDFs and plain text open inline; everything else is a download served as `application/octet-stream`, since the sender chose the type |
| GET | `/api/email/settings/logo` | **No session.** The current logo, used in the `<img>` of the signature |
| POST | `/api/webhooks/resend-inbound` | **No session.** Delivery status events from Resend. The **Svix** signature (headers `svix-id`, `svix-timestamp`, `svix-signature`, secret `RESEND_WEBHOOK_SECRET`) is verified on the raw body: 503 if the secret is not configured, 401 if the signature fails. A malformed payload or an unknown event → 200, so Resend does not retry forever |
| POST | `/api/webhooks/cloudflare-inbound` | **No session.** Received mail, posted by the Worker in `infra/cloudflare-email-worker/` with the header `X-Cloudflare-Email-Token`. The payload holds the whole message: `html`, `text`, attachments with `contentId` and `disposition` |

Sending works whether or not receiving is set up.

### Outreach sequences (automatic drip)

Source: `sequences-routes.ts`, `sequences-service.ts`, `sequences-schema.ts`, and the cron
`jobs/email-sequence-runner.ts` (hourly; it only sends inside the configured window, by default
10:00 Europe/Bucharest on weekdays, editable in Email settings as `outreachSendHour` and
`outreachSendWeekdaysOnly`).

| Method | Route | Description |
|---|---|---|
| GET | `/api/email/sequences` | The sequences with their steps (`steps: [{ templateId, delayDays, stepOrder }]`) |
| POST | `/api/email/sequences` | `{ name, fromIdentity, steps: [{ templateId, delayDays }] }`. `fromIdentity` is the key of a sending identity; `stepOrder` comes from the position in the array |
| PATCH | `/api/email/sequences/:id` | Partial update. `steps`, if sent, **replaces** the whole list |
| DELETE | `/api/email/sequences/:id` | Soft delete |
| GET | `/api/email/sequences/:id/enrollments` | The enrollments (status, currentStep, nextSendAt) |
| POST | `/api/email/sequences/:id/enroll` | `{ recipients: [{ email, nume?, prospectId? }] }` (2000 at most; it only writes rows, nothing is sent in the request) → `{ enrolled, alreadyEnrolled: string[] }`. Idempotent on `(sequence_id, recipient_email)` |
| PATCH | `/api/email/sequences/:id/enrollments/:enrollmentId` | `{ status: 'unsubscribed' \| 'active' \| 'replied' }`, the manual transitions. `completed` and `failed` belong to the cron |

**Warm-up cap** (`getOutreachCapStatus`): on the `outreach` identity only, checked once per
batch or cron run. It is a manual cap, editable in Email settings (`outreachDailyCap`, default
50). When it is reached, a sequence send is postponed (`next_send_at` unchanged) and a bulk send
stops with a clear message (`capBlockedRecipients` in the answer); nothing is sent partially
without saying so.

**Stop on reply.** When any message is received, every active enrollment of the sender's
address is set to `status='replied'`. For a company domain the match is on the whole domain;
for public webmail domains it is on the exact address.

## Archive

File contents live on Cloudflare R2 (`shared/lib/r2.ts`); the database keeps metadata only.

**A space per person.** Each person has a root folder of their own, created on first use.
Access is held on the folder and inherited down the tree: the owner edits, a share gives `view`
or `edit`, and `arhiva.administrare` sees every space. The effective level is computed in one
place, `modules/archive/access.ts` (a recursive CTE on `parent_id`). A folder or file from
another space → `404`. Only the folder's owner and the admin can share it. The jobs (monthly
subfolders, the financial archive, the quarterly package) write into the platform admin's space
(`systemArchiveRoot`). Features: `arhiva.view` to read, `arhiva.editare` to write,
`arhiva.administrare` to assign.

| Method | Route | Description |
|---|---|---|
| GET | `/api/archive/spaces` | `{ own: { id, name }, shared: [...], spaces: [...] \| null }`. `shared` are the folders received through a share (the top ones only); `spaces` are everyone's roots, only with `arhiva.administrare`. Entries: `{ id, name, kind, level, ownerUserId, ownerName }` |
| POST | `/api/archive/folders` | `{ name, parentId? }`. Without `parentId`, in the person's space. Needs `edit` on the parent |
| GET | `/api/archive/folders` | Query: `parentId?` (missing = the root of the person's space), `sort?` (`recent`/`oldest`/`name`) → `[{ id, name, parentId, ownerUserId, fileCount, subfolderCount, autoMonthlySubfolders, level, canShare }]` |
| GET | `/api/archive/folders/:id/path` | `{ path: [{ id, name }], level, canShare, ownerUserId, ownerName }`. The path starts at the topmost folder the person can access, so a shared folder does not show its ancestors |
| PATCH | `/api/archive/folders/:id` | `{ name?, parentId?, autoMonthlySubfolders? }`. 409 on a cycle in the tree. Moving also needs `edit` on the destination |
| DELETE | `/api/archive/folders/:id` | Soft delete. 409 if it is not empty |
| GET | `/api/archive/folders/:id/download` | A zip of the whole subtree |
| GET | `/api/archive/folders/:id/shares` | `[{ id, userId, level, displayName, email }]`. Owner or admin |
| POST | `/api/archive/folders/:id/shares` | `{ userId, level: 'view'\|'edit' }`, adds or changes the level. Audited |
| DELETE | `/api/archive/folders/:id/shares/:userId` | Removes the access. Audited |
| POST | `/api/archive/folders/:id/assign` | `{ ownerUserId }`, moves the whole subtree to another person. `arhiva.administrare` |
| POST | `/api/archive/spaces/:ownerUserId/assign` | `{ toUserId }` → `{ moved }`, all of a person's folders in one call. `arhiva.administrare` |
| POST | `/api/archive/files` | `multipart/form-data`, with `folderId`/`tags` before `file`. Without `folderId`, the root of the person's space. 200 MB at most |
| GET | `/api/archive/files` | Query: `folderId?`, `q?`, `tags?` (all of them), `sort?`, `page?` (50 per page) |
| GET | `/api/archive/search` | Query: `q`, `tags?` → results from everything the person can see, with `folderPath` |
| GET | `/api/archive/files/:id/download-url` | `{ url, expiresAt }`, a presigned R2 URL valid 15 minutes. For navigation, not for `fetch()` (R2 does not apply CORS to presigned URLs) |
| GET | `/api/archive/files/:id/download` | Same-origin streaming through the backend, for code that has to read the bytes in JS |
| PATCH | `/api/archive/files/:id` | `{ name?, folderId?, tags? }` |
| DELETE | `/api/archive/files/:id` | Query: `permanent?` (`true` also deletes from R2) |
| GET | `/api/archive/storage` | `{ usedBytes, limitBytes, totalUsedBytes }`, the space the person uses; `totalUsedBytes` only with `arhiva.administrare`, otherwise `null` |

## Calendar

One table (`calendar_events`) for single and recurring events (RRULE, expanded on the server
over the window asked for).

**A calendar per person.** Each event has an owner. A share is given on the person's whole
calendar (`view` / `edit`), only by the owner or the admin. A common event (one with attendees)
shows up for each attendee; only someone with `calendar.comune` creates or changes it.
`calendar.administrare` sees every calendar. An event from another calendar asked for by id →
`404`; visible but not writable → `403 EVENT_READ_ONLY`. Public bookings always go into the
platform admin's calendar, and free slots are computed from it alone.

| Method | Route | Description |
|---|---|---|
| GET | `/api/calendar/calendars` | `{ mine: [{ userId, name, level, owner }], given: [...], members: [...] }`, the layers in the UI and the share dialog |
| POST | `/api/calendar/events` | `{ title, startAt, endAt, description?, location?, allDay?, recurrenceRule?, recurrenceEndAt?, color?, reminderMinutesBefore?, attendeeUserIds?, calendarOwnerUserId? }`. `attendeeUserIds` needs `calendar.comune` (`403 COMMON_NOT_ALLOWED`). `calendarOwnerUserId` creates in someone else's calendar, with an `edit` share (`403 CALENDAR_READ_ONLY`) |
| GET | `/api/calendar/events` | Query: `from`, `to` → the occurrences the person can see: `{ eventId, occurrenceStart, occurrenceEnd, ownerUserId, ownerName, attendees, isCommon, access: 'owner'\|'edit'\|'view'\|null, source: 'manual'\|'booking', ... }`. Recurring expenses appear with `ownerUserId: null` |
| PATCH | `/api/calendar/events/:id` | Partial update, on the whole series. `attendeeUserIds` needs `calendar.comune` |
| DELETE | `/api/calendar/events/:id` | Soft delete, the whole series |
| POST | `/api/calendar/shares` | `{ ownerUserId, userId, level }` → the shares given. Owner or admin (`403 SHARE_NOT_ALLOWED`). Audited |
| DELETE | `/api/calendar/shares/:ownerUserId/:userId` | Removes the access. Audited |

An event's reminder reaches the owner and, for a common event, each attendee.

## Notes

One table (`notes`), plain text, no markdown. Each note belongs to the person who wrote it
(`owner_user_id`); the same goes for the wishlist and the plan.

| Method | Route | Description |
|---|---|---|
| GET | `/api/notes` | Query: `search?` (title and body), `pinned?` → pinned first, then by `updated_at` descending |
| POST | `/api/notes` | `{ title, body? }` |
| PATCH | `/api/notes/:id` | `{ title?, body?, pinned? }`. 404 if missing |
| DELETE | `/api/notes/:id` | Soft delete |

## Wishlist

Table `wishlist_items`, with an optional link to `financial_records`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/wishlist` | Query: `category?` (`necesitate`/`placere`), `purchased?` → `{ items, totals }`. `totals` is the SUM of `estimated_price` in RON per category, over the items not bought yet |
| POST | `/api/wishlist` | `{ title, category, priority?, estimatedPrice?, currency?, link? }` |
| PATCH | `/api/wishlist/:id` | Partial update. 404 if missing |
| DELETE | `/api/wishlist/:id` | Soft delete |
| POST | `/api/wishlist/:id/purchase` | `{ addExpense? }`, marks it bought. With `addExpense=true` (always an explicit choice) it also writes a `financial_records` row (`type='expense'`, `direction='in'`) and links it |

## Tenders

Watches open direct acquisitions and public tenders on e-licitatie.ro (SICAP). Tables
`tender_opportunities` (upsert on `source` + `externalId`) and `tender_watch_rules` (CPV prefix
or keyword). They are filled by the cron `jobs/tender-watch-sync.ts` (twice a day), not by a
write route. `modules/tenders/e-licitatie-client.ts` describes the SICAP endpoints, which are
not officially documented, and the traffic limits every request to SICAP goes through.

| Method | Route | Description |
|---|---|---|
| GET | `/api/tenders` | Query: `source?` (`direct_acquisition`/`contract_notice`), `isOpen?`, `isPriority?`, `dismissed?` (`only`; active ones by default), `search?` (title or authority). Sorted by `isPriority` descending, then `deadlineAt` ascending (NULL last) |
| PATCH | `/api/tenders/:id` | `{ dismissed }`, "not interested" or restore; nothing is deleted. 404 if missing |
| GET | `/api/tenders/watch-rules` | All the rules, active and inactive |
| POST | `/api/tenders/watch-rules` | `{ label, cpvPrefix?, keyword?, active?, highPriority? }`. At least one of `cpvPrefix`/`keyword`. With `highPriority=true`, new matches raise a separate `critical` alert |
| PATCH | `/api/tenders/watch-rules/:id` | Partial update. 404 if missing |
| DELETE | `/api/tenders/watch-rules/:id` | Soft delete |

## Plan

A game plan with two independent tracks (`personal`/`firma`, table `plan_goals`): ordered steps
that unlock in sequence. The unlocking is informative only: the status is computed on read and
any step can be ticked at any time. An optional `mrr_ron` threshold compares against the current
MRR and only shows progress; ticking stays manual. The plan belongs to each person
(`owner_user_id`), under `notite.view`.

Each goal has a `tier` (1-4, a visual grouping; the tier labels are in the frontend, not in the
data) and an optional `monthlyCostRon`. Ordering, and so unlocking, is on `(tier, position)`: a
step in tier N+1 becomes `available` only after the last step of tier N. `position` is scoped
to `(scope, tier)`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/plan` | `{ personal: PlanGoal[], firma: PlanGoal[], mrrRon: number }`. `status` is `locked`/`available`/`completed` |
| POST | `/api/plan` | `{ scope, tier? (1-4, default 1), title, note?, thresholdType?, thresholdValue?, monthlyCostRon? }`. `thresholdValue` is required when `thresholdType='mrr_ron'`. `position` is the last of `(scope, tier)` plus one |
| PATCH | `/api/plan/:id` | Partial update. Switching to `thresholdType='manual'` clears `thresholdValue`; switching to `mrr_ron` without a `thresholdValue` → 400. 404 if missing |
| DELETE | `/api/plan/:id` | Soft delete |
| PATCH | `/api/plan/:id/complete` | `{ completed }`, sets or clears `completedAt` |
| POST | `/api/plan/reorder` | `{ scope, tier, orderedIds }`, rewrites the positions of one `(scope, tier)` in a transaction. `orderedIds` has to match the existing goals of that tier exactly, otherwise 400 |

## Alerts

A threshold engine over `platform_metrics`, run hourly (`jobs/metric-alerts.ts`). The
`accounting.*` namespace is reserved for `jobs/accounting-alerts.ts` (event-based, daily).
`GET /api/alerts` shows both.

| Method | Route | Description |
|---|---|---|
| GET | `/api/alert-rules` | The rules, including the `accounting.*` ones created by the accounting job (their condition and threshold are placeholders) |
| POST | `/api/alert-rules` | `{ name, metricKey, condition, threshold, windowHours?, severity?, platformId?, enabled? }`. `metricKey` cannot start with `accounting.` |
| PATCH | `/api/alert-rules/:id` | Partial update, without `metricKey` (fixed after creation). 404 if missing |
| DELETE | `/api/alert-rules/:id` | Soft delete |
| POST | `/api/alert-rules/:id/test` | Dry run: evaluates the rule now, `{ value, triggered }`, and inserts no alert |
| GET | `/api/alerts` | Query: `status?` (`active`\|`acknowledged`\|`all`) |
| GET | `/api/alerts/active-count` | `{ count }`, for the badge in the sidebar |
| PATCH | `/api/alerts/:id/ack` | Acknowledges the alert |
| PATCH | `/api/alerts/:id/snooze` | `{ days }`, 90 at most |
| POST | `/api/alerts/ack-bulk` | `{ ruleId? }`, acknowledges all active alerts, or only those of one rule → `{ acked }` |
| GET | `/api/alert-rules/:id/sparkline` | The raw series of the rule's metric over its window (the last 120 samples) |

Three more sources create their rules on demand (`shared/lib/alerting.ts`, deduplicated on the
active rule):

- `jobs/platform-ops-alerts.ts` (every 5 minutes): a red signal from a platform's ops signals →
  `platform_ops.<platformId>.<signalKey>`; a platform that cannot be fetched →
  `platform_ops.<platformId>.unreachable`.
- `jobs/uptime-monitor.ts` (every 5 minutes): site down → `platform_uptime.<platformId>.site`;
  backend or database degraded (`connector.checkHealth()`) →
  `platform_uptime.<platformId>.backend`.
- `POST /api/webhooks/sentry`, below.

### Sentry webhook

**No session.** HMAC-SHA256 over the raw body, header `Sentry-Hook-Signature`, secret
`SENTRY_WEBHOOK_SECRET`: 503 if the secret is not configured, 400 if the header is missing, 401
if the signature fails. The payload is read best-effort in the two shapes Sentry can send
(Internal Integration `data.issue.*`, Issue Alert webhook `data.event.*`). It was not validated
against a live Sentry: if the alerts look thin, check the server log (the raw payload is logged
on every delivery, cut at 2000 characters) and adjust
`modules/webhooks/sentry-service.ts::extractIssue`. Deduplicated on `sentry.<issue id>`, or on
a hash of title and culprit when there is no stable id.

Setup on the Sentry side:

1. Settings → Developer Settings → New Internal Integration.
2. Webhooks → enable, URL: `https://<your domain>/api/webhooks/sentry`.
3. Subscribe to the "Issue" event.
4. Save, and copy the generated **Client Secret** into `SENTRY_WEBHOOK_SECRET`.

| Method | Route | Description |
|---|---|---|
| POST | `/api/webhooks/sentry` | Body: the Sentry issue payload, signed. Always answers 200 once the signature is valid |

## Reports

All P&L aggregation reuses `shared/lib/financial-aggregation.ts`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/reports/mrr-trend` | Query: `from`, `to` → `{ clientsByMonth, currentMrr }`: the monthly client counts (the last value of each month) and the current MRR, computed live from `billing_clients` |
| GET | `/api/reports/period-comparison` | Query: `fromA`, `toA`, `fromB`, `toB` → `{ periodA, periodB }`, each `{ revenue, expense, net }` in RON |
| GET | `/api/reports/period-comparison/csv` | Same params, as CSV |
| GET | `/api/reports/expense-breakdown-trend` | Query: `from`, `to` → expenses per category and month |
| GET | `/api/reports/monthly-snapshot` | Query: `month` (`YYYY-MM`) → revenue, expense, net, MRR, top 5 expense categories, alerts raised, sync success rate |
| POST | `/api/reports/monthly-snapshot/pdf` | Query: `month` → the PDF, streamed, nothing stored. 503 if Chromium is not available |

## Pricing (price calculator)

Settings per platform (`pricing_configs`, free jsonb validated strictly at the API by
`PricingConfigSchema`). The frontend has a mirror of the calculation
(`modules/pricing/calc.ts`, kept in step by a parity test), used as an offline fallback.

| Method | Route | Description |
|---|---|---|
| GET | `/api/pricing/config` | Query: `platformId` → `PricingConfigRow \| null` |
| PUT | `/api/pricing/config` | `{ platformId, config: PricingConfig }`, upsert (unique on `platformId`) |
| POST | `/api/pricing/calculate` | `{ platformId, flux, opDesktop, opMobil, puncte, documente, siatd, selectedEquipmentIds?, selectedAddonKeys?, selectedBundleKey?, cantare? }` → `PricingResult` (`totalMonthly`, `totalAnnual`, `onboardingTotal`, `manualReviewNeeded`, `breakdown[]`). 404 if the platform has no saved config |
| GET/PUT | `/api/pricing/self-serve-toggle` | Kill switch, `{ enabled }`, `true` by default. Off → the self-serve ingest below answers 503 |

**Add-ons and bundles.** `PricingConfig.addons: [{key, label, price}]` is a generic catalog;
`selectedAddonKeys` sums on `key`, so a new add-on needs no new code. `PricingConfig.bundles:
[{key, label, addonKeys, price, puncteLucru?, operatoriDesktop?, operatoriMobil?, documente?,
onboardingPrice}]` are packages at a fixed price, combinable with add-ons outside the package
(`selectedBundleKey`); add-ons already in the package are left out of the individual sum, so
nothing is charged twice. `puncteLucru`, `operatoriDesktop`, `operatoriMobil` and `documente`
are presets for the UI and do not enter the formula. `onboardingPrice` replaces the normal
onboarding formula while the package is selected.

**Equipment.** `PricingConfig.equipmentItems` is an array of `{ id, name, purchasePrice,
integrationPrice, monthlyFee }`: purchase and integration are one-time and go into
`onboardingTotal`, `monthlyFee` recurs in `totalMonthly`. Configs saved before a field existed
parse with defaults; no migration is needed.

## VanaGreen integration: self-serve ingest

Called by the VanaGreen signup wizard, not by a browser session. Auth: the header
`X-Ingest-Token`, with a separate secret for the pricing routes and for billing-clients, never
shared with `VANAGREEN_ALERT_INGEST_TOKEN`.

| Method | Route | Description |
|---|---|---|
| POST | `/api/v1/integrations/vanagreen/pricing/calculate` | `{ workPoints, desktopOperators, mobileSeats, documentsPerMonth, siatdPurchasesPerMonth, flavor: 'simple'\|'deee_dba', addons: Array<'treatment'\|'pickup'\|'market_prices'\|'nexus'\|'crm'\|'accounting'\|'signature_pad'\|'id_scanner'\|'analytics'\|'partner_portal'\|'hr'\|'ai_assistant'>, bundle?, cantare?, includeOnboarding }` → `{ totalMonthly, totalAnnual, onboardingTotal, currency: 'RON' }`, with no `{success,data}` wrapper and no breakdown. 503 if the kill switch is off, the platform is not configured, there is no saved config, or the volume needs a manual quote. The caller treats any non-2xx as "price unavailable" |
| GET | `/api/v1/integrations/vanagreen/pricing/bundles` | `[{key, label, addonKeys, price}]`, the current package catalog. Empty if the platform is not configured |
| POST | `/api/v1/integrations/vanagreen/billing-clients` | `{ vanagreenTenantId, companyName, contactEmail, quotedMonthlyTotal, quotedAnnualTotal, needsBillingInfo: true, autoInvoiceEnabled: false }`, creates a skeleton `billing_client` (tax id and address left empty, to be filled in by hand). Idempotent on `vanagreenTenantId` |

`POST /api/webhooks/vanagreen-alert` (header `X-Ingest-Token`, secret
`VANAGREEN_ALERT_INGEST_TOKEN`) receives an alert when a tenant's e-Factura upload fails for a
reason that is not the tenant's fault. Deduplicated on tenant, invoice and source.

## Push notifications

Web Push (VAPID) and, for the Android app, Firebase Cloud Messaging, behind one wrapper:
`shared/lib/push.ts` (`notifyPush`, fire-and-forget, cleans up expired subscriptions). The same
call fans out to both channels on the same preferences. With `VAPID_*` or
`FIREBASE_SERVICE_ACCOUNT_JSON` empty, that channel is a silent no-op. Triggers: new alerts, new
email, the ANAF status of an invoice, calendar reminders, payment matches, chat messages.

| Method | Route | Description |
|---|---|---|
| GET | `/api/push/vapid-public-key` | `{ publicKey }`. The private key is never returned |
| POST | `/api/push/subscribe` | `{ endpoint, keys: { p256dh, auth }, deviceLabel? }`, upsert on `endpoint` |
| DELETE | `/api/push/subscribe` | `{ endpoint }`, soft delete |
| GET | `/api/push/preferences` | Switches per `eventType` (`alerts`, `email`, `invoiceStatus`, `calendarReminder`, `paymentMatch`), all `true` by default |
| PUT | `/api/push/preferences` | Partial update |
| POST | `/api/push/test` | Sends a test notification to all active subscriptions, ignoring preferences → `{ sent, failed }` |
| POST | `/api/push/device` | `{ token }`, the FCM token of the Android app; upsert on the token |
| DELETE | `/api/push/device` | `{ token }`, removed on logout from the app |

## Prospects (CRM)

Tables `prospects` and `prospect_scoring_config` (one row). No connector: the data is local,
imported from CSV. Scoring is a set of pure functions (`modules/prospects/scoring.ts`). The
priority (HOT/WARM/NURTURE/SKIP) is derived from `score` on read with the current thresholds,
not stored.

| Method | Route | Description |
|---|---|---|
| GET | `/api/prospects` | Query: `status?`, `priority?`, `source?`, `search?` (name or tax id), sorted by `score` descending |
| POST | `/api/prospects` | Manual creation: `{ name, cif?, phone?, email?, website?, contactName?, caenCode?, foundingYear?, employeeCount?, revenue?, profit?, debt?, equity?, cash?, receivables?, inventory?, source?, platformId? }`; the score is computed |
| PATCH | `/api/prospects/:id` | Partial update; recomputes the score. `assignedUserId` (an active person, or `null`) sets the owner and writes the change to the history. 404 if missing, 400 for an unknown status or owner |
| GET | `/api/prospects/assignees` | The active people a prospect can be assigned to → `[{ id, displayName, email }]` |
| DELETE | `/api/prospects/:id` | Soft delete |
| POST | `/api/prospects/import` | Multipart (`file`) or JSON `{ csv, source? }`. Tolerant of column aliases; UPSERT on `cif`, field by field, so an empty value in the new row does not erase an existing one |
| POST | `/api/prospects/:id/promote` | `{ address, city?, county?, cif? }`, creates a `billing_client` from the prospect, links it and sets the status to `aprobat`. `cif` is required in the body only if the prospect has none |
| GET | `/api/prospects/scoring-config` | The current weights and thresholds; creates the default row on first read |
| PUT | `/api/prospects/scoring-config` | Updates the config and recomputes the score of every prospect → `{ config, recalculated }` |

**Status catalog.** `prospect_statuses` (key, label, a `colorToken` from a fixed palette,
sortOrder) is editable. `PATCH /api/prospects/:id` validates `status` against the active
catalog.

| Method | Route | Description |
|---|---|---|
| GET | `/api/prospects/statuses` | The catalog, by `sortOrder` |
| POST | `/api/prospects/statuses` | `{ key, label, colorToken }`. 409 if the `key` already exists |
| PATCH | `/api/prospects/statuses/:id` | `{ label?, colorToken? }` |
| DELETE | `/api/prospects/statuses/:id` | Soft delete. 409 if an active prospect still uses the status |
| POST | `/api/prospects/statuses/reorder` | `{ orderedIds }`. 400 if it does not match the active statuses exactly |

## Assistant

A chat with a language model over the tools of the rest of the app. Every route needs
`asistent.view`. The assistant talks to the person logged in: conversations are theirs, and the
tool list sent to the model contains only what their features and mailboxes allow (a scheduled
run recomputes them for its author each time). Tools are either "auto" (they run) or "confirm"
(they are only recorded, and run when the person confirms).

The message, confirm and reject routes do not return JSON. They answer with
`Content-Type: text/event-stream`, events `data: {...}\n\n` of type `text_delta`, `tool_call`,
`confirm_required`, `entity_refs`, `done` or `error`.

| Method | Route | Description |
|---|---|---|
| POST | `/api/assistant/conversations` | Creates a conversation |
| GET | `/api/assistant/conversations/:id/messages` | The message history (raw content blocks) |
| POST | `/api/assistant/conversations/:id/messages` | `{ text }`, sends a message. **SSE answer** |
| POST | `/api/assistant/actions/:id/confirm` | Runs the pending action. **SSE answer** with the rest of the conversation. 400 if the action is missing, no longer `pending` or expired |
| POST | `/api/assistant/actions/:id/reject` | Marks the action `rejected`. **SSE answer**; nothing is executed |
| GET | `/api/assistant/providers` | The provider settings (`anthropic`, `openrouter`, `local`). `apiKeyPreview` is masked; the raw key is never returned |
| PUT | `/api/assistant/providers/:provider` | `{ apiKey?, baseUrl?, models?, defaultModel?, enabled? }`. The key is write-only, encrypted with AES-256-GCM |
| GET | `/api/assistant/models` | The models available, from the active providers, with env as fallback |
| GET | `/api/assistant/scheduled` | The active tasks scheduled from chat (reminders and reports) |
| DELETE | `/api/assistant/scheduled/:id` | Cancels a pending task. 400 if it is no longer pending |
| DELETE | `/api/assistant/conversations/:id` | Deletes the conversation for good, with its messages and pending actions. 404 if missing |

The assistant writes references as `[[type:id|label]]` (invoice, email, archive, alert, client,
platform, reminder, page); the UI renders them as clickable chips. Scheduled reminders and
reports run in `jobs/scheduled-tick.ts` (a scan every minute; pending ones are recovered at
boot; older than 7 days → failed; recurrence once, daily or weekly, on Europe/Bucharest time).

**Never reachable through a tool:** sending an invoice to ANAF
(`POST /api/invoicing/invoices/:id/send-anaf`). It stays manual from the UI, or automatic
through the billing cron.

**The `local` provider** is an OpenAI-compatible server (llama.cpp) on a private network
(`LOCAL_AI_BASE_URL`, or `baseUrl` in its settings). Its models get a short system prompt and
no tools: nothing from the app is sent to them.

## Calls

Video calls through Daily (Prebuilt). The routes exist only with `DAILY_API_KEY`; the feature is
`apeluri.view` to read and `apeluri.manage` to change. Calls are company data, shared by everyone
with the feature. A row never carries the Daily room name or a token: `publicUrl` is our own
`/apel/<publicId>` link.

| Method | Route | Description |
|---|---|---|
| GET | `/api/calls` | Query: `status` (`open`, `ended`, `all`), `limit` (max 200) |
| POST | `/api/calls` | `{ title, expiresInHours? (1-8, default 4), prospectId?, billingClientId? }` → 201. 503 without Daily, 502 when Daily fails |
| PATCH | `/api/calls/:id` | `{ title?, prospectId?, billingClientId? }` |
| POST | `/api/calls/:id/join` | `{ roomUrl, token }`, an owner token for the person. 410 once the call is closed |
| POST | `/api/calls/:id/end` | Deletes the room (everyone is removed) and marks the call `ended` |
| GET | `/api/public/calls/:publicId` | No session. `{ status, opensAt, closesAt, roomUrl }`; `roomUrl` is `null` once closed |

A public booking gets a room from 15 minutes before to an hour after its slot; canceling the
booking closes it. `jobs/calls-close.ts` closes expired rooms every 30 minutes (20 per run, one
request at a time) and keeps the duration and the most people at once.

## Crypto

Market data from the public CoinGecko API and DEX pools from GeckoTerminal (60s in-memory
cache, hostname allowlist); trading on Binance (production and testnet, HMAC-SHA256 signature).
Paper mode simulates orders in `crypto_paper_orders`, filled at the public price. Live mode
needs the kill switch on (`crypto_trading_enabled` in `dashboard_config`, off when missing) and
keys without withdrawal permission. Price alerts are ordinary rows in `alert_rules` on the
metrics `crypto.<id>` / `crypto.dex.<poolId>`, written by `jobs/crypto-price-sync.ts` (every 5
minutes, watchlist plus the top 50).

| Method | Route | Description |
|---|---|---|
| GET | `/api/crypto/markets` | Query: `page?` (1..20), `limit?` (25 default \| 50), `category?` (`all`\|`gainers`\|a CoinGecko category id) |
| GET | `/api/crypto/coin/:id` | Full detail for a coin's page |
| GET | `/api/crypto/coin/:id/chart` | Query: `days?` (1\|7\|30\|90\|365, default 7), the price series, downsampled to about 160 points |
| GET | `/api/crypto/coin/:id/candles` | Query: `days?`, OHLC candles |
| GET | `/api/crypto/search` | Query: `q` → `{ coins[], pools[] }`. DEX-only assets can be watched and alerted on, not traded |
| GET | `/api/crypto/watchlist` | The favourites |
| POST | `/api/crypto/watchlist` | Adds `{ kind: 'cex'\|'dex', id, symbol, name, network?, address?, dex? }` |
| DELETE | `/api/crypto/watchlist/:kind/:id` | Removes a favourite |
| GET | `/api/crypto/watchlist/prices` | Current price, 24h change and a mini series per favourite |
| GET | `/api/crypto/portfolio` | Query: `exchange?`. Paper positions (average cost, P&L at the live price) or live, read-only |
| GET | `/api/crypto/orders` | The last 100 paper orders |
| GET | `/api/crypto/trades` | Query: `exchange?`, `symbol?` (required on live), the trade history |
| POST | `/api/crypto/orders/preview` | Step one: validates and estimates (`referencePrice`, `estimatedQuoteValue`); places nothing |
| POST | `/api/crypto/orders` | Step two: executes. A paper market order fills at once; a limit order stays `open` until the sync crosses its price; a live order is refused while the kill switch is off |
| GET | `/api/crypto/exchanges` | The connections. `apiKeyMasked`; the raw key is never returned |
| PUT | `/api/crypto/exchanges/:exchange` | `{ apiKey, apiSecret, mode: 'paper'\|'live', enabled }`, encrypted, upsert |
| DELETE | `/api/crypto/exchanges/:exchange` | Disconnects (soft delete) |
| GET | `/api/crypto/settings` | `{ tradingEnabled }`, the kill switch |
| PUT | `/api/crypto/settings` | `{ tradingEnabled }`. `false` blocks live orders only |

### Trading bot (the "Bot" tabs)

An optional integration with an external paper trading bot. Its data arrives by **push**: the
bot's export POSTs every 5 minutes, so the bot's server does not have to be reachable from
outside. The feature (`investitii.bots`), the tabs and the alerts job exist only where
`JEFFBOT_INGEST_TOKEN` is set. The reference shape of the snapshot is
`backend/src/modules/jeffbot/fixtures/snapshot.json`.

| Method | Route | Description |
|---|---|---|
| POST | `/api/v1/integrations/jeffbot/snapshot` | Machine to machine, header `X-Ingest-Token`. Rate limit 30 per minute. Body: `schemaVersion: 1`, `services`, `data`, `model`, `strategies`, `equityPoints`, `trades`, `news`, `reviews`, and optionally `stocks`. Idempotent: `equityPoints` upsert on `(market, key, ts)`, `trades` on `sourceId`, `reviews` on `(date, kind)`. `200` · `400` validation · `401` token |
| GET | `/api/jeffbot/overview` | Query: `market` (`crypto`\|`stocks`, default `crypto`). `{ receivedAt, stale, snapshot, trades[50], reviews[10] }`, or `data: null` until the first snapshot (for `stocks`: until a snapshot has a `stocks` block). `stale` is true after 15 minutes |
| GET | `/api/jeffbot/equity` | Query: `days` (`7`\|`30`\|`90`\|`all`, default `30`), `market` → `[{ key, ts, equity }]` |
| GET | `/api/jeffbot/reviews/:id` | A full review, with `markdown`. 404 on an unknown id |

The `stocks` block is `{ currency, session: { isOpen, nextOpen, nextClose }, broker: { name,
mode, ok, error }, prices[], strategies[], equityPoints[], trades[], news[] }`. Amounts are in
`currency` although the fields are named `valueUsdt` / `feeUsdt`. Reference shape:
`fixtures/snapshot-stocks.json`.

Alerts (`jobs/jeffbot-alerts.ts`, every 5 minutes, only after the first snapshot):
`jeffbot.offline` (the last snapshot is older than 30 minutes), `jeffbot.service.<name>` (a
service that is not `active` in a fresh snapshot) and `jeffbot.review.critical`. One alert per
episode, even if you acknowledge it in between.

## Assets

The same skeleton as Crypto, on traditional markets. Prices: Finnhub (stocks, ETFs) and Twelve
Data (XAU/USD, XAG/USD), 60s cache, one encrypted key per provider in `asset_price_providers`.
Broker: Trading212, live only (it has no testnet, so paper is simulated locally in
`asset_paper_orders`). Kill switch `asset_trading_enabled`, off when missing. Price alerts are
ordinary rows in `alert_rules` on `asset.<symbol>`, written by `jobs/assets-price-sync.ts`
(every 15 minutes, watchlist only).

**Two symbol namespaces.** Preview and paper use the price provider's symbol (`AAPL`,
`XAU/USD`). A live order sends the symbol straight to Trading212 as its ticker (`AAPL_US_EQ`).
There is no automatic mapping between the two, because a wrong one would place a wrong order
with real money.

| Method | Route | Description |
|---|---|---|
| GET | `/api/assets/search` | Query: `q` → Finnhub symbols; empty without the key |
| GET | `/api/assets/metals` | The fixed Twelve Data pairs (XAU/USD, XAG/USD) |
| GET | `/api/assets/index-list` | Query: `page?`, `limit?` (25 default \| 50), `q?`. A static S&P 500 + Nasdaq 100 list, paginated; not a live ranking. Live prices only for the visible page |
| GET | `/api/assets/detail/:category/:symbol` | Quote and company profile for a symbol's page |
| GET | `/api/assets/detail/:category/:symbol/chart` | Query: `days?` (1\|7\|30\|90\|365, default 7), OHLC bars from Twelve Data |
| GET | `/api/assets/watchlist` | The favourites |
| POST | `/api/assets/watchlist` | Adds `{ category: 'stock'\|'etf'\|'metal', symbol, name }` |
| DELETE | `/api/assets/watchlist/:category/:symbol` | Removes a favourite |
| GET | `/api/assets/watchlist/prices` | Current price, change and a mini series (30 days) per favourite |
| GET | `/api/assets/portfolio` | Paper positions, or Trading212 live, read-only |
| GET | `/api/assets/orders` | The last 100 paper orders |
| POST | `/api/assets/orders/preview` | Step one: validates and estimates; places nothing |
| POST | `/api/assets/orders` | Step two: executes, as for crypto |
| GET | `/api/assets/brokers` | The connections. `apiKeyMasked` |
| PUT | `/api/assets/brokers/:broker` | `{ apiKey?, mode: 'paper'\|'live', enabled }`. `apiKey` is optional on paper and required on live |
| DELETE | `/api/assets/brokers/:broker` | Disconnects (soft delete) |
| GET | `/api/assets/price-providers` | The price keys connected. `apiKeyMasked` |
| PUT | `/api/assets/price-providers/:provider` | `{ apiKey }`. `provider`: `finnhub`\|`twelvedata` |
| DELETE | `/api/assets/price-providers/:provider` | Disconnects (soft delete) |
| GET | `/api/assets/settings` | `{ tradingEnabled }` |
| PUT | `/api/assets/settings` | `{ tradingEnabled }`. `false` blocks live orders only |

## Settings

| Method | Route | Description |
|---|---|---|
| GET | `/api/settings/nav-layout` | The order and visibility of the menu items; `null` means the default |
| PUT | `/api/settings/nav-layout` | `{ items: [{ to, visible }] }`. Items that are new in the code and missing here appear at the end, visible |

## Support

Tickets to whoever runs the installation. `/api/support/*` belongs to any active person and
shows only their own tickets; someone else's answers `404`. `/api/platform/support/*` needs
`is_platform_admin` and answers `404` to anyone else. A ticket is `{ id, subject, description,
status: 'deschis'|'raspuns'|'inchis', page, createdAt, lastActivityAt, unread, author: { id,
name } }`; the detail adds `replies[]` (`{ id, body, isPlatformReply, createdAt, author }`).

| Method | Route | Description |
|---|---|---|
| GET | `/api/support/tickets` | My tickets, unread first |
| POST | `/api/support/tickets` | `{ subject (1-160), description (1-5000), page? }` → `201`. Push and email to the platform accounts |
| GET | `/api/support/tickets/:id` | The ticket and its thread; marks it read for the author |
| POST | `/api/support/tickets/:id/replies` | `{ body }`. Reopens the ticket, even a closed one, and makes it unread for the platform |
| PATCH | `/api/support/tickets/:id` | `{ status: 'inchis' }` |
| GET | `/api/support/unread` | `{ mine, platform }`; `platform` is `null` without a platform account |
| GET | `/api/platform/support/tickets?status=` | All tickets, unread first |
| GET | `/api/platform/support/tickets/:id` | The ticket and its thread; marks it read for the platform |
| POST | `/api/platform/support/tickets/:id/replies` | `{ body }`. The ticket moves to `raspuns`; push and email to the author |
| PATCH | `/api/platform/support/tickets/:id` | `{ status: 'inchis' }` |

## Public booking

Call bookings from the company website; see `docs/BOOKING.md`. The `/api/v1/public/*` routes
are called only by the website's server-side function, after Turnstile, with the header
`X-Booking-Token` (`BOOKING_TOKEN`). A browser does not call them. Booking starts with
`enabled=false`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/v1/public/booking/slots` | Query: `days?` (1–60, default 14). `{ timezone, durationMin, slots: [{ start, end }] }`, ISO UTC. Empty while booking is off. No titles or details from the calendar. Rate limit 60 per minute |
| POST | `/api/v1/public/booking` | `{ start, name, email, company?, topic, consent: true, locale? }`. `locale` is the two-letter language of the site page; it picks the language of the emails and the cancel link (`BOOKING_CANCEL_URL_<LANG>`). 201 `{ bookingId, start, end }`; 409 `slot_taken`; 422 `validation` (links in the name or company included); 429 `daily_cap` (5 new bookings a day). Rate limit 10 per minute |
| POST | `/api/v1/public/booking/cancel` | `{ token }` from the link in the email. 200 `{ start, end }`; 404 `not_found` (unknown, already cancelled or purged); 410 `too_late` (after the call started). There is no GET |
| GET | `/api/booking/settings` | `{ enabled, durationMin, bufferMin, minNoticeHours, horizonDays, weekly: [{ weekday 1–7, start, end }] }`, hours on Bucharest time |
| PUT | `/api/booking/settings` | The same object, validated as a whole |
| GET | `/api/booking/preview` | Query: `days?`. What the website sees now (same shape as `/slots`) |
| GET | `/api/booking/blocks` | Query: `from`, `to`. The intervals blocked for booking |
| POST | `/api/booking/blocks` | `{ startAt, endAt, reason? }` → 201 |
| DELETE | `/api/booking/blocks/:id` | Unblocks (soft delete) |
| GET | `/api/booking/bookings` | Query: `from`, `to`. `[{ id, calendarEventId, start, end, name, email, company, topic, status, createdAt }]`; the personal fields are `null` after the purge |
| POST | `/api/booking/bookings/:id/cancel` | `{ notifyVisitor? }` (default `true`). Cancels, deletes the event, and emails the visitor only with `notifyVisitor` |

A slot is free if it is inside the weekly schedule, after `minNoticeHours`, within
`horizonDays`, and does not touch (with `bufferMin` on both sides) a blocked interval, a
calendar occurrence (RRULE expanded; all-day events take the local day) or a confirmed booking.
Recurring expenses shown in the calendar take no time.

## What a connected platform has to expose

A platform is anything that implements the connector interface; see `docs/CONNECTOR_GUIDE.md`
and `docs/METRIC_KEYS.md`. For the built-in `vanagreen` connector that is an aggregated metrics
endpoint (`GET /api/v1/platform/metrics`, Bearer key, no personal data), `GET /health`, and
optionally `GET /api/v1/platform/health-signals`.
