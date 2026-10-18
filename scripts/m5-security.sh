#!/usr/bin/env bash
# Check 5.12: no-token calls get 401 at the gateway (the load balancer's RequestCount stays 0); a POST with no body
# works through CloudFront; cross-team download and preview get 404; a link fails after 2 minutes; the bucket without
# a link gives 403. Run it alone, so the load balancer count means something. gitleaks: scripts/check-public.sh.
#   scripts/m5-security.sh
set -euo pipefail
exec node --no-warnings "$(dirname "$0")/m5/checks.ts" security "$@"
