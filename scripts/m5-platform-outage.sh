#!/usr/bin/env bash
# Check 5.3: the platform is stopped for 5 minutes in the middle of a 2,000-task run. The backlog drains when it
# returns and the DLQs stay empty (CloudWatch). Changes AWS: scales the platform ECS service to 0 and back to 1.
#   scripts/m5-platform-outage.sh --yes
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" platform-outage "$@"
