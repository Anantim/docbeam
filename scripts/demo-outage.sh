#!/usr/bin/env bash
# For the demo recording: stop or start the Document Platform on dev, to show the backlog draining when it returns.
#   scripts/demo-outage.sh stop     # scales the platform service to 0
#   scripts/demo-outage.sh start    # scales it back to 1
# Dev only. It changes one ECS service's desired count and nothing else.
set -euo pipefail

ACTION="${1:?usage: scripts/demo-outage.sh stop|start}"
REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER=docbeam-dev-cluster
SERVICE=docbeam-dev-platform

case "$ACTION" in
  stop) COUNT=0 ;;
  start) COUNT=1 ;;
  *) echo "usage: scripts/demo-outage.sh stop|start" >&2; exit 64 ;;
esac

aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service "$SERVICE" --desired-count "$COUNT" \
  --query 'service.[serviceName,desiredCount]' --output text
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE"
aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].[serviceName,runningCount,desiredCount]' --output text
