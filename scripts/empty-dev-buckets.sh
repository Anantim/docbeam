#!/usr/bin/env bash
# Empties the two dev data buckets, all versions and delete markers, before `terraform destroy` (D-M2-23).
#
#   scripts/empty-dev-buckets.sh dev [--dry-run]
#
# The AWS provider's own emptying fails on buckets with many versions ("token too long"), so this does it
# with the AWS CLI, 1,000 objects at a time. The bucket names come from the Terraform outputs of infra/envs/dev.
#
# --dry-run lists each bucket and how many versions and delete markers it would delete, and deletes nothing.
# Run it first and read the names and numbers; then run the script without the flag.
#
# Safety:
#   - only `dev` is accepted; `prod` is refused;
#   - a bucket is emptied only if it is named docbeam-dev-<something>-<this account's id>;
#   - the Terraform state bucket (docbeam-tfstate-...) can never match that rule.
# Safe to run twice: an empty or missing bucket is a notice, not an error.
set -euo pipefail

ENV_NAME="${1:?usage: scripts/empty-dev-buckets.sh dev [--dry-run]}"
DRY_RUN=false
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Unknown argument '${arg}'. usage: scripts/empty-dev-buckets.sh dev [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [ "$ENV_NAME" = "prod" ]; then
  echo "Refusing: prod buckets are never emptied by this script." >&2
  exit 1
fi
if [ "$ENV_NAME" != "dev" ]; then
  echo "Refusing: only 'dev' is accepted, got '${ENV_NAME}'." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-southeast-2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="terraform -chdir=${ROOT}/infra/envs/${ENV_NAME}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if ! [[ "$ACCOUNT" =~ ^[0-9]{12}$ ]]; then
  echo "Could not read the AWS account id." >&2
  exit 1
fi

# The check is on the name pattern, not on where the name came from.
check_name() {
  local bucket="$1"
  if ! [[ "$bucket" =~ ^docbeam-dev-[a-z0-9-]+-${ACCOUNT}$ ]] || [[ "$bucket" == *tfstate* ]]; then
    echo "Refusing to empty '${bucket}': it is not named docbeam-dev-...-${ACCOUNT}." >&2
    exit 1
  fi
}

BUCKETS=()
for output in object_store_bucket platform_files_bucket; do
  name="$($TF output -raw "$output")"
  check_name "$name"
  BUCKETS+=("$name")
done

count_bucket() {
  local bucket="$1" pages versions markers
  # One "versions markers" line per page of results; the CLI pages through the whole bucket.
  pages="$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
    --query '[length(Versions || `[]`), length(DeleteMarkers || `[]`)]' --output text)"
  versions="$(echo "$pages" | awk '{ v += $1 } END { print v + 0 }')"
  markers="$(echo "$pages" | awk '{ m += $2 } END { print m + 0 }')"
  echo "${bucket}: would delete ${versions} versions and ${markers} delete markers ($((versions + markers)) in total)."
}

empty_bucket() {
  local bucket="$1" total=0 batch="$TMP/batch.json"
  if ! aws s3api head-bucket --bucket "$bucket" --region "$REGION" >/dev/null 2>&1; then
    echo "${bucket}: not found, nothing to do."
    return 0
  fi
  if [ "$DRY_RUN" = true ]; then
    count_bucket "$bucket"
    return 0
  fi
  while true; do
    # The first 1,000 versions and delete markers together. After they are deleted the next call returns the next ones.
    aws s3api list-object-versions --bucket "$bucket" --region "$REGION" --no-paginate --max-keys 1000 \
      --query '{Objects: [Versions, DeleteMarkers][].{Key: Key, VersionId: VersionId}}' --output json >"$batch"
    local count
    # grep exits 1 when nothing matches, which is the normal end of the loop.
    count="$( (grep -o '"Key"' "$batch" || true) | wc -l | tr -d ' ')"
    if [ "$count" -eq 0 ]; then
      break
    fi
    local errors
    errors="$(aws s3api delete-objects --bucket "$bucket" --region "$REGION" --delete "file://${batch}" \
      --query 'Errors[].Message' --output text)"
    if [ -n "$errors" ] && [ "$errors" != "None" ]; then
      echo "${bucket}: delete failed: ${errors}" >&2
      exit 1
    fi
    total=$((total + count))
    echo "${bucket}: deleted ${total} so far"
  done
  echo "${bucket}: empty (${total} versions and delete markers deleted)."
}

for bucket in "${BUCKETS[@]}"; do
  empty_bucket "$bucket"
done

if [ "$DRY_RUN" = true ]; then
  echo "Dry run: nothing was deleted. Run it again without --dry-run to empty these buckets."
else
  echo "Done. Now run: terraform -chdir=infra/envs/${ENV_NAME} destroy (README, Tear down)."
fi
