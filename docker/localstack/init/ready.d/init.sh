#!/usr/bin/env bash
# Creates the local buckets and queues once LocalStack is ready. The settings match the design:
# maxReceiveCount 3 (Job) and 5 (Task, Upload Events), visibility 360 s, 720 s and 3,600 s,
# 14-day retention, and an event for every new object under staging/ (ADR-005, ADR-016).
set -euo pipefail
P=docbeam-local
REGION=ap-southeast-2
ACCOUNT=000000000000
RETENTION=1209600

queue() { # name visibility [dlq-name max-receive]
  local attrs="{\"VisibilityTimeout\":\"$2\",\"MessageRetentionPeriod\":\"$RETENTION\""
  if [ $# -eq 4 ]; then
    attrs+=",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"arn:aws:sqs:$REGION:$ACCOUNT:$3\\\",\\\"maxReceiveCount\\\":\\\"$4\\\"}\""
  fi
  attrs+="}"
  awslocal sqs create-queue --queue-name "$1" --attributes "$attrs" >/dev/null
}

queue "$P-job-dlq" 30
queue "$P-task-dlq" 30
queue "$P-upload-events-dlq" 30
queue "$P-job" 360 "$P-job-dlq" 3
queue "$P-task" 720 "$P-task-dlq" 5
queue "$P-upload-events" 3600 "$P-upload-events-dlq" 5

awslocal s3api create-bucket --bucket "$P-object-store" \
  --create-bucket-configuration LocationConstraint=$REGION >/dev/null
awslocal s3api create-bucket --bucket "$P-platform-files" \
  --create-bucket-configuration LocationConstraint=$REGION >/dev/null
awslocal s3api put-bucket-versioning --bucket "$P-platform-files" \
  --versioning-configuration Status=Enabled
awslocal s3api put-bucket-cors --bucket "$P-object-store" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://127.0.0.1:5173"],
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}'
awslocal s3api put-bucket-notification-configuration --bucket "$P-object-store" --notification-configuration "{
  \"QueueConfigurations\": [{
    \"QueueArn\": \"arn:aws:sqs:$REGION:$ACCOUNT:$P-upload-events\",
    \"Events\": [\"s3:ObjectCreated:*\"],
    \"Filter\": {\"Key\": {\"FilterRules\": [{\"Name\": \"prefix\", \"Value\": \"staging/\"}]}}
  }]
}"

touch /tmp/docbeam-ready
echo "docbeam: buckets and queues ready"
