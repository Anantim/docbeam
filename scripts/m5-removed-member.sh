#!/usr/bin/env bash
# Check 5.2: the sender is removed from one of 20 destination teams after submitting, with the Delivery trigger paused.
# That team's 100 deliveries fail NOT_AUTHORIZED_AT_DELIVERY and the other 1,900 complete. Restores the seed at the end.
# Changes AWS: pauses the Delivery trigger, runs the seed variant as a one-off task.
#   scripts/m5-removed-member.sh --yes
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" removed-member "$@"
