#!/usr/bin/env bash
# Check 5.1: job submission is accepted in under 1 s at p99 under peak delivery load, or under 500 ms at p99 with
# --quiet (normal operation, deliveries paused) (D-M5-17). Read server side from the API Gateway access log.
# Submits 100 jobs of mixed size (5 of 100 x 20, 20 of 10 x 20, 75 of 1 x 20) and cancels each one (D-M5-7).
#   scripts/m5-submit-load.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" submit-load "$@"
