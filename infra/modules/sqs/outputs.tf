output "queue_urls" {
  description = "URL of each queue, keyed job, task, upload-events and the same with a -dlq suffix."
  value = merge(
    { for k, q in aws_sqs_queue.main : k => q.url },
    { for k, q in aws_sqs_queue.dlq : "${k}-dlq" => q.url },
  )
}

output "queue_arns" {
  value = merge(
    { for k, q in aws_sqs_queue.main : k => q.arn },
    { for k, q in aws_sqs_queue.dlq : "${k}-dlq" => q.arn },
  )
}

output "queue_names" {
  value = merge(
    { for k, q in aws_sqs_queue.main : k => q.name },
    { for k, q in aws_sqs_queue.dlq : "${k}-dlq" => q.name },
  )
}

output "upload_events_queue_arn" {
  description = "Waits for the queue policy, so the bucket notification is created only after S3 may send to it."
  value       = aws_sqs_queue.main["upload-events"].arn
  depends_on  = [aws_sqs_queue_policy.upload_events]
}
