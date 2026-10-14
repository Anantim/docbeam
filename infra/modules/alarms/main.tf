terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Four alarms and one email address (D-G12, D-M2-2). Anything in a dead-letter queue is a task or a job that
# will not finish by itself, so each DLQ alarms as soon as one message waits.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "dlq" {
  for_each = var.dlq_names

  alarm_name          = "${var.name}-${each.key}-dlq-not-empty"
  alarm_description   = "A message is waiting in the ${each.key} dead-letter queue for 5 minutes. The DLQ Consumer marks it, or a person must look."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = each.value }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Errors over invocations above 1% for 15 minutes (three periods of five). No invocations is no data,
# which is not a breach.
resource "aws_cloudwatch_metric_alarm" "delivery_errors" {
  alarm_name          = "${var.name}-delivery-error-rate"
  alarm_description   = "More than 1% of Delivery invocations failed for 15 minutes."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  metric_query {
    id          = "rate"
    expression  = "100 * errors / invocations"
    label       = "Delivery error rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      dimensions  = { FunctionName = var.delivery_function_name }
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "invocations"
    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Invocations"
      dimensions  = { FunctionName = var.delivery_function_name }
      period      = 300
      stat        = "Sum"
    }
  }
}
