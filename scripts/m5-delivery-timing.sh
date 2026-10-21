#!/usr/bin/env bash
# F1 (D-F1-55): one 100 files x 20 teams distribution in normal operation on dev, timed from POST /jobs accepted to the
# first delivery, to half of them and to all 2,000, with deliveries per second.
#   scripts/m5-delivery-timing.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" delivery-timing "$@"
