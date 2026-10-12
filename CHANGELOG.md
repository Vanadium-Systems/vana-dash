# Changelog

Notable changes, newest first. The app is deployed continuously from `main`, so entries are
dated rather than versioned. What users see is also listed in the app, under Updates
(`frontend/src/modules/updates/releases.ts`).

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
