#!/usr/bin/env bash
# Check 5.7 (and the cross-team part of 5.12): a viewer in one destination team sees only that team's deliveries and
# audit events, and gets 404 for a file sent only to another team.
#   scripts/m5-team-viewer.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" team-viewer "$@"
