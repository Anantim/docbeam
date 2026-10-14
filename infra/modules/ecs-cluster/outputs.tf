output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "db_bootstrap_task_definition" {
  description = "Family name; run-task uses the latest revision."
  value       = aws_ecs_task_definition.db_bootstrap.family
}

output "one_off_task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "db_bootstrap_log_group" {
  value = aws_cloudwatch_log_group.db_bootstrap.name
}
