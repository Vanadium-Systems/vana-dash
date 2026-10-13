# Contributing

Thanks for looking. VanaDash is one company's back office made public, so the bar for a change
is simple: it must keep working for the people who use it every day.

Issues, pull requests and code comments are in English.

## Before you start

- Bug fixes, translations and connectors for other countries are welcome as pull requests.
- New modules, and changes to how access works, start as an issue. The app is deliberately
  small; a feature nobody here uses will probably be declined, however well it is built.
- Your first pull request asks you to accept the [CLA](CLA.md). The project is
  [source-available](LICENSE.md), and the CLA is what lets it also be licensed commercially.

## Setup

Follow "Run it locally" in the [README](README.md), then load the demo data:

```bash
./dev db seed:demo
```

## The checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four run in CI on every pull request. Backend tests are integration tests against a real
PostgreSQL; they create and delete their own rows.

## Rules that reviews enforce

These are the ones that get a pull request sent back.

- Every route is in the feature catalog. Add it to a feature in
  `backend/src/shared/lib/features.ts`, or declare it `self`, `public` or `machine`. A route
  without `authenticate` has to be declared `public` or `machine`. The server refuses to start
  otherwise, and `feature-guard.test.ts` fails.
- Personal data is filtered per person in the service, next to the query. An object that
  belongs to someone else answers `404`, not `403`.
- Modules do not import each other. A module is `routes.ts`, `service.ts`, `schema.ts` under
  `backend/src/modules/<name>`; shared code lives in `backend/src/shared`.
- Platform-specific logic stays in its connector (`backend/src/connectors/<platform>`), with no
  `if (platform.type === ...)` anywhere else.
- There is no `tenant_id`: this is a single-company app.
- Aggregation is done in SQL, never with `.reduce()` over rows fetched from a large table.
- Metrics are upserted, never plainly inserted.
- Outbound requests have a timeout, and requests to public sources go one at a time with a cap.
  A burst from this code once got a server's IP banned by a government portal.
- Secrets never appear in a response or a log.
- A recursive CTE over `parent_id` uses `UNION` or guards against cycles.
- Code, tests and comments contain no real names, addresses, phone numbers or figures. Tests
  use `Acme` and `example.com`.

## Texts and languages

The interface is in Romanian and English, and every text exists in both.

- Frontend: add the key to `frontend/src/locales/ro/<module>.json` and to the same file under
  `en/`, then read it with `t('module:path.to.key')` from `@/shared/lib/i18n`. Keys are
  checked against the Romanian files, so a typo fails `pnpm typecheck`. Counts use plural
  forms (`_one`, `_few`, `_other` in Romanian; `_one`, `_other` in English). A sentence with
  an element inside it goes through `tNodes()` or `tRich()`.
- Backend: add the key under `backend/src/locales/{ro,en}/` and use `tr()` where the error is
  thrown. A message for someone other than the caller (email, push, alert) uses `trFor()` or
  `tl()` with the recipient's language. A Zod schema message uses `lazyTr()`.
- Numbers, money and dates go through `frontend/src/shared/lib/format.ts`. An amount is shown
  with the currency the server sent, never an assumed one.
- Check [docs/GLOSSARY.md](docs/GLOSSARY.md) so the same thing keeps the same name.
- Tests fail on a key missing from one language, on a literal written in JSX, and on Romanian
  text in code outside `locales/`. The exceptions (invoices, declarations, contracts, emails
  to clients) are listed in `no-romanian-in-code.test.ts`.
- A new language is a new folder next to `ro/` and `en/`, an entry in `LOCALES` and
  `INTL_TAG` on both sides, and, once every screen has it, in `ENABLED_LOCALES`.

For the interface, read [DESIGN.md](DESIGN.md): reuse the existing tokens
and components before adding a colour, a spacing value or a variant.

## Style

Match the file you are editing. Comments explain why, not what. Names come from the domain
(`platformId`, `syncLog`), not `data` or `result`. No abstractions for a future that has not
arrived.

## Commits and pull requests

One change per pull request, with a description of what it does and how you checked it. Database
changes come with a generated migration (`./dev db generate`); never edit a migration that has
already shipped.

Merging to `main` deploys to production, so a maintainer reviews and merges every pull request.
