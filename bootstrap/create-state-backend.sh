#!/usr/bin/env bash
# Creates the Terraform state bucket (ADR-012). The only AWS resource made outside Terraform, besides the
# deploy user (D-G1). Safe to run again: it exits early if the bucket already exists.
#
#   bootstrap/create-state-backend.sh
#
# Uses the AWS CLI's default profile (the admin user). The bucket is docbeam-tfstate-<account id> in
# ap-southeast-2: versioned, encrypted with SSE-KMS and a Bucket Key, Block Public Access on, TLS only.
# Terraform locks the state with a lock file in the bucket (use_lockfile = true), so there is no DynamoDB table.
# There is no deny for other principals on purpose: a wrong deny could lock out the admin user (D-M0-4).
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${TF_STATE_BUCKET:-docbeam-tfstate-${ACCOUNT_ID}}"

if [ "$REGION" != "ap-southeast-2" ]; then
  echo "Region must be ap-southeast-2 (the Free plan allows only a few regions). Got: $REGION" >&2
  exit 1
fi

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "State bucket $BUCKET already exists. Nothing to do."
  exit 0
fi

echo "Creating state bucket $BUCKET in $REGION"
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null

aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{
  "Rules": [{
    "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "aws:kms" },
    "BucketKeyEnabled": true
  }]
}'

aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"],
    \"Condition\": { \"Bool\": { \"aws:SecureTransport\": \"false\" } }
  }]
}"

echo "Done. Check it with:"
echo "  aws s3api get-bucket-versioning --bucket $BUCKET"
echo "  aws s3api get-bucket-encryption --bucket $BUCKET"
echo "  aws s3api get-public-access-block --bucket $BUCKET"
echo "  aws s3api get-bucket-policy --bucket $BUCKET"
