terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# The Sweeper's two schedules (ADR-014): re-send unstarted jobs every minute, clean up once a day.

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-sweeper-schedule"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy" "invoke" {
  name = "invoke-sweeper"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = var.function_arn
    }]
  })
}

locals {
  schedules = {
    resend  = "rate(1 minute)"
    cleanup = "rate(1 day)"
  }
}

resource "aws_scheduler_schedule" "sweeper" {
  for_each = local.schedules

  name                = "${var.name}-sweeper-${each.key}"
  schedule_expression = each.value

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = var.function_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ task = each.key })

    # One run a minute that fails is followed by the next. Retrying a stale run adds nothing.
    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
