#!/usr/bin/env bash
# Check 5.4: a never-uploaded file gets 422 FILE_NOT_READY and creates nothing; a file removed after submitting fails
# only its own tasks with FILE_NOT_UPLOADED. Changes AWS: pauses the Delivery trigger, deletes one staged object.
#   scripts/m5-file-checks.sh --yes
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" file-checks "$@"
