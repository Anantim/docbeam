#!/usr/bin/env bash
# Diagnosis of check 5.1 (D-M5-14): for the window of one submit-load run, the gateway latency and integration latency,
# the API's own phases per job size, the load balancer's response time, and the CPU of the API, the platform and the
# database. Read only.
#   scripts/m5-submit-report.sh --from=2026-10-18T10:00:00Z --to=2026-10-18T10:20:00Z
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" submit-report "$@"
