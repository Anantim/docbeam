terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Six queues (ADR-005, ADR-008, ADR-016): Job, Task and Upload Events, each with a dead-letter queue.
# All use SSE-SQS and keep messages 14 days. Visibility timeouts are 6 times the consuming Lambda's timeout.

locals {
  retention_seconds = 14 * 24 * 60 * 60

  queues = {
    job = {
      visibility_timeout = 360 # Fan-out: 60 s timeout
      max_receive_count  = 3
    }
    task = {
      visibility_timeout = 720 # Delivery: 120 s timeout
      max_receive_count  = 5
    }
    "upload-events" = {
      visibility_timeout = 3600 # Upload Events: 600 s timeout
      max_receive_count  = 5
    }
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each = local.queues

  name                      = "${var.name}-${each.key}-dlq"
  message_retention_seconds = local.retention_seconds
  sqs_managed_sse_enabled   = true
  # The DLQ Consumer's timeout is 60 s.
  visibility_timeout_seconds = 360
}

resource "aws_sqs_queue" "main" {
  for_each = local.queues

  name                       = "${var.name}-${each.key}"
  visibility_timeout_seconds = each.value.visibility_timeout
  message_retention_seconds  = local.retention_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each = local.queues

  queue_url = aws_sqs_queue.dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main[each.key].arn]
  })
}

# S3 may send events for the Object Store, and only for it.
data "aws_iam_policy_document" "upload_events" {
  statement {
    sid       = "AllowObjectStoreEvents"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main["upload-events"].arn]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.object_store_bucket_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "upload_events" {
  queue_url = aws_sqs_queue.main["upload-events"].id
  policy    = data.aws_iam_policy_document.upload_events.json
}
