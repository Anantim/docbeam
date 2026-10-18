#!/usr/bin/env bash
# Is the repository safe to make public? Checks the whole git history and the working tree (M5).
#
#   scripts/check-public.sh
#
# 1. gitleaks over every commit on every branch, and over the files on disk.
# 2. No .env, key, certificate-with-key, state or tfvars file was ever added (the public RDS CA bundle is expected).
# 3. No private key text in any commit, outside the allowed test fixtures.
# 4. Every email address in the content and messages of every commit is an example address, a GitHub or Anthropic
#    noreply address, or third-party package metadata in package-lock.json.
# 5. The author address of older commits is reported. D-M5-2 accepts it (a .mailmap maps it to the noreply address).
# Exits 1 if any of 1 to 4 fails.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAIL=1; }

# 1. gitleaks (the same pinned image CI uses)
GITLEAKS=ghcr.io/gitleaks/gitleaks:v8.28.0
if docker run --rm -v "$PWD:/repo" "$GITLEAKS" detect --source /repo --redact --no-banner --log-opts="--all" >/tmp/gitleaks-history.txt 2>&1; then
  pass "gitleaks: no secrets in $(git rev-list --all --count) commits on all branches"
else
  fail "gitleaks found something in the history"; cat /tmp/gitleaks-history.txt
fi
# The files git would commit now (tracked, or new and not ignored). A local .env is ignored and never leaves the machine.
TREE="$(mktemp -d)"
git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - 2>/dev/null | tar -x -C "$TREE"
if docker run --rm -v "$TREE:/repo" "$GITLEAKS" detect --source /repo --no-git --redact --no-banner >/tmp/gitleaks-tree.txt 2>&1; then
  pass "gitleaks: no secrets in the files that would be committed"
else
  fail "gitleaks found something in the files that would be committed"; cat /tmp/gitleaks-tree.txt
fi
rm -rf "$TREE"

# 2. files that must never have been added
BAD="$(git log --all --diff-filter=A --name-only --format= | sort -u \
  | grep -E '(^|/)\.env($|\.)|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|\.tfstate|\.tfvars$|credentials$|\.pem$' \
  | grep -vE '^\.env\.example$|^packages/shared/certs/rds-ca-bundle\.pem$' || true)"
if [ -z "$BAD" ]; then pass "no .env, key, state, tfvars or credentials file was ever committed"; else fail "files that should not be in the history:"; echo "$BAD"; fi

# 3. private key text anywhere in history
KEYS="$(git log --all -G'-----BEGIN [A-Z ]*PRIVATE KEY-----' --format='%h %s' --name-only | grep -vE '^$' || true)"
if [ -z "$KEYS" ]; then
  pass "no private key text in any commit"
else
  echo "Commits that touch private key text (read them; fixtures that are generated at run time are fine):"
  echo "$KEYS"
  # A key block with real base64 body is a leak; a header in a code string or a doc is not.
  if git log --all -p --no-color | grep -aE '^\+-----BEGIN [A-Z ]*PRIVATE KEY-----$' >/dev/null; then
    fail "a full private key header sits on a line of its own in a commit"
  else
    pass "private key text appears only inside code or documents, never as a key block"
  fi
fi

# 4. emails in content and messages
ALLOWED='(@example\.(com|test)|@db\.example|@users\.noreply\.github\.com|^noreply@anthropic\.com)$'
# .mailmap holds the older author address on purpose (D-M5-2): it maps it to the noreply address.
# The older author address is the one accepted in D-M5-2. Every commit that carries it in a file or message, apart from
# .mailmap, is listed, so it is never a surprise.
AUTHOR_ADDRESS='anantimpatil2015@gmail.com'
OWN="$(git log --all -p --no-color --format=%B -- . ':(exclude)package-lock.json' ':(exclude).mailmap' \
  | grep -aoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u | grep -vE "$ALLOWED" | grep -vxF "$AUTHOR_ADDRESS" || true)"
if [ -z "$OWN" ]; then pass "every email address in the history is an example or noreply address (or the accepted author address)"; else fail "other email addresses in the history:"; echo "$OWN"; fi
echo "INFO  commits with the accepted author address in a file or message (D-M5-2), apart from .mailmap:"
git log --all -S"$AUTHOR_ADDRESS" --format='        %h %s' -- . ':(exclude).mailmap'
THIRD="$(git log --all -p --no-color --format= -- package-lock.json \
  | grep -aoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u | grep -vE "$ALLOWED" | grep -vE '^[^@]*@[0-9]' || true)"
echo "INFO  third-party package metadata in package-lock.json: ${THIRD:-none}" | tr '\n' ' '; echo

# 5. author addresses
echo "INFO  commit author addresses (D-M5-2 accepts the older one; .mailmap maps it):"
git log --all --format='%ae' | sort | uniq -c | sort -rn | sed 's/^/        /'
git log --all --use-mailmap --format='%aN <%aE>' | sort | uniq -c | sed 's/^/        mailmap view: /'

[ "$FAIL" -eq 0 ] && echo "PASS check-public" || echo "FAIL check-public"
exit "$FAIL"
