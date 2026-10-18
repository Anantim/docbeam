#!/usr/bin/env bash
# Server-side latency per gateway route from the API Gateway access log (Logs Insights), since a time.
#   scripts/m5-server-metrics.sh [--since=2026-10-17T10:00:00Z]
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" metrics "$@"
