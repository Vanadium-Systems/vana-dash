# Changelog

Notable changes, newest first. The app is deployed continuously from `main`, so entries are
dated rather than versioned. What users see is also listed in the app, under Updates
(`frontend/src/modules/updates/releases.ts`).

## 2026-10-19: Safer unsubscribe and platform URL check

### Fixed
- Unsubscribe links in emails no longer unsubscribe on open. Link scanners (Outlook Safe Links,
  antivirus gateways) open every link in a message, so `GET /api/email/unsubscribe/:token` now
  shows a confirm button and only the `POST` unsubscribes.
- One-click unsubscribe (RFC 8058) answered 415: the client posts a form body and the server had
  no parser for it. The route now accepts it, so Gmail's Unsubscribe chip works.
- A platform URL whose name resolves to a private or loopback address (`localtest.me` is
  127.0.0.1) is refused on create and edit, not only an address written as such.

## 2026-10-19: Message bubbles, read receipts and photo thumbnails

### Added
- Delivered and seen ticks: `conversation_members.delivered_up_to` (migration 0070), moved when
  the reader loads the conversation list or the thread, a `delivered` stream event and
  `receipts` on the thread. Seen comes from the existing last-read message.
- Message bubbles, with the time and the ticks inside.
- `?size=thumb` on chat image attachments: a 640px JPEG made with `vipsthumbnail` (vips-tools in
  the backend image) on first request and kept in R2. Attachments are cached as `immutable`.

### Fixed
- A thread now opens at the last message and stays there while photos load or the keyboard
  opens; sending a message always brings you down to it.
- The tender sync could insert one notice twice in a single upsert, which Postgres rejects; the
  rejection was unhandled and stopped the server. Rows are deduplicated, and an unhandled
  rejection from any job is now logged instead of ending the process.

## 2026-10-19: Prospect owners, booking language and small fixes

### Added
- Prospects have an owner (`assigned_user_id`, migration 0068): `GET /api/prospects/assignees`,
  `assignedUserId` on `PATCH /api/prospects/:id`, a "Mine" filter and a history entry on change.
- Bookings keep the language of the site page (`bookings.locale`, migration 0069). The emails
  are written in it and the cancel link uses `BOOKING_CANCEL_URL_<LANG>` when set.
- A guide for My profile. A guide may have no feature, meaning everyone sees it.
- `GET /api/assets/index-list` returns `priceKeyMissing`; the page explains the empty prices.

### Fixed
- On a 390px screen, Modules and Team were wider than the viewport: visually hidden labels in
  the table escaped its scroll container, which was not positioned.

## 2026-10-19: Blank contracts and the ANAF token alert

### Added
- `GET /api/contracts/templates/:key/blank` returns the contract, the price annex or the
  addendum as a PDF with the client's fields as dotted lines. Nothing is stored. Three buttons
  on the contract templates card call it.
- `POST /api/accounting/anaf/refresh` renews the ANAF tokens on demand, with a button on the
  ANAF card. A failure there does not mark the credentials as needing re-authorization.

### Fixed
- The `anaf_token_expiring` alert fired with under 7 days left while the nightly refresh only
  acts under 48 hours, so it warned for days about something that would fix itself. It now
  fires under 24 hours.

## 2026-10-13: Dependency and code scanning fixes

### Security
- Dependencies raised to patched releases, among them `fastify` 5.12.5, `@capacitor/android`
  8.5.3, `@tiptap/*` 3.31, `csv-parse` 7 and `react-router-dom` 7. Transitive packages that
  stayed pinned are forced through `overrides` in `pnpm-workspace.yaml`.
- `escapeHtml` in the email module also escapes double quotes, the BNR rate parser no longer
  builds a regular expression from the currency code, and `deploy.yml` runs with a read-only
  token.

## 2026-10-13: English interface and display currency

### Added
- The interface in English next to Romanian. Texts live in `frontend/src/locales` and
  `backend/src/locales`; a parity test keeps the two languages in step and a lint rule rejects
  a literal written in JSX. Each person picks a language in My profile.
- A display currency per person (RON, EUR, USD). Totals are converted in SQL at the BNR rate of
  each row's day and marked as converted; documents and declarations are not converted.
- System emails and push notifications are written in the recipient's language.
- `db:seed:demo [ro|en]`, with invented EUR and USD rates.
- `DEFAULT_LOCALE` and `DEFAULT_DISPLAY_CURRENCY` in `.env.example`.

## 2026-10-12 — Initial public release

The repository becomes public under the PolyForm Noncommercial License 1.0.0. Everything built
before this date is part of this entry; the earlier history is kept privately.

### Added
- `LICENSE.md`, `CLA.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `TRADEMARKS.md`, issue and pull request templates.
- `db:seed:demo`: invented clients, invoices, prospects, messages and metrics for a first local
  run. It refuses to run in production or on a database that already has clients.
- CI on pull requests: typecheck, lint, tests against PostgreSQL, build.
- An English `README.md`, `.env.example`, connector guide and metric key reference.
- The contract, price annex and addendum templates ship as short sample texts that say so on the
  page. An installation writes its own from the templates screen; what it saves is kept in the
  database and is not overwritten by later versions.

### Fixed
- Saving a contract template was refused when the body used the provider tokens
  (`{{prestator.nume}}` and the like), which every default body does.
- An empty database could not be migrated: migration 0065 raised an exception when no user
  existed yet. It now skips the backfill in that case.
