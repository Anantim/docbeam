output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "security_group_id" {
  value = aws_security_group.service.id
}

output "log_group" {
  value = aws_cloudwatch_log_group.this.name
}

output "task_definition_families" {
  description = "Service, migrate and one-off families."
  value = merge(
    { service = aws_ecs_task_definition.service.family, migrate = aws_ecs_task_definition.migrate.family },
    { for k, t in aws_ecs_task_definition.one_off : k => t.family },
  )
}
