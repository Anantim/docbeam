#!/usr/bin/env bash
# Check 5.10: cancelling mid-run. Running deliveries finish, waiting ones show CANCELLED, the job reads cancelled.
# The cancel is a POST with no body.
#   scripts/m5-cancel.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" cancel "$@"
