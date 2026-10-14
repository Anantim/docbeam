output "instance_id" {
  value = aws_db_instance.this.identifier
}

output "endpoint" {
  description = "Direct address of the instance. ECS services use this."
  value       = aws_db_instance.this.address
}

output "proxy_endpoint" {
  description = "RDS Proxy address, or null when the proxy is off (dev, D-M0-6)."
  value       = one(aws_db_proxy.this[*].endpoint)
}

output "lambda_db_host" {
  description = "Host the Lambdas put in their config: the proxy when it exists, otherwise the instance."
  value       = coalesce(one(aws_db_proxy.this[*].endpoint), aws_db_instance.this.address)
}

output "port" {
  value = 5432
}

output "master_secret_arn" {
  description = "RDS-managed master login. Used by the bootstrap task and the migrate tasks."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "app_secret_arns" {
  description = "Secret ARN of each app role, keyed by service: auth, platform, docbeam."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "proxy_security_group_id" {
  value = one(aws_security_group.proxy[*].id)
}
