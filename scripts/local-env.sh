#!/usr/bin/env bash
# Makes .env ready for the local stack: copies .env.example if there is no .env, then adds the
# generated values that are missing (signing key, client secrets, seed password). Safe to re-run.
# The generated values live only in .env, which git ignores (AGENTS.md "Secrets").
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

has() { grep -q "^$1=" .env; }
rand() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }

if ! has JWT_PRIVATE_KEY; then
  # One line, newlines written as \n; the auth service reads that form (keys.ts).
  key="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | awk '{printf "%s\\n", $0}')"
  printf 'JWT_PRIVATE_KEY="%s"\n' "$key" >> .env
fi
for client in DELIVERY_WORKER DOCBEAM_API WS_HANDLERS SEED_SCRIPT; do
  has "CLIENT_SECRET_${client}" || printf 'CLIENT_SECRET_%s=%s\n' "$client" "$(rand)" >> .env
done
has SEED_USER_PASSWORD || printf 'SEED_USER_PASSWORD=%s\n' "$(rand)" >> .env
echo ".env is ready"
