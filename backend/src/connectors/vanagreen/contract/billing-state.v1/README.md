# vanagreen.billing-state v1 fixtures

The contract between vana-dash (sender, `../../billing-state.ts`) and VanaGreen (receiver,
`PUT /api/v1/platform/tenants/:id/billing-state`). VanaGreen keeps a byte-identical copy of this folder
in `backend/test/fixtures/vanadash-billing-state.v1/`; `scripts/check-vanagreen-contract.sh` compares the two.

`valid/` must be accepted by both schemas, `invalid/` refused by both. Data is made up.
Changing a file here is a contract change: copy the folder to VanaGreen in the same change.
