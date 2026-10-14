#!/usr/bin/env bash
# Checks from inside the private network that every service answers /health through the internal ALB
# (ADR-001: services are checked from inside before the gateway sends traffic to them).
#
#   scripts/check-internal.sh <env>
set -euo pipefail

ENV_NAME="${1:?usage: scripts/check-internal.sh <env>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALB="$(terraform -chdir="${ROOT}/infra/envs/${ENV_NAME}" output -raw alb_dns_name)"

PROBE="const hosts=['3001','3002','3003'];let bad=0;(async()=>{for(const p of hosts){try{const r=await fetch('http://${ALB}:'+p+'/health');const b=await r.text();console.log(p,r.status,b);if(!r.ok)bad=1}catch(e){console.log(p,'error',String(e));bad=1}}process.exit(bad)})()"

"${ROOT}/scripts/run-task.sh" "$ENV_NAME" auth service node -e "$PROBE"
