#!/usr/bin/env bash
# Times the body checks of a 100 x 20 POST /jobs with the CPU limited to 0.25 vCPU (check 5.1, D-M5-14).
# Local only: no AWS. Run `npm run build` first. CPUS=0.5 (or 1) shows the other task sizes.
#   scripts/m5-schema-timing.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec docker run --rm --cpus="${CPUS:-0.25}" -v "$root:/app:ro" -w /app node:22-slim node --no-warnings scripts/m5/schema-timing.ts
