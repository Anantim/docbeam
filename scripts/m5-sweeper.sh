#!/usr/bin/env bash
# Check 5.13: the job message is dropped after the commit. The Sweeper starts fan-out within 3 minutes.
# Changes AWS: disables the Fan-out trigger, purges the Job Queue (only after checking that nothing else is queued or
# running), enables the trigger again. No code change.
#   scripts/m5-sweeper.sh --yes
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" lost-job "$@"
