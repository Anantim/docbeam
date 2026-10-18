#!/usr/bin/env bash
# Check 5.8: a database failover during a 2,000-task run. Deliveries pause, then finish; nothing is lost.
# Changes AWS: switches the dev database to Multi-AZ (about +0.6 USD a day), reboots it with failover, and switches it
# back to Single-AZ whatever happens. If the Free plan refuses Multi-AZ the check records the exact error and stops.
# Needs IMAGE_TAG (the tag dev runs) and `gh` signed in for ALARM_EMAIL.
#   scripts/m5-failover.sh --yes
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" failover "$@"
