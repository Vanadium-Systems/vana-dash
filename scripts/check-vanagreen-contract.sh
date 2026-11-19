#!/usr/bin/env bash
# The billing-state fixtures are the contract between vana-dash and VanaGreen (recyclers_app):
# both test suites read them, and VanaGreen keeps a copy. This fails when the two copies differ.
#   scripts/check-vanagreen-contract.sh [path to recyclers_app]   (default: ../recyclers_app)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
other=${1:-"$here/../recyclers_app"}
ours="$here/backend/src/connectors/vanagreen/contract/billing-state.v1"
theirs="$other/backend/test/fixtures/vanadash-billing-state.v1"
if [[ ! -d "$theirs" ]]; then
  echo "no VanaGreen copy at $theirs" >&2
  exit 2
fi
if diff -r "$ours" "$theirs"; then
  echo "billing-state v1 fixtures: identical"
else
  echo "billing-state v1 fixtures differ: copy $ours to $theirs in the same change" >&2
  exit 1
fi
