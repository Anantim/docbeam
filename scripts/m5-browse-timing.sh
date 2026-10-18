#!/usr/bin/env bash
# Check 5.5: browsing loads in under 1 second for a user in 50 teams (the dev load seed). Client side over 40 runs,
# and server side from the API Gateway access log.
#   scripts/m5-browse-timing.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" browse "$@"
