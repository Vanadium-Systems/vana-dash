# Changelog

Notable changes, newest first. The app is deployed continuously from `main`, so entries are
dated rather than versioned. What users see is also listed in the app, under Updates
(`frontend/src/modules/updates/releases.ts`).

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
