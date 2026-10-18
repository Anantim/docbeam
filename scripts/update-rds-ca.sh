#!/usr/bin/env bash
# Rebuilds packages/shared/certs/rds-ca-bundle.pem (D-M5-4). Run it when AWS rotates the RDS certificate authority.
#
#   scripts/update-rds-ca.sh
#
# The file holds public certificates only: the RDS global bundle (the instance certificates, Multi-AZ and Proxy-less)
# plus Amazon Root CA 1, which an RDS Proxy certificate chains to (prod). It has no private key.
set -euo pipefail

OUT="$(dirname "$0")/../packages/shared/certs/rds-ca-bundle.pem"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -sSf -m 60 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem >>"$TMP"
curl -sSf -m 60 https://www.amazontrust.com/repository/AmazonRootCA1.pem >>"$TMP"

if grep -q "PRIVATE KEY" "$TMP"; then
  echo "The download holds a private key. Stopping." >&2
  exit 1
fi
count="$(grep -c "BEGIN CERTIFICATE" "$TMP")"
[ "$count" -ge 50 ] || { echo "Only $count certificates in the download. Stopping." >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
mv "$TMP" "$OUT"
chmod 644 "$OUT" # mktemp makes it 0600, and the services run as a user that is not root
trap - EXIT
echo "Wrote $OUT with $count certificates."
sha256sum "$OUT"
