#!/usr/bin/env bash
# For the demo recording (docs/DEMO-SCRIPT.md): uploads 100 files and sends them to 20 folders as load.user@example.com,
# so there are 2,000 deliveries to watch. Prints the address of the live status page.
#   scripts/demo-send.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" demo-send "$@"
