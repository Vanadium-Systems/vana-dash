# Standard metric keys

Every connector maps onto these keys in its `transform.ts`. The dashboard aggregates across
platforms only on standard keys.

| Key | Unit | Kind | Meaning |
|---|---|---|---|
| `revenue` | RON | flow | Total revenue in the period |
| `active_clients` | count | gauge | Active clients |
| `collection_count` | count | flow | The platform's main transactions |
| `stock_kg` | kg | gauge | Current stock |
| `mrr` | RON | gauge | Monthly recurring revenue |
| `user_count` | count | gauge | Active users of the platform |

A **gauge** is the current state (the dashboard shows the latest value). A **flow** accumulates
over the period (shown as a total or a daily series).

## Custom keys

Anything that does not fit a standard key takes the platform's prefix: `<platform>.<metric>`.

Emitted today by the VanaGreen connector:

| Key | Unit |
|---|---|
| `vanagreen.inactive_tenants` | count |
| `vanagreen.outgoing_this_month` | count |
| `vanagreen.storage_bytes` | bytes |
| `vanagreen.demo_clients` | count |

`revenue` and `mrr` no longer come from that connector: the money now lives entirely in VanaDash
(see `getRecurringRevenue` in `modules/financials/service.ts`). `active_clients` excludes demo
accounts, which are counted separately in `vanagreen.demo_clients`.

## Conventions

- For snapshots, truncate `recorded_at` to the start of the day: one point per day per metric,
  and repeated syncs upsert the same point.
- The value is always numeric (`numeric(18,4)` in the database). What is not a number is not a
  metric.
