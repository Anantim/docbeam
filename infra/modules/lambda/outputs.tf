output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "role_arn" {
  value = aws_iam_role.this.arn
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "log_group" {
  value = aws_cloudwatch_log_group.this.name
}
